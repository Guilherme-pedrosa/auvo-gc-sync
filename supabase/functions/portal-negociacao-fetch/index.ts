import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

async function auvoLogin(apiKey: string, apiToken: string): Promise<string | null> {
  try {
    const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return j?.result?.accessToken || null;
  } catch { return null; }
}

function parsePgTimestamp(raw: string): number {
  // Postgres devolve "YYYY-MM-DD HH:MM:SS+00" — Deno precisa de "T" e "+00:00"
  if (!raw) return NaN;
  let s = raw.trim().replace(" ", "T");
  // "+00" → "+00:00" ; "-03" → "-03:00"
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

async function fetchAuvoTaskLive(bearer: string, taskId: string): Promise<{ taskUrl: string; durationDecimal: number; checkIn: string | null; checkOut: string | null; equipmentIds: string[]; equipmentName: string; equipmentSerial: string } | null> {
  try {
    const r = await fetch(`${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const res = j?.result || j || {};
    const equipmentIds = Array.from(new Set([
      ...(Array.isArray(res?.equipmentsId) ? res.equipmentsId : []),
      ...(Array.isArray(res?.equipmentsID) ? res.equipmentsID : []),
      ...(Array.isArray(res?.equipmentIds) ? res.equipmentIds : []),
    ].map((id) => String(id || "").trim()).filter(Boolean)));
    return {
      taskUrl: String(res?.taskUrl || ""),
      durationDecimal: Number(res?.durationDecimal || 0),
      checkIn: res?.checkInDate || res?.CheckInDate || null,
      checkOut: res?.checkOutDate || res?.CheckOutDate || null,
      equipmentIds,
      equipmentName: String(res?.equipmentName || res?.equipment?.name || res?.equipment?.model || "").trim(),
      equipmentSerial: String(res?.equipmentIdentifier || res?.equipment?.identifier || res?.equipment?.serial || "").trim(),
    };
  } catch { return null; }
}

function addEquipLabel(map: Map<string, Set<string>>, osId: string, nome: string, serie: string) {
  const cleanNome = String(nome || "").trim();
  const cleanSerie = String(serie || "").trim();
  const label = cleanNome && cleanSerie ? `${cleanNome} (${cleanSerie})` : (cleanNome || (cleanSerie ? `#${cleanSerie}` : ""));
  if (!label) return;
  if (!map.has(osId)) map.set(osId, new Set());
  map.get(osId)!.add(label);
}

// Situações de OS "EXECUTADO*" — todas as variantes exibidas no portal do cliente.
// Podem ser sobrescritas via body.situacao_ids
const DEFAULT_SITUACAO_IDS = [
  "7116099", // EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA
  "7124107", // EXECUTADO COM NOTA EMITIDA
  "8760417", // LIBERADO P/ FATURAMENTO
  "7063724", // AGUARDANDO PAGAMENTO
  "7438044", // EXECUTADO EM GARANTIA
  "7535001", // EXECUTADO - PATRIMÔNIO
  "7720756", // FINANCEIRO SEPARADO
  "8677491", // CIGAM
  "8685059", // IMP CIGAM FATURADO TOTAL
  "8736723", // FINANCEIRO SEPARADO / BAIXA CIGAM
  "8889036", // FECHADO CHAMADO
  "9203836", // CHAMADO FECHADO - FATURADO
];

// Situação prioritária da aba "Negociação Financeira".
const AG_NEGOCIACAO_ID = "7116099";

// Extrai YYYY-MM de uma data em formato ISO (yyyy-mm-dd) ou br (dd/mm/yyyy).
function monthKeyOf(s?: string): string {
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}`;
  return "";
}

const normalize = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(ltda|me|sa|s\.a\.|s\/a|eireli|epp)\s*\.?$/i, "")
    .replace(/[.\-\/]/g, "")
    .replace(/\s+/g, " ");

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class GcApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GcApiError";
    this.status = status;
  }
}

async function assertGcOk(res: Response, context: string) {
  if (res.ok) return;
  let detail = "";
  try {
    const json = await res.json();
    detail = String(json?.data?.mensagem || json?.mensagem || json?.message || json?.erro || "");
  } catch {
    detail = await res.text().catch(() => "");
  }
  throw new GcApiError(res.status, `${context}: GC ${res.status}${detail ? ` - ${detail}` : ""}`);
}

async function fetchOsBySituacao(gcHeaders: Record<string, string>, situacaoId: string) {
  const records: any[] = [];
  const MAX_PAGES = 30;
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${pagina}&situacao_id=${situacaoId}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: gcHeaders });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
        continue;
      }
      break;
    }
    if (!res) throw new GcApiError(0, `ordens_servicos ${situacaoId}: sem resposta do GC`);
    await assertGcOk(res, `ordens_servicos ${situacaoId}`);
    const json = await res.json().catch(() => ({}));
    const data = Array.isArray(json?.data) ? json.data : [];
    records.push(...data);
    const totalPaginas = Number(json?.meta?.total_paginas || 1);
    if (pagina >= totalPaginas) break;
  }
  return records;
}

async function fetchRecebimentosEmAberto(gcHeaders: Record<string, string>) {
  const records: any[] = [];
  const MAX_PAGES = 40;
  // ab = em aberto ; at = em atraso — busca ambos
  for (const liquidado of ["ab", "at"]) {
    for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
      const url = `${GC_BASE_URL}/api/recebimentos?limite=100&pagina=${pagina}&liquidado=${liquidado}`;
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url, { headers: gcHeaders });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
          continue;
        }
        break;
      }
      if (!res) throw new GcApiError(0, `recebimentos ${liquidado}: sem resposta do GC`);
      await assertGcOk(res, `recebimentos ${liquidado}`);
      const json = await res.json().catch(() => ({}));
      const data = Array.isArray(json?.data) ? json.data : [];
      for (const r of data) records.push({ ...r, _liquidado: liquidado });
      const totalPaginas = Number(json?.meta?.total_paginas || 1);
      if (pagina >= totalPaginas) break;
    }
  }
  return records;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchOsFromLocalCache(
  admin: ReturnType<typeof createClient>,
  clientesNorm: Set<string>,
  situacaoIds: string[],
  filtroClienteNorm: string,
  filtroMes: string,
) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = admin
      .from("tarefas_central")
      .select("gc_os_id, gc_os_codigo, gc_os_cliente, cliente, gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_valor_total, gc_os_vendedor, gc_os_data, gc_os_data_saida, gc_os_link, gc_os_link_cobranca, auvo_task_id, gc_os_tarefa_exec, auvo_task_url, auvo_link, equipamento_nome, equipamento_id_serie, duracao_decimal, check_in_iso, check_out_iso, data_conclusao, data_tarefa")
      .not("gc_os_id", "is", null)
      .range(from, from + 999);

    if (situacaoIds.length > 0) query = query.in("gc_os_situacao_id", situacaoIds);

    const { data, error } = await query;
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }

  const byOs = new Map<string, any>();
  const parseTime = (value: string) => {
    const t = parsePgTimestamp(value);
    return Number.isFinite(t) ? t : new Date(value).getTime();
  };

  for (const row of rows) {
    const osId = String(row.gc_os_id || "").trim();
    if (!osId) continue;

    const cliente = String(row.gc_os_cliente || row.cliente || "").trim();
    const clienteNorm = normalize(cliente);
    if (!clientesNorm.has(clienteNorm)) continue;
    if (filtroClienteNorm && clienteNorm !== filtroClienteNorm) continue;

    const dataSaida = String(row.gc_os_data_saida || row.data_conclusao || row.gc_os_data || row.data_tarefa || "").slice(0, 10);
    if (filtroMes && monthKeyOf(dataSaida) !== filtroMes) continue;

    if (!byOs.has(osId)) {
      byOs.set(osId, {
        gc_os_id: osId,
        codigo: String(row.gc_os_codigo || osId),
        cliente,
        situacao: String(row.gc_os_situacao || ""),
        situacao_id: String(row.gc_os_situacao_id || ""),
        cor_situacao: String(row.gc_os_cor_situacao || ""),
        data: String(row.gc_os_data || row.data_tarefa || "").slice(0, 10),
        data_final: "",
        data_saida: dataSaida,
        data_execucao: String(row.data_conclusao || row.check_out_iso || "").slice(0, 10),
        valor_total: Number(row.gc_os_valor_total || 0),
        descricao: "",
        vendedor: String(row.gc_os_vendedor || ""),
        link: String(row.gc_os_link_cobranca || row.gc_os_link || "") || `https://gestaoclick.com/ordens_servicos/editar/${osId}`,
        auvo_task_id: "",
        auvo_task_url: "",
        horas_execucao: 0,
        equipamentos: [] as string[],
        _equipSet: new Set<string>(),
        _bestExecTime: 0,
      });
    }

    const item = byOs.get(osId)!;
    const execTaskId = String(row.gc_os_tarefa_exec || row.auvo_task_id || "").trim();
    const taskId = String(row.auvo_task_id || "").trim();
    const checkOut = String(row.check_out_iso || row.data_conclusao || "").trim();
    const checkOutTime = checkOut ? parseTime(checkOut) : 0;
    const isExecRow = execTaskId && taskId && execTaskId === taskId;

    if (!item.auvo_task_id || isExecRow || checkOutTime > item._bestExecTime) {
      item.auvo_task_id = execTaskId || taskId || item.auvo_task_id;
      item._bestExecTime = Math.max(item._bestExecTime || 0, checkOutTime || 0);
    }

    const publicUrl = String(row.auvo_task_url || "").trim();
    const savedUrl = publicUrl || String(row.auvo_link || "").trim();
    if (savedUrl && (!item.auvo_task_url || /informacoes\/tarefa/.test(savedUrl) || isExecRow)) {
      item.auvo_task_url = savedUrl;
    }

    if (checkOut) {
      const current = String(item.data_execucao || "");
      const next = checkOut.slice(0, 10);
      if (!current || next > current) item.data_execucao = next;
    }

    let h = Number(row.duracao_decimal || 0);
    if (!(h > 0)) {
      const ci = String(row.check_in_iso || "").trim();
      const co = String(row.check_out_iso || "").trim();
      if (ci && co) {
        const diffMs = parseTime(co) - parseTime(ci);
        if (Number.isFinite(diffMs) && diffMs > 0) h = Math.round((diffMs / 3600000) * 100) / 100;
      }
    }
    if (h > 0) item.horas_execucao = Math.max(Number(item.horas_execucao || 0), h);

    addEquipLabel(new Map([[osId, item._equipSet]]), osId, String(row.equipamento_nome || ""), String(row.equipamento_id_serie || ""));
  }

  return Array.from(byOs.values())
    .map((item) => {
      item.equipamentos = Array.from(item._equipSet || []);
      delete item._equipSet;
      delete item._bestExecTime;
      if (item.auvo_task_id && !item.auvo_task_url) {
        item.auvo_task_url = `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${item.auvo_task_id}`;
      }
      return item;
    })
    .sort((a, b) => String(b.data_saida || "").localeCompare(String(a.data_saida || "")));
}

// Busca OS em Ag. Negociação Financeira com equipamento "coifa" no cache local,
// ignorando o filtro de grupo (o cliente pediu para incluir todas as OS de coifa
// nessa situação). Respeita filtro de cliente e mês quando informados.
async function fetchCoifaOsFromCache(
  admin: ReturnType<typeof createClient>,
  filtroClienteNorm: string,
  filtroMes: string,
) {
  const situacaoIds = [AG_NEGOCIACAO_ID];
  const allClientes = new Set<string>();
  // sentinel: fetchOsFromLocalCache exige clientesNorm.has(x) — usamos um Set
  // com um wildcard e adaptamos a lógica localmente.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("tarefas_central")
      .select("gc_os_id, gc_os_codigo, gc_os_cliente, cliente, gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_valor_total, gc_os_vendedor, gc_os_data, gc_os_data_saida, gc_os_link, gc_os_link_cobranca, auvo_task_id, gc_os_tarefa_exec, auvo_task_url, auvo_link, equipamento_nome, equipamento_id_serie, duracao_decimal, check_in_iso, check_out_iso, data_conclusao, data_tarefa")
      .not("gc_os_id", "is", null)
      .in("gc_os_situacao_id", situacaoIds)
      .ilike("equipamento_nome", "%coifa%")
      .range(from, from + 999);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }

  const byOs = new Map<string, any>();
  for (const row of rows) {
    const osId = String((row as any).gc_os_id || "").trim();
    if (!osId) continue;
    const cliente = String((row as any).gc_os_cliente || (row as any).cliente || "").trim();
    const clienteNorm = normalize(cliente);
    if (filtroClienteNorm && clienteNorm !== filtroClienteNorm) continue;
    const dataSaida = String((row as any).gc_os_data_saida || (row as any).data_conclusao || (row as any).gc_os_data || (row as any).data_tarefa || "").slice(0, 10);
    if (filtroMes && monthKeyOf(dataSaida) !== filtroMes) continue;

    if (!byOs.has(osId)) {
      byOs.set(osId, {
        gc_os_id: osId,
        codigo: String((row as any).gc_os_codigo || osId),
        cliente,
        situacao: String((row as any).gc_os_situacao || ""),
        situacao_id: String((row as any).gc_os_situacao_id || ""),
        cor_situacao: String((row as any).gc_os_cor_situacao || ""),
        data: String((row as any).gc_os_data || (row as any).data_tarefa || "").slice(0, 10),
        data_final: "",
        data_saida: dataSaida,
        data_execucao: String((row as any).data_conclusao || (row as any).check_out_iso || "").slice(0, 10),
        valor_total: Number((row as any).gc_os_valor_total || 0),
        descricao: "",
        vendedor: String((row as any).gc_os_vendedor || ""),
        link: String((row as any).gc_os_link_cobranca || (row as any).gc_os_link || "") || `https://gestaoclick.com/ordens_servicos/editar/${osId}`,
        auvo_task_id: String((row as any).gc_os_tarefa_exec || (row as any).auvo_task_id || ""),
        auvo_task_url: String((row as any).auvo_task_url || (row as any).auvo_link || ""),
        horas_execucao: Number((row as any).duracao_decimal || 0),
        equipamentos: [] as string[],
        _equipSet: new Set<string>(),
        _fromCoifa: true,
      });
    }
    const item = byOs.get(osId)!;
    addEquipLabel(new Map([[osId, item._equipSet]]), osId, String((row as any).equipamento_nome || ""), String((row as any).equipamento_id_serie || ""));
  }

  return Array.from(byOs.values()).map((item) => {
    item.equipamentos = Array.from(item._equipSet || []);
    delete item._equipSet;
    if (item.auvo_task_id && !item.auvo_task_url) {
      item.auvo_task_url = `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${item.auvo_task_id}`;
    }
    return item;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN")!;
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ ok: false, error: "Não autorizado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return ok({ ok: false, error: "Não autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("id, grupo_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.grupo_id) return ok({ ok: false, error: "Usuário sem grupo configurado" });

    const { data: membros } = await admin
      .from("grupo_cliente_membros")
      .select("cliente_nome")
      .eq("grupo_id", profile.grupo_id);
    const clientesNorm = new Set((membros || []).map((m: any) => normalize(m.cliente_nome)));
    if (clientesNorm.size === 0) {
      return ok({ ok: true, os_list: [], recebimentos: [], totals: { qtd_os: 0, valor_os: 0, qtd_recebimentos: 0, valor_recebimentos: 0 } });
    }

    const body = await req.json().catch(() => ({}));
    const situacaoIds: string[] = Array.isArray(body?.situacao_ids) && body.situacao_ids.length > 0
      ? body.situacao_ids.map(String)
      : (body?.all_executadas ? DEFAULT_SITUACAO_IDS : [AG_NEGOCIACAO_ID]);
    const filtroClienteRaw = String(body?.cliente || "").trim();
    const filtroClienteNorm = filtroClienteRaw ? normalize(filtroClienteRaw) : "";
    const filtroMes = String(body?.mes || "").trim();

    const gcHeaders = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    const avisos: string[] = [];
    let dataSource = "gc";
    let osFiltered: any[] = [];
    const osPagamentosByOs = new Map<string, any[]>();

    // 1. OS aguardando negociação. Se o GC falhar, usa o cache local para não
    // deixar o portal do cliente em branco.
    try {
      const osRaw: any[] = [];
      for (const sit of situacaoIds) {
        const arr = await fetchOsBySituacao(gcHeaders, sit);
        osRaw.push(...arr);
      }
      osFiltered = uniqueBy(
        osRaw
          .filter((o: any) => {
            const nomeNorm = normalize(String(o.nome_cliente || ""));
            if (!clientesNorm.has(nomeNorm)) return false;
            if (filtroClienteNorm && nomeNorm !== filtroClienteNorm) return false;
            if (filtroMes) {
              const k = monthKeyOf(String(o.data_saida || o.data_final || o.data || ""));
              if (k !== filtroMes) return false;
            }
            return true;
          })
          .map((o: any) => ({
            gc_os_id: String(o.id),
            codigo: String(o.codigo || ""),
            cliente: String(o.nome_cliente || ""),
            situacao: String(o.nome_situacao || ""),
            situacao_id: String(o.situacao_id || ""),
            cor_situacao: String(o.cor_situacao || ""),
            data: String(o.data || ""),
            data_final: String(o.data_final || ""),
            data_saida: String(o.data_saida || o.data_final || o.data || ""),
            data_execucao: "",
            valor_total: Number(o.valor_total || 0),
            descricao: String(o.descricao || ""),
            vendedor: String(o.nome_vendedor || ""),
            link: o.hash
              ? `https://gestaoclick.com/cobranca/${o.hash}`
              : `https://gestaoclick.com/ordens_servicos/editar/${o.id}`,
          })),
        (o) => String(o.gc_os_id || ""),
      );

      // Fallback: buscar hash individual das OS que não vieram na listagem
      // Também: coleta as parcelas (pagamentos) da OS pra gerar itens de
      // "Financeiro Pendente" quando o cliente ainda não teve recebimento gerado
      // no GC (comum em Klabin — OS com pagamentos previstos mas sem título).
      await Promise.all(
        osFiltered.map(async (o) => {
          try {
            const res = await fetch(`${GC_BASE_URL}/api/ordens_servicos/${o.gc_os_id}`, {
              headers: gcHeaders,
            });
            if (!res.ok) return;
            const j = await res.json().catch(() => ({}));
            const data = j?.data || {};
            const hash = data?.hash;
            if (hash && !o.link.includes("/cobranca/")) {
              o.link = `https://gestaoclick.com/cobranca/${hash}`;
            }
            const pags = Array.isArray(data?.pagamentos) ? data.pagamentos : [];
            if (pags.length > 0) osPagamentosByOs.set(o.gc_os_id, pags);
          } catch { /* ignore */ }
        }),
      );
    } catch (e) {
      if (!(e instanceof GcApiError)) throw e;
      console.warn("[portal-negociacao-fetch] GC indisponível; usando cache local:", e.message);
      avisos.push("Dados exibidos do cache local porque o GC recusou a consulta em tempo real.");
      dataSource = "cache";
      osFiltered = await fetchOsFromLocalCache(admin, clientesNorm, situacaoIds, filtroClienteNorm, filtroMes);
    }

    // Preenche data_execucao (checkout da Tarefa Execução Auvo) via tarefas_central
    try {
      const osIds = osFiltered.map((o) => o.gc_os_id).filter(Boolean);
      if (osIds.length > 0) {
        const { data: tarefas } = await admin
          .from("tarefas_central")
          .select("gc_os_id, auvo_task_id, check_in_iso, check_out_iso, data_conclusao, gc_os_tarefa_exec, duracao_decimal, auvo_task_url, auvo_link, equipamento_nome, equipamento_id_serie")
          .in("gc_os_id", osIds);
        const dtByOs = new Map<string, string>();
        const execByOs = new Map<string, string>();
        const rowByTaskId = new Map<string, any>();
        const hoursByOs = new Map<string, number>();
        const equipsByOs = new Map<string, Set<string>>();
        const taskIdsByOs = new Map<string, Set<string>>();
        const osIdsByTaskId = new Map<string, Set<string>>();
        for (const t of tarefas || []) {
          const key = String((t as any).gc_os_id);
          const taskId = String((t as any).auvo_task_id || "").trim();
          if (taskId) {
            rowByTaskId.set(taskId, t);
            if (!taskIdsByOs.has(key)) taskIdsByOs.set(key, new Set());
            taskIdsByOs.get(key)!.add(taskId);
            if (!osIdsByTaskId.has(taskId)) osIdsByTaskId.set(taskId, new Set());
            osIdsByTaskId.get(taskId)!.add(key);
          }
          const eqNome = String((t as any).equipamento_nome || "").trim();
          const eqSerie = String((t as any).equipamento_id_serie || "").trim();
          addEquipLabel(equipsByOs, key, eqNome, eqSerie);
          const dt = String((t as any).check_out_iso || (t as any).data_conclusao || "").trim();
          if (dt) {
            const cur = dtByOs.get(key);
            if (!cur || dt > cur) dtByOs.set(key, dt);
          }
          // exec task id: prefer explicit gc_os_tarefa_exec; fallback ao próprio auvo_task_id
          const exec = String((t as any).gc_os_tarefa_exec || (t as any).auvo_task_id || "").trim();
          if (exec && !execByOs.has(key)) execByOs.set(key, exec);
          if (exec) {
            if (!taskIdsByOs.has(key)) taskIdsByOs.set(key, new Set());
            taskIdsByOs.get(key)!.add(exec);
            if (!osIdsByTaskId.has(exec)) osIdsByTaskId.set(exec, new Set());
            osIdsByTaskId.get(exec)!.add(key);
          }
          // Horas: usa duracao_decimal; se estiver zerada mas houver check-in/out,
          // calcula a duração a partir dos timestamps (fallback quando a sync de horas
          // ainda não rodou pro período).
          let h = Number((t as any).duracao_decimal || 0);
          if (!(h > 0)) {
            const ci = String((t as any).check_in_iso || "").trim();
            const co = String((t as any).check_out_iso || "").trim();
            if (ci && co) {
              const diffMs = parsePgTimestamp(co) - parsePgTimestamp(ci);
              if (Number.isFinite(diffMs) && diffMs > 0) {
                h = Math.round((diffMs / 3600000) * 100) / 100;
              }
            }
          }
          if (h > 0) {
            const cur = hoursByOs.get(key) || 0;
            if (h > cur) hoursByOs.set(key, h);
          }
        }
        for (const o of osFiltered) {
          const v = dtByOs.get(o.gc_os_id);
          if (v) o.data_execucao = v;
          const ex = execByOs.get(o.gc_os_id);
          if (ex) {
            const execRow = rowByTaskId.get(ex);
            const savedUrl = String(execRow?.auvo_task_url || execRow?.auvo_link || "").trim();
            (o as any).auvo_task_id = ex;
            // Mesmo link que a aba "Horas" usa: primeiro o link salvo da tarefa;
            // só monta fallback se a sincronização antiga ainda não trouxe URL.
            (o as any).auvo_task_url = savedUrl || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${ex}`;
            // Marca se o URL público (informacoes/tarefa/...) ainda não foi resolvido
            if (!/informacoes\/tarefa/.test((o as any).auvo_task_url)) {
              (o as any)._needsAuvoLive = true;
            }
          }
          const hrs = hoursByOs.get(o.gc_os_id);
          if (hrs && hrs > 0) (o as any).horas_execucao = hrs;
          const eqs = equipsByOs.get(o.gc_os_id);
          if (eqs && eqs.size > 0) (o as any).equipamentos = Array.from(eqs);
        }

        // Fallback: resolve equipamento via vínculo nativo Auvo usando TODAS as tarefas
        // amarradas à OS (Tarefa OS + Tarefa Execução). Muitos equipamentos ficam no
        // vínculo da Tarefa OS, não na execução — por isso buscar só auvo_task_id exec
        // fazia aparecer apenas alguns.
        try {
          const osComTarefas = osFiltered.filter((o: any) => {
            const ids = taskIdsByOs.get(String(o.gc_os_id));
            return (ids && ids.size > 0) || o.auvo_task_id;
          });
          if (osComTarefas.length > 0) {
            const taskIds = Array.from(new Set(osComTarefas.flatMap((o: any) => {
              const ids = Array.from(taskIdsByOs.get(String(o.gc_os_id)) || []);
              if (o.auvo_task_id) ids.push(String(o.auvo_task_id));
              return ids;
            }).filter(Boolean)));
            if (taskIds.length === 0) throw new Error("Nenhuma tarefa Auvo vinculada para resolver equipamento");
            const { data: links } = await admin
              .from("equipamento_tarefas_auvo")
              .select("auvo_task_id, auvo_equipment_id")
              .in("auvo_task_id", taskIds);
            const allEqIds = new Set<string>();
            for (const l of links || []) {
              const eid = String((l as any).auvo_equipment_id || "");
              if (!eid) continue;
              allEqIds.add(eid);
            }
            const eqInfo = new Map<string, { nome: string; serie: string }>();
            if (allEqIds.size > 0) {
              const { data: eqs } = await admin
                .from("equipamentos_auvo")
                .select("auvo_equipment_id, nome, identificador")
                .in("auvo_equipment_id", Array.from(allEqIds));
              for (const e of eqs || []) {
                eqInfo.set(String((e as any).auvo_equipment_id), {
                  nome: String((e as any).nome || "").trim(),
                  serie: String((e as any).identificador || "").trim(),
                });
              }
            }
            for (const l of links || []) {
              const tid = String((l as any).auvo_task_id || "");
              const eid = String((l as any).auvo_equipment_id || "");
              const info = eqInfo.get(eid);
              if (!tid || !info) continue;
              for (const osId of osIdsByTaskId.get(tid) || []) {
                addEquipLabel(equipsByOs, osId, info.nome, info.serie);
              }
            }
            for (const o of osComTarefas as any[]) {
              const labels = equipsByOs.get(String(o.gc_os_id));
              if (labels && labels.size > 0) o.equipamentos = Array.from(labels);
            }
          }
        } catch (e) {
          console.warn("[portal-negociacao-fetch] equip lookup failed:", e);
        }

        // Live fallback no Auvo para tarefas exec sem URL pública, sem horas ou sem equipamento.
        try {
          const auvoKey = Deno.env.get("AUVO_APP_KEY");
          const auvoTok = Deno.env.get("AUVO_TOKEN");
          const targets = osFiltered.filter((o: any) =>
            o.auvo_task_id && (o._needsAuvoLive || !(o.horas_execucao > 0) || !((o.equipamentos || []).length > 0))
          );
          if (auvoKey && auvoTok && targets.length > 0) {
            const bearer = await auvoLogin(auvoKey, auvoTok);
            if (bearer) {
              const BATCH = 8;
              for (let i = 0; i < targets.length; i += BATCH) {
                const slice = targets.slice(i, i + BATCH);
                await Promise.all(slice.map(async (o: any) => {
                  const info = await fetchAuvoTaskLive(bearer, String(o.auvo_task_id));
                  if (!info) return;
                  if (info.taskUrl) {
                    (o as any).auvo_task_url = info.taskUrl;
                    admin.from("tarefas_central")
                      .update({ auvo_task_url: info.taskUrl })
                      .eq("auvo_task_id", String(o.auvo_task_id))
                      .then(() => {}, () => {});
                  }
                  if (!(o.horas_execucao > 0) && info.durationDecimal > 0) {
                    (o as any).horas_execucao = Math.round(info.durationDecimal * 100) / 100;
                  }
                  // Se Auvo devolveu check-in/out mas durationDecimal=0, calcula
                  if (!(o.horas_execucao > 0) && info.checkIn && info.checkOut) {
                    const diff = new Date(info.checkOut).getTime() - new Date(info.checkIn).getTime();
                    if (Number.isFinite(diff) && diff > 0) {
                      (o as any).horas_execucao = Math.round((diff / 3600000) * 100) / 100;
                    }
                  }
                  if (!((o.equipamentos || []).length > 0)) {
                    addEquipLabel(equipsByOs, String(o.gc_os_id), info.equipmentName, info.equipmentSerial);
                    if ((!equipsByOs.get(String(o.gc_os_id)) || equipsByOs.get(String(o.gc_os_id))!.size === 0) && info.equipmentIds.length > 0) {
                      const { data: eqs } = await admin
                        .from("equipamentos_auvo")
                        .select("auvo_equipment_id, nome, identificador")
                        .in("auvo_equipment_id", info.equipmentIds);
                      for (const e of eqs || []) {
                        addEquipLabel(
                          equipsByOs,
                          String(o.gc_os_id),
                          String((e as any).nome || "").trim(),
                          String((e as any).identificador || "").trim(),
                        );
                      }
                    }
                    const labels = equipsByOs.get(String(o.gc_os_id));
                    if (labels && labels.size > 0) (o as any).equipamentos = Array.from(labels);
                  }
                }));
              }
            }
          }
          // limpa marcador interno
          for (const o of osFiltered as any[]) delete o._needsAuvoLive;
        } catch (e) {
          console.warn("[portal-negociacao-fetch] auvo live fallback falhou:", e);
        }
      }
    } catch (e) {
      console.warn("[portal-negociacao-fetch] falha ao juntar data_execucao:", e);
    }

    // 2. Recebimentos em aberto / atraso
    let recRaw: any[] = [];
    try {
      recRaw = await fetchRecebimentosEmAberto(gcHeaders);
    } catch (e) {
      if (!(e instanceof GcApiError)) throw e;
      console.warn("[portal-negociacao-fetch] recebimentos GC indisponível:", e.message);
      avisos.push("Financeiro pendente em tempo real indisponível no GC no momento.");
      if (dataSource !== "cache") dataSource = "parcial";
    }
    const hoje = new Date().toISOString().slice(0, 10);
    const recebimentos = recRaw
      .filter((r: any) => clientesNorm.has(normalize(String(r.nome_cliente || r.nome || ""))))
      .map((r: any) => {
        const venc = String(r.data_vencimento || "").slice(0, 10);
        const atrasado = venc && venc < hoje;
        return {
          gc_recebimento_id: String(r.id),
          codigo: String(r.codigo || ""),
          descricao: String(r.descricao || ""),
          cliente: String(r.nome_cliente || r.nome || ""),
          valor: Number(r.valor || 0),
          valor_pago: Number(r.valor_pago || 0),
          valor_pendente: Math.max(0, Number(r.valor || 0) - Number(r.valor_pago || 0)),
          data_vencimento: venc,
          data_competencia: String(r.data_competencia || "").slice(0, 10),
          liquidado: String(r._liquidado || ""),
          atrasado,
          os_codigo: String(r.os_codigo || r.numero_os || ""),
          forma_pagamento: String(r.nome_forma_pagamento || ""),
          parcela: r.parcela ? String(r.parcela) : "",
        };
      });

    // Fallback: para OS cujo cliente não tem recebimento correspondente no GC,
    // usa as parcelas (pagamentos) da própria OS como pendências financeiras.
    // Dedup por (os_codigo, data_vencimento, valor) contra recebimentos reais.
    const recKey = new Set(
      recebimentos.map((r) =>
        `${r.os_codigo || ""}|${r.data_vencimento}|${r.valor.toFixed(2)}`,
      ),
    );
    for (const o of osFiltered) {
      const pags = osPagamentosByOs.get(o.gc_os_id) || [];
      pags.forEach((p: any, idx: number) => {
        const node = p?.pagamento || p;
        const valor = Number(node?.valor || 0);
        if (!(valor > 0)) return;
        const venc = String(node?.data_vencimento || "").slice(0, 10);
        const k = `${o.codigo || ""}|${venc}|${valor.toFixed(2)}`;
        if (recKey.has(k)) return;
        recKey.add(k);
        recebimentos.push({
          gc_recebimento_id: `os-${o.gc_os_id}-${idx}`,
          codigo: "",
          descricao: `Parcela OS #${o.codigo}${node?.observacao ? ` — ${node.observacao}` : ""}`,
          cliente: o.cliente,
          valor,
          valor_pago: 0,
          valor_pendente: valor,
          data_vencimento: venc,
          data_competencia: "",
          liquidado: "os",
          atrasado: !!venc && venc < hoje,
          os_codigo: String(o.codigo || ""),
          forma_pagamento: String(node?.nome_forma_pagamento || ""),
          parcela: String(idx + 1),
        });
      });
    }

    const totals = {
      qtd_os: osFiltered.length,
      valor_os: osFiltered.reduce((s, o) => s + o.valor_total, 0),
      qtd_recebimentos: recebimentos.length,
      valor_recebimentos: recebimentos.reduce((s, r) => s + r.valor_pendente, 0),
      valor_atrasado: recebimentos.filter((r) => r.atrasado).reduce((s, r) => s + r.valor_pendente, 0),
      qtd_atrasado: recebimentos.filter((r) => r.atrasado).length,
    };

    // 3. Inclusão adicional: OS em Ag. Negociação Financeira (7116099) cujo
    // equipamento vinculado contenha "coifa" — mesmo fora do grupo do cliente
    // logado. Só entra quando a aba está mostrando essa situação.
    try {
      if (situacaoIds.includes(AG_NEGOCIACAO_ID)) {
        const extras = await fetchCoifaOsFromCache(admin, filtroClienteNorm, filtroMes);
        const existentes = new Set(osFiltered.map((o: any) => String(o.gc_os_id)));
        const novos = extras.filter((o: any) => !existentes.has(String(o.gc_os_id)));
        if (novos.length > 0) {
          osFiltered.push(...novos);
          osFiltered.sort((a: any, b: any) => String(b.data_saida || "").localeCompare(String(a.data_saida || "")));
          totals.qtd_os = osFiltered.length;
          totals.valor_os = osFiltered.reduce((s: number, o: any) => s + Number(o.valor_total || 0), 0);
        }
      }
    } catch (e) {
      console.warn("[portal-negociacao-fetch] falha ao incluir OS coifa:", e);
    }

    return ok({ ok: true, os_list: osFiltered, recebimentos, totals, source: dataSource, warnings: avisos });
  } catch (err) {
    console.error("[portal-negociacao-fetch] erro:", err);
    return ok({ ok: false, error: (err as Error)?.message || "Erro interno" });
  }
});