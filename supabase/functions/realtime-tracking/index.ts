import { installGcUsuarioId } from "../_shared/gc-user.ts";
import { resolveAuvoTaskAssignee } from "../_shared/auvo-task-assignee.ts";
import {
  GcRateLimitedError,
  fetchGcWithoutRetry,
  isRealtimeGcCacheStale,
  shouldClaimRealtimeGcRefresh,
  type RealtimeGcRefreshMode,
} from "../_shared/realtime-gc-refresh.ts";
installGcUsuarioId();

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const REALTIME_GC_GLOBAL_CACHE_KEY = "__global__";

type GcDocMapEntry = {
  codigo: string;
  valor: string;
  vendedor?: string;
};

type GcDocMap = Record<string, GcDocMapEntry>;

type RealtimeGcCacheRow = {
  cache_key: string;
  os_map: GcDocMap | null;
  orc_map: GcDocMap | null;
  refreshed_at: string | null;
  refresh_started_at: string | null;
  blocked_until: string | null;
  last_error: string | null;
};

type GcRefreshResult = {
  osMap?: GcDocMap;
  orcMap?: GcDocMap;
  refreshedAt?: string;
  blockedUntil?: string;
  error?: string;
};

let inMemoryGcBlockedUntil = 0;

// Retry silencioso 502/503 Auvo (3s/6s/9s) — só loga se a tentativa final falhar
async function auvoFetchSilent(url: string, init: RequestInit): Promise<Response> {
  const BACKOFF = [3000, 6000, 9000];
  let resp = await fetch(url, init);
  for (let i = 0; i < BACKOFF.length && (resp.status === 502 || resp.status === 503); i++) {
    await new Promise(r => setTimeout(r, BACKOFF[i]));
    resp = await fetch(url, init);
  }
  return resp;
}

// O GC não tem retry local: o primeiro 429 abre o circuito compartilhado.
// Fetch GC docs and build a map of auvo_task_id → { codigo, valor_total }
// Window: filter by GC document date to capture recent records (avoid pagination cap missing today's docs)
async function fetchGcDocMap(
  gcHeaders: Record<string, string>,
  endpoint: "ordens_servicos" | "orcamentos",
  atributoId: string,
  labelHints: string[],
  dataInicio?: string,
  dataFim?: string
): Promise<GcDocMap> {
  const map: GcDocMap = {};
  let page = 1;
  let totalPages = 1;

  const MAX_PAGES = 30;
  while (page <= totalPages && page <= MAX_PAGES) {
    let url = `${GC_BASE_URL}/api/${endpoint}?limite=100&pagina=${page}`;
    if (dataInicio) url += `&data_inicio=${dataInicio}`;
    if (dataFim) url += `&data_fim=${dataFim}`;
    const response = await fetchGcWithoutRetry(url, { headers: gcHeaders });
    if (!response.ok) {
      console.warn(`[realtime-tracking] GC ${endpoint} page ${page} final status ${response.status}`);
      break;
    }
    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const doc of records) {
      const atributos: any[] = doc.atributos || [];
      const atributoTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        const id = String(nested.atributo_id || nested.id || "");
        const label = String(nested.descricao || nested.label || nested.nome || "").toLowerCase();
        return id === atributoId || labelHints.some((hint) => label.includes(hint));
      });
      if (!atributoTarefa) continue;
      const nested2 = atributoTarefa?.atributo || atributoTarefa;
      const taskIdValue = String(nested2?.conteudo || nested2?.valor || "").trim();
      if (!taskIdValue || !/^\d+$/.test(taskIdValue)) continue;

      map[taskIdValue] = {
        codigo: String(doc.codigo || doc.id),
        valor: String(doc.valor_total || "0"),
        vendedor: String(doc.nome_vendedor || "").trim(),
      };
    }
    page++;
  }
  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[realtime-tracking] TRUNCAMENTO: MAX_PAGES atingido em GC ${endpoint} (totalPages=${totalPages})`);
  }

  return map;
}

async function fetchGcOsMap(
  gcHeaders: Record<string, string>,
  dataInicio?: string,
  dataFim?: string
): Promise<GcDocMap> {
  // Fetch GC OS pages filtered by date window, then scan for BOTH attributes (73343=Tarefa OS, 73344=Tarefa Execução)
  const map: GcDocMap = {};
  let page = 1;
  let totalPages = 1;

  const MAX_PAGES = 30;
  while (page <= totalPages && page <= MAX_PAGES) {
    let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    if (dataInicio) url += `&data_inicio=${dataInicio}`;
    if (dataFim) url += `&data_fim=${dataFim}`;
    const response = await fetchGcWithoutRetry(url, { headers: gcHeaders });
    if (!response.ok) {
      console.warn(`[realtime-tracking] GC ordens_servicos page ${page} final status ${response.status}`);
      break;
    }
    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const doc of records) {
      const atributos: any[] = doc.atributos || [];
      // Check both attributes: 73343 (Tarefa OS) and 73344 (Tarefa Execução)
      for (const a of atributos) {
        const nested = a?.atributo || a;
        const id = String(nested.atributo_id || nested.id || "");
        const label = String(nested.descricao || nested.label || nested.nome || "").toLowerCase();
        const isRelevant = id === "73343" || id === "73344" ||
          label.includes("tarefa os") || label.includes("tarefa execu");
        if (!isRelevant) continue;
        const taskIdValue = String(nested?.conteudo || nested?.valor || "").trim();
        if (!taskIdValue || !/^\d+$/.test(taskIdValue)) continue;
        const valor = String(doc.valor_total || "0");
        const vendedor = String(doc.nome_vendedor || "").trim();
        // Only set if this entry has a real value, or if no entry exists yet
        if (!map[taskIdValue] || (parseFloat(valor) > 0 && parseFloat(map[taskIdValue].valor) <= 0)) {
          map[taskIdValue] = { codigo: String(doc.codigo || doc.id), valor, vendedor };
        }
      }
    }
    page++;
  }
  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[realtime-tracking] TRUNCAMENTO: MAX_PAGES atingido em GC ordens_servicos (totalPages=${totalPages})`);
  }

  console.log(`[realtime-tracking] GC map: ${Object.keys(map).length} OS mapeadas (janela ${dataInicio || "all"} → ${dataFim || "all"})`);
  return map;
}

async function fetchGcOrcMap(
  gcHeaders: Record<string, string>,
  dataInicio?: string,
  dataFim?: string
): Promise<GcDocMap> {
  const atributoId = Deno.env.get("GC_ATRIBUTO_ORCAMENTO_ID") || "73341";
  const label = (Deno.env.get("AUVO_ATRIBUTO_ORCAMENTO_LABEL") || "Tarefa Orçamento").toLowerCase();
  const map = await fetchGcDocMap(gcHeaders, "orcamentos", atributoId, [label, "tarefa orç", "tarefa orc", "orcamento"], dataInicio, dataFim);
  console.log(`[realtime-tracking] GC map: ${Object.keys(map).length} Orçamentos mapeados (janela ${dataInicio || "all"} → ${dataFim || "all"})`);
  return map;
}

function realtimeGcCacheKey(dataInicio: string, dataFim: string): string {
  return `v1:${dataInicio}:${dataFim}`;
}

function normalizeGcMap(value: unknown): GcDocMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as GcDocMap;
}

async function loadRealtimeGcCache(
  sb: ReturnType<typeof createClient>,
  cacheKey: string,
): Promise<RealtimeGcCacheRow | null> {
  const { data, error } = await sb
    .from("realtime_tracking_gc_cache")
    .select("cache_key, os_map, orc_map, refreshed_at, refresh_started_at, blocked_until, last_error")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) {
    console.warn(`[realtime-tracking] cache GC indisponivel: ${error.message}`);
    return null;
  }
  return data as RealtimeGcCacheRow | null;
}

async function claimRealtimeGcRefresh(
  sb: ReturnType<typeof createClient>,
  cacheKey: string,
  dataInicio: string,
  dataFim: string,
  mode: RealtimeGcRefreshMode,
  cache: RealtimeGcCacheRow | null,
  globalCache: RealtimeGcCacheRow | null,
): Promise<boolean> {
  const now = Date.now();
  if (inMemoryGcBlockedUntil > now) return false;

  const state = cache
    ? {
        refreshedAt: cache.refreshed_at,
        refreshStartedAt: cache.refresh_started_at,
        blockedUntil: cache.blocked_until,
      }
    : null;
  if (!shouldClaimRealtimeGcRefresh(state, mode, now)) return false;
  const globalState = globalCache
    ? {
        refreshedAt: globalCache.refreshed_at,
        refreshStartedAt: globalCache.refresh_started_at,
        blockedUntil: globalCache.blocked_until,
      }
    : null;
  if (!shouldClaimRealtimeGcRefresh(globalState, mode, now)) return false;

  const { data, error } = await sb.rpc("claim_realtime_tracking_gc_refresh", {
    p_cache_key: cacheKey,
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
    p_force: mode === "manual",
  });

  if (error) {
    console.warn(`[realtime-tracking] trava do cache GC indisponivel: ${error.message}`);
    // Sem a migration, somente uma ação manual pode tocar o GC. O polling nunca
    // volta ao comportamento antigo de paginar o GC a cada minuto.
    return mode === "manual";
  }
  return data === true;
}

