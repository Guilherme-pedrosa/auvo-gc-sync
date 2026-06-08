import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const DB_PAGE_SIZE = 1000;
const REPORT_COLUMNS = [
  "auvo_task_id", "cliente", "tecnico", "tecnico_id", "data_tarefa", "data_conclusao", "status_auvo",
  "orientacao", "pendencia", "descricao", "duracao_decimal", "hora_inicio", "hora_fim", "check_in", "check_out",
  "check_in_iso", "check_out_iso", "duracao_deslocamento", "equipamento_nome", "equipamento_id_serie",
  "auvo_link", "auvo_task_url", "auvo_survey_url", "gc_os_id", "gc_os_codigo", "gc_os_cliente",
  "gc_os_situacao", "gc_os_situacao_id", "gc_os_cor_situacao", "gc_os_valor_total", "gc_os_vendedor",
  "gc_os_data", "gc_os_data_saida", "gc_os_link", "gc_os_link_cobranca", "gc_os_tarefa_exec", "gc_os_tarefa_os",
  "gc_orcamento_id", "gc_orcamento_codigo", "gc_orc_cliente", "gc_orc_situacao", "gc_orc_situacao_id",
  "gc_orc_cor_situacao", "gc_orc_valor_total", "gc_orc_vendedor", "gc_orc_data", "gc_orc_link",
  "task_type_id", "atualizado_em",
].join(",");

function isGcEditLink(value: unknown): boolean {
  return typeof value === "string" && value.includes("gestaoclick.com/") && value.includes("/editar/");
}

function isPublicGcOsLink(value: unknown): boolean {
  return typeof value === "string" && value.includes("gestaoclick.com/cobranca/");
}

function isPublicGcOrcLink(value: unknown): boolean {
  return typeof value === "string" && value.includes("gestaoclick.com/prop/");
}

function sanitizeGcLinks(row: any) {
  if (!row) return row;
  if (isGcEditLink(row.gc_os_link)) row.gc_os_link = row.gc_os_link_cobranca || "";
  if (isGcEditLink(row.gc_os_link_cobranca)) row.gc_os_link_cobranca = "";
  if (isGcEditLink(row.gc_orc_link)) row.gc_orc_link = "";
  return row;
}

async function persistResolvedGcLinks(supabase: any, tasks: any[]) {
  const osLinks = new Map<string, string>();
  const orcLinks = new Map<string, string>();

  for (const task of tasks) {
    const osId = String(task?.gc_os_id || "").trim();
    const osLink = isPublicGcOsLink(task?.gc_os_link_cobranca) ? task.gc_os_link_cobranca : task?.gc_os_link;
    if (osId && isPublicGcOsLink(osLink)) osLinks.set(osId, osLink);

    const orcId = String(task?.gc_orcamento_id || "").trim();
    if (orcId && isPublicGcOrcLink(task?.gc_orc_link)) orcLinks.set(orcId, task.gc_orc_link);
  }

  const updateInBatches = async (
    entries: [string, string][],
    updateOne: (id: string, link: string) => Promise<unknown>,
  ) => {
    let updated = 0;
    const batchSize = 8;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(([id, link]) => updateOne(id, link)));
      updated += results.filter((r) => r.status === "fulfilled").length;
    }
    return updated;
  };

  const osUpdated = await updateInBatches(Array.from(osLinks.entries()), async (id, link) => {
    const { error } = await supabase
      .from("tarefas_central")
      .update({ gc_os_link: link, gc_os_link_cobranca: link })
      .eq("gc_os_id", id);
    if (error) throw error;
  });

  const orcUpdated = await updateInBatches(Array.from(orcLinks.entries()), async (id, link) => {
    const { error } = await supabase
      .from("tarefas_central")
      .update({ gc_orc_link: link })
      .eq("gc_orcamento_id", id);
    if (error) throw error;
  });

  return { osUpdated, orcUpdated };
}

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

  // ── Tempo TRABALHADO (não planejado) ──────────────────────────────
  // Fonte 1: campo `duration` do Auvo ("HH:MM:SS"), que já desconta pausas.
  // Fonte 2: (checkOut - checkIn) - Σ pausas (do array timeControl).
  // Sem check-in → 0 (não considerar janela planejada).
  const checkIn = t?.checkInDate || t?.CheckInDate || null;
  const checkOut = t?.checkOutDate || t?.CheckOutDate || null;
  let workedSeconds = 0;
  const dStr = String(t?.duration || t?.Duration || "").trim();
  const dMatch = dStr.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (dMatch) {
    workedSeconds =
      parseInt(dMatch[1], 10) * 3600 +
      parseInt(dMatch[2], 10) * 60 +
      parseInt(dMatch[3], 10);
  } else if (checkIn) {
    // Calcula manualmente a partir dos eventos de monitoramento.
    const tc: any[] = Array.isArray(t?.timeControl) ? t.timeControl : [];
    let pauseSec = 0;
    let openPauseStart: number | null = null;
    for (const ev of tc) {
      const ps = ev?.pauseStart || ev?.startPause || ev?.start;
      const pe = ev?.pauseEnd || ev?.endPause || ev?.end || ev?.resumeDate;
      if (ps && pe) {
        const diff = new Date(pe).getTime() - new Date(ps).getTime();
        if (Number.isFinite(diff) && diff > 0) pauseSec += Math.floor(diff / 1000);
      } else if (ps && !pe) {
        const ts = new Date(ps).getTime();
        if (Number.isFinite(ts) && (openPauseStart === null || ts > openPauseStart)) {
          openPauseStart = ts;
        }
      }
      if (typeof ev?.duration === "number") pauseSec += ev.duration;
    }
    const inMs = new Date(checkIn).getTime();
    let endMs: number | null = null;
    if (checkOut) {
      endMs = new Date(checkOut).getTime();
    } else if (openPauseStart !== null) {
      // Pausa em aberto: trabalhado vai até o início da pausa atual.
      endMs = openPauseStart;
    }
    if (endMs !== null && Number.isFinite(inMs) && Number.isFinite(endMs) && endMs > inMs) {
      const totalSec = Math.floor((endMs - inMs) / 1000);
      workedSeconds = Math.max(0, totalSec - pauseSec);
    }
  }
  const workedHours = Math.round((workedSeconds / 3600) * 10000) / 10000;

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
    worked_hours: workedHours,
    has_check_in: !!checkIn,
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
        // Tempo TRABALHADO (já desconta pausas). Sem check-in => 0.
        update.duracao_decimal = m.has_check_in ? m.worked_hours : 0;

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
    // Por padrão NÃO faz a varredura completa do GC (lista todas as OS e
    // orçamentos do período) — isso é o que torna o endpoint lento. O
    // central-sync já popula gc_os_link/gc_orc_link com o hash público.
    // Use refreshGc=true para forçar reprocessamento.
    const refreshGc = body?.refreshGc === true;
    const refreshAuvo = body?.refreshAuvo === true;
    // Resolver hashes faltantes do GC via N chamadas individuais é caro e bloqueia
    // a resposta. Por padrão, NÃO faz — usa apenas o que já está no banco.
    // O caller pode forçar com resolveLinks=true (ex.: botão "Reprocessar GC").
    const resolveLinks = body?.resolveLinks === true || refreshGc;
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
        .select(REPORT_COLUMNS)
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
      if (!refreshAuvo) throw new Error("SKIP_AUVO_REFRESH");
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
      if ((e?.message || e) !== "SKIP_AUVO_REFRESH") {
        avisos.push(`Auvo indisponível — OS recentemente atualizadas podem não estar refletidas: ${e?.message || e}`);
      }
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
        // Sobrescreve horários e duração com a verdade do Auvo (tempo trabalhado, sem pausas).
        if (m.has_check_in) {
          existing.duracao_decimal = m.worked_hours;
          if (m.check_in_iso) existing.hora_inicio = String(m.check_in_iso).slice(11, 16);
          if (m.check_out_iso) existing.hora_fim = String(m.check_out_iso).slice(11, 16);
        } else {
          // Sem check-in => não houve execução real. Zera horas planejadas.
          existing.duracao_decimal = 0;
        }
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
          duracao_decimal: m.has_check_in ? m.worked_hours : 0,
          hora_inicio: m.check_in_iso ? String(m.check_in_iso).slice(11, 16) : null,
          hora_fim: m.check_out_iso ? String(m.check_out_iso).slice(11, 16) : null,
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
        const semRefs = !String(t.gc_os_tarefa_os || "").trim() ||
                        !String(t.gc_os_tarefa_exec || "").trim();
        const semEquip = !String(t.equipamento_nome || "").trim();
        return semGc || semRefs || semEquip;
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
            "auvo_task_id, gc_os_tarefa_os, gc_os_tarefa_exec, gc_os_codigo, gc_os_id, gc_os_link, " +
            "gc_os_link_cobranca, gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_data, " +
            "gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_cliente, " +
            "gc_orcamento_codigo, gc_orcamento_id, gc_orc_link, gc_orc_situacao, " +
            "gc_orc_situacao_id, gc_orc_cor_situacao, gc_orc_data, gc_orc_valor_total, " +
            "gc_orc_vendedor, gc_orc_cliente, equipamento_nome, equipamento_id_serie"
          )
          .or(orFilter);

        // Mapa: execId → parent row (prefere quem tem gc_os_codigo preenchido)
        const byExec = new Map<string, any>();
        for (const p of (parents || []) as any[]) {
          const execStr = String(p.gc_os_tarefa_exec || "");
          if (!execStr) continue;
          const execIds = execStr.split(/[\/,;\s]+/).map((x) => x.trim()).filter(Boolean);
          for (const eid of execIds) {
            const cur = byExec.get(eid);
            const score = (p.gc_os_codigo ? 2 : 0) + (p.gc_orcamento_codigo ? 1 : 0) +
              (p.gc_os_tarefa_os ? 1 : 0) + (p.gc_os_tarefa_exec ? 1 : 0);
            const curScore = cur ? (cur.gc_os_codigo ? 2 : 0) + (cur.gc_orcamento_codigo ? 1 : 0) +
              (cur.gc_os_tarefa_os ? 1 : 0) + (cur.gc_os_tarefa_exec ? 1 : 0) : -1;
            if (!cur || score > curScore) byExec.set(eid, p);
          }
        }

        let enriched = 0;
        const inheritedUpdates: any[] = [];
        for (const t of orfas) {
          const p = sanitizeGcLinks(byExec.get(String(t.auvo_task_id)));
          if (!p) continue;
          if (!String(p.gc_os_tarefa_os || "").trim()) {
            p.gc_os_tarefa_os = String(p.auvo_task_id || "").trim() || null;
          }
          // Herda apenas campos GC vazios — nunca sobrescreve dados existentes.
          const osFields = [
            "gc_os_tarefa_os","gc_os_tarefa_exec",
            "gc_os_codigo","gc_os_id","gc_os_link","gc_os_link_cobranca","gc_os_situacao","gc_os_situacao_id",
            "gc_os_cor_situacao","gc_os_data","gc_os_data_saida","gc_os_valor_total",
            "gc_os_vendedor","gc_os_cliente",
            "equipamento_nome","equipamento_id_serie",
          ];
          const inheritedOnlyIfBlankFields = [
            "gc_orcamento_codigo","gc_orcamento_id","gc_orc_link","gc_orc_situacao",
            "gc_orc_situacao_id","gc_orc_cor_situacao","gc_orc_data","gc_orc_valor_total",
            "gc_orc_vendedor","gc_orc_cliente",
          ];
          const fields = [...osFields, ...inheritedOnlyIfBlankFields];
          let touched = false;
          const update: any = {};
          for (const f of osFields) {
            if (p[f] && t[f] !== p[f]) { t[f] = p[f]; update[f] = p[f]; touched = true; }
          }
          for (const f of inheritedOnlyIfBlankFields) {
            if (!t[f] && p[f]) { t[f] = p[f]; update[f] = p[f]; touched = true; }
          }
          if (touched) {
            t.gc_inherited_from = p.auvo_task_id;
            if (Object.keys(update).length > 0) {
              inheritedUpdates.push({ auvo_task_id: String(t.auvo_task_id), update });
            }
            enriched++;
          }
        }
        if (enriched > 0) {
          avisos.push(`${enriched} tarefa(s) de execução enriquecidas com OS/Orçamento da tarefa pai.`);
          for (let i = 0; i < inheritedUpdates.length; i += 8) {
            const batch = inheritedUpdates.slice(i, i + 8);
            await Promise.allSettled(batch.map(({ auvo_task_id, update }) =>
              supabase
                .from("tarefas_central")
                .update(update)
                .eq("auvo_task_id", auvo_task_id)
            ));
          }
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] enrichment failed:", e?.message || e);
      avisos.push(`Falha ao enriquecer execuções com GC: ${e?.message || e}`);
    }

    // 6.a.bis) Fallback por regex: extrai "Orçamento #NNNN" e/ou "OS Nº NNNN"
    // da orientacao/descricao das execuções ainda órfãs e herda OS/Orçamento
    // de qualquer tarefa do MESMO cliente que já tenha esse código vinculado.
    // Cobre o caso comum em que a tarefa de execução não foi amarrada pelo
    // atributo 73344 mas o técnico colou a referência no texto da OS.
    try {
      const orfas = tasks.filter((t: any) =>
        (!String(t.gc_os_codigo || "").trim() &&
         !String(t.gc_orcamento_codigo || "").trim()) ||
        !String(t.gc_os_tarefa_os || "").trim() ||
        !String(t.gc_os_tarefa_exec || "").trim()
      );
      if (orfas.length > 0) {
        const normCli = (s: string) => String(s || "")
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|MEI)\s*/g, "")
          .replace(/[.\-\/]/g, "")
          .replace(/\s+/g, " ")
          .trim();

        const orcCodes = new Set<string>();
        const osCodes = new Set<string>();
        const perTask: { t: any; orc: string | null; os: string | null }[] = [];
        for (const t of orfas) {
          const text = `${t.orientacao || ""}\n${t.descricao || ""}`;
          const orcMatch =
            text.match(/or[çc]amento[^0-9#]*#?\s*(\d{3,7})/i) ||
            // Forma abreviada: "OR Nº 5744", "ORC. #5744", "OR. N° 5744"
            text.match(/\bORC?\.?\s*(?:n[º°o]\.?|#)\s*(\d{3,7})/i);
          const osMatch = text.match(/\bOS(?:\s*GC)?[^0-9#]*(?:n[º°o]\.?\s*|#\s*)?(\d{3,7})/i);
          const orc = orcMatch?.[1] || null;
          const os = osMatch?.[1] || null;
          if (orc) orcCodes.add(orc);
          if (os) osCodes.add(os);
          if (orc || os) perTask.push({ t, orc, os });
        }

        if (perTask.length > 0 && (orcCodes.size > 0 || osCodes.size > 0)) {
          const selectCols =
            "auvo_task_id, cliente, gc_os_cliente, " +
            "gc_os_tarefa_os, gc_os_tarefa_exec, " +
            "gc_os_codigo, gc_os_id, gc_os_link, gc_os_link_cobranca, gc_os_situacao, " +
            "gc_os_situacao_id, gc_os_cor_situacao, gc_os_data, gc_os_data_saida, " +
            "gc_os_valor_total, gc_os_vendedor, " +
            "gc_orcamento_codigo, gc_orcamento_id, gc_orc_link, gc_orc_situacao, " +
            "gc_orc_situacao_id, gc_orc_cor_situacao, gc_orc_data, gc_orc_valor_total, " +
            "gc_orc_vendedor, gc_orc_cliente";
          const orFilters: string[] = [];
          if (orcCodes.size > 0) orFilters.push(`gc_orcamento_codigo.in.(${Array.from(orcCodes).join(",")})`);
          if (osCodes.size > 0) orFilters.push(`gc_os_codigo.in.(${Array.from(osCodes).join(",")})`);
          const { data: cands } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .or(orFilters.join(","));

          // Index by code → row (prefer rows that have BOTH os+orc)
          const byOrc = new Map<string, any>();
          const byOs = new Map<string, any>();
          for (const r of (cands || []) as any[]) {
            const sanitized = sanitizeGcLinks(r);
            const score = (sanitized.gc_os_codigo ? 2 : 0) + (sanitized.gc_orcamento_codigo ? 1 : 0);
            const orc = String(sanitized.gc_orcamento_codigo || "").trim();
            const os = String(sanitized.gc_os_codigo || "").trim();
            if (orc) {
              const cur = byOrc.get(orc);
              const curScore = cur ? (cur.gc_os_codigo ? 2 : 0) + (cur.gc_orcamento_codigo ? 1 : 0) : -1;
              if (!cur || score > curScore) byOrc.set(orc, sanitized);
            }
            if (os) {
              const cur = byOs.get(os);
              const curScore = cur ? (cur.gc_os_codigo ? 2 : 0) + (cur.gc_orcamento_codigo ? 1 : 0) : -1;
              if (!cur || score > curScore) byOs.set(os, sanitized);
            }
          }

          const fields = [
            "gc_os_tarefa_os","gc_os_tarefa_exec",
            "gc_os_codigo","gc_os_id","gc_os_link","gc_os_link_cobranca","gc_os_situacao","gc_os_situacao_id",
            "gc_os_cor_situacao","gc_os_data","gc_os_data_saida","gc_os_valor_total",
            "gc_os_vendedor","gc_os_cliente",
            "gc_orcamento_codigo","gc_orcamento_id","gc_orc_link","gc_orc_situacao",
            "gc_orc_situacao_id","gc_orc_cor_situacao","gc_orc_data","gc_orc_valor_total",
            "gc_orc_vendedor","gc_orc_cliente",
          ];

          let enriched = 0;
          const updates: any[] = [];
          for (const { t, orc, os } of perTask) {
            const cand = (orc && byOrc.get(orc)) || (os && byOs.get(os)) || null;
            if (!cand) continue;
            // Segurança: só herda se o cliente bater (evita amarrar OS de outro cliente).
            const cliTask = normCli(t.cliente || t.gc_os_cliente || "");
            const cliCand = normCli(cand.cliente || cand.gc_os_cliente || cand.gc_orc_cliente || "");
            if (cliTask && cliCand && cliTask !== cliCand) continue;
            let touched = false;
            const update: any = {};
            for (const f of fields) {
              if (!t[f] && cand[f]) { t[f] = cand[f]; update[f] = cand[f]; touched = true; }
            }
            if (touched) {
              t.gc_inherited_from = cand.auvo_task_id;
              updates.push({ auvo_task_id: String(t.auvo_task_id), update });
              enriched++;
            }
          }
          if (enriched > 0) {
            avisos.push(`${enriched} execução(ões) vinculadas por referência textual (#código).`);
            for (let i = 0; i < updates.length; i += 8) {
              const batch = updates.slice(i, i + 8);
              await Promise.allSettled(batch.map(({ auvo_task_id, update }) =>
                {
                  const blankConditions = Object.keys(update).map((f) => `${f}.is.null`).join(",");
                  return supabase
                    .from("tarefas_central")
                    .update(update)
                    .eq("auvo_task_id", auvo_task_id)
                    .or(blankConditions);
                }
              ));
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] regex linkage failed:", e?.message || e);
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

    // 6.c) Varredura completa do GC no período: lista todas as OS e
    //      orçamentos (paginado) e mapeia por atributos custom:
    //        - 73343 = Tarefa OS  (vínculo OS → Auvo task da OS)
    //        - 73344 = Tarefa Execução (vínculo OS → Auvo task de execução)
    //        - 73341 = Tarefa Orçamento (vínculo Orç → Auvo task)
    //      Mesma estratégia usada por kanban-os / budget-kanban.
    //      Se não achar match no GC, deixa em branco — sem chutar.
    try {
      const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
      const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
      if (gcAccessToken && gcSecretToken && refreshGc) {
        const gcH = {
          "access-token": gcAccessToken,
          "secret-access-token": gcSecretToken,
          "Content-Type": "application/json",
        };
        const GC_BASE = "https://api.gestaoclick.com";
        const ATR_OS = "73343";
        const ATR_EXEC = "73344";
        const ATR_ORC = "73341";
        const MAX_PAGES = 30;
        const CONCURRENCY = 5;

        const fetchGcById = async (resource: "ordens_servicos" | "orcamentos", id: string) => {
          const url = `${GC_BASE}/api/${resource}/${encodeURIComponent(id)}`;
          const r = await fetch(url, { headers: gcH });
          if (!r.ok) return null;
          const data = await r.json().catch(() => null);
          return data?.data || data;
        };

        const fetchPage = async (resource: "ordens_servicos" | "orcamentos", page: number) => {
          // Expande a janela ~180 dias para trás: GC OS/Orçamento podem ter sido
          // criados meses antes da tarefa Auvo ser executada (ex.: OS de março
          // executada em abril). Filtrar pelo período do relatório perde essas.
          const d = new Date(`${startDate}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - 180);
          const gcStart = d.toISOString().slice(0, 10);
          const e = new Date(`${endDate}T00:00:00Z`);
          e.setUTCDate(e.getUTCDate() + 30);
          const gcEnd = e.toISOString().slice(0, 10);
          const url = `${GC_BASE}/api/${resource}?limite=100&pagina=${page}&data_inicio=${gcStart}&data_fim=${gcEnd}`;
          for (let attempt = 0; attempt < 3; attempt++) {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 12000);
            try {
              const r = await fetch(url, { headers: gcH, signal: ctrl.signal });
              clearTimeout(tid);
              if (r.status === 429) { await new Promise(s => setTimeout(s, 4000)); continue; }
              if (!r.ok) return null;
              const data = await r.json().catch(() => null);
              return {
                records: Array.isArray(data?.data) ? data.data : [],
                totalPages: data?.meta?.total_paginas || 1,
              };
            } catch {
              clearTimeout(tid);
              await new Promise(s => setTimeout(s, 1500));
            }
          }
          return null;
        };

        const fetchAll = async (resource: "ordens_servicos" | "orcamentos") => {
          const all: any[] = [];
          const first = await fetchPage(resource, 1);
          if (!first) return all;
          all.push(...first.records);
          const totalPages = Math.min(first.totalPages, MAX_PAGES);
          for (let start = 2; start <= totalPages; start += CONCURRENCY) {
            const batch: number[] = [];
            for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(p);
            const results = await Promise.all(batch.map((p) => fetchPage(resource, p)));
            for (const r of results) if (r) all.push(...r.records);
          }
          return all;
        };

        const collectTaskIds = (atributos: any[], atrId: string): string[] => {
          const ids: string[] = [];
          for (const a of atributos || []) {
            const nested = a?.atributo || a;
            if (String(nested.atributo_id || nested.id || "") !== atrId) continue;
            const raw = String(nested?.conteudo || nested?.valor || "").trim();
            for (const piece of raw.split(/[\/,;]/)) {
              const tid = piece.trim();
              if (tid && /^\d+$/.test(tid)) ids.push(tid);
            }
          }
          return ids;
        };

        const [osList, orcList] = await Promise.all([
          fetchAll("ordens_servicos"),
          fetchAll("orcamentos"),
        ]);

        // Indexa OS: aceita match por atributo 73343 OU 73344
        const osByTaskId = new Map<string, any>();
        for (const os of osList) {
          const atributos: any[] = os.atributos || [];
          const tids = new Set<string>([
            ...collectTaskIds(atributos, ATR_OS),
            ...collectTaskIds(atributos, ATR_EXEC),
          ]);
          if (tids.size === 0) continue;
          const payload = {
            gc_os_id: String(os.id),
            gc_os_codigo: String(os.codigo || ""),
            gc_os_situacao: String(os.nome_situacao || ""),
            gc_os_situacao_id: String(os.situacao_id || ""),
            gc_os_cor_situacao: String(os.cor_situacao || ""),
            gc_os_valor_total: parseFloat(String(os.valor_total || "0")) || 0,
            gc_os_vendedor: String(os.nome_vendedor || ""),
            gc_os_cliente: String(os.nome_cliente || ""),
            gc_os_data: String(os.data || os.data_entrada || "").split("T")[0] || null,
            gc_os_data_saida: String(os.data_saida || "").split("T")[0] || null,
            gc_os_link: os.hash
              ? `https://gestaoclick.com/cobranca/${os.hash}`
              : "",
            gc_os_link_cobranca: os.hash
              ? `https://gestaoclick.com/cobranca/${os.hash}`
              : "",
          };
          for (const tid of tids) {
            // Mantém o de maior valor caso colisão (geralmente OS principal)
            const cur = osByTaskId.get(tid);
            if (!cur || payload.gc_os_valor_total > (cur.gc_os_valor_total || 0)) {
              osByTaskId.set(tid, payload);
            }
          }
        }

        // Indexa Orçamento por atributo 73341
        const orcByTaskId = new Map<string, any>();
        for (const orc of orcList) {
          const tids = collectTaskIds(orc.atributos || [], ATR_ORC);
          if (tids.length === 0) continue;
          const payload = {
            gc_orcamento_id: String(orc.id),
            gc_orcamento_codigo: String(orc.codigo || ""),
            gc_orc_situacao: String(orc.nome_situacao || ""),
            gc_orc_situacao_id: String(orc.situacao_id || ""),
            gc_orc_cor_situacao: String(orc.cor_situacao || ""),
            gc_orc_valor_total: parseFloat(String(orc.valor_total || "0")) || 0,
            gc_orc_vendedor: String(orc.nome_vendedor || ""),
            gc_orc_cliente: String(orc.nome_cliente || ""),
            gc_orc_data: String(orc.data || "").split("T")[0] || null,
            gc_orc_link: orc.hash
              ? `https://gestaoclick.com/prop/${orc.hash}`
              : "",
          };
          for (const tid of tids) {
            const cur = orcByTaskId.get(tid);
            if (!cur || payload.gc_orc_valor_total > (cur.gc_orc_valor_total || 0)) {
              orcByTaskId.set(tid, payload);
            }
          }
        }

        let osMatched = 0;
        let orcMatched = 0;
        // Mapas id→hash pra reescrever links antigos /editar/ persistidos no DB
        const osHashById = new Map<string, string>();
        for (const os of osList) {
          if (os?.id && os?.hash) osHashById.set(String(os.id), String(os.hash));
        }
        const orcHashById = new Map<string, string>();
        for (const orc of orcList) {
          if (orc?.id && orc?.hash) orcHashById.set(String(orc.id), String(orc.hash));
        }
        for (const t of tasks) {
          const tid = String(t.auvo_task_id || "");
          if (!tid) continue;

          if (!String(t.gc_os_codigo || "").trim()) {
            const os = osByTaskId.get(tid);
            if (os) {
              for (const [k, v] of Object.entries(os)) {
                if (!t[k]) t[k] = v;
              }
              osMatched++;
            }
          }
          if (!String(t.gc_orcamento_codigo || "").trim()) {
            const orc = orcByTaskId.get(tid);
            if (orc) {
              for (const [k, v] of Object.entries(orc)) {
                if (!t[k]) t[k] = v;
              }
              orcMatched++;
            }
          }

          // Força link público mesmo se já existia link "/editar/" persistido no DB
          const osId = String(t.gc_os_id || "");
          sanitizeGcLinks(t);
          if (osId && osHashById.has(osId)) {
            t.gc_os_link = `https://gestaoclick.com/cobranca/${osHashById.get(osId)}`;
          } else if (typeof t.gc_os_link === "string" && t.gc_os_link.includes("/ordens_servicos/editar/")) {
            t.gc_os_link = "";
          }
          const orcId = String(t.gc_orcamento_id || "");
          if (orcId && orcHashById.has(orcId)) {
            t.gc_orc_link = `https://gestaoclick.com/prop/${orcHashById.get(orcId)}`;
          } else if (typeof t.gc_orc_link === "string" && t.gc_orc_link.includes("/orcamentos_servicos/editar/")) {
            t.gc_orc_link = "";
          }
        }

        const unresolvedOsIds = [...new Set(tasks
          .filter((t: any) => String(t.gc_os_id || "") && !isPublicGcOsLink(t.gc_os_link) && !isPublicGcOsLink(t.gc_os_link_cobranca))
          .map((t: any) => String(t.gc_os_id)))];
        const unresolvedOrcIds = [...new Set(tasks
          .filter((t: any) => String(t.gc_orcamento_id || "") && !String(t.gc_orc_link || "").includes("/prop/"))
          .map((t: any) => String(t.gc_orcamento_id)))];

        for (const id of unresolvedOsIds) {
          const os = await fetchGcById("ordens_servicos", id);
          const hash = String(os?.hash || "").trim();
          if (hash) osHashById.set(id, hash);
        }
        for (const id of unresolvedOrcIds) {
          const orc = await fetchGcById("orcamentos", id);
          const hash = String(orc?.hash || "").trim();
          if (hash) orcHashById.set(id, hash);
        }
        for (const t of tasks) {
          const osId = String(t.gc_os_id || "");
          const orcId = String(t.gc_orcamento_id || "");
          if (osId && osHashById.has(osId)) {
            const link = `https://gestaoclick.com/cobranca/${osHashById.get(osId)}`;
            t.gc_os_link = link;
            t.gc_os_link_cobranca = link;
          }
          if (orcId && orcHashById.has(orcId)) t.gc_orc_link = `https://gestaoclick.com/prop/${orcHashById.get(orcId)}`;
          sanitizeGcLinks(t);
        }

        if (osMatched > 0 || orcMatched > 0) {
          avisos.push(`Varredura GC: ${osMatched} OS e ${orcMatched} orçamento(s) vinculados via atributos 73343/73344/73341.`);
        }

        try {
          const persisted = await persistResolvedGcLinks(supabase, tasks);
          if (persisted.osUpdated > 0 || persisted.orcUpdated > 0) {
            avisos.push(`Links GC salvos no banco: ${persisted.osUpdated} OS e ${persisted.orcUpdated} orçamento(s).`);
          }
        } catch (e: any) {
          console.warn("[horas-trabalhadas-fetch] persist gc scan links failed:", e?.message || e);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] gc scan failed:", e?.message || e);
      avisos.push(`Falha ao varrer GC: ${e?.message || e}`);
    }

    // 6.d) Modo rápido (default): apenas sanitiza links `/editar/` e resolve
    //      hashes faltantes via GET por ID (paralelo) — sem paginar tudo no GC.
    if (!refreshGc) {
      try {
        const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
        const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
        for (const t of tasks) sanitizeGcLinks(t);

        // Sempre reaproveita links já persistidos em outras linhas do mesmo DB pull
        // (barato, sem chamadas externas). Só faz GET por ID se resolveLinks=true.
        if (gcAccessToken && gcSecretToken) {
          const gcH = {
            "access-token": gcAccessToken,
            "secret-access-token": gcSecretToken,
            "Content-Type": "application/json",
          };
          const GC_BASE = "https://api.gestaoclick.com";

          const fetchById = async (resource: "ordens_servicos" | "orcamentos", id: string) => {
            try {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 6000);
              const r = await fetch(`${GC_BASE}/api/${resource}/${encodeURIComponent(id)}`, {
                headers: gcH, signal: ctrl.signal,
              });
              clearTimeout(tid);
              if (!r.ok) return null;
              const j = await r.json().catch(() => null);
              const hash = String((j?.data || j)?.hash || "").trim();
              return hash || null;
            } catch { return null; }
          };

          const knownOsLinks = new Map<string, string>();
          const knownOrcLinks = new Map<string, string>();
          for (const r of dbRows) {
            const osId = String(r.gc_os_id || "");
            const osLink = isPublicGcOsLink(r.gc_os_link_cobranca) ? r.gc_os_link_cobranca : r.gc_os_link;
            if (osId && isPublicGcOsLink(osLink)) knownOsLinks.set(osId, osLink);
            const orcId = String(r.gc_orcamento_id || "");
            if (orcId && isPublicGcOrcLink(r.gc_orc_link)) knownOrcLinks.set(orcId, r.gc_orc_link);
          }
          for (const t of tasks) {
            const osId = String(t.gc_os_id || "");
            if (osId && !isPublicGcOsLink(t.gc_os_link) && !isPublicGcOsLink(t.gc_os_link_cobranca) && knownOsLinks.has(osId)) {
              const link = knownOsLinks.get(osId)!;
              t.gc_os_link = link;
              t.gc_os_link_cobranca = link;
            }
            const orcId = String(t.gc_orcamento_id || "");
            if (orcId && !isPublicGcOrcLink(t.gc_orc_link) && knownOrcLinks.has(orcId)) t.gc_orc_link = knownOrcLinks.get(orcId)!;
          }

          // Resolver via GET por ID é caro. Pula a menos que explicitamente solicitado.
          if (!resolveLinks) {
            return new Response(JSON.stringify({ tasks, avisos }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const needOs = [...new Set(tasks
            .filter((t: any) => String(t.gc_os_id || "") && !isPublicGcOsLink(t.gc_os_link) && !isPublicGcOsLink(t.gc_os_link_cobranca))
            .map((t: any) => String(t.gc_os_id)))];
          const needOrc = [...new Set(tasks
            .filter((t: any) => String(t.gc_orcamento_id || "") && !isPublicGcOrcLink(t.gc_orc_link))
            .map((t: any) => String(t.gc_orcamento_id)))];

          // Resolve todos os links faltantes do período; em paralelo controlado
          // para não congelar a tela nem deixar a maioria sem link.
          const limitedOs = needOs;
          const limitedOrc = needOrc;

          const osHash = new Map<string, string>();
          const orcHash = new Map<string, string>();
          const CONC = 6;
          for (let i = 0; i < limitedOs.length; i += CONC) {
            const batch = limitedOs.slice(i, i + CONC);
            const res = await Promise.all(batch.map((id) => fetchById("ordens_servicos", id)));
            res.forEach((h, idx) => { if (h) osHash.set(batch[idx], h); });
          }
          for (let i = 0; i < limitedOrc.length; i += CONC) {
            const batch = limitedOrc.slice(i, i + CONC);
            const res = await Promise.all(batch.map((id) => fetchById("orcamentos", id)));
            res.forEach((h, idx) => { if (h) orcHash.set(batch[idx], h); });
          }

          for (const t of tasks) {
            const osId = String(t.gc_os_id || "");
            const orcId = String(t.gc_orcamento_id || "");
            if (osId && osHash.has(osId)) {
              const link = `https://gestaoclick.com/cobranca/${osHash.get(osId)}`;
              t.gc_os_link = link;
              t.gc_os_link_cobranca = link;
            }
            if (orcId && orcHash.has(orcId)) t.gc_orc_link = `https://gestaoclick.com/prop/${orcHash.get(orcId)}`;
          }

          if (osHash.size > 0 || orcHash.size > 0) {
            try {
              const persisted = await persistResolvedGcLinks(supabase, tasks);
              avisos.push(`Links GC salvos no banco: ${persisted.osUpdated} OS e ${persisted.orcUpdated} orçamento(s).`);
            } catch (e: any) {
              console.warn("[horas-trabalhadas-fetch] persist resolved links failed:", e?.message || e);
            }
          }
        }
      } catch (e: any) {
        console.warn("[horas-trabalhadas-fetch] fast link resolve failed:", e?.message || e);
      }
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
