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

async function fetchAuvoTasksUpdatedSince(token: string, sinceDate: string, untilDate: string) {
  // Use a wide startDate/endDate window plus dateLastUpdate to catch tasks
  // updated on/after sinceDate. Then filter in-client by dateLastUpdate <= untilDate.
  const filterObj = {
    startDate: "2020-01-01T00:00:00",
    endDate: "2099-12-31T23:59:59",
    dateLastUpdate: `${sinceDate}T00:00:00`,
  };
  const all: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${PAGE_SIZE}&order=desc&paramFilter=${paramFilter}`;
    const r = await fetch(url, { headers: authHeaders(token) });
    if (!r.ok) {
      console.warn(`[horas-trabalhadas-fetch] Auvo page ${page} status ${r.status}`);
      break;
    }
    const j = await r.json();
    const tasks = j?.result?.entityList || j?.result?.Entities || j?.result?.tasks || j?.result || [];
    if (!Array.isArray(tasks) || tasks.length === 0) break;
    all.push(...tasks);
    if (tasks.length < PAGE_SIZE) break;
    page++;
  }
  // Client-side filter: dateLastUpdate <= untilDate (inclusive)
  const untilCutoff = `${untilDate}T23:59:59`;
  return all.filter((t: any) => {
    const dlu = String(t?.dateLastUpdate || t?.DateLastUpdate || "");
    if (!dlu) return true;
    return dlu <= untilCutoff;
  });
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
    auvo_status_label: statusLabel,
    auvo_date_last_update: t?.dateLastUpdate || t?.DateLastUpdate || null,
    auvo_task_date: isoDate(t?.taskDate || t?.TaskDate),
    auvo_check_in_date: isoDate(t?.checkInDate || t?.CheckInDate),
    auvo_check_out_date: isoDate(t?.checkOutDate || t?.CheckOutDate),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const avisos: string[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const startDate = String(body?.startDate || "");
    const endDate = String(body?.endDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return new Response(JSON.stringify({ error: "startDate/endDate inválidos (yyyy-mm-dd)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Read DB tasks (deterministic order to avoid pagination duplication).
    //    Filter by COALESCE(data_conclusao, data_tarefa) within [startDate, endDate].
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
        .order("auvo_task_id", { ascending: false })
        .range(from, from + DB_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      dbRows.push(...batch);
      if (batch.length < DB_PAGE_SIZE) break;
      from += DB_PAGE_SIZE;
    }

    // 2. Fetch Auvo /tasks updated since startDate, in parallel-friendly way
    let auvoTasks: any[] = [];
    try {
      const apiKey = Deno.env.get("AUVO_APP_KEY");
      const apiToken = Deno.env.get("AUVO_TOKEN");
      if (!apiKey || !apiToken) throw new Error("AUVO_APP_KEY/AUVO_TOKEN ausentes");
      const token = await auvoLogin(apiKey, apiToken);
      auvoTasks = await fetchAuvoTasksUpdatedSince(token, startDate, endDate);
    } catch (e: any) {
      avisos.push(`Falha ao buscar Auvo: ${e?.message || e}. Usando apenas dados do banco.`);
      auvoTasks = [];
    }

    // 3. Hydrate Auvo tasks with DB row when present (so UI sees gc_*, equipamento, etc.)
    const dbById = new Map<string, any>();
    for (const r of dbRows) {
      const id = String(r.auvo_task_id || "");
      if (!id) continue;
      const existing = dbById.get(id);
      if (!existing || (r.atualizado_em || "") > (existing.atualizado_em || "")) {
        dbById.set(id, r);
      }
    }

    // 4. Merge: prefer the most recent of (DB.atualizado_em, Auvo.dateLastUpdate)
    const merged = new Map<string, any>();
    for (const r of dbById.values()) {
      merged.set(String(r.auvo_task_id), { ...r, task_type_id: r.task_type_id ?? null });
    }

    for (const t of auvoTasks) {
      const m = mapAuvoTask(t);
      if (!m.auvo_task_id) continue;
      const dbRow = dbById.get(m.auvo_task_id);
      const existing = merged.get(m.auvo_task_id);
      if (existing) {
        // Always attach task_type_id from Auvo (the DB doesn't carry it)
        existing.task_type_id = m.task_type_id || existing.task_type_id || "";
        // If Auvo update is newer than DB row, keep DB columns but stamp the
        // updated marker so the dedup fallback in the UI prefers this entry.
        const dbStamp = String(existing.atualizado_em || "");
        const auvoStamp = String(m.auvo_date_last_update || "");
        if (auvoStamp && auvoStamp > dbStamp) {
          existing.atualizado_em = auvoStamp;
        }
      } else {
        // Auvo-only task (not yet synced into DB). Provide minimal fields so it
        // still appears in the report.
        merged.set(m.auvo_task_id, {
          auvo_task_id: m.auvo_task_id,
          task_type_id: m.task_type_id,
          status_auvo: m.auvo_status_label,
          data_tarefa: m.auvo_task_date,
          data_conclusao: m.auvo_check_out_date,
          atualizado_em: m.auvo_date_last_update,
          // Hours unknown from /tasks summary alone — UI will skip rows with no
          // duration and no hora_inicio/hora_fim, which is correct.
        });
      }
    }

    const tasks = Array.from(merged.values());

    // Aviso: tasks com horas mas status não-finalizado
    const naoFechadasComHoras = tasks.filter((t: any) => {
      const dur = Number(t.duracao_decimal) || 0;
      const tem = dur > 0 || (!!t.hora_inicio && !!t.hora_fim);
      return tem && t.status_auvo !== "Finalizada";
    });
    if (naoFechadasComHoras.length > 0) {
      avisos.push(`${naoFechadasComHoras.length} tarefa(s) com horas registradas mas status não-finalizado.`);
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