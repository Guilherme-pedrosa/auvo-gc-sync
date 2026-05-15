import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const DB_PAGE_SIZE = 1000;

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Auvo login failed (${r.status})`);
  const j = await r.json();
  const token = j?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function isoDate(s: string | null | undefined): string | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const d = raw.split("T")[0];
  if (!d || d === "0001-01-01") return null;
  return d;
}

function isoTimestamp(s: string | null | undefined): string | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  if (raw.startsWith("0001-01-01")) return null;
  return raw;
}

async function fetchWithRetry(url: string, token: string, attempts = 2): Promise<Response | null> {
  let delay = 400;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: authHeaders(token), signal: ctrl.signal });
      clearTimeout(tid);
      if (r.ok) return r;
      if (r.status !== 502 && r.status !== 503 && r.status !== 504) return r;
    } catch (e) {
      clearTimeout(tid);
      console.warn("fetchWithRetry attempt", i, e);
    }
    await new Promise((res) => setTimeout(res, delay));
    delay *= 2;
  }
  return null;
}

async function fetchAuvoTasks(
  token: string,
  filterObj: Record<string, unknown>,
  label: string,
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${PAGE_SIZE}&order=desc&paramFilter=${paramFilter}`;
    const r = await fetchWithRetry(url, token);
    if (!r || !r.ok) {
      console.warn(`[horas-trabalhadas-fetch:${label}] page ${page} failed (${r?.status ?? "no-response"})`);
      break;
    }
    const j = await r.json();
    const tasks = j?.result?.entityList || j?.result?.Entities || j?.result?.tasks || j?.result || [];
    if (!Array.isArray(tasks) || tasks.length === 0) break;
    all.push(...tasks);
    if (tasks.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

function mapAuvoTask(t: any) {
  const taskId = String(t?.taskID ?? t?.taskId ?? t?.id ?? "").trim();
  const taskType = t?.taskType ?? t?.TaskType ?? null;
  const status = t?.taskStatus ?? t?.TaskStatus ?? null;
  const statusLabelMap: Record<number, string> = {
    1: "Aberta", 2: "Em deslocamento", 3: "Em andamento",
    4: "Finalizada", 5: "Finalizada", 6: "Pausada",
  };
  const statusLabel = typeof status === "number" ? statusLabelMap[status] ?? "" : "";
  return {
    auvo_task_id: taskId,
    task_type_id: taskType != null ? String(taskType) : "",
    task_type_description: String(t?.taskTypeDescription || t?.TaskTypeDescription || "").trim(),
    auvo_status_label: statusLabel,
    auvo_date_last_update: isoTimestamp(t?.dateLastUpdate || t?.DateLastUpdate),
    auvo_task_date: isoDate(t?.taskDate || t?.TaskDate),
    auvo_check_in_date: isoDate(t?.checkInDate || t?.CheckInDate),
    auvo_check_out_date: isoDate(t?.checkOutDate || t?.CheckOutDate),
    check_in_iso: isoTimestamp(t?.checkInDate || t?.CheckInDate),
    check_out_iso: isoTimestamp(t?.checkOutDate || t?.CheckOutDate),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const avisos: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "batch");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ─── Modo "single": refetch de UMA OS específica do Auvo ────────
    if (mode === "single") {
      const taskId = String(body?.taskId || "").trim();
      if (!taskId) {
        return new Response(JSON.stringify({ ok: false, error: "taskId obrigatório" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Estado anterior (para retornar diff ao cliente)
      const { data: prev } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, duracao_decimal, status_auvo, check_in_iso, check_out_iso, hora_inicio, hora_fim, data_tarefa, data_conclusao, atualizado_em")
        .eq("auvo_task_id", taskId)
        .maybeSingle();

      try {
        const apiKey = Deno.env.get("AUVO_APP_KEY");
        const apiToken = Deno.env.get("AUVO_TOKEN");
        if (!apiKey || !apiToken) throw new Error("AUVO_APP_KEY/AUVO_TOKEN ausentes");
        const token = await auvoLogin(apiKey, apiToken);

        const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
        const r = await fetchWithRetry(url, token);
        if (!r || !r.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: `Auvo respondeu ${r?.status ?? "sem resposta"} para a OS ${taskId}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const j = await r.json();
        const t = j?.result?.entity || j?.result || j;
        const m = mapAuvoTask(t);
        if (!m.auvo_task_id) {
          return new Response(
            JSON.stringify({ ok: false, error: "Auvo retornou OS sem ID" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Atualiza somente os campos seguros — não toca em campos GC/financeiros
        // nem dispara qualquer reescrita de OS Em Aberto.
        const update: any = {
          task_type_id: m.task_type_id || null,
          status_auvo: m.auvo_status_label || null,
          data_tarefa: m.auvo_task_date,
          data_conclusao: m.auvo_check_out_date,
          check_in_iso: m.check_in_iso,
          check_out_iso: m.check_out_iso,
          atualizado_em: m.auvo_date_last_update || new Date().toISOString(),
        };
        // Recalcula hora_inicio / hora_fim a partir do ISO quando disponível
        if (m.check_in_iso) update.hora_inicio = String(m.check_in_iso).slice(11, 16);
        if (m.check_out_iso) update.hora_fim = String(m.check_out_iso).slice(11, 16);
        // Recalcula duracao_decimal (horas) baseado em check_in/out
        if (m.check_in_iso && m.check_out_iso) {
          const ms = new Date(m.check_out_iso).getTime() - new Date(m.check_in_iso).getTime();
          if (Number.isFinite(ms)) update.duracao_decimal = Math.round((ms / 3_600_000) * 10000) / 10000;
        }

        // Upsert restrito por auvo_task_id (mirror_key permanece como está)
        if (prev) {
          await supabase.from("tarefas_central").update(update).eq("auvo_task_id", taskId);
        } else {
          await supabase.from("tarefas_central").upsert(
            { auvo_task_id: taskId, mirror_key: taskId, ...update },
            { onConflict: "mirror_key" },
          );
        }

        const { data: nowRow } = await supabase
          .from("tarefas_central")
          .select("*")
          .eq("auvo_task_id", taskId)
          .maybeSingle();

        return new Response(JSON.stringify({
          ok: true,
          task: nowRow,
          alteracoes: {
            horas_anteriores: prev?.duracao_decimal ?? null,
            horas_atuais: nowRow?.duracao_decimal ?? null,
            status_anterior: prev?.status_auvo ?? null,
            status_atual: nowRow?.status_auvo ?? null,
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(
          JSON.stringify({ ok: false, error: e?.message || String(e) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ─── Modo "batch" (default) ────────────────────────────────────
    const startDate = String(body?.startDate || "");
    const endDate = String(body?.endDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return new Response(JSON.stringify({ error: "startDate/endDate inválidos (yyyy-mm-dd)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Read DB tasks within period (deterministic order to avoid pagination dupes).
    const dbRows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .or(
          `and(data_conclusao.gte.${startDate},data_conclusao.lte.${endDate}),` +
          `and(data_conclusao.is.null,data_tarefa.gte.${startDate},data_tarefa.lte.${endDate})`
        )
        .order("data_tarefa", { ascending: false })
        .order("auvo_task_id", { ascending: false })
        .range(from, from + DB_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      dbRows.push(...batch);
      if (batch.length < DB_PAGE_SIZE) break;
      from += DB_PAGE_SIZE;
    }

    // 2 + 3) Auvo: recently-updated since startDate AND in-progress within period.
    let auvoTasks: any[] = [];
    try {
      const apiKey = Deno.env.get("AUVO_APP_KEY");
      const apiToken = Deno.env.get("AUVO_TOKEN");
      if (!apiKey || !apiToken) throw new Error("AUVO_APP_KEY/AUVO_TOKEN ausentes");
      const token = await auvoLogin(apiKey, apiToken);

      // (a) Tasks updated since startDate (catches recently-modified historical OS)
      const recentFilter = {
        startDate: "2020-01-01T00:00:00",
        endDate: "2099-12-31T23:59:59",
        dateLastUpdate: `${startDate}T00:00:00`,
      };
      // (b) Tasks scheduled within period — catches OS that haven't been
      //     updated lately but have work in the period (e.g. open/paused).
      const periodFilter = {
        startDate: `${startDate}T00:00:00`,
        endDate: `${endDate}T23:59:59`,
      };

      const [recent, period] = await Promise.all([
        fetchAuvoTasks(token, recentFilter, "recent"),
        fetchAuvoTasks(token, periodFilter, "period"),
      ]);

      // Filter recent: drop entries whose dateLastUpdate is AFTER endDate (they
      // are post-period changes and shouldn't drive period inclusion).
      const endStamp = `${endDate}T23:59:59`;
      const recentFiltered = recent.filter((t: any) => {
        const dlu = String(t?.dateLastUpdate || t?.DateLastUpdate || "");
        return !dlu || dlu <= endStamp;
      });

      const merged = new Map<string, any>();
      for (const t of [...recentFiltered, ...period]) {
        const id = String(t?.taskID ?? t?.taskId ?? t?.id ?? "");
        if (!id) continue;
        const ex = merged.get(id);
        const dlu = String(t?.dateLastUpdate || t?.DateLastUpdate || "");
        if (!ex || dlu > String(ex?.dateLastUpdate || ex?.DateLastUpdate || "")) {
          merged.set(id, t);
        }
      }
      auvoTasks = Array.from(merged.values());
    } catch (e: any) {
      avisos.push(`Auvo indisponível — OS recentemente atualizadas podem não estar refletidas: ${e?.message || e}`);
      auvoTasks = [];
    }

    // 4) Index DB rows by id (most recent atualizado_em wins).
    const dbById = new Map<string, any>();
    for (const r of dbRows) {
      const id = String(r.auvo_task_id || "");
      if (!id) continue;
      const existing = dbById.get(id);
      if (!existing || (r.atualizado_em || "") > (existing.atualizado_em || "")) {
        dbById.set(id, r);
      }
    }

    // 5) Merge: prefer DB columns, attach Auvo-only fields (task_type_id,
    //    check_in_iso/check_out_iso). For Auvo-only rows, keep minimal record.
    const merged = new Map<string, any>();
    for (const r of dbById.values()) {
      merged.set(String(r.auvo_task_id), { ...r });
    }
    for (const t of auvoTasks) {
      const m = mapAuvoTask(t);
      if (!m.auvo_task_id) continue;
      const existing = merged.get(m.auvo_task_id);
      if (existing) {
        existing.task_type_id = m.task_type_id || existing.task_type_id || "";
        existing.task_type_description = m.task_type_description || existing.task_type_description || "";
        existing.check_in_iso = m.check_in_iso || existing.check_in_iso || null;
        existing.check_out_iso = m.check_out_iso || existing.check_out_iso || null;
        const dbStamp = String(existing.atualizado_em || "");
        const auvoStamp = String(m.auvo_date_last_update || "");
        if (auvoStamp && auvoStamp > dbStamp) {
          existing.atualizado_em = auvoStamp;
        }
      } else {
        merged.set(m.auvo_task_id, {
          auvo_task_id: m.auvo_task_id,
          task_type_id: m.task_type_id,
          task_type_description: m.task_type_description,
          status_auvo: m.auvo_status_label,
          data_tarefa: m.auvo_task_date,
          data_conclusao: m.auvo_check_out_date,
          atualizado_em: m.auvo_date_last_update,
          check_in_iso: m.check_in_iso,
          check_out_iso: m.check_out_iso,
        });
      }
    }

    const tasks = Array.from(merged.values());

    // 6) Enriquecimento: para tarefas sem vínculo GC (OS/Orçamento), buscar a
    //    tarefa "pai" (Visita técnica - Ordem de Serviço) cujo campo
    //    gc_os_tarefa_exec referencia esta tarefa de execução, e herdar os
    //    campos GC. Cobre casos onde a tarefa de execução aparece no relatório
    //    sem código GC mesmo havendo uma OS pai sincronizada.
    try {
      const orfas = tasks.filter((t: any) => {
        if (!String(t.auvo_task_id || "").trim()) return false;
        const semGc = !String(t.gc_os_codigo || "").trim() &&
                      !String(t.gc_orcamento_codigo || "").trim();
        const semEquip = !String(t.equipamento_nome || "").trim();
        return semGc || semEquip;
      });
      if (orfas.length > 0) {
        // Busca em lotes — gc_os_tarefa_exec pode conter IDs separados por barra.
        const ids = orfas.map((t: any) => String(t.auvo_task_id));
        const orFilter = ids
          .map((id) => `gc_os_tarefa_exec.ilike.%${id}%`)
          .join(",");
        const { data: parents } = await supabase
          .from("tarefas_central")
          .select(
            "auvo_task_id, gc_os_tarefa_exec, gc_os_codigo, gc_os_id, gc_os_link, " +
            "gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_data, " +
            "gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_cliente, " +
            "gc_orcamento_codigo, gc_orcamento_id, gc_orc_link, gc_orc_situacao, " +
            "gc_orc_situacao_id, gc_orc_cor_situacao, gc_orc_data, gc_orc_valor_total, " +
            "gc_orc_vendedor, gc_orc_cliente, equipamento_nome, equipamento_id_serie"
          )
          .or(orFilter);

        // Mapa: execId → parent row (prefere quem tem gc_os_codigo preenchido)
        const byExec = new Map<string, any>();
        for (const p of parents || []) {
          const execStr = String(p.gc_os_tarefa_exec || "");
          if (!execStr) continue;
          const execIds = execStr.split(/[\/,;\s]+/).map((x) => x.trim()).filter(Boolean);
          for (const eid of execIds) {
            const cur = byExec.get(eid);
            const score = (p.gc_os_codigo ? 2 : 0) + (p.gc_orcamento_codigo ? 1 : 0);
            const curScore = cur ? (cur.gc_os_codigo ? 2 : 0) + (cur.gc_orcamento_codigo ? 1 : 0) : -1;
            if (!cur || score > curScore) byExec.set(eid, p);
          }
        }

        let enriched = 0;
        for (const t of orfas) {
          const p = byExec.get(String(t.auvo_task_id));
          if (!p) continue;
          // Herda apenas campos GC vazios — nunca sobrescreve dados existentes.
          const fields = [
            "gc_os_codigo","gc_os_id","gc_os_link","gc_os_situacao","gc_os_situacao_id",
            "gc_os_cor_situacao","gc_os_data","gc_os_data_saida","gc_os_valor_total",
            "gc_os_vendedor","gc_os_cliente",
            "gc_orcamento_codigo","gc_orcamento_id","gc_orc_link","gc_orc_situacao",
            "gc_orc_situacao_id","gc_orc_cor_situacao","gc_orc_data","gc_orc_valor_total",
            "gc_orc_vendedor","gc_orc_cliente",
            "equipamento_nome","equipamento_id_serie",
          ];
          let touched = false;
          for (const f of fields) {
            if (!t[f] && p[f]) { t[f] = p[f]; touched = true; }
          }
          if (touched) {
            t.gc_inherited_from = p.auvo_task_id;
            enriched++;
          }
        }
        if (enriched > 0) {
          avisos.push(`${enriched} tarefa(s) de execução enriquecidas com OS/Orçamento da tarefa pai.`);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] enrichment failed:", e?.message || e);
      avisos.push(`Falha ao enriquecer execuções com GC: ${e?.message || e}`);
    }

    // 6.b) Equipamento real por tarefa: a tabela equipamento_tarefas_auvo
    //      contém o vínculo nativo Auvo (task_id → equipment_id). Usamos isso
    //      para resolver equipamento_nome SEM chutar/inferir de tarefas-irmãs.
    try {
      const semEquip = tasks.filter((t: any) =>
        !String(t.equipamento_nome || "").trim() &&
        String(t.auvo_task_id || "").trim()
      );
      if (semEquip.length > 0) {
        const ids = semEquip.map((t: any) => String(t.auvo_task_id));
        const { data: links } = await supabase
          .from("equipamento_tarefas_auvo")
          .select("auvo_task_id, auvo_equipment_id")
          .in("auvo_task_id", ids);

        // Agrupa equipment_ids por task (uma tarefa pode ter vários equipamentos)
        const eqByTask = new Map<string, Set<string>>();
        const allEqIds = new Set<string>();
        for (const l of links || []) {
          const tid = String(l.auvo_task_id || "");
          const eid = String(l.auvo_equipment_id || "");
          if (!tid || !eid) continue;
          if (!eqByTask.has(tid)) eqByTask.set(tid, new Set());
          eqByTask.get(tid)!.add(eid);
          allEqIds.add(eid);
        }

        // Busca os nomes dos equipamentos
        const eqNames = new Map<string, { nome: string; serie: string }>();
        if (allEqIds.size > 0) {
          const { data: eqs } = await supabase
            .from("equipamentos_auvo")
            .select("auvo_equipment_id, nome, identificador")
            .in("auvo_equipment_id", Array.from(allEqIds));
          for (const e of eqs || []) {
            eqNames.set(String(e.auvo_equipment_id), {
              nome: String(e.nome || "").trim(),
              serie: String(e.identificador || "").trim(),
            });
          }
        }

        let resolvidos = 0;
        for (const t of semEquip) {
          const eqIds = eqByTask.get(String(t.auvo_task_id));
          if (!eqIds || eqIds.size === 0) continue;
          const nomes: string[] = [];
          const series: string[] = [];
          for (const eid of eqIds) {
            const info = eqNames.get(eid);
            if (info?.nome) nomes.push(info.nome);
            if (info?.serie) series.push(info.serie);
          }
          if (nomes.length === 0) continue;
          t.equipamento_nome = nomes.join(" / ");
          if (series.length > 0) t.equipamento_id_serie = series.join(" / ");
          resolvidos++;
        }
        if (resolvidos > 0) {
          avisos.push(`${resolvidos} tarefa(s) com equipamento resolvido via vínculo nativo Auvo.`);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] equip lookup failed:", e?.message || e);
    }

    // 6.c) Resolução direta no GC: para tarefas ainda sem gc_os_codigo /
    //      gc_orcamento_codigo, extrai o número da OS / orçamento citado em
    //      `orientacao` (ex.: "OS:9308", "OS Nº 9280", "Orçamento 1234")
    //      e busca direto na API do GC para preencher os campos.
    try {
      const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
      const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
      if (gcAccessToken && gcSecretToken) {
        const gcH = {
          "access-token": gcAccessToken,
          "secret-access-token": gcSecretToken,
          "Content-Type": "application/json",
        };
        const GC_BASE = "https://api.gestaoclick.com";

        // Regex tolerante: captura "OS:9308", "OS Nº 9280", "OS N° 9308",
        // "OS 9280", "ORD. SERVIÇO 9308". Procura no início de linha de
        // preferência para evitar matches dentro de palavras maiores.
        const reOS = /\bOS(?:\s*[NnRr][.°ºo]?)?\s*[:#-]?\s*(\d{3,6})\b/i;
        const reORC = /\b(?:OR[ÇCç]|ORC|ORCAMENTO|OR[ÇC]AMENTO)\s*[NnRr]?[.°ºo]?\s*[:#-]?\s*(\d{3,6})\b/i;

        const candidatos = tasks.filter((t: any) =>
          (!String(t.gc_os_codigo || "").trim() || !String(t.gc_orcamento_codigo || "").trim()) &&
          String(t.orientacao || "").trim()
        );

        // Coleta códigos únicos pra dedupe de chamadas
        const osCodigos = new Map<string, any[]>(); // codigo → tasks
        const orcCodigos = new Map<string, any[]>();
        for (const t of candidatos) {
          const ori = String(t.orientacao || "");
          if (!t.gc_os_codigo) {
            const m = ori.match(reOS);
            if (m && m[1]) {
              const code = m[1];
              if (!osCodigos.has(code)) osCodigos.set(code, []);
              osCodigos.get(code)!.push(t);
            }
          }
          if (!t.gc_orcamento_codigo) {
            const m = ori.match(reORC);
            if (m && m[1]) {
              const code = m[1];
              if (!orcCodigos.has(code)) orcCodigos.set(code, []);
              orcCodigos.get(code)!.push(t);
            }
          }
        }

        const fetchOne = async (url: string) => {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 8000);
          try {
            const r = await fetch(url, { headers: gcH, signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) return null;
            return await r.json().catch(() => null);
          } catch {
            clearTimeout(tid);
            return null;
          }
        };

        // OS lookups
        let osResolvidas = 0;
        const osEntries = Array.from(osCodigos.entries());
        const PAR = 8;
        for (let i = 0; i < osEntries.length; i += PAR) {
          const slice = osEntries.slice(i, i + PAR);
          await Promise.all(slice.map(async ([code, ts]) => {
            const data = await fetchOne(`${GC_BASE}/api/ordens_servicos?codigo=${encodeURIComponent(code)}&limite=1`);
            const arr = data?.data;
            const os = Array.isArray(arr) ? arr[0] : (arr?.id ? arr : null);
            if (!os?.id) return;
            const valorTotal = parseFloat(String(os.valor_total || "0")) || 0;
            for (const t of ts) {
              if (!t.gc_os_codigo) t.gc_os_codigo = String(os.codigo || code);
              if (!t.gc_os_id) t.gc_os_id = String(os.id);
              if (!t.gc_os_situacao) t.gc_os_situacao = String(os.nome_situacao || "");
              if (!t.gc_os_situacao_id) t.gc_os_situacao_id = String(os.situacao_id || "");
              if (!t.gc_os_cor_situacao) t.gc_os_cor_situacao = String(os.cor_situacao || "");
              if (!t.gc_os_valor_total) t.gc_os_valor_total = valorTotal;
              if (!t.gc_os_vendedor) t.gc_os_vendedor = String(os.nome_vendedor || "");
              if (!t.gc_os_cliente) t.gc_os_cliente = String(os.nome_cliente || "");
              if (!t.gc_os_data) t.gc_os_data = String(os.data_inicio || os.data || "").split("T")[0] || null;
              if (!t.gc_os_data_saida) t.gc_os_data_saida = String(os.data_saida || "").split("T")[0] || null;
              if (!t.gc_os_link) t.gc_os_link = `https://app.gestaoclick.com/ordens_servicos/visualizar/${os.id}`;
              t.gc_os_inferido_de_orientacao = true;
              osResolvidas++;
            }
          }));
        }

        // Orçamento lookups
        let orcResolvidos = 0;
        const orcEntries = Array.from(orcCodigos.entries());
        for (let i = 0; i < orcEntries.length; i += PAR) {
          const slice = orcEntries.slice(i, i + PAR);
          await Promise.all(slice.map(async ([code, ts]) => {
            const data = await fetchOne(`${GC_BASE}/api/orcamentos?codigo=${encodeURIComponent(code)}&limite=1`);
            const arr = data?.data;
            const orc = Array.isArray(arr) ? arr[0] : (arr?.id ? arr : null);
            if (!orc?.id) return;
            const valorTotal = parseFloat(String(orc.valor_total || "0")) || 0;
            for (const t of ts) {
              if (!t.gc_orcamento_codigo) t.gc_orcamento_codigo = String(orc.codigo || code);
              if (!t.gc_orcamento_id) t.gc_orcamento_id = String(orc.id);
              if (!t.gc_orc_situacao) t.gc_orc_situacao = String(orc.nome_situacao || "");
              if (!t.gc_orc_situacao_id) t.gc_orc_situacao_id = String(orc.situacao_id || "");
              if (!t.gc_orc_cor_situacao) t.gc_orc_cor_situacao = String(orc.cor_situacao || "");
              if (!t.gc_orc_valor_total) t.gc_orc_valor_total = valorTotal;
              if (!t.gc_orc_vendedor) t.gc_orc_vendedor = String(orc.nome_vendedor || "");
              if (!t.gc_orc_cliente) t.gc_orc_cliente = String(orc.nome_cliente || "");
              if (!t.gc_orc_data) t.gc_orc_data = String(orc.data || orc.data_inicio || "").split("T")[0] || null;
              if (!t.gc_orc_link) t.gc_orc_link = `https://app.gestaoclick.com/orcamentos/visualizar/${orc.id}`;
              t.gc_orc_inferido_de_orientacao = true;
              orcResolvidos++;
            }
          }));
        }

        if (osResolvidas > 0 || orcResolvidos > 0) {
          avisos.push(`${osResolvidas} OS e ${orcResolvidos} orçamento(s) resolvidos no GC via código citado em orientação.`);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] gc lookup failed:", e?.message || e);
    }

    return new Response(JSON.stringify({ tasks, avisos }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e), tasks: [], avisos }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
