import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE = "https://api.gestaoclick.com";
const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const AUVO_TASK_FIELDS =
  "taskID,taskDate,checkOutDate,deliveredDate,finishedDate,equipmentsId,taskType,taskTypeDescription,taskStatus,finished,customerDescription,customerName,userToName";

function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/,/.test(s)) {
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function norm(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Peca = {
  codigo: string;
  produto_id?: string | null;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  origem: "os" | "orcamento";
  documento_id: string;
  documento_codigo: string;
  situacao: string;
  data: string | null;
  cliente: string;
  auvo_task_id: string | null;
  link: string | null;
  vendida: boolean;
  vinculo: "direto" | "texto" | "historico";
};

const SITUACOES_VENDIDAS = [
  "executad", "finalizad", "concluid", "entregue", "faturad", "aprovad", "pago",
];

async function gcGet(path: string, headers: Record<string, string>) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${GC_BASE}${path}`, { headers, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

async function auvoLogin(): Promise<string | null> {
  const apiKey = Deno.env.get("AUVO_APP_KEY") ?? "";
  const apiToken = Deno.env.get("AUVO_TOKEN") ?? "";
  if (!apiKey || !apiToken) return null;
  try {
    const res = await fetch(
      `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`,
      { headers: { "Content-Type": "application/json" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result?.accessToken ?? null;
  } catch {
    return null;
  }
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const auvoEquipmentId = String(body?.auvo_equipment_id || "").trim();
    let identificador = String(body?.identificador || "").trim();
    const auvoTaskId = String(body?.auvo_task_id || "").trim();
    const equipamentoNome = String(body?.nome || "").trim();

    if (!auvoEquipmentId && !identificador && !auvoTaskId) {
      return new Response(JSON.stringify({ ok: false, error: "auvo_equipment_id, identificador ou auvo_task_id é obrigatório" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const gcHeaders = {
      "access-token": Deno.env.get("GC_ACCESS_TOKEN") ?? "",
      "secret-access-token": Deno.env.get("GC_SECRET_TOKEN") ?? "",
      "Content-Type": "application/json",
    };

    // 1) Descoberta ESTRITA: apenas o equipamento exato (auvo_equipment_id / série)
    const taskIds = new Set<string>();
    const equipIds = new Set<string>();
    const series = new Set<string>();
    if (auvoEquipmentId) equipIds.add(auvoEquipmentId);
    if (identificador) series.add(identificador);
    if (auvoTaskId) taskIds.add(auvoTaskId);

    const selectCols =
      "auvo_task_id, cliente, data_tarefa, orientacao, descricao, equipamento_nome, equipamento_id_serie, gc_os_id, gc_os_codigo, gc_os_situacao, gc_os_link, gc_os_data, gc_orcamento_id, gc_orcamento_codigo, gc_orc_situacao, gc_orc_link, gc_orc_data, gc_os_tarefa_os, gc_os_tarefa_exec";

    const centralById = new Map<string, any>();
    const addCentral = (rows: any[] | null, expandirTarefas = true) => {
      let novos = 0;
      for (const r of rows || []) {
        const k = String(r.auvo_task_id || "");
        if (!k) continue;
        if (!centralById.has(k)) { centralById.set(k, r); novos++; }
        if (expandirTarefas) taskIds.add(k);
      }
      return novos;
    };

    // Muitas tarefas do equipamento não têm gc_os_id na própria linha: o documento
    // GC está em OUTRA linha (ex.: linha "gc-only" ou a tarefa OS) que aponta para
    // esta tarefa em gc_os_tarefa_os / gc_os_tarefa_exec. Recupera esses documentos.
    const carregarPorTarefaVinculada = async () => {
      const ids = Array.from(taskIds).filter(Boolean);
      if (!ids.length) return 0;
      const tokensDe = (v: any) =>
        String(v || "").split(/[\/;,|\s]+/).map((t) => t.trim()).filter(Boolean);
      let novos = 0;
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        const filtro = chunk
          .flatMap((id) => [`gc_os_tarefa_os.ilike.%${id}%`, `gc_os_tarefa_exec.ilike.%${id}%`])
          .join(",");
        const { data } = await supabase
          .from("tarefas_central")
          .select(selectCols)
          .or(filtro)
          .limit(1000);
        const validos = (data || []).filter((r: any) => {
          const toks = new Set([...tokensDe(r.gc_os_tarefa_os), ...tokensDe(r.gc_os_tarefa_exec)]);
          return chunk.some((id) => toks.has(id));
        });
        // não expande taskIds: evita cascata para tarefas de outros equipamentos
        novos += addCentral(validos, false);
      }
      return novos;
    };

    // Equipamentos do catálogo que batem com a série informada
    const resolveEquipCatalogo = async () => {
      const seriesArr = Array.from(series).filter(Boolean);
      if (!seriesArr.length) return;
      const { data } = await supabase
        .from("equipamentos_auvo")
        .select("auvo_equipment_id, identificador, nome")
        .in("identificador", seriesArr);
      (data || []).forEach((e: any) => {
        if (e.auvo_equipment_id) equipIds.add(String(e.auvo_equipment_id));
      });
    };

    const expandirTarefasPorEquipamento = async () => {
      if (!equipIds.size) return;
      const { data } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_task_id")
        .in("auvo_equipment_id", Array.from(equipIds));
      (data || []).forEach((r: any) => { if (r.auvo_task_id) taskIds.add(String(r.auvo_task_id)); });
    };

    // Vínculos podem estar defasados (sync noturno). Busca AO VIVO no Auvo as
    // tarefas do período ainda não sincronizado e grava os vínculos que faltam.
    const atualizarVinculosAuvoAoVivo = async () => {
      if (!equipIds.size) return;
      const token = await auvoLogin();
      if (!token) { console.log("[pecas] auvo login falhou"); return; }

      const equipsArr = Array.from(equipIds);
      const hoje = new Date();
      const fim = new Date(hoje.getTime() + 7 * 86400000);

      // Histórico completo: por padrão varre desde 2024-01-01 (ou desde a data
      // enviada pelo cliente). Só limita ao período recente quando o histórico
      // antigo já foi trazido em uma varredura anterior.
      const desdeParam = String(body?.desde || "").trim();
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(desdeParam)
        ? new Date(`${desdeParam}T00:00:00Z`)
        : new Date("2025-01-01T00:00:00Z");

      const { data: maisAntigo } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("data_tarefa")
        .in("auvo_equipment_id", equipsArr)
        .not("data_tarefa", "is", null)
        .order("data_tarefa", { ascending: true })
        .limit(1);
      const { data: ultimo } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("synced_at")
        .in("auvo_equipment_id", equipsArr)
        .order("synced_at", { ascending: false })
        .limit(1);

      const antigoIso = maisAntigo?.[0]?.data_tarefa ? String(maisAntigo[0].data_tarefa).slice(0, 10) : null;
      // A API do Auvo não devolve mais tarefas anteriores a 2025; a varredura
      // longa só roda sob pedido explícito (full_history) para não estourar tempo.
      const historicoJaVarrido = body?.full_history === true
        ? false
        : true;

      let inicio: Date;
      if (historicoJaVarrido) {
        const limite = new Date(hoje.getTime() - 400 * 86400000);
        inicio = ultimo?.[0]?.synced_at ? new Date(ultimo[0].synced_at) : limite;
        inicio = new Date(inicio.getTime() - 7 * 86400000);
        if (inicio < limite) inicio = limite;
      } else {
        inicio = desde;
      }

      console.log(
        `[pecas] live auvo ${isoDay(inicio)} → ${isoDay(fim)} (histórico=${!historicoJaVarrido}) equips=${equipsArr.join(",")}`,
      );

      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const novos: any[] = [];

      // Auvo limita paginação; quebramos o período em janelas de 60 dias.
      const janelas: Array<{ ini: Date; fim: Date }> = [];
      for (let cur = new Date(inicio); cur < fim;) {
        const prox = new Date(Math.min(cur.getTime() + 60 * 86400000, fim.getTime()));
        janelas.push({ ini: new Date(cur), fim: prox });
        cur = new Date(prox.getTime() + 86400000);
      }

      const pageUrl = (page: number, j: { ini: Date; fim: Date }) => {
        const paramFilter = encodeURIComponent(JSON.stringify({
          startDate: `${isoDay(j.ini)}T00:00:00`,
          endDate: `${isoDay(j.fim)}T23:59:59`,
        }));
        return `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=100&order=desc&paramFilter=${paramFilter}&selectFields=${encodeURIComponent(AUVO_TASK_FIELDS)}`;
      };
      const buscarPagina = async (page: number, j: { ini: Date; fim: Date }): Promise<any> => {
        try {
          const res = await fetch(pageUrl(page, j), { headers });
          if (!res.ok) { const b = await res.text().catch(() => ""); console.log(`[pecas] auvo tasks HTTP ${res.status} page ${page}: ${b.slice(0, 200)}`); return null; }
          return await res.json();
        } catch (e) { console.log("[pecas] auvo tasks erro", String(e)); return null; }
      };
      const ingerir = (json: any) => {
        const lista = json?.result?.entityList || [];
        if (!Array.isArray(lista)) return;
        for (const t of lista) {
          const ids: any[] = Array.isArray(t.equipmentsId) ? t.equipmentsId : [];
          const taskId = String(t.taskID || t.id || "");
          if (!taskId) continue;
          for (const eq of ids) {
            if (!equipIds.has(String(eq))) continue;
            taskIds.add(taskId);
            novos.push({
              auvo_equipment_id: String(eq),
              auvo_task_id: taskId,
              auvo_task_type_id: t.taskType ? String(t.taskType) : null,
              auvo_task_type_description: t.taskTypeDescription || null,
              status_auvo: t.finished || t.checkOutDate ? "Finalizada" : "Pendente",
              data_tarefa: String(t.taskDate || "").slice(0, 10) || null,
              data_conclusao: String(t.checkOutDate || t.finishedDate || "").slice(0, 10) || null,
              cliente: t.customerDescription || t.customerName || null,
              tecnico: t.userToName || null,
              auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
              source: "live_equipment_relation",
              synced_at: new Date().toISOString(),
            });
          }
        }
      };

      let totalGeral = 0;
      const varrerJanela = async (j: { ini: Date; fim: Date }) => {
        const first = await buscarPagina(1, j);
        if (!first) return;
        ingerir(first);
        const total = Number(first?.result?.pagedSearchReturnData?.totalItems || 0);
        totalGeral += total;
        const totalPaginas = Math.min(40, Math.ceil(total / 100));
        if (totalPaginas > 1) {
          const restantes = await Promise.all(
            Array.from({ length: totalPaginas - 1 }, (_, i) => buscarPagina(i + 2, j)),
          );
          restantes.forEach(ingerir);
        }
      };
      for (let i = 0; i < janelas.length; i += 4) {
        await Promise.all(janelas.slice(i, i + 4).map(varrerJanela));
      }
      console.log(
        `[pecas] live auvo: ${totalGeral} tarefas em ${janelas.length} janela(s), vinculos=${novos.length}`,
      );

      if (novos.length) {
        const { error } = await supabase
          .from("equipamento_tarefas_auvo")
          .upsert(novos, { onConflict: "auvo_equipment_id,auvo_task_id" });
        if (error) console.log("[pecas] upsert erro", error.message);
      }
    };

    const carregarCentral = async () => {
      let novos = 0;
      const ids = Array.from(taskIds).filter((id) => !centralById.has(id));
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select(selectCols)
          .in("auvo_task_id", ids.slice(i, i + 200));
        if (error) throw error;
        novos += addCentral(data);
      }
      // Série EXATA do próprio equipamento — inclusive quando o campo traz vários
      // equipamentos separados por / ; , (validamos token a token, sem match parcial)
      const norm = (v: string) => String(v || "").trim().toUpperCase();
      const tokens = (v: string) =>
        norm(v).split(/[\/;,|]+/).map((t) => t.trim()).filter(Boolean);
      for (const s of Array.from(series)) {
        const alvo = norm(s);
        if (!alvo) continue;
        // 1) igualdade direta (varredura completa, paginada)
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .eq("equipamento_id_serie", s)
            .range(from, from + 999);
          novos += addCentral(data);
          if (!data || data.length < 1000) break;
        }
        // 2) campos com múltiplos equipamentos: filtra por token exato
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .ilike("equipamento_id_serie", `%${s}%`)
            .range(from, from + 999);
          const validos = (data || []).filter((r: any) =>
            tokens(r.equipamento_id_serie).includes(alvo)
          );
          novos += addCentral(validos);
          if (!data || data.length < 1000) break;
        }
      }
      return novos;
    };

    // Histórico antigo (antes do vínculo Auvo existir): nome EXATO do equipamento
    // restrito aos clientes já identificados para este equipamento.
    const expandirHistoricoAntigo = async () => {
      const norm = (v: string) => String(v || "").trim().toUpperCase();
      const nomes = new Set<string>();
      if (equipamentoNome) nomes.add(norm(equipamentoNome));
      const clientes = new Set<string>();
      for (const r of centralById.values()) {
        if (r.equipamento_nome) nomes.add(norm(r.equipamento_nome));
        if (r.cliente) clientes.add(norm(r.cliente));
      }
      if (equipIds.size) {
        const { data } = await supabase
          .from("equipamentos_auvo")
          .select("nome")
          .in("auvo_equipment_id", Array.from(equipIds));
        (data || []).forEach((e: any) => { if (e?.nome) nomes.add(norm(e.nome)); });
      }
      if (!nomes.size || !clientes.size) return 0;
      let novos = 0;
      for (const nome of Array.from(nomes)) {
        if (nome.length < 4) continue;
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .ilike("equipamento_nome", nome)
            .range(from, from + 999);
          const validos = (data || []).filter((r: any) =>
            norm(r.equipamento_nome) === nome && clientes.has(norm(r.cliente))
          );
          novos += addCentral(validos);
          if (!data || data.length < 1000) break;
        }
      }
      return novos;
    };

    // Tarefa base (kanban): descobre a série/equipamento antes de expandir
    if (auvoTaskId) {
      await carregarCentral();
      const base = centralById.get(auvoTaskId);
      const serieBase = String(base?.equipamento_id_serie || "").trim();
      if (serieBase) series.add(serieBase);
      const { data: linkRows } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_equipment_id")
        .eq("auvo_task_id", auvoTaskId);
      (linkRows || []).forEach((r: any) => { if (r.auvo_equipment_id) equipIds.add(String(r.auvo_equipment_id)); });

      // Fallback: sem vínculo/série, resolve o equipamento no catálogo pelo
      // nome EXATO + cliente da tarefa base (evita cruzar equipamentos).
      if (!equipIds.size && !series.size) {
        const norm = (v: string) => String(v || "").trim().toUpperCase();
        const nomeBase = norm(base?.equipamento_nome || equipamentoNome);
        const clienteBase = norm(base?.cliente);
        if (nomeBase.length >= 4) {
          const { data: cat } = await supabase
            .from("equipamentos_auvo")
            .select("auvo_equipment_id, identificador, nome, cliente")
            .ilike("nome", nomeBase);
          for (const e of cat || []) {
            if (norm(e.nome) !== nomeBase) continue;
            if (clienteBase && norm(e.cliente) && norm(e.cliente) !== clienteBase) continue;
            if (e.auvo_equipment_id) equipIds.add(String(e.auvo_equipment_id));
            if (e.identificador) series.add(String(e.identificador));
          }
        }
      }
    }

    // Passe único e fechado: série -> catálogo -> tarefas do MESMO equipamento -> central
    await resolveEquipCatalogo();
    await expandirTarefasPorEquipamento();
    await atualizarVinculosAuvoAoVivo();
    await carregarCentral();
    // varre todo o período disponível, recuperando OS/orçamentos antigos
    await expandirHistoricoAntigo();
    await carregarCentral();
    // documentos GC que apontam para as tarefas do equipamento (tarefa OS / execução)
    const vinculados = await carregarPorTarefaVinculada();
    console.log(`[pecas] docs por tarefa vinculada: ${vinculados}`);

    if (!identificador) identificador = Array.from(series)[0] || "";
    const centralRows: any[] = Array.from(centralById.values());

    // 3) Documentos GC únicos
    const osMap = new Map<string, any>();
    const orcMap = new Map<string, any>();
    for (const r of centralRows) {
      const osId = String(r.gc_os_id || "").trim();
      if (osId && !osMap.has(osId)) osMap.set(osId, r);
      const orcId = String(r.gc_orcamento_id || "").trim();
      if (orcId && !orcMap.has(orcId)) orcMap.set(orcId, r);
    }

    // 3b) Replica a resolução do Controle OS: o equipamento pertence às tarefas
    // informadas nos atributos GC 73343 (Tarefa OS) e 73344 (Tarefa Execução).
    // Nunca classifica pelo texto inteiro da OS/orçamento, pois nomes de peças de
    // outro equipamento (ex.: Rational) geram falsos positivos.
    const clientes = new Set<string>();
    for (const r of centralRows) if (r.cliente) clientes.add(String(r.cliente));
    if (equipIds.size) {
      const { data: catCli } = await supabase
        .from("equipamentos_auvo")
        .select("cliente, nome")
        .in("auvo_equipment_id", Array.from(equipIds));
      (catCli || []).forEach((e: any) => { if (e?.cliente) clientes.add(String(e.cliente)); });
    }

    const STOP = new Set([
      "cima", "baixo", "sobre", "para", "com", "sem", "balcao", "area", "cozinha",
      "salao", "lado", "esquerdo", "direito", "frente", "fundo", "novo", "nova",
    ]);
    const nomesEquip = new Set<string>();
    if (equipamentoNome) nomesEquip.add(equipamentoNome);
    for (const r of centralRows) if (r.equipamento_nome) nomesEquip.add(String(r.equipamento_nome));
    if (equipIds.size) {
      const { data: catNomes } = await supabase
        .from("equipamentos_auvo")
        .select("nome")
        .in("auvo_equipment_id", Array.from(equipIds));
      (catNomes || []).forEach((e: any) => { if (e?.nome) nomesEquip.add(String(e.nome)); });
    }
    const termos: string[][] = [];
    for (const n of nomesEquip) {
      const toks = norm(n)
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 4 && !STOP.has(t));
      if (toks.length) termos.push(toks.slice(0, Math.min(3, toks.length)));
    }
    const seriesArr = Array.from(series).map((s) => norm(s)).filter((s) => s.length >= 5);

    const tokensDeTarefa = (v: any) =>
      String(v || "").split(/[\/;,|\s]+/).map((t) => t.trim()).filter((t) => /^\d+$/.test(t));
    const candidatosOs = new Map<string, any>();
    const candidatosOrc = new Map<string, any>();
    if (clientes.size) {
      for (const cli of clientes) {
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .eq("cliente", cli)
            .range(from, from + 999);
          for (const r of data || []) {
            const osId = String(r.gc_os_id || "").trim();
            if (osId && !osMap.has(osId) && !candidatosOs.has(osId)) candidatosOs.set(osId, r);
            const orcId = String(r.gc_orcamento_id || "").trim();
            if (orcId && !orcMap.has(orcId) && !candidatosOrc.has(orcId)) candidatosOrc.set(orcId, r);
          }
          if (!data || data.length < 1000) break;
        }
      }
    }

    const linkedIds = new Set<string>();
    for (const ref of [
      ...osMap.values(), ...orcMap.values(),
      ...candidatosOs.values(), ...candidatosOrc.values(),
    ]) {
      tokensDeTarefa(ref.gc_os_tarefa_os).forEach((id) => linkedIds.add(id));
      tokensDeTarefa(ref.gc_os_tarefa_exec).forEach((id) => linkedIds.add(id));
    }
    const linkedTaskRows = new Map<string, any>();
    const linkedIdList = Array.from(linkedIds);
    for (let i = 0; i < linkedIdList.length; i += 200) {
      const { data } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, orientacao, descricao, equipamento_nome, equipamento_id_serie")
        .in("auvo_task_id", linkedIdList.slice(i, i + 200));
      for (const row of data || []) linkedTaskRows.set(String(row.auvo_task_id), row);
    }

    const linkedToTargetEquipment = new Set<string>();
    for (let i = 0; i < linkedIdList.length; i += 500) {
      const { data } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_task_id, auvo_equipment_id")
        .in("auvo_task_id", linkedIdList.slice(i, i + 500))
        .in("auvo_equipment_id", Array.from(equipIds));
      for (const row of data || []) linkedToTargetEquipment.add(String(row.auvo_task_id));
    }

    type EquipmentMatch = "target" | "other" | "unknown";
    const tarefaClassificaEquipamento = (taskId: string): EquipmentMatch => {
      const row = linkedTaskRows.get(taskId);
      if (!row) {
        return taskIds.has(taskId) || linkedToTargetEquipment.has(taskId) ? "target" : "unknown";
      }
      const texto = norm([
        row.equipamento_id_serie, row.equipamento_nome, row.orientacao, row.descricao,
      ].filter(Boolean).join("\n"));
      if (seriesArr.some((s) => texto.includes(s))) return "target";
      if (termos.some((toks) => toks.every((t) => texto.includes(t)))) return "target";

      // A orientação da tarefa de execução é a fonte mais específica usada no
      // Controle OS. Se ela nomeia claramente outro equipamento, o documento não
      // pode herdar o equipamento da tarefa OS genérica.
      const orientacao = norm(row.orientacao || "");
      const nomeDireto = norm(row.equipamento_nome || "");
      const serieDireta = norm(row.equipamento_id_serie || "");
      const nomeiaEquipamento = Boolean(
        nomeDireto || serieDireta ||
        /(?:equipamento\s*:|\b(?:fogao|forno|fritadeira|chapa|coifa|lavadora|camara|refrigerador|freezer|maquina|balcao)\b)/.test(orientacao)
      );
      if (nomeiaEquipamento) return "other";
      return taskIds.has(taskId) || linkedToTargetEquipment.has(taskId) ? "target" : "unknown";
    };
    const documentoLigadoAoEquipamento = (ref: any, origem: "os" | "orcamento") => {
      // Cada documento deve seguir a tarefa que efetivamente o originou:
      // 73343 (Tarefa OS) gera orçamento; 73344 (Tarefa Execução) gera OS.
      // Misturar os dois faz uma OS de outro equipamento herdar o equipamento
      // do orçamento (caso real: OS 8703, Forno Rational, no Fogão Tramontina).
      const idsDaOrigem = origem === "orcamento"
        ? tokensDeTarefa(ref.gc_os_tarefa_os)
        : tokensDeTarefa(ref.gc_os_tarefa_exec);
      const matches = idsDaOrigem.map(tarefaClassificaEquipamento);
      if (matches.includes("target")) return true;
      if (matches.includes("other")) return false;

      // Documentos antigos podem estar diretamente na própria tarefa do
      // equipamento, sem o atributo correspondente preenchido.
      if (idsDaOrigem.length) return false;
      return taskIds.has(String(ref.auvo_task_id || ""));
    };

    // Histórico anterior ao vínculo estrutural: o Auvo não devolve mais tarefas
    // antigas pela API e as linhas antigas não têm equipamento preenchido. Nesse
    // período (e SOMENTE nele) aceitamos o documento quando o texto da tarefa
    // nomeia exatamente o equipamento (todos os termos do nome, ex.: fogao +
    // bocas + tramontina), sempre dentro dos clientes do equipamento.
    const CORTE_HISTORICO = String(body?.corte_historico || "2025-03-01");
    const historicos = new Set<string>();
    const dataDoRef = (ref: any, origem: "os" | "orcamento") =>
      String((origem === "os" ? ref?.gc_os_data : ref?.gc_orc_data) || ref?.data_tarefa || "").slice(0, 10);
    const matchHistoricoTexto = (ref: any, origem: "os" | "orcamento") => {
      if (!termos.length) return false;
      const data = dataDoRef(ref, origem);
      if (!data || data >= CORTE_HISTORICO) return false;
      const texto = norm([
        ref.equipamento_nome, ref.equipamento_id_serie, ref.orientacao, ref.descricao,
      ].filter(Boolean).join("\n"));
      if (!texto) return false;
      return termos.some((toks) => toks.every((t) => texto.includes(t)));
    };

    let aceitosPorTarefa = 0;
    let aceitosHistorico = 0;
    for (const [id, ref] of candidatosOs) {
      if (documentoLigadoAoEquipamento(ref, "os")) {
        osMap.set(id, ref);
        aceitosPorTarefa++;
      } else if (matchHistoricoTexto(ref, "os")) {
        osMap.set(id, ref);
        historicos.add(`os:${id}`);
        aceitosHistorico++;
      }
    }
    for (const [id, ref] of candidatosOrc) {
      if (documentoLigadoAoEquipamento(ref, "orcamento")) {
        orcMap.set(id, ref);
        aceitosPorTarefa++;
      } else if (matchHistoricoTexto(ref, "orcamento")) {
        orcMap.set(id, ref);
        historicos.add(`orc:${id}`);
        aceitosHistorico++;
      }
    }
    // Também valida os documentos encontrados na carga inicial. Isso impede que
    // um vínculo antigo da Tarefa OS mantenha uma OS cuja Tarefa Execução aponta
    // explicitamente para outro equipamento.
    for (const [id, ref] of Array.from(osMap.entries())) {
      if (historicos.has(`os:${id}`)) continue;
      if ((ref.gc_os_tarefa_os || ref.gc_os_tarefa_exec) && !documentoLigadoAoEquipamento(ref, "os")) {
        osMap.delete(id);
      }
    }
    for (const [id, ref] of Array.from(orcMap.entries())) {
      if (historicos.has(`orc:${id}`)) continue;
      if ((ref.gc_os_tarefa_os || ref.gc_os_tarefa_exec) && !documentoLigadoAoEquipamento(ref, "orcamento")) {
        orcMap.delete(id);
      }
    }
    console.log(
      `[pecas] resolução Controle OS: candidatos_os=${candidatosOs.size} candidatos_orc=${candidatosOrc.size} aceitos_por_73343_73344=${aceitosPorTarefa} historico_texto=${aceitosHistorico}`,
    );

    const pecas: Peca[] = [];
    const documentos: any[] = [];

    const extrair = (
      detail: any,
      origem: "os" | "orcamento",
      docId: string,
      ref: any,
      vinculo: "direto" | "texto" | "historico" = "direto",
    ) => {
      const codigo = String(detail?.codigo || (origem === "os" ? ref?.gc_os_codigo : ref?.gc_orcamento_codigo) || docId);
      const situacao = String(detail?.nome_situacao || (origem === "os" ? ref?.gc_os_situacao : ref?.gc_orc_situacao) || "");
      const data = String(
        detail?.data_saida || detail?.data || (origem === "os" ? ref?.gc_os_data : ref?.gc_orc_data) || ""
      ).split("T")[0] || null;
      const cliente = String(detail?.nome_cliente || ref?.cliente || "");
      const link = origem === "os" ? (ref?.gc_os_link || null) : (ref?.gc_orc_link || null);
      const sitNorm = norm(situacao);
      const vendida = origem === "os" && SITUACOES_VENDIDAS.some((s) => sitNorm.includes(s));

      const produtos: any[] = (Array.isArray(detail?.produtos) ? detail.produtos : [])
        .map((x: any) => x?.produto || x)
        .filter(Boolean);

      let itens = 0;
      for (const p of produtos) {
        const descricao = String(p.nome_produto || p.nome || p.detalhes || "Peça sem descrição").trim();
        // Código real do produto (nunca o ID interno do GC)
        const codigoPeca = String(
          p.codigo_interno || p.codigo || p.codigo_produto || p.sku || p.produto_codigo || ""
        ).trim();
        const produtoId = String(p.produto_id || p.id || "").trim();
        const quantidade = toNum(p.quantidade) || 1;
        const valor_total = toNum(p.valor_total) || (toNum(p.valor_venda || p.valor_unitario) * quantidade);
        pecas.push({
          codigo: codigoPeca,
          produto_id: produtoId || null,
          descricao,
          quantidade,
          valor_unitario: quantidade > 0 ? valor_total / quantidade : valor_total,
          valor_total,
          origem,
          documento_id: docId,
          documento_codigo: codigo,
          situacao,
          data,
          cliente,
          auvo_task_id: ref?.auvo_task_id ? String(ref.auvo_task_id) : null,
          link,
          vendida,
          vinculo,
        });
        itens++;
      }

      documentos.push({
        origem, documento_id: docId, documento_codigo: codigo, situacao, data, cliente,
        auvo_task_id: ref?.auvo_task_id ? String(ref.auvo_task_id) : null,
        link, itens, vendida, vinculo,
        valor_total: toNum(detail?.valor_total),
      });
    };

    const CONC = 6;
    const osEntries = Array.from(osMap.entries());
    for (let i = 0; i < osEntries.length; i += CONC) {
      const batch = osEntries.slice(i, i + CONC);
      const res = await Promise.all(batch.map(([id]) => gcGet(`/api/ordens_servicos/${encodeURIComponent(id)}`, gcHeaders)));
      res.forEach((j, idx) => {
        const detail = j?.data || j;
        if (detail) {
          extrair(
            detail, "os", batch[idx][0], batch[idx][1],
            historicos.has(`os:${batch[idx][0]}`) ? "historico" : "direto",
          );
        }
      });
    }

    const orcEntries = Array.from(orcMap.entries());
    for (let i = 0; i < orcEntries.length; i += CONC) {
      const batch = orcEntries.slice(i, i + CONC);
      const res = await Promise.all(batch.map(([id]) => gcGet(`/api/orcamentos/${encodeURIComponent(id)}`, gcHeaders)));
      res.forEach((j, idx) => {
        const detail = j?.data || j;
        if (detail) {
          extrair(
            detail, "orcamento", batch[idx][0], batch[idx][1],
            historicos.has(`orc:${batch[idx][0]}`) ? "historico" : "direto",
          );
        }
      });
    }

    // 4) Consolidado por peça
    // Resolve o código interno real dos produtos que vieram sem código
    const idsSemCodigo = Array.from(
      new Set(pecas.filter((p: any) => !p.codigo && p.produto_id).map((p: any) => p.produto_id as string)),
    );
    if (idsSemCodigo.length) {
      const mapaCodigos = new Map<string, string>();
      const CONC_P = 6;
      for (let i = 0; i < idsSemCodigo.length; i += CONC_P) {
        const batch = idsSemCodigo.slice(i, i + CONC_P);
        const res = await Promise.all(
          batch.map((id) => gcGet(`/api/produtos/${encodeURIComponent(id)}`, gcHeaders)),
        );
        res.forEach((j, idx) => {
          const d = j?.data || j;
          const cod = String(d?.codigo_interno || d?.codigo || d?.sku || "").trim();
          if (cod) mapaCodigos.set(batch[idx], cod);
        });
      }
      for (const p of pecas as any[]) {
        if (!p.codigo && p.produto_id && mapaCodigos.has(p.produto_id)) {
          const codigoResolvido = mapaCodigos.get(p.produto_id);
          if (codigoResolvido) p.codigo = codigoResolvido;
        }
      }
    }

    const consolidado = new Map<string, any>();
    for (const p of pecas) {
      const key = p.codigo ? `c:${norm(p.codigo)}` : `d:${norm(p.descricao)}`;
      const cur = consolidado.get(key) || {
        codigo: p.codigo || "",
        descricao: p.descricao,
        qtd_orcada: 0, valor_orcado: 0,
        qtd_vendida: 0, valor_vendido: 0,
        ocorrencias: 0, ultima_data: null as string | null,
      };
      if (!cur.codigo && p.codigo) cur.codigo = p.codigo;
      if (p.vendida) {
        cur.qtd_vendida += p.quantidade;
        cur.valor_vendido += p.valor_total;
      } else {
        cur.qtd_orcada += p.quantidade;
        cur.valor_orcado += p.valor_total;
      }
      cur.ocorrencias += 1;
      if (p.data && (!cur.ultima_data || p.data > cur.ultima_data)) cur.ultima_data = p.data;
      consolidado.set(key, cur);
    }

    const lista = Array.from(consolidado.values()).sort(
      (a, b) => (b.valor_vendido + b.valor_orcado) - (a.valor_vendido + a.valor_orcado),
    );

    return new Response(JSON.stringify({
      ok: true,
      equipamento: { auvo_equipment_id: auvoEquipmentId || null, identificador: identificador || null, nome: equipamentoNome || null },
      tarefas: taskIds.size,
      cobertura: {
        tarefas_com_dados: centralRows.length,
        live_sync: true,
        series: Array.from(series),
        equipamentos: Array.from(equipIds),
        data_inicial: documentos.reduce((m: string | null, d: any) => (d.data && (!m || d.data < m) ? d.data : m), null),
        data_final: documentos.reduce((m: string | null, d: any) => (d.data && (!m || d.data > m) ? d.data : m), null),
      },
      documentos: documentos.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
      pecas: pecas.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
      consolidado: lista,
      totais: {
        os: documentos.filter((d: any) => d.origem === "os").length,
        orcamentos: documentos.filter((d: any) => d.origem === "orcamento").length,
        docs_por_texto: 0,
        itens: pecas.length,
        valor_vendido: pecas.filter((p) => p.vendida).reduce((s, p) => s + p.valor_total, 0),
        valor_orcado: pecas.filter((p) => !p.vendida).reduce((s, p) => s + p.valor_total, 0),
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[equipamento-pecas]", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});