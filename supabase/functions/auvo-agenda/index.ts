import { installGcUsuarioId } from "../_shared/gc-user.ts";
import { parseAuvoDurationMinutes } from "../_shared/auvo-duration.ts";
import {
  auvoCheckInDate,
  auvoCheckOutDate,
  computeAuvoWorkedHours,
} from "../_shared/auvo-worked-time.ts";
import {
  auvoTaskTypeDescription,
  auvoTaskTypeId,
  isConcreteAuvoTaskTypeDescription,
} from "../_shared/auvo-task-type.ts";
import {
  isOsEligibleForBudgetForecast,
  normalizeGcDocumentCode,
} from "../_shared/agenda-forecast-promotion.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
installGcUsuarioId();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const GC_ATRIBUTO_TAREFA_OS = "73343";
const GC_ATRIBUTO_TAREFA_EXEC = "73344";
const GC_ATRIBUTO_TAREFA_ORC = "73341";
const GC_ATRIBUTO_NUMERO_ORC = "81831";

function timeToMinutes(value: string): number {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

function minutesToClock(value: number): string {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function plannedWindowMinutes(start: string, end: string): number {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes < 0 || endMinutes < 0 || startMinutes === endMinutes) return 0;
  return endMinutes > startMinutes
    ? endMinutes - startMinutes
    : (24 * 60 - startMinutes) + endMinutes;
}

function managedDescriptionDurationMinutes(value: unknown): number {
  const match = String(value ?? "").trim().match(/^\[WEDO:\d+:(\d+)\]/i);
  const minutes = Number(match?.[1] ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
}

type AuvoTaskTypeMetadata = {
  description: string;
  durationMinutes: number;
};

async function fetchMissingTaskTypes(
  headers: Record<string, string>,
  taskTypeIds: string[],
): Promise<Map<string, AuvoTaskTypeMetadata>> {
  const result = new Map<string, AuvoTaskTypeMetadata>();
  const uniqueIds = [...new Set(taskTypeIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const concurrency = 6;
  for (let index = 0; index < uniqueIds.length; index += concurrency) {
    const batch = uniqueIds.slice(index, index + concurrency);
    await Promise.all(batch.map(async (id) => {
      try {
        for (const path of ["tasktypes", "taskTypes"]) {
          const response = await fetchWithRetry(`${AUVO_BASE_URL}/${path}/${encodeURIComponent(id)}`, { headers }, {
            retryStatuses: [502, 503],
            delaysMs: [1500, 3000],
            label: `Auvo task type ${id}`,
          });
          if (response.status === 404) continue;
          if (!response.ok) break;
          const json = await response.json().catch(() => ({}));
          const item = json?.result || json?.data || json;
          const description = String(item?.description ?? item?.name ?? "").trim();
          const durationMinutes = parseAuvoDurationMinutes(
            item?.standartTime ?? item?.standardTime ?? item?.defaultTime,
          );
          if (description || durationMinutes > 0) {
            result.set(id, {
              description: description.substring(0, 500),
              durationMinutes,
            });
          }
          break;
        }
      } catch (error) {
        console.warn(`[auvo-agenda] tipo ${id} não resolvido: ${(error as Error).message}`);
      }
    }));
  }
  return result;
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`Auvo login failed (${response.status})`);
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

// Fetch with retry for transient errors (429 for GC, 502/503 for Auvo)
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retryStatuses: number[]; delaysMs: number[]; label: string }
): Promise<Response> {
  let lastResp: Response | null = null;
  const attempts = opts.delaysMs.length + 1;
  for (let i = 0; i < attempts; i++) {
    const resp = await fetch(url, init);
    if (!opts.retryStatuses.includes(resp.status)) return resp;
    lastResp = resp;
    if (i < opts.delaysMs.length) {
      console.warn(`[auvo-agenda] ${opts.label} got ${resp.status}, retrying in ${opts.delaysMs[i]}ms (attempt ${i + 1}/${attempts - 1})`);
      await new Promise(r => setTimeout(r, opts.delaysMs[i]));
    }
  }
  return lastResp!;
}

// Fetch all GC OS pages and build taskId -> OS map
async function fetchGcOsMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string,
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 120;
  const dateQs = (startDate && endDate) ? `&data_inicio=${startDate}&data_fim=${endDate}` : "";

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}${dateQs}`;
    const response = await fetchWithRetry(url, { headers: gcHeaders }, {
      retryStatuses: [429],
      delaysMs: [5000, 10000],
      label: `GC OS page ${page}`,
    });
    if (!response.ok) break;

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const os of records) {
      const atributos: any[] = os.atributos || [];
      const osData = {
        gc_os_codigo: String(os.codigo || ""),
        gc_os_orcamento_codigo: "" as string,
        gc_os_tarefa_exec: "" as string,
        gc_os_situacao: String(os.nome_situacao || ""),
        gc_os_valor_total: parseFloat(os.valor_total || "0"),
        gc_os_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
      };

      const budgetAttr = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_NUMERO_ORC;
      });
      if (budgetAttr) {
        const nested = budgetAttr?.atributo || budgetAttr;
        osData.gc_os_orcamento_codigo = String(nested?.conteudo || nested?.valor || "").replace(/\D/g, "");
      }

      const execAttr = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_EXEC;
      });
      if (execAttr) {
        const nested = execAttr?.atributo || execAttr;
        osData.gc_os_tarefa_exec = String(nested?.conteudo || nested?.valor || "")
          .split(/\D+/)
          .filter((taskId) => taskId.length >= 4)
          .join("/");
      }

      // Check both attributes: 73343 (tarefa OS) and 73344 (tarefa execução)
      for (const attrId of [GC_ATRIBUTO_TAREFA_OS, GC_ATRIBUTO_TAREFA_EXEC]) {
        const attr = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === attrId;
        });
        if (attr) {
          const nested = attr?.atributo || attr;
          const taskIds = String(nested?.conteudo || nested?.valor || "")
            .split(/\D+/)
            .filter((taskId) => taskId.length >= 4);
          for (const taskId of taskIds) {
            map.set(taskId, osData);
          }
        }
      }
    }
    page++;
  }
  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[auvo-agenda] GC OS truncated at MAX_PAGES=${MAX_PAGES} (totalPages=${totalPages})`);
  }
  console.log(`[auvo-agenda] GC OS map: ${map.size} entries`);
  return map;
}

// Fetch all GC orçamentos and build taskId -> orc map
async function fetchGcOrcMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string,
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 120;
  const dateQs = (startDate && endDate) ? `&data_inicio=${startDate}&data_fim=${endDate}` : "";

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}${dateQs}`;
    const response = await fetchWithRetry(url, { headers: gcHeaders }, {
      retryStatuses: [429],
      delaysMs: [5000, 10000],
      label: `GC Orc page ${page}`,
    });
    if (!response.ok) break;

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const orc of records) {
      const atributos: any[] = orc.atributos || [];
      const attrTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_ORC;
      });
      if (attrTarefa) {
        const nested = attrTarefa?.atributo || attrTarefa;
        const taskId = String(nested?.conteudo || nested?.valor || "").trim();
        if (taskId && /^\d+$/.test(taskId)) {
          map.set(taskId, {
            gc_orcamento_codigo: String(orc.codigo || ""),
            gc_orc_situacao: String(orc.nome_situacao || ""),
            gc_orc_valor_total: parseFloat(orc.valor_total || "0"),
            gc_orc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
          });
        }
      }
    }
    page++;
  }
  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[auvo-agenda] GC Orc truncated at MAX_PAGES=${MAX_PAGES} (totalPages=${totalPages})`);
  }
  console.log(`[auvo-agenda] GC Orc map: ${map.size} entries`);
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("AUVO_APP_KEY");
    const apiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

    if (!apiKey || !apiToken) {
      return new Response(
        JSON.stringify({ error: "Credenciais Auvo não configuradas" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { startDate, endDate } = body;
    // O Agendamento Equipe precisa somente das tarefas e dos vínculos já
    // consolidados pelo Controle OS. Nesse modo, não bloqueamos a tela com uma
    // nova varredura de 18 meses no GestãoClick nem com snapshots individuais.
    const fastMode = body.fast === true;

    if (!startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "startDate e endDate são obrigatórios (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bearerToken = await auvoLogin(apiKey, apiToken);
    const headers = { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" };

    // Fetch users for name resolution
    const usersMap = new Map<string, string>();
    if (!fastMode) {
      let page = 1;
      const MAX = 10;
      while (page <= MAX) {
        const url = `${AUVO_BASE_URL}/users/?page=${page}&pageSize=100`;
        const resp = await fetch(url, { headers });
        if (resp.status === 404 || !resp.ok) { await resp.text(); break; }
        const json = await resp.json();
        const users = json?.result?.entityList || json?.result || [];
        if (!Array.isArray(users) || users.length === 0) break;
        for (const u of users) {
          usersMap.set(String(u.userID || ""), String(u.name || u.login || ""));
        }
        if (users.length < 100) break;
        page++;
      }
      console.log(`[auvo-agenda] ${usersMap.size} users loaded`);
    }

    // Fetch Auvo tasks + GC data in parallel
    const gcHeaders: Record<string, string> = gcAccessToken && gcSecretToken ? {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    } : {};
    const hasGc = !fastMode && !!gcAccessToken && !!gcSecretToken;

    const fetchTasks = async () => {
      const allTasks: any[] = [];
      let page = 1;
      let complete = true;
      let truncated = false;
      const pageSize = 100;
      const MAX_PAGES = 20;
      const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };

      while (page <= MAX_PAGES) {
        const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
        const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;
        const response = await fetchWithRetry(url, { headers }, {
          retryStatuses: [502, 503],
          delaysMs: [3000, 6000, 9000],
          label: `Auvo tasks page ${page}`,
        });
        if (response.status === 404) {
          // 404 na primeira página não é uma listagem vazia confiável. Sem essa
          // trava, uma indisponibilidade do endpoint poderia apagar a agenda.
          if (page === 1) complete = false;
          break;
        }
        if (!response.ok) {
          const text = await response.text();
          console.error(`[auvo-agenda] page ${page} error ${response.status}: ${text.substring(0, 200)}`);
          complete = false;
          break;
        }
        const json = await response.json();
        const tasks = json?.result?.entityList || json?.result?.Entities || json?.result?.tasks || json?.result || [];
        if (!Array.isArray(tasks)) {
          complete = false;
          console.error(`[auvo-agenda] page ${page} returned an unexpected payload`);
          break;
        }
        if (tasks.length === 0) break;
        allTasks.push(...tasks);
        if (tasks.length < pageSize) break;
        page++;
      }
      if (page > MAX_PAGES) {
        console.warn(`[auvo-agenda] Auvo tasks truncated at MAX_PAGES=${MAX_PAGES}`);
        complete = false;
        truncated = true;
      }
      return {
        tasks: allTasks,
        complete,
        truncated,
        pagesFetched: Math.min(page, MAX_PAGES),
      };
    };

    // Run in parallel: Auvo tasks + GC OS + GC Orçamentos
    // OS/Orçamentos do GC costumam ter data de emissão MUITO anterior à data
    // agendada da tarefa (escala futura de 90 dias). Por isso ampliamos a janela
    // de busca no GC: 18 meses antes do início até o fim do período.
    const gcStart = (() => {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 18);
      return d.toISOString().substring(0, 10);
    })();
    const [taskFetch, gcOsMap, gcOrcMap] = await Promise.all([
      fetchTasks(),
      hasGc ? fetchGcOsMap(gcHeaders, gcStart, endDate) : Promise.resolve(new Map<string, any>()),
      hasGc ? fetchGcOrcMap(gcHeaders, gcStart, endDate) : Promise.resolve(new Map<string, any>()),
    ]);

    const allTasks = taskFetch.tasks;

    // A mesma fonte do Controle OS é a autoridade para o vínculo tarefa → OS principal.
    // O documento pode ser antigo e não aparecer na janela consultada na API do GC.
    const localDocumentMap = new Map<string, {
      mirror_key: string | null;
      gc_os_codigo: string | null;
      gc_orcamento_codigo: string | null;
      gc_os_tarefa_exec: string | null;
      gc_os_tarefa_os: string | null;
      gc_os_data: string | null;
      gc_os_situacao: string | null;
      gc_os_valor_total: number | null;
      gc_os_link: string | null;
      gc_orc_situacao: string | null;
      gc_orc_valor_total: number | null;
      gc_orc_link: string | null;
      task_type_id: string | null;
      task_type_description: string | null;
    }>();
    const backendUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const backend = backendUrl && serviceRoleKey
      ? createClient(backendUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;
    const taskIds = [...new Set(allTasks
      .map((task: any) => String(task.taskID || task.taskId || task.id || "").trim())
      .filter(Boolean))];

    if (backend && taskIds.length > 0) {
      for (let index = 0; index < taskIds.length; index += 500) {
        const batch = taskIds.slice(index, index + 500);
        const { data: localRows, error: localError } = await backend
          .from("tarefas_central")
          .select("mirror_key,auvo_task_id,gc_os_codigo,gc_orcamento_codigo,gc_os_tarefa_exec,gc_os_tarefa_os,gc_os_data,gc_os_situacao,gc_os_valor_total,gc_os_link,gc_orc_situacao,gc_orc_valor_total,gc_orc_link,task_type_id,descricao")
          .in("auvo_task_id", batch);

        if (localError) {
          console.error(`[auvo-agenda] falha ao consultar vínculos do Controle OS: ${localError.message}`);
          break;
        }

        for (const row of localRows ?? []) {
          const id = String(row.auvo_task_id || "").trim();
          if (!id) continue;
          const existing = localDocumentMap.get(id);
          localDocumentMap.set(id, {
            mirror_key: existing?.mirror_key || row.mirror_key || null,
            gc_os_codigo: existing?.gc_os_codigo || row.gc_os_codigo || null,
            gc_orcamento_codigo: existing?.gc_orcamento_codigo || row.gc_orcamento_codigo || null,
            gc_os_tarefa_exec: existing?.gc_os_tarefa_exec || row.gc_os_tarefa_exec || null,
            gc_os_tarefa_os: existing?.gc_os_tarefa_os || row.gc_os_tarefa_os || null,
            gc_os_data: existing?.gc_os_data || row.gc_os_data || null,
            gc_os_situacao: existing?.gc_os_situacao || row.gc_os_situacao || null,
            gc_os_valor_total: existing?.gc_os_valor_total ?? row.gc_os_valor_total ?? null,
            gc_os_link: existing?.gc_os_link || row.gc_os_link || null,
            gc_orc_situacao: existing?.gc_orc_situacao || row.gc_orc_situacao || null,
            gc_orc_valor_total: existing?.gc_orc_valor_total ?? row.gc_orc_valor_total ?? null,
            gc_orc_link: existing?.gc_orc_link || row.gc_orc_link || null,
            task_type_id: existing?.task_type_id || row.task_type_id || null,
            task_type_description: existing?.task_type_description || row.descricao || null,
          });
        }

        // A agenda também guarda a última referência conhecida. Ela é o plano
        // B quando uma sincronização antiga já removeu a linha do central.
        const { data: agendaRows, error: agendaError } = await backend
          .from("agenda_agendamentos")
          .select("auvo_task_id,gc_os_codigo,gc_orcamento_codigo")
          .in("auvo_task_id", batch);
        if (agendaError) {
          console.warn(`[auvo-agenda] falha ao consultar referências estáveis da agenda: ${agendaError.message}`);
        } else {
          for (const row of agendaRows ?? []) {
            const id = String(row.auvo_task_id || "").trim();
            if (!id) continue;
            const existing = localDocumentMap.get(id);
            localDocumentMap.set(id, {
              mirror_key: existing?.mirror_key || null,
              gc_os_codigo: existing?.gc_os_codigo || row.gc_os_codigo || null,
              gc_orcamento_codigo: existing?.gc_orcamento_codigo || row.gc_orcamento_codigo || null,
              gc_os_tarefa_exec: existing?.gc_os_tarefa_exec || null,
              gc_os_tarefa_os: existing?.gc_os_tarefa_os || null,
              gc_os_data: existing?.gc_os_data || null,
              gc_os_situacao: existing?.gc_os_situacao || null,
              gc_os_valor_total: existing?.gc_os_valor_total ?? null,
              gc_os_link: existing?.gc_os_link || null,
              gc_orc_situacao: existing?.gc_orc_situacao || null,
              gc_orc_valor_total: existing?.gc_orc_valor_total ?? null,
              gc_orc_link: existing?.gc_orc_link || null,
              task_type_id: existing?.task_type_id || null,
              task_type_description: existing?.task_type_description || null,
            });
          }
        }
      }
    }

    console.log(`[auvo-agenda] mode=${fastMode ? "fast" : "full"}, ${allTasks.length} tasks, ${gcOsMap.size} OS, ${gcOrcMap.size} orçamentos, ${localDocumentMap.size} vínculos locais`);

    // A listagem costuma omitir checkInDate/checkOutDate. Busca o detalhe apenas
    // das tarefas que já começaram/finalizaram e estão sem esses horários. Assim
    // o modo rápido continua seletivo e o total diário não depende de cache velho.
    const snapshotMap = new Map<string, {
      checkInDate: string;
      checkOutDate: string;
      duration: unknown;
      durationDecimal: unknown;
      timeControl: unknown;
      estimatedDuration: unknown;
      taskTypeId: string;
      taskTypeDescription: string;
    }>();
    const detailTaskIds = new Set<string>();
    for (const t of allTasks) {
      const tid = String(t.taskID || t.taskId || t.id || "");
      const normalizedStatus = String(t.taskStatus?.description || t.status?.description || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const isFinished = !!t.finished || normalizedStatus.includes("finaliz") || normalizedStatus.includes("conclui");
      const hasStarted = t.checkIn === true
        || normalizedStatus.includes("andamento")
        || normalizedStatus.includes("pausad")
        || isFinished;
      const hasCheckInDate = !!auvoCheckInDate(t);
      const hasCheckOutDate = !!auvoCheckOutDate(t);
      if (hasStarted && tid && (!hasCheckInDate || (isFinished && !hasCheckOutDate))) {
        detailTaskIds.add(tid);
      }
      if (
        tid
        && !auvoTaskTypeDescription(t)
        && !isConcreteAuvoTaskTypeDescription(localDocumentMap.get(tid)?.task_type_description)
      ) {
        detailTaskIds.add(tid);
      }
    }
    const detailIds = [...detailTaskIds];
    const CONCURRENCY = 5;
    for (let i = 0; i < detailIds.length; i += CONCURRENCY) {
      const batch = detailIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (tid) => {
        try {
          const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(tid)}`;
          const resp = await fetchWithRetry(url, { headers }, {
            retryStatuses: [502, 503],
            delaysMs: [1500, 3000],
            label: `Auvo task ${tid} snapshot`,
          });
          if (!resp.ok) return;
          const json = await resp.json().catch(() => ({}));
          const r = json?.result || json || {};
          snapshotMap.set(tid, {
            checkInDate: String(r.checkInDate || r.checkinDate || r.checkin_date || "").trim(),
            checkOutDate: String(r.checkOutDate || r.checkoutDate || r.checkout_date || "").trim(),
            duration: r.duration ?? r.Duration ?? null,
            durationDecimal: r.durationDecimal ?? r.DurationDecimal ?? null,
            timeControl: r.timeControl ?? r.TimeControl ?? null,
            estimatedDuration: r.estimatedDuration ?? r.estimated_duration ?? null,
            taskTypeId: auvoTaskTypeId(r),
            taskTypeDescription: auvoTaskTypeDescription(r),
          });
        } catch (_) { /* ignore */ }
      }));
    }
    console.log(`[auvo-agenda] task detail fetched for ${snapshotMap.size}/${detailIds.length} tasks missing work/type data`);

    // Consulta cada tipo necessário uma única vez. Além do nome, o cadastro do
    // tipo é a fonte oficial do tempo planejado quando a listagem rápida omite
    // estimatedDuration.
    const requiredTaskTypeIds = allTasks
      .filter((task: any) => {
        const id = String(task.taskID || task.taskId || task.id || "").trim();
        const detail = snapshotMap.get(id);
        const missingDescription = !auvoTaskTypeDescription(task)
          && !detail?.taskTypeDescription
          && !isConcreteAuvoTaskTypeDescription(localDocumentMap.get(id)?.task_type_description);
        const missingDuration = parseAuvoDurationMinutes(
          task?.estimatedDuration ?? task?.estimated_duration ?? detail?.estimatedDuration,
        ) <= 0;
        return missingDescription || missingDuration;
      })
      .map((task: any) => {
        const id = String(task.taskID || task.taskId || task.id || "").trim();
        return auvoTaskTypeId(task)
          || snapshotMap.get(id)?.taskTypeId
          || localDocumentMap.get(id)?.task_type_id
          || "";
      });
    const taskTypesMap = await fetchMissingTaskTypes(headers, requiredTaskTypeIds);

    // Map to simplified format + enrich with GC
    const enriched = allTasks.map((t: any) => {
      const taskId = String(t.taskID || t.taskId || t.id || "");

      const custDesc = String(t.customerDescription || "").trim();
      const custName = String(t.customerName || t.customer?.tradeName || t.customer?.companyName || t.customer?.legalName || "").trim();
      const cliente = custDesc || custName || "Sem cliente";

      const rawTecnico = String(t.userToName || t.userTo?.name || t.userTo?.login || "").trim();
      const tecnicoId = String(t.idUserTo || t.userTo?.userID || t.userTo?.id || "");
      const tecnico = rawTecnico || usersMap.get(tecnicoId) || "Sem técnico";

      const rawDate = String(t.taskDate || "");
      const taskDate = rawDate ? rawDate.substring(0, 10) : "";

      const statusDesc = String(t.taskStatus?.description || t.status?.description || "").trim();
      const status = statusDesc || (t.finished ? "Finalizada" : (t.checkIn ? "Em andamento" : "Agendada"));

      // Extract time from taskDate and taskEndDate (format: 2025-03-16T08:00:00)
      const taskDateTime = rawDate.length >= 16 ? rawDate.substring(11, 16) : "";
      const rawEndDate = String(t.taskEndDate || t.endDate || t.scheduledEndDate || "");
      const taskEndDateTime = rawEndDate.length >= 16 ? rawEndDate.substring(11, 16) : "";
      const rawStartTime = String(t.startTime || t.startHour || "").trim();
      const rawEndTime = String(t.endTime || t.endHour || "").trim();
      const snap = snapshotMap.get(taskId);
      const localDocument = localDocumentMap.get(taskId);
      const resolvedTaskTypeId = auvoTaskTypeId(t)
        || snap?.taskTypeId
        || localDocument?.task_type_id
        || "";
      const taskTypeMetadata = taskTypesMap.get(resolvedTaskTypeId);
      const taskTypeDescription = auvoTaskTypeDescription(t)
        || snap?.taskTypeDescription
        || taskTypeMetadata?.description
        || (isConcreteAuvoTaskTypeDescription(localDocument?.task_type_description)
          ? localDocument?.task_type_description
          : "")
        || (resolvedTaskTypeId ? `Tipo ${resolvedTaskTypeId}` : "");
      const scheduledStartTime = rawStartTime || taskDateTime;
      const scheduledEndTime = taskEndDateTime || rawEndTime;
      const estimatedDurationMinutes = parseAuvoDurationMinutes(
        t.estimatedDuration ?? t.estimated_duration ?? snap?.estimatedDuration,
      )
        || taskTypeMetadata?.durationMinutes
        || managedDescriptionDurationMinutes(taskTypeDescription)
        || plannedWindowMinutes(scheduledStartTime, scheduledEndTime);
      const isFinished = !!t.finished || statusDesc === "Finalizada";
      
      // Real check-in/check-out timestamps (when technician actually started/finished)
      const workedSource = {
        ...t,
        checkInDate: auvoCheckInDate(t) || snap?.checkInDate || null,
        checkOutDate: auvoCheckOutDate(t) || snap?.checkOutDate || null,
        duration: t.duration ?? t.Duration ?? snap?.duration ?? null,
        durationDecimal: t.durationDecimal ?? t.DurationDecimal ?? snap?.durationDecimal ?? null,
        timeControl: t.timeControl ?? t.TimeControl ?? snap?.timeControl ?? null,
      };
      const rawCheckInDate = auvoCheckInDate(workedSource) || "";
      const rawCheckOutDate = auvoCheckOutDate(workedSource) || "";
      const workedHours = computeAuvoWorkedHours(workedSource);
      const checkInTime = rawCheckInDate.length >= 16 ? rawCheckInDate.substring(11, 16) : "";
      const checkOutTime = rawCheckOutDate.length >= 16 ? rawCheckOutDate.substring(11, 16) : "";

      // For finished tasks, show effective time spent (check-in → check-out).
      // For other tasks, fall back to scheduled window.
      const startTime = isFinished
        ? (checkInTime || rawStartTime || taskDateTime || "")
        : (rawStartTime || taskDateTime || "");
      const estimatedEndTime = estimatedDurationMinutes > 0 && timeToMinutes(startTime) >= 0
        ? minutesToClock(timeToMinutes(startTime) + estimatedDurationMinutes)
        : "";
      const endTime = isFinished
        ? (checkOutTime || rawEndTime || taskEndDateTime || "")
        : (taskEndDateTime || rawEndTime || estimatedEndTime || "");

      const address = typeof t.address === "object" ? "" : String(t.address || "").substring(0, 200);
      const description = String(t.orientation || t.description || "").substring(0, 500);

      // GC enrichment
      const os = gcOsMap.get(taskId);
      const orc = gcOrcMap.get(taskId);

      return {
        mirror_key: localDocument?.mirror_key || `${taskId}::os:::orc:`,
        auvo_task_id: taskId,
        cliente,
        tecnico,
        tecnico_id: tecnicoId,
        data_tarefa: taskDate,
        hora_inicio: startTime,
        hora_fim: endTime,
        duracao_decimal: workedHours > 0 ? workedHours : null,
        duracao_estimada_minutos: estimatedDurationMinutes || null,
        auvo_task_type_id: resolvedTaskTypeId || null,
        task_type_id: resolvedTaskTypeId || localDocument?.task_type_id || null,
        task_type_description: taskTypeDescription || null,
        status_auvo: status,
        endereco: address,
        descricao: description,
        orientacao: description,
        check_in: t.checkIn === true || !!rawCheckInDate,
        check_out: t.checkOut === true || !!rawCheckOutDate,
        check_in_iso: rawCheckInDate || null,
        check_out_iso: rawCheckOutDate || null,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        gc_os_codigo: localDocument?.gc_os_codigo ?? os?.gc_os_codigo ?? null,
        gc_os_situacao: os?.gc_os_situacao ?? localDocument?.gc_os_situacao ?? null,
        gc_os_valor_total: os?.gc_os_valor_total ?? localDocument?.gc_os_valor_total ?? null,
        gc_os_link: os?.gc_os_link ?? localDocument?.gc_os_link ?? null,
        gc_os_tarefa_exec: os?.gc_os_tarefa_exec ?? localDocument?.gc_os_tarefa_exec ?? null,
        gc_os_tarefa_os: os?.gc_os_tarefa_os ?? localDocument?.gc_os_tarefa_os ?? null,
        gc_os_data: os?.gc_os_data ?? localDocument?.gc_os_data ?? null,
        // O orçamento continua sendo a chave histórica mesmo depois que a OS existe.
        gc_orcamento_codigo: localDocument?.gc_orcamento_codigo
          ?? os?.gc_os_orcamento_codigo
          ?? orc?.gc_orcamento_codigo
          ?? null,
        gc_orc_situacao: orc?.gc_orc_situacao ?? localDocument?.gc_orc_situacao ?? null,
        gc_orc_valor_total: orc?.gc_orc_valor_total ?? localDocument?.gc_orc_valor_total ?? null,
        gc_orc_link: orc?.gc_orc_link ?? localDocument?.gc_orc_link ?? null,
        pendencia: null,
      };
    });

    // O modo rápido também é uma sincronização de verdade: a agenda e os demais
    // módulos consultam tarefas_central para abrir os detalhes da tarefa. Gravar
    // o espelho aqui custa somente upserts em lote e evita exibir uma tarefa que
    // "ainda não foi sincronizada" logo depois do botão concluir.
    let persistedTasks = 0;
    if (backend && enriched.length > 0) {
      const now = new Date().toISOString();
      const centralRows = enriched.map((task: any) => {
        const row: Record<string, unknown> = {
          mirror_key: task.mirror_key,
          auvo_task_id: task.auvo_task_id,
          cliente: task.cliente,
          tecnico: task.tecnico,
          tecnico_id: task.tecnico_id,
          data_tarefa: task.data_tarefa || null,
          status_auvo: task.status_auvo,
          hora_inicio: task.hora_inicio || null,
          check_in: task.check_in,
          check_out: task.check_out,
          auvo_link: task.auvo_link,
          atualizado_em: now,
        };
        if (task.hora_fim) row.hora_fim = task.hora_fim;
        if (task.duracao_decimal != null) row.duracao_decimal = task.duracao_decimal;
        if (task.check_in_iso) row.check_in_iso = task.check_in_iso;
        if (task.check_out_iso) row.check_out_iso = task.check_out_iso;
        if (task.endereco) row.endereco = task.endereco;
        if (task.descricao) row.orientacao = task.descricao;
        if (task.task_type_id) row.task_type_id = task.task_type_id;
        if (task.task_type_description) row.descricao = task.task_type_description;
        if (task.gc_os_codigo) row.gc_os_codigo = task.gc_os_codigo;
        if (task.gc_os_situacao) row.gc_os_situacao = task.gc_os_situacao;
        if (task.gc_os_valor_total != null) row.gc_os_valor_total = task.gc_os_valor_total;
        if (task.gc_os_link) row.gc_os_link = task.gc_os_link;
        if (task.gc_os_tarefa_exec) row.gc_os_tarefa_exec = task.gc_os_tarefa_exec;
        if (task.gc_os_tarefa_os) row.gc_os_tarefa_os = task.gc_os_tarefa_os;
        if (task.gc_os_data) row.gc_os_data = task.gc_os_data;
        if (task.gc_orcamento_codigo) row.gc_orcamento_codigo = task.gc_orcamento_codigo;
        if (task.gc_orc_situacao) row.gc_orc_situacao = task.gc_orc_situacao;
        if (task.gc_orc_valor_total != null) row.gc_orc_valor_total = task.gc_orc_valor_total;
        if (task.gc_orc_link) row.gc_orc_link = task.gc_orc_link;
        return row;
      });

      // tarefas_central possui gatilhos de reconciliação de visitas contratuais.
      // Um único upsert grande acumula o custo desses gatilhos na mesma instrução
      // e pode atingir o statement_timeout mesmo com poucas dezenas de tarefas.
      // Lotes pequenos mantêm cada instrução abaixo do limite sem remover nem
      // contornar as regras de reconciliação do banco.
      const CENTRAL_WRITE_BATCH_SIZE = 8;
      for (let index = 0; index < centralRows.length; index += CENTRAL_WRITE_BATCH_SIZE) {
        const batch = centralRows.slice(index, index + CENTRAL_WRITE_BATCH_SIZE);
        const { error: persistError } = await backend
          .from("tarefas_central")
          .upsert(batch, {
            onConflict: "mirror_key",
            ignoreDuplicates: false,
            defaultToNull: false,
          });
        if (persistError) {
          throw new Error(`Falha ao gravar tarefas na base: ${persistError.message}`);
        }
        persistedTasks += batch.length;
      }
    }

    const promotionResults: any[] = [];
    if (backend) {
      const { data: activeForecasts, error: forecastReadError } = await backend
        .from("agenda_agendamentos")
        .select("id,gc_orcamento_codigo,criado_em")
        .eq("previsao_tipo", "ORCAMENTO_EXECUCAO")
        .eq("previsao_continuidade", true)
        .or("conversao_status.is.null,conversao_status.neq.BLOQUEADA")
        .is("auvo_task_id", null);
      if (forecastReadError) {
        console.warn(`[auvo-agenda] falha ao consultar previsões pendentes: ${forecastReadError.message}`);
      }
      const forecastsByBudget = new Map<string, any>();
      for (const forecast of activeForecasts || []) {
        const budgetCode = normalizeGcDocumentCode(forecast.gc_orcamento_codigo);
        if (budgetCode) forecastsByBudget.set(budgetCode, forecast);
      }
      const candidates = enriched.filter((task: any) => {
        const budgetCode = normalizeGcDocumentCode(task.gc_orcamento_codigo);
        const forecast = forecastsByBudget.get(budgetCode);
        if (!task.auvo_task_id || !task.gc_os_codigo || !forecast) return false;

        // Verifica se a OS é elegível (não é de lote anterior e não é terminal)
        if (!isOsEligibleForBudgetForecast(task, forecast.criado_em)) return false;

        const execIds = String(task.gc_os_tarefa_exec || "").split(/\D+/).filter(Boolean);
        const osTaskIds = String(task.gc_os_tarefa_os || "").split(/\D+/).filter(Boolean);

        // O motor falha se exigir que a tarefa seja EXCLUSIVAMENTE de execução (execIds e não osTaskIds).
        // Na prática, muitos fluxos usam a mesma tarefa para OS e Execução.
        // O critério correto é: se a tarefa está vinculada a essa OS (seja no campo 73343 ou 73344),
        // ela pode promover a previsão daquele orçamento.
        return execIds.includes(String(task.auvo_task_id)) || osTaskIds.includes(String(task.auvo_task_id));
      });
      const concurrency = 3;
      for (let index = 0; index < candidates.length; index += concurrency) {
        const batch = candidates.slice(index, index + concurrency);
        const results = await Promise.all(batch.map(async (task: any) => {
          const { data, error } = await backend.functions.invoke("auvo-task-update", {
            body: {
              action: "promote-budget-forecast",
              gcOrcamentoCodigo: task.gc_orcamento_codigo,
              gcOsCodigo: task.gc_os_codigo,
              execTaskId: task.auvo_task_id,
            },
          });
          return { task, data, error };
        }));
        for (const result of results) {
          promotionResults.push({
            taskId: result.task.auvo_task_id,
            promoted: !!result.data?.promoted,
            alreadyPromoted: !!result.data?.alreadyPromoted,
            reason: result.error?.message || result.data?.reason || null,
          });
          const agenda = result.data?.agenda;
          if ((result.data?.promoted || result.data?.alreadyPromoted) && agenda) {
            result.task.data_tarefa = agenda.data;
            result.task.hora_inicio = String(agenda.hora_inicio || "").slice(0, 5);
            result.task.hora_fim = String(agenda.hora_fim || "").slice(0, 5);
            result.task.tecnico = agenda.colaborador_nome;
            result.task.gc_os_codigo = agenda.gc_os_codigo;
            result.task.gc_orcamento_codigo = agenda.gc_orcamento_codigo;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        data: enriched,
        total: enriched.length,
        persisted_tasks: persistedTasks,
        forecast_promotions: promotionResults,
        mode: fastMode ? "fast" : "full",
        sync_complete: taskFetch.complete,
        sync_truncated: taskFetch.truncated,
        sync_pages: taskFetch.pagesFetched,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[auvo-agenda] Erro:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