async function refreshRealtimeGcCache(
  sb: ReturnType<typeof createClient>,
  cacheKey: string,
  dataInicio: string,
  dataFim: string,
  gcHeaders: Record<string, string>,
): Promise<GcRefreshResult> {
  try {
    // Sequencial de propósito: se OS receber 429, orçamentos nem começam.
    const osMap = await fetchGcOsMap(gcHeaders, dataInicio, dataFim);
    const orcMap = await fetchGcOrcMap(gcHeaders, dataInicio, dataFim);
    const refreshedAt = new Date().toISOString();

    const { error } = await sb.from("realtime_tracking_gc_cache").upsert({
      cache_key: cacheKey,
      data_inicio: dataInicio,
      data_fim: dataFim,
      os_map: osMap,
      orc_map: orcMap,
      refreshed_at: refreshedAt,
      refresh_started_at: null,
      blocked_until: null,
      last_error: null,
      updated_at: refreshedAt,
    }, { onConflict: "cache_key" });
    if (error) console.warn(`[realtime-tracking] nao foi possivel salvar cache GC: ${error.message}`);
    const { error: globalError } = await sb.from("realtime_tracking_gc_cache").upsert({
      cache_key: REALTIME_GC_GLOBAL_CACHE_KEY,
      data_inicio: "1970-01-01",
      data_fim: "1970-01-01",
      refreshed_at: refreshedAt,
      refresh_started_at: null,
      blocked_until: null,
      last_error: null,
      updated_at: refreshedAt,
    }, { onConflict: "cache_key" });
    if (globalError) console.warn(`[realtime-tracking] nao foi possivel liberar trava GC: ${globalError.message}`);

    return { osMap, orcMap, refreshedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blockedUntil = error instanceof GcRateLimitedError ? error.blockedUntil : undefined;
    if (blockedUntil) inMemoryGcBlockedUntil = Date.parse(blockedUntil);

    const update = {
      refresh_started_at: null,
      blocked_until: blockedUntil || null,
      last_error: message.substring(0, 500),
      updated_at: new Date().toISOString(),
    };
    const { error: cacheError } = await sb
      .from("realtime_tracking_gc_cache")
      .update(update)
      .eq("cache_key", cacheKey);
    if (cacheError) console.warn(`[realtime-tracking] nao foi possivel registrar falha GC: ${cacheError.message}`);
    const { error: globalError } = await sb.from("realtime_tracking_gc_cache").upsert({
      cache_key: REALTIME_GC_GLOBAL_CACHE_KEY,
      data_inicio: "1970-01-01",
      data_fim: "1970-01-01",
      refresh_started_at: null,
      blocked_until: blockedUntil || null,
      last_error: message.substring(0, 500),
      updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });
    if (globalError) console.warn(`[realtime-tracking] nao foi possivel abrir circuito GC: ${globalError.message}`);

    console.warn(`[realtime-tracking] refresh GC interrompido: ${message}`);
    return { blockedUntil, error: message };
  }
}

function runInBackground(promise: Promise<unknown>): void {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (work: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(promise);
    return;
  }
  void promise.catch((error) => console.warn("[realtime-tracking] refresh GC em segundo plano falhou", error));
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Auvo login failed (${response.status}): ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchAllTasks(
  bearerToken: string,
  startDate: string,
  endDate: string,
  status?: number // undefined = all statuses
): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 30;

  const filterObj: any = {
    startDate: `${startDate}T00:00:00`,
    endDate: `${endDate}T23:59:59`,
  };
  if (status !== undefined) filterObj.status = status;

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;
    const response = await auvoFetchSilent(url, { headers: auvoHeaders(bearerToken) });

    if (response.status === 404) break;
    if (!response.ok) {
      console.error(`[realtime-tracking] Page ${page}: ${response.status}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];
    allTasks.push(...entities);
    if (entities.length < pageSize) break;
    page++;
  }

  if (page > MAX_PAGES) {
    console.warn(`[realtime-tracking] TRUNCAMENTO: MAX_PAGES atingido em Auvo /tasks`);
  }

  return allTasks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    if (!auvoApiKey || !auvoApiToken) {
      return new Response(JSON.stringify({ error: "Credenciais Auvo não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date().toISOString().split("T")[0];
    const targetDate = body.date || today;
    const requestedGcMode = String(body.gc_mode || body.mode || body.action || "cache").toLowerCase();
    const gcMode: RealtimeGcRefreshMode = requestedGcMode === "manual" || requestedGcMode === "refresh_gc"
      ? "manual"
      : requestedGcMode === "read_only" || requestedGcMode === "auvo_only"
        ? "read_only"
        : "cache";

    console.log(`[realtime-tracking] Buscando tarefas para ${targetDate}; GC=${gcMode}`);

    // GC credentials (optional — if available, we fetch OS values)
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
    const gcHeaders: Record<string, string> | null = (gcAccessToken && gcSecretToken)
      ? { "access-token": gcAccessToken, "secret-access-token": gcSecretToken, "Content-Type": "application/json" }
      : null;

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    // Supabase client for DB fallback
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // GC date window: ±60 days around target date to capture both today's freshly-created OS
    // and OS with future planned exit dates linked to this task
    const targetDateObj = new Date(targetDate + "T00:00:00");
    const gcWindowStart = new Date(targetDateObj.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const gcWindowEnd = new Date(targetDateObj.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Fetch Auvo tasks + GC OS + GC Orçamentos + DB values in parallel
    const cacheKey = realtimeGcCacheKey(gcWindowStart, gcWindowEnd);

    // O polling de 60s sempre consulta o Auvo e o cache local. O GC só é
    // atualizado manualmente ou, quando o cache vence, por uma única execução
    // em segundo plano protegida por trava transacional no banco.
    const tasksPromise = fetchAllTasks(bearerToken, targetDate, targetDate);
    const dbTasksPromise = (async () => {
      const { data } = await sb
        .from("tarefas_central")
        .select("auvo_task_id, gc_os_codigo, gc_os_valor_total, gc_orc_valor_total, gc_orcamento_codigo, gc_os_id, gc_orcamento_id, gc_os_vendedor, gc_orc_vendedor")
        .eq("data_tarefa", targetDate);
      return data || [];
    })();
    const [gcCache, globalGcCache] = await Promise.all([
      loadRealtimeGcCache(sb, cacheKey),
      loadRealtimeGcCache(sb, REALTIME_GC_GLOBAL_CACHE_KEY),
    ]);
    let gcOsMap = normalizeGcMap(gcCache?.os_map);
    let gcOrcMap = normalizeGcMap(gcCache?.orc_map);
    let gcRefreshedAt = gcCache?.refreshed_at || null;
    let gcBlockedUntil = globalGcCache?.blocked_until || gcCache?.blocked_until || null;
    let gcRefreshing = Boolean(
      (globalGcCache?.refresh_started_at || gcCache?.refresh_started_at) &&
      Date.parse((globalGcCache?.refresh_started_at || gcCache?.refresh_started_at)!) > Date.now() - 15 * 60 * 1000,
    );
    let gcRefreshError = globalGcCache?.last_error || gcCache?.last_error || null;
    let gcSource: "cache" | "manual" | "database" = gcRefreshedAt ? "cache" : "database";

    if (gcHeaders) {
      const claimed = await claimRealtimeGcRefresh(
        sb,
        cacheKey,
        gcWindowStart,
        gcWindowEnd,
        gcMode,
        gcCache,
        globalGcCache,
      );

      if (claimed && gcMode === "manual") {
        const refreshed = await refreshRealtimeGcCache(
          sb,
          cacheKey,
          gcWindowStart,
          gcWindowEnd,
          gcHeaders,
        );
        if (refreshed.osMap && refreshed.orcMap) {
          gcOsMap = refreshed.osMap;
          gcOrcMap = refreshed.orcMap;
          gcRefreshedAt = refreshed.refreshedAt || gcRefreshedAt;
          gcRefreshError = null;
          gcSource = "manual";
        } else {
          gcBlockedUntil = refreshed.blockedUntil || gcBlockedUntil;
          gcRefreshError = refreshed.error || gcRefreshError;
        }
      } else if (claimed) {
        gcRefreshing = true;
        runInBackground(refreshRealtimeGcCache(
          sb,
          cacheKey,
          gcWindowStart,
          gcWindowEnd,
          gcHeaders,
        ));
      }
    }

    const [tasks, dbTasks] = await Promise.all([tasksPromise, dbTasksPromise]);

    // Build DB fallback map: auvo_task_id → { codigo, valor, tipo }
    const dbValorMap: Record<string, { codigo: string; valor: string; tipo: string; vendedor: string }> = {};
    for (const t of dbTasks) {
      const osVal = Number(t.gc_os_valor_total) || 0;
      const orcVal = Number(t.gc_orc_valor_total) || 0;
      if (osVal > 0) {
        dbValorMap[t.auvo_task_id] = { codigo: t.gc_os_codigo || "", valor: String(osVal), tipo: "OS", vendedor: String(t.gc_os_vendedor || "").trim() };
      } else if (orcVal > 0) {
        dbValorMap[t.auvo_task_id] = { codigo: t.gc_orcamento_codigo || "", valor: String(orcVal), tipo: "ORÇ", vendedor: String(t.gc_orc_vendedor || "").trim() };
      } else {
        // Even without value, capture vendedor if present
        const vend = String(t.gc_os_vendedor || t.gc_orc_vendedor || "").trim();
        if (vend) dbValorMap[t.auvo_task_id] = { codigo: t.gc_os_codigo || t.gc_orcamento_codigo || "", valor: "0", tipo: t.gc_os_codigo ? "OS" : "ORÇ", vendedor: vend };
      }
    }
    console.log(`[realtime-tracking] DB fallback: ${Object.keys(dbValorMap).length} tarefas com valor`);

    console.log(`[realtime-tracking] Total: ${tasks.length} tarefas`);
    if (tasks.length > 0) {
      const s = tasks[0];
      console.log(`[realtime-tracking] Sample keys: ${Object.keys(s).join(", ")}`);
      console.log(`[realtime-tracking] Customer fields: customerDescription=${s.customerDescription}, customerName=${s.customerName}, customer=${JSON.stringify(s.customer)?.substring(0,300)}`);
    }

    // Current time for late detection (Brazil timezone UTC-3)
    const nowUTC = new Date();
    const nowBR = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
    const nowStr = nowBR.toISOString().split("T")[0];
    const nowTime = nowBR.toISOString().split("T")[1].substring(0, 5); // HH:MM

    // Group by technician
    const techMap: Record<string, {
      id: string;
      nome: string;
      tarefas: any[];
    }> = {};

    for (const task of tasks) {
      const assignee = resolveAuvoTaskAssignee(task);
      if (!assignee) continue;
      const techId = assignee.id;
      const techName = assignee.nome;

      // Determine status label
      let statusLabel = "Agendada";
      const s = task.status;
      if (s === 3 || task.finished === true || task.finished === "true") statusLabel = "Finalizada";
      else if (s === 2 || task.checkIn === true) statusLabel = "Em andamento";
      else if (s === 4) statusLabel = "Cancelada";
      else if (s === 1) statusLabel = "Agendada";

      const taskDate = String(task.taskDate || task.date || "").split("T")[0];
      const startTime = String(task.startTime || task.startHour || "");
      const endTime = String(task.endTime || task.endHour || "");
      
      // Customer resolution
      let customerName = "";
      if (task.customerDescription) {
        customerName = String(task.customerDescription).trim();
      } else if (task.customer && typeof task.customer === "object") {
        customerName = String(task.customer.name || task.customer.description || "").trim();
      } else if (task.customerName) {
        customerName = String(task.customerName).trim();
      } else if (typeof task.customer === "string") {
        customerName = task.customer.trim();
      }
      
      const address = task.address || task.customer?.address || "";

      // Late detection: if task is "Agendada" and endTime has passed, or if no endTime and it's past 17:00
      let atrasada = false;
      if (statusLabel === "Agendada" && taskDate <= nowStr) {
        if (taskDate < nowStr) {
          // Past day = definitely late
          atrasada = true;
        } else if (endTime) {
          // Today: compare with current time
          atrasada = nowTime > endTime;
        } else if (startTime) {
          // If start time has passed by 2+ hours, consider late
          const startHour = parseInt(startTime.split(":")[0] || "0");
          const startMin = parseInt(startTime.split(":")[1] || "0");
          const nowHour = parseInt(nowTime.split(":")[0] || "0");
          const nowMin = parseInt(nowTime.split(":")[1] || "0");
          const diffMin = (nowHour * 60 + nowMin) - (startHour * 60 + startMin);
          atrasada = diffMin > 120;
        } else {
          // No time info: if past 17:00 and still "Agendada", it's late
          atrasada = nowTime > "17:00";
        }
      }

      const auvoTaskId = String(task.taskID || task.id || "");
      const gcOs = gcOsMap[auvoTaskId] || null;
      const gcOrc = gcOrcMap[auvoTaskId] || null;
      const gcDoc = gcOs || gcOrc;
      const gcDocTipo = gcOs ? "OS" : (gcOrc ? "ORÇ" : "");

      // DB fallback: if live API didn't find a value, check tarefas_central
      const dbFallback = dbValorMap[auvoTaskId] || null;
      // Use GC live value only if it has a real amount (> 0), otherwise fall back to DB
      const gcValorNum = parseFloat(gcDoc?.valor || "0");
      const dbValorNum = parseFloat(dbFallback?.valor || "0");
      const finalCodigo = (gcValorNum > 0 ? gcDoc?.codigo : null) || dbFallback?.codigo || gcDoc?.codigo || "";
      const finalValor = gcValorNum > 0 ? gcDoc!.valor : (dbValorNum > 0 ? dbFallback!.valor : (gcDoc?.valor || ""));
      const finalTipo = (gcValorNum > 0 ? gcDocTipo : null) || dbFallback?.tipo || gcDocTipo || "";

      // O cartão representa a agenda do responsável real no Auvo. O vendedor do
      // GestãoClick é apenas uma informação comercial da OS e nunca define o grupo.
      const gcVendedor = (gcDoc?.vendedor || dbFallback?.vendedor || "").trim();
      const groupKey = techId;

      if (!techMap[groupKey]) {
        techMap[groupKey] = { id: techId, nome: techName, tarefas: [] };
      }

      techMap[groupKey].tarefas.push({
        taskId: auvoTaskId,
        cliente: customerName,
        endereco: typeof address === "object" ? "" : String(address).substring(0, 100),
        status: statusLabel,
        atrasada,
        horaInicio: startTime,
        horaFim: endTime,
        data: taskDate,
        checkIn: !!task.checkIn,
        checkOut: !!task.checkOut,
        pendencia: String(task.pendency ?? task.pendencia ?? "").trim(),
        descricao: String(task.description || task.orientation || "").substring(0, 150),
        duration: String(task.duration || ""),
        gcOsCodigo: finalCodigo,
        gcOsValor: finalValor,
        gcOsTipo: finalTipo,
        gcVendedor,
      });
    }

    // Sort tasks by start time within each technician
    const tecnicos = Object.values(techMap).map((tech) => {
      tech.tarefas.sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""));
      const finalizadas = tech.tarefas.filter(t => t.status === "Finalizada").length;
      const emAndamento = tech.tarefas.filter(t => t.status === "Em andamento").length;
      const agendadas = tech.tarefas.filter(t => t.status === "Agendada").length;
      const atrasadas = tech.tarefas.filter(t => t.atrasada).length;
      return {
        id: tech.id,
        nome: tech.nome,
        tarefas: tech.tarefas,
        resumo: {
          total: tech.tarefas.length,
          finalizadas,
          emAndamento,
          agendadas,
          atrasadas,
        }
      };
    }).sort((a, b) => {
      if (a.resumo.emAndamento > 0 && b.resumo.emAndamento === 0) return -1;
      if (b.resumo.emAndamento > 0 && a.resumo.emAndamento === 0) return 1;
      return b.resumo.total - a.resumo.total;
    });

    // Save late/non-executed tasks to DB immediately for commission tracking
    // Persist any task detected as "atrasada" right away (even during the day)
    // Also persist all non-executed at end of day (past 18:00) or for past dates
    const shouldPersistAll = targetDate < nowStr || (targetDate === nowStr && nowTime >= "18:00");
    const hasLateTasks = tecnicos.some(t => t.tarefas.some(task => task.atrasada));

    if (shouldPersistAll || hasLateTasks) {
      try {

        const naoExecutadas: any[] = [];
        for (const tech of tecnicos) {
          for (const task of tech.tarefas) {
            // Persist if: task is late OR (end of day and still scheduled/not finished)
            const isLateNow = task.atrasada;
            const isEndOfDayPending = shouldPersistAll && (task.status === "Agendada" || (task.status !== "Finalizada" && task.status !== "Em andamento"));
            if (isLateNow || isEndOfDayPending) {
              naoExecutadas.push({
                auvo_task_id: task.taskId,
                tecnico_id: tech.id,
                tecnico_nome: tech.nome,
                cliente: task.cliente || null,
                descricao: task.descricao || null,
                data_planejada: targetDate,
                status_original: isLateNow ? "Atrasada" : task.status,
              });
            }
          }
        }

        if (naoExecutadas.length > 0) {
          const { error: upsertErr } = await sb
            .from("atividades_nao_executadas")
            .upsert(naoExecutadas, { onConflict: "auvo_task_id,data_planejada" });
          if (upsertErr) console.error("[realtime-tracking] Erro ao salvar não executadas:", upsertErr);
          else console.log(`[realtime-tracking] ${naoExecutadas.length} atividades não executadas/atrasadas salvas para ${targetDate}`);
        }
      } catch (err) {
        console.warn("[realtime-tracking] Erro ao persistir não executadas:", err);
      }
    }

    // Count total late
    const totalAtrasadas = tecnicos.reduce((s, t) => s + t.resumo.atrasadas, 0);

    return new Response(JSON.stringify({
      data: targetDate,
      total_tarefas: tasks.length,
      total_tecnicos: tecnicos.length,
      total_atrasadas: totalAtrasadas,
      gc_cache: {
        mode: gcMode,
        source: gcSource,
        refreshed_at: gcRefreshedAt,
        stale: isRealtimeGcCacheStale(gcRefreshedAt),
        refreshing: gcRefreshing,
        blocked_until: gcBlockedUntil,
        rate_limited: Boolean(gcBlockedUntil && Date.parse(gcBlockedUntil) > Date.now()),
        error: gcRefreshError,
      },
      tecnicos,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[realtime-tracking] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
