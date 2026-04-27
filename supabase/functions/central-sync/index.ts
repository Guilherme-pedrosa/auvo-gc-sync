import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const QUESTIONNAIRE_ID = "216040";
const GC_ATRIBUTO_TAREFA_ORC = "73341";
const GC_ATRIBUTO_TAREFA_OS = "73343";
const GC_ATRIBUTO_TAREFA_EXEC = "73344";
const MIN_DELAY_MS = 200;
const FUTURE_DAYS_WINDOW = 30;
let lastAuvoCall = 0;
let lastGcCall = 0;

async function rateLimitedFetch(url: string, options: RequestInit, type: "gc" | "auvo"): Promise<Response> {
  const now = Date.now();
  const last = type === "gc" ? lastGcCall : lastAuvoCall;
  const elapsed = now - last;
  if (elapsed < MIN_DELAY_MS) await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  if (type === "gc") lastGcCall = Date.now();
  else lastAuvoCall = Date.now();
  return fetch(url, options);
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

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function normalizeDate(dateLike: unknown): string | null {
  const raw = String(dateLike || "").trim();
  if (!raw) return null;
  const d = raw.split("T")[0];
  if (!d || d === "0001-01-01") return null;
  return d;
}

function extractTimeFromDateStr(dateStr: string): string {
  // Extract HH:MM:SS or HH:MM from ISO-like date string e.g. "2025-03-18T10:00:00"
  const raw = String(dateStr || "").trim();
  if (raw.length >= 16) {
    const timePart = raw.substring(11, 19); // HH:MM:SS
    if (/^\d{2}:\d{2}/.test(timePart)) return timePart;
  }
  return "";
}

function parseClockToMinutes(timeLike: string): number {
  const raw = String(timeLike || "").trim();
  if (!raw) return -1;
  const hh = parseInt(raw.substring(0, 2), 10);
  const mm = parseInt(raw.substring(3, 5), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return -1;
  return hh * 60 + mm;
}

function minutesToClock(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

function parseDurationToHours(durationLike: unknown): number {
  const raw = String(durationLike || "").trim();
  if (!raw) return 0;

  // Supports HH:MM:SS, HH:MM and decimal strings
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const parts = raw.split(":");
    const hours = parseInt(parts[0] || "0", 10);
    const minutes = parseInt(parts[1] || "0", 10);
    const seconds = parseInt(parts[2] || "0", 10);
    return hours + minutes / 60 + seconds / 3600;
  }

  const numeric = parseFloat(raw.replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function resolveTaskType(task: any): string {
  const candidates = [
    task?.taskTypeDescription,
    task?.taskType?.description,
    task?.taskType?.name,
    task?.typeDescription,
    task?.serviceTypeDescription,
    task?.description,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value && value !== "null" && value !== "undefined") {
      return value.substring(0, 500);
    }
  }

  const taskTypeId = task?.taskTypeId ?? (typeof task?.taskType === "number" ? task.taskType : null);
  if (taskTypeId !== null && taskTypeId !== undefined) {
    const idValue = String(taskTypeId).trim();
    if (idValue) return `Tipo ${idValue}`;
  }

  return "";
}

function extractAddress(addr: unknown): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr.substring(0, 300);
  if (typeof addr === "object" && addr !== null) {
    const a = addr as Record<string, unknown>;
    // Auvo address object can have: street, number, complement, neighborhood, city, state, zipCode, country, fullAddress
    if (a.fullAddress) return String(a.fullAddress).substring(0, 300);
    const parts = [
      a.street || a.logradouro || a.rua || "",
      a.number || a.numero || "",
      a.complement || a.complemento || "",
      a.neighborhood || a.bairro || "",
      a.city || a.cidade || a.localidade || "",
      a.state || a.estado || a.uf || "",
      a.zipCode || a.cep || a.zip || "",
      a.country || a.pais || "",
    ].map(v => String(v || "").trim()).filter(Boolean);
    if (parts.length > 0) return parts.join(", ").substring(0, 300);
    // Last resort: stringify non-empty keys
    const vals = Object.values(a).map(v => String(v || "").trim()).filter(Boolean);
    return vals.join(", ").substring(0, 300);
  }
  return String(addr).substring(0, 300);
}

function normalizeComparable(text: unknown): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function resolveTaskAddress(task: any): string {
  return extractAddress(
    task?.address ||
    task?.customerAddress ||
    task?.addressDescription ||
    task?.customer?.address ||
    task?.customer?.fullAddress ||
    task?.customer?.location ||
    ""
  );
}

type AuvoTaskSnapshot = {
  address: string;
  orientation: string;
  displacementStart: string;
  checkInDate: string;
  checkOutDate: string;
  taskEndDate: string;
  startTime: string;
  endTime: string;
  estimatedDuration: string;
  equipmentName: string;
  equipmentSerial: string;
  equipmentIds: string[];
};

async function fetchAuvoTaskSnapshot(bearerToken: string, taskId: string): Promise<AuvoTaskSnapshot | null> {
  const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
    if (response.status === 502 || response.status === 503) {
      await new Promise(r => setTimeout(r, attempt * 2000));
      continue;
    }
    break;
  }
  if (!response || !response.ok) return null;

  const json = await response.json().catch(() => ({}));
  const result = json?.result || json || {};

  const address = extractAddress(
    result?.address ||
    result?.customerAddress ||
    result?.addressDescription ||
    result?.customer?.address ||
    result?.customer?.fullAddress ||
    result?.customer?.location ||
    ""
  );
  const orientation = String(result?.orientation || "").substring(0, 500);
  const displacementStart = String(result?.displacementStart || result?.displacement_start || "").trim();
  const checkInDate = String(result?.checkInDate || result?.checkinDate || result?.checkin_date || "").trim();
  const checkOutDate = String(result?.checkOutDate || result?.checkoutDate || result?.checkout_date || "").trim();
  const taskEndDate = String(
    result?.taskEndDate ||
    result?.taskEndDateTime ||
    result?.endDate ||
    result?.endDateTime ||
    result?.scheduledEndDate ||
    result?.scheduledEndDateTime ||
    ""
  ).trim();
  const startTime = String(result?.startTime || result?.startHour || result?.scheduledStartTime || "").trim();
  const endTime = String(result?.endTime || result?.endHour || result?.scheduledEndTime || "").trim();
  const estimatedDuration = String(result?.estimatedDuration || result?.estimatedTime || "").trim();

  // Extract equipment info from snapshot
  let equipmentName = "";
  let equipmentSerial = "";
  const equipIds: string[] = Array.isArray(result?.equipmentsId) ? result.equipmentsId.map(String) :
    Array.isArray(result?.equipmentsID) ? result.equipmentsID.map(String) :
    Array.isArray(result?.equipmentIds) ? result.equipmentIds.map(String) : [];
  
  // Try equipment fields directly on task
  if (result?.equipmentName || result?.equipment?.name || result?.equipment?.model) {
    equipmentName = String(result?.equipmentName || result?.equipment?.name || result?.equipment?.model || "").trim();
  }
  if (result?.equipmentIdentifier || result?.equipment?.identifier || result?.equipment?.serial) {
    equipmentSerial = String(result?.equipmentIdentifier || result?.equipment?.identifier || result?.equipment?.serial || "").trim();
  }

  return { address, orientation, displacementStart, checkInDate, checkOutDate, taskEndDate, startTime, endTime, estimatedDuration, equipmentName, equipmentSerial, equipmentIds: equipIds };
}

// Fetch Auvo tasks for a single month window
async function fetchAuvoTasksForPeriod(bearerToken: string, startDate: string, endDate: string): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 30;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
      if (response.status === 502 || response.status === 503) {
        const waitMs = attempt * 3000; // 3s, 6s, 9s
        console.warn(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: ${response.status} — retry ${attempt}/${MAX_RETRIES} em ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
    
    if (!response) break;

    if (response.status === 404) {
      console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: 404 (fim)`);
      break;
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[central-sync] Auvo ${startDate}→${endDate} page ${page} error ${response.status} (após ${MAX_RETRIES} tentativas): ${text.substring(0, 200)}`);
      break;
    }

    const json = await response.json();
    const tasks = json?.result?.entityList || json?.result?.Entities || json?.result?.tasks || json?.result || [];
    if (!Array.isArray(tasks) || tasks.length === 0) {
      console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: 0 tasks (fim)`);
      break;
    }

    allTasks.push(...tasks);
    console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: ${tasks.length} tasks`);

    if (tasks.length < pageSize) break;
    page++;
  }

  return allTasks;
}

// Fetch ALL Auvo tasks month-by-month to avoid API limits
async function fetchAuvoTasks(bearerToken: string, startDate: string, endDate: string): Promise<any[]> {
  const allTasks: any[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Split into monthly chunks
  const current = new Date(start);
  while (current <= end) {
    const monthStart = current.toISOString().split("T")[0];
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const clampedEnd = monthEnd > end ? endDate : monthEnd.toISOString().split("T")[0];

    console.log(`[central-sync] Buscando Auvo: ${monthStart} → ${clampedEnd}`);
    const tasks = await fetchAuvoTasksForPeriod(bearerToken, monthStart, clampedEnd);
    allTasks.push(...tasks);
    console.log(`[central-sync] Mês ${monthStart}: ${tasks.length} tarefas (acumulado: ${allTasks.length})`);

    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return allTasks;
}

// Fetch ALL GC orçamentos (no date filter)
// Returns { byTaskId, byCodigo } for secondary linkage
async function fetchGcOrcamentos(gcHeaders: Record<string, string>): Promise<{ byTaskId: Record<string, any>; byCodigo: Record<string, any> }> {
  const map: Record<string, any> = {};
  const byCodigo: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) break;

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const orc of records) {
      const atributos: any[] = orc.atributos || [];
      const orcPayload = {
        gc_orcamento_id: String(orc.id),
        gc_orcamento_codigo: String(orc.codigo || ""),
        gc_orc_cliente: String(orc.nome_cliente || ""),
        gc_orc_situacao: String(orc.nome_situacao || ""),
        gc_orc_situacao_id: String(orc.situacao_id || ""),
        gc_orc_cor_situacao: String(orc.cor_situacao || ""),
        gc_orc_valor_total: parseFloat(orc.valor_total || "0"),
        gc_orc_vendedor: String(orc.nome_vendedor || ""),
        gc_orc_data: String(orc.data || "").split("T")[0] || null,
        gc_orc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
      };

      // Reverse map by orçamento código
      const codigo = String(orc.codigo || "").trim();
      if (codigo) byCodigo[codigo] = orcPayload;

      const attrTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_ORC;
      });
      if (attrTarefa) {
        const nested = attrTarefa?.atributo || attrTarefa;
        const taskId = String(nested?.conteudo || nested?.valor || "").trim();
        if (taskId && /^\d+$/.test(taskId)) {
          map[taskId] = orcPayload;
        }
      }
    }

    console.log(`[central-sync] GC orçamentos page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  return { byTaskId: map, byCodigo };
}

// Fetch GC OS with optional filters (situacao_ids, date range)
async function fetchGcOs(gcHeaders: Record<string, string>, options?: { situacaoIds?: string[]; dataInicio?: string; dataFim?: string }): Promise<{ byTaskId: Record<string, any>; byTaskIdAll: Record<string, any[]>; byCodigo: Record<string, any>; byOrcNumero: Record<string, any> }> {
  const map: Record<string, any> = {};
  const byTaskIdAll: Record<string, any[]> = {};
  const byCodigo: Record<string, any> = {};
  const byOrcNumero: Record<string, any> = {};

  // If situacaoIds provided, fetch per situação; otherwise fetch all
  const situacaoIds = options?.situacaoIds?.length ? options.situacaoIds : [null];

  for (const sitId of situacaoIds) {
    let page = 1;
    let totalPages = 1;
    const MAX_PAGES = 50;

    while (page <= totalPages && page <= MAX_PAGES) {
      let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
      if (sitId) url += `&situacao_id=${sitId}`;
      if (options?.dataInicio) url += `&data_inicio=${options.dataInicio}`;
      if (options?.dataFim) url += `&data_fim=${options.dataFim}`;

      const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!response.ok) break;

      const data = await response.json();
      const records: any[] = Array.isArray(data?.data) ? data.data : [];
      totalPages = data?.meta?.total_paginas || 1;

      for (const os of records) {
        const atributos: any[] = os.atributos || [];
        // Extract 73344 (tarefa execução) value for this OS
        const attrExec = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_EXEC;
        });
        const execTaskVal = attrExec
          ? String((attrExec?.atributo || attrExec)?.conteudo || (attrExec?.atributo || attrExec)?.valor || "").trim()
          : "";
        const gc_os_tarefa_exec = execTaskVal && /^\d+$/.test(execTaskVal) ? execTaskVal : null;

        const osPayload = {
          gc_os_id: String(os.id),
          gc_os_codigo: String(os.codigo || ""),
          gc_os_cliente: String(os.nome_cliente || ""),
          gc_os_situacao: String(os.nome_situacao || ""),
          gc_os_situacao_id: String(os.situacao_id || ""),
          gc_os_cor_situacao: String(os.cor_situacao || ""),
          gc_os_valor_total: parseFloat(os.valor_total || "0"),
          gc_os_vendedor: String(os.nome_vendedor || ""),
          gc_os_data: String(os.data_entrada || os.data || "").split("T")[0] || null,
          gc_os_data_saida: String(os.data_saida || "").split("T")[0] || null,
          gc_os_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          gc_os_tarefa_exec,
        };

        // Reverse map by OS código
        const codigo = String(os.codigo || "").trim();
        if (codigo) byCodigo[codigo] = osPayload;

        // Reverse map by NÚMERO ORÇAMENTO (attribute 81831) → OS
        const attrOrcNum = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === "81831";
        });
        if (attrOrcNum) {
          const nested = attrOrcNum?.atributo || attrOrcNum;
          const orcNum = String(nested?.conteudo || nested?.valor || "").trim();
          if (orcNum && /^\d+$/.test(orcNum)) {
            byOrcNumero[orcNum] = osPayload;
          }
        }

        // 73343 = tarefa OS. Do NOT map 73344 here: it is execution-only and
        // must not make the OS appear under the execution task.
        for (const attrId of [GC_ATRIBUTO_TAREFA_OS]) {
          const attrTarefa = atributos.find((a: any) => {
            const nested = a?.atributo || a;
            return String(nested.atributo_id || nested.id || "") === attrId;
          });

          if (!attrTarefa) continue;

          const nested = attrTarefa?.atributo || attrTarefa;
          const taskId = String(nested?.conteudo || nested?.valor || "").trim();
          if (!taskId || !/^\d+$/.test(taskId)) continue;

          if (!map[taskId]) {
            map[taskId] = osPayload;
          }
          const bucket = byTaskIdAll[taskId] || [];
          if (!bucket.some((existing) => existing?.gc_os_id === osPayload.gc_os_id)) {
            bucket.push(osPayload);
            byTaskIdAll[taskId] = bucket;
          }
        }
      }

      console.log(`[central-sync] GC OS${sitId ? ` sit=${sitId}` : ''} page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
      page++;
    }
  }
  return { byTaskId: map, byTaskIdAll, byCodigo, byOrcNumero };
}


type CentralSyncBody = {
  start_date?: unknown;
  end_date?: unknown;
  situacao_ids?: unknown;
  wait?: unknown;
};

async function runCentralSync(body: CentralSyncBody = {}) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbClient = createClient(supabaseUrl, supabaseKey);

    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

    if (!auvoApiKey || !auvoApiToken || !gcAccessToken || !gcSecretToken) {
      throw new Error("Credenciais não configuradas");
    }

    // Calculate period (request body overrides default 6-month + future window)
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + FUTURE_DAYS_WINDOW);

    const bodyStart = normalizeDate(body?.start_date);
    const bodyEnd = normalizeDate(body?.end_date);
    const situacaoIds: string[] = Array.isArray(body?.situacao_ids) ? body.situacao_ids.filter((s: any) => s) : [];

    const startDate = bodyStart || sixMonthsAgo.toISOString().split("T")[0];
    const endDate = bodyEnd || futureDate.toISOString().split("T")[0];
    const cleanupCutoff = sixMonthsAgo.toISOString().split("T")[0];

    console.log(`[central-sync] Período: ${startDate} a ${endDate} (limpeza < ${cleanupCutoff}), situações: ${situacaoIds.length || 'todas'}`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Step 1: Fetch GC data first (faster, ~20s) — Auvo will come after status refresh
    const gcOsOptions = {
      situacaoIds: situacaoIds.length > 0 ? situacaoIds : undefined,
      dataInicio: bodyStart || undefined,
      dataFim: bodyEnd || undefined,
    };
    const [gcOrcResult, gcOsResult] = await Promise.all([
      fetchGcOrcamentos(gcH),
      fetchGcOs(gcH, gcOsOptions),
    ]);

    const gcOrcMap = gcOrcResult.byTaskId;
    const gcOrcByCodigo = gcOrcResult.byCodigo;
    const gcOsMap = gcOsResult.byTaskId;
    const gcOsByTaskIdAll = gcOsResult.byTaskIdAll || {};
    const gcOsByCodigo = gcOsResult.byCodigo;
    const gcOsByOrcNumero = gcOsResult.byOrcNumero;

    console.log(`[central-sync] GC carregado: Orç: ${Object.keys(gcOrcMap).length}, OS: ${Object.keys(gcOsMap).length}`);

    // ── IMMEDIATE: Late linkage — link existing DB tasks to GC OS/ORC when gc_os_id is null ──
    // Runs FIRST (before heavy lookups) to handle OS created after the task was synced
    {
      let lateLinkOS = 0;
      let lateLinkOrc = 0;
      for (const [taskId, osPayload] of Object.entries(gcOsResult.byTaskId)) {
        if (!taskId || !osPayload?.gc_os_id) continue;
        const { count } = await sbClient
          .from("tarefas_central")
          .update({
            gc_os_id: osPayload.gc_os_id,
            gc_os_codigo: osPayload.gc_os_codigo,
            gc_os_cliente: osPayload.gc_os_cliente,
            gc_os_situacao: osPayload.gc_os_situacao,
            gc_os_situacao_id: osPayload.gc_os_situacao_id,
            gc_os_cor_situacao: osPayload.gc_os_cor_situacao,
            gc_os_valor_total: osPayload.gc_os_valor_total,
            gc_os_vendedor: osPayload.gc_os_vendedor,
            gc_os_data: osPayload.gc_os_data,
            gc_os_data_saida: osPayload.gc_os_data_saida,
            gc_os_link: osPayload.gc_os_link,
            gc_os_tarefa_exec: osPayload.gc_os_tarefa_exec || null,
            os_realizada: true,
            atualizado_em: new Date().toISOString(),
          }, { count: "exact" })
          .eq("auvo_task_id", taskId)
          .is("gc_os_id", null);
        lateLinkOS += count || 0;
      }

      for (const [taskId, orcPayload] of Object.entries(gcOrcResult.byTaskId)) {
        if (!taskId || !orcPayload?.gc_orcamento_id) continue;
        const { count } = await sbClient
          .from("tarefas_central")
          .update({
            gc_orcamento_id: orcPayload.gc_orcamento_id,
            gc_orcamento_codigo: orcPayload.gc_orcamento_codigo,
            gc_orc_cliente: orcPayload.gc_orc_cliente,
            gc_orc_situacao: orcPayload.gc_orc_situacao,
            gc_orc_situacao_id: orcPayload.gc_orc_situacao_id,
            gc_orc_cor_situacao: orcPayload.gc_orc_cor_situacao,
            gc_orc_valor_total: orcPayload.gc_orc_valor_total,
            gc_orc_vendedor: orcPayload.gc_orc_vendedor,
            gc_orc_data: orcPayload.gc_orc_data,
            gc_orc_link: orcPayload.gc_orc_link,
            orcamento_realizado: true,
            atualizado_em: new Date().toISOString(),
          }, { count: "exact" })
          .eq("auvo_task_id", taskId)
          .is("gc_orcamento_id", null);
        lateLinkOrc += count || 0;
      }

      if (lateLinkOS > 0 || lateLinkOrc > 0) {
        console.log(`[central-sync] Late linkage: ${lateLinkOS} tarefas vinculadas a OS, ${lateLinkOrc} a orçamentos`);
      }
    }

    // ── PRIORITY: Global OS/ORC status refresh (runs FIRST, before heavy Auvo processing) ──
    // This ensures OS statuses are always updated even if the function times out later
    {
      const allGcOsById: Record<string, any> = {};
      for (const osPayload of Object.values(gcOsResult.byCodigo)) {
        if (osPayload.gc_os_id) allGcOsById[osPayload.gc_os_id] = osPayload;
      }
      for (const osPayload of Object.values(gcOsResult.byTaskId)) {
        if (osPayload.gc_os_id) allGcOsById[osPayload.gc_os_id] = osPayload;
      }

      const allGcOrcById: Record<string, any> = {};
      for (const orcPayload of Object.values(gcOrcResult.byCodigo)) {
        if (orcPayload.gc_orcamento_id) allGcOrcById[orcPayload.gc_orcamento_id] = orcPayload;
      }
      for (const orcPayload of Object.values(gcOrcResult.byTaskId)) {
        if (orcPayload.gc_orcamento_id) allGcOrcById[orcPayload.gc_orcamento_id] = orcPayload;
      }

      // Fetch distinct gc_os_id values from the DB — scoped to period when dates are provided
      const isScoped = !!bodyStart && !!bodyEnd;
      const dbOsIds = new Set<string>();
      for (let from = 0; ; from += 1000) {
        let query = sbClient
          .from("tarefas_central")
          .select("gc_os_id")
          .not("gc_os_id", "is", null);
        if (isScoped) {
          query = query.gte("data_tarefa", startDate).lte("data_tarefa", endDate);
        }
        const { data: chunk } = await query.range(from, from + 999);
        if (!chunk || chunk.length === 0) break;
        for (const r of chunk) {
          if (r.gc_os_id) dbOsIds.add(r.gc_os_id);
        }
        if (chunk.length < 1000) break;
      }
      console.log(`[central-sync] OS no banco${isScoped ? ` (${startDate}→${endDate})` : ' (global)'}: ${dbOsIds.size}`);

      // For OS in DB but NOT in GC listing (e.g. cancelled OS filtered by API), fetch individually
      const missingOsIds = Array.from(dbOsIds).filter(id => !allGcOsById[id]);
      if (missingOsIds.length > 0) {
        // Cap individual lookups to avoid IDLE_TIMEOUT (150s). Remaining IDs will be picked up next sync.
        const MAX_INDIVIDUAL = 80;
        const toFetch = missingOsIds.slice(0, MAX_INDIVIDUAL);
        if (missingOsIds.length > MAX_INDIVIDUAL) {
          console.log(`[central-sync] ${missingOsIds.length} OS faltantes — limitando a ${MAX_INDIVIDUAL} nesta execução`);
        } else {
          console.log(`[central-sync] ${missingOsIds.length} OS no banco não encontradas na listagem GC — buscando individualmente...`);
        }
        const PARALLEL = 15;
        for (let i = 0; i < toFetch.length; i += PARALLEL) {
          const batch = toFetch.slice(i, i + PARALLEL);
          const results = await Promise.all(batch.map(async (osId) => {
            const url = `${GC_BASE_URL}/api/ordens_servicos/${osId}`;
            const resp = await rateLimitedFetch(url, { headers: gcH }, "gc");
            if (!resp.ok) return null;
            const data = await resp.json().catch(() => null);
            const os = data?.data || data;
            if (!os || !os.id) return null;
            // Extract tarefa execução (73344) from atributos
            const atributos: any[] = os.atributos || [];
            const attrExec = atributos.find((a: any) => {
              const nested = a?.atributo || a;
              return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_EXEC;
            });
            const execTaskVal = attrExec
              ? String((attrExec?.atributo || attrExec)?.conteudo || (attrExec?.atributo || attrExec)?.valor || "").trim()
              : "";
            const gc_os_tarefa_exec = execTaskVal && /^\d+$/.test(execTaskVal) ? execTaskVal : null;
            return {
              gc_os_id: String(os.id),
              gc_os_situacao: String(os.nome_situacao || ""),
              gc_os_situacao_id: String(os.situacao_id || ""),
              gc_os_cor_situacao: String(os.cor_situacao || ""),
              gc_os_valor_total: parseFloat(os.valor_total || "0"),
              gc_os_vendedor: String(os.nome_vendedor || ""),
              gc_os_cliente: String(os.nome_cliente || ""),
              gc_os_data_saida: String(os.data_saida || "").split("T")[0] || null,
              gc_os_tarefa_exec,
            };
          }));
          for (const fresh of results) {
            if (fresh) allGcOsById[fresh.gc_os_id] = fresh;
          }
        }
        console.log(`[central-sync] OS individuais recuperadas: ${missingOsIds.length - Array.from(dbOsIds).filter(id => !allGcOsById[id]).length}`);
      }

      let globalOsUpdated = 0;
      for (const osId of dbOsIds) {
        const fresh = allGcOsById[osId];
        if (!fresh) continue;
        const updatePayload: any = {
            gc_os_situacao: fresh.gc_os_situacao,
            gc_os_situacao_id: fresh.gc_os_situacao_id,
            gc_os_cor_situacao: fresh.gc_os_cor_situacao,
            gc_os_valor_total: fresh.gc_os_valor_total,
            gc_os_vendedor: fresh.gc_os_vendedor,
            gc_os_cliente: fresh.gc_os_cliente,
            gc_os_data_saida: fresh.gc_os_data_saida,
            atualizado_em: new Date().toISOString(),
          };
        if (fresh.gc_os_tarefa_exec) {
          updatePayload.gc_os_tarefa_exec = fresh.gc_os_tarefa_exec;
        }
        const { count } = await sbClient
          .from("tarefas_central")
          .update(updatePayload, { count: "exact" })
          .eq("gc_os_id", osId)
          .neq("gc_os_situacao", fresh.gc_os_situacao);
        globalOsUpdated += count || 0;
      }

      // Second pass: fill gc_os_tarefa_exec for OS that have it null but GC has it
      let execFilled = 0;
      for (const osId of dbOsIds) {
        const fresh = allGcOsById[osId];
        if (!fresh?.gc_os_tarefa_exec) continue;
        const { count } = await sbClient
          .from("tarefas_central")
          .update({
            gc_os_tarefa_exec: fresh.gc_os_tarefa_exec,
            atualizado_em: new Date().toISOString(),
          }, { count: "exact" })
          .eq("gc_os_id", osId)
          .is("gc_os_tarefa_exec", null);
        execFilled += count || 0;
      }
      if (execFilled > 0) {
        console.log(`[central-sync] gc_os_tarefa_exec preenchido para ${execFilled} registros`);
      }

      const dbOrcIds = new Set<string>();
      for (let from = 0; ; from += 1000) {
        let query = sbClient
          .from("tarefas_central")
          .select("gc_orcamento_id")
          .not("gc_orcamento_id", "is", null);
        if (isScoped) {
          query = query.gte("data_tarefa", startDate).lte("data_tarefa", endDate);
        }
        const { data: chunk } = await query.range(from, from + 999);
        if (!chunk || chunk.length === 0) break;
        for (const r of chunk) {
          if (r.gc_orcamento_id) dbOrcIds.add(r.gc_orcamento_id);
        }
        if (chunk.length < 1000) break;
      }

      let globalOrcUpdated = 0;
      for (const orcId of dbOrcIds) {
        const fresh = allGcOrcById[orcId];
        if (!fresh) continue;
        const { count } = await sbClient
          .from("tarefas_central")
          .update({
            gc_orc_situacao: fresh.gc_orc_situacao,
            gc_orc_situacao_id: fresh.gc_orc_situacao_id,
            gc_orc_cor_situacao: fresh.gc_orc_cor_situacao,
            gc_orc_valor_total: fresh.gc_orc_valor_total,
            gc_orc_vendedor: fresh.gc_orc_vendedor,
            gc_orc_cliente: fresh.gc_orc_cliente,
            atualizado_em: new Date().toISOString(),
          }, { count: "exact" })
          .eq("gc_orcamento_id", orcId)
          .neq("gc_orc_situacao", fresh.gc_orc_situacao);
        globalOrcUpdated += count || 0;
      }

      console.log(`[central-sync] Atualização global de status: ${globalOsUpdated} OS e ${globalOrcUpdated} orçamentos atualizados no banco`);
    }

    // Step 3: NOW fetch Auvo tasks (heavy, can take minutes)
    console.log(`[central-sync] Iniciando busca Auvo: ${startDate} → ${endDate}`);
    const auvoTasks = await fetchAuvoTasks(bearerToken, startDate, endDate);
    console.log(`[central-sync] Auvo: ${auvoTasks.length} tarefas`);

    if (auvoTasks.length === 0) {
      console.warn("[central-sync] Nenhuma tarefa retornada do Auvo; aplicando fallback apenas com dados do GC");
    }

    // Load existing task IDs to avoid overwriting rows not returned by current Auvo window
    const existingTaskIdsInDb = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: existingChunk, error: existingErr } = await sbClient
        .from("tarefas_central")
        .select("auvo_task_id")
        .range(from, from + 999);
      if (existingErr || !existingChunk || existingChunk.length === 0) break;
      for (const row of existingChunk) existingTaskIdsInDb.add(String((row as any).auvo_task_id));
      if (existingChunk.length < 1000) break;
    }

    // Enrich ALL completed tasks with direct Auvo task detail (list endpoint lacks displacement data)
    const taskSnapshotById = new Map<string, AuvoTaskSnapshot>();
    const candidateTaskIds: string[] = [];
    const seenCandidates = new Set<string>();

    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "").trim();
      if (!taskId || seenCandidates.has(taskId)) continue;
      // Fetch snapshot for ALL tasks to get accurate hora_fim (taskEndDate), address, displacement
      candidateTaskIds.push(taskId);
      seenCandidates.add(taskId);
    }

    if (candidateTaskIds.length > 0) {
      console.log(`[central-sync] Buscando detalhe via Auvo para ${candidateTaskIds.length} tarefas (paralelo 10)...`);
      const PARALLEL = 10;
      for (let i = 0; i < candidateTaskIds.length; i += PARALLEL) {
        const batch = candidateTaskIds.slice(i, i + PARALLEL);
        const results = await Promise.all(
          batch.map((id) => fetchAuvoTaskSnapshot(bearerToken, id))
        );
        batch.forEach((id, idx) => {
          if (results[idx]) taskSnapshotById.set(id, results[idx]!);
        });
      }
      console.log(`[central-sync] Snapshots obtidos: ${taskSnapshotById.size}/${candidateTaskIds.length}`);
    }

    // Secondary linkage: parse orientacao for OS/Orçamento/Tarefa references
    function secondaryLinkage(orientation: string, taskId: string): { os: any | null; orc: any | null } {
      let os: any = null;
      let orc: any = null;
      if (!orientation) return { os, orc };

      // Try "TAREFA OS: XXXXX" or "TAREFA OS XXXXX" → look up in gcOsMap by referenced taskId
      const tarefaOsMatch = orientation.match(/TAREFA\s+OS[:\s]+(\d{5,})/i);
      if (tarefaOsMatch) {
        const refTaskId = tarefaOsMatch[1];
        if (refTaskId !== taskId && gcOsMap[refTaskId]) {
          os = gcOsMap[refTaskId];
        }
      }

      // Try "OS N° XXXX" or "OS: XXXX" or "OS Nº XXXX" → look up by OS código
      if (!os) {
        const osNumMatch = orientation.match(/OS\s*(?:N[°º]|:)\s*(\d{3,})/i);
        if (osNumMatch && gcOsByCodigo[osNumMatch[1]]) {
          os = gcOsByCodigo[osNumMatch[1]];
        }
      }

      // Try "OR N° XXXX" or "Orçamento #XXXX" or "OR: XXXX" → look up by orçamento código
      if (!orc) {
        const orcMatch = orientation.match(/(?:OR|Or[çc]amento)\s*(?:N[°º]|#|:)\s*(\d{3,})/i);
        if (orcMatch) {
          const orcNum = orcMatch[1];
          if (gcOrcByCodigo[orcNum]) orc = gcOrcByCodigo[orcNum];
          // Also link to OS via "NÚMERO ORÇAMENTO" attribute (81831)
          if (!os && gcOsByOrcNumero[orcNum]) os = gcOsByOrcNumero[orcNum];
        }
      }

      // Also try "OS ref. Orçamento #XXXX" pattern
      if (!orc) {
        const orcRefMatch = orientation.match(/ref\.\s*Or[çc]amento\s*#?\s*(\d{3,})/i);
        if (orcRefMatch && gcOrcByCodigo[orcRefMatch[1]]) {
          orc = gcOrcByCodigo[orcRefMatch[1]];
        }
      }

      return { os, orc };
    }

    // Build rows for upsert
    let secondaryMatches = 0;
    const rows: any[] = [];
    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "");
      if (!taskId) continue;

      let gcOrc = gcOrcMap[taskId] || null;
      let gcOs = gcOsMap[taskId] || null;

      // Secondary linkage: if no direct match, parse orientacao for references
      if (!gcOs || !gcOrc) {
        const orientation = String(task.orientation || "");
        const snapshot = taskSnapshotById.get(taskId);
        const snapshotOrientation = String(snapshot?.orientation || "");
        const fullOrientation = snapshotOrientation || orientation;

        if (fullOrientation) {
          const secondary = secondaryLinkage(fullOrientation, taskId);
          if (!gcOs && secondary.os) {
            gcOs = secondary.os;
            secondaryMatches++;
          }
          if (!gcOrc && secondary.orc) {
            gcOrc = secondary.orc;
            if (!secondary.os) secondaryMatches++;
          }
        }
      }

      // Customer resolution chain
      const desc = String(task.customerDescription || "").trim();
      const nameRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || ""
      ).trim();
      const nameGc = gcOrc?.gc_orc_cliente || gcOs?.gc_os_cliente || "";
      const cliente = desc || nameRaw || nameGc || "Cliente não identificado";

      // Questionnaire
      const targetQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      const answers = (targetQ?.answers || []).map((a: any) => ({
        question: String(a.questionDescription || ""),
        reply: String(a.reply || ""),
      }));
      const hasFilledQ = answers.some(
        (r: any) => r.reply && r.reply.trim() !== "" && !r.reply.startsWith("http")
      );

      const baseAddress = resolveTaskAddress(task);
      const snapshot = taskSnapshotById.get(taskId);
      // Always prefer snapshot (detail endpoint) - it's more reliable than list
      const snapshotAddr = snapshot?.address && snapshot.address.length > 5 ? snapshot.address : "";
      const resolvedAddress = snapshotAddr || baseAddress;
      const resolvedOrientation = String(snapshot?.orientation || task.orientation || "").substring(0, 500);

      // Resolve checkout date for monthly accounting
      const checkOutDateRaw = normalizeDate(task.checkOutDate || task.checkoutDate || snapshot?.checkOutDate);
      // displacementStart: try list endpoint first, then snapshot
      const displacementStartRaw = String(task.displacementStart || task.displacement_start || snapshot?.displacementStart || "").trim();
      // checkInDate: try list endpoint first, then snapshot
      const checkInDateRaw = String(task.checkInDate || task.checkinDate || snapshot?.checkInDate || "").trim();

      // Calculate displacement duration (displacementStart → checkInDate) in decimal hours
      let duracaoDeslocamento: number | null = null;
      if (displacementStartRaw && checkInDateRaw) {
        const dStart = new Date(displacementStartRaw);
        const dEnd = new Date(checkInDateRaw);
        if (!isNaN(dStart.getTime()) && !isNaN(dEnd.getTime())) {
          const diffMs = dEnd.getTime() - dStart.getTime();
          if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) { // sanity: < 24h
            duracaoDeslocamento = Math.round((diffMs / 3600000) * 100) / 100;
          }
        }
      }

      const startTimeResolved =
        String(task.startTime || task.startHour || snapshot?.startTime || "").trim() ||
        extractTimeFromDateStr(String(task.taskDate || ""));

      let endTimeResolved =
        String(task.endTime || task.endHour || snapshot?.endTime || "").trim() ||
        extractTimeFromDateStr(String(task.taskEndDate || task.taskEndDateTime || snapshot?.taskEndDate || ""));

      const durationDecimalRaw = parseFloat(task.durationDecimal || "0") || 0;
      const estimatedDurationHours = parseDurationToHours(task.estimatedDuration || snapshot?.estimatedDuration || "");
      const durationDecimalResolved = durationDecimalRaw > 0 ? durationDecimalRaw : estimatedDurationHours;

      if (!endTimeResolved && startTimeResolved && durationDecimalResolved > 0) {
        const startMinutes = parseClockToMinutes(startTimeResolved);
        if (startMinutes >= 0) {
          const endMinutes = startMinutes + Math.round(durationDecimalResolved * 60);
          endTimeResolved = minutesToClock(endMinutes);
        }
      }

      const row: any = {
        auvo_task_id: taskId,
        cliente,
        tecnico: String(task.userToName || ""),
        tecnico_id: String(task.idUserTo || ""),
        data_tarefa: normalizeDate(task.taskDate) || gcOs?.gc_os_data || null,
        data_conclusao: checkOutDateRaw || null,
        deslocamento_inicio: displacementStartRaw || null,
        duracao_deslocamento: duracaoDeslocamento,
        status_auvo: (() => {
          // Auvo taskStatus codes: 1=Opened, 2=InDisplacement, 3=CheckedIn, 4=CheckedOut, 5=Finished, 6=Paused
          const statusCode = typeof task.taskStatus === "number" ? task.taskStatus
            : typeof task.taskStatus?.id === "number" ? task.taskStatus.id
            : typeof task.taskStatus === "object" ? Number(task.taskStatus?.id || task.taskStatus?.status || 0) : 0;

          if (statusCode === 6) return "Pausada";
          if (statusCode === 4 || statusCode === 5) return "Finalizada";
          if (statusCode === 3) return "Em andamento";
          if (statusCode === 2) return "Em deslocamento";
          if (statusCode === 1) return "Aberta";

          // Fallback: derive from event fields if statusCode is missing/0
          const hasCheckOut = !!task.checkOut;
          if (hasCheckOut) return "Finalizada";
          const timeControls = task.timeControl || [];
          const hasPauseOpen = timeControls.some((tc: any) => tc.pauseStart && !tc.pauseEnd);
          if (hasPauseOpen || task.reasonForPause) return "Pausada";
          if (task.checkIn) return "Em andamento";
          return "Aberta";
        })(),
        orientacao: resolvedOrientation,
        pendencia: String(task.pendency ?? "").trim(),
        descricao: resolveTaskType(task),
        duracao_decimal: durationDecimalResolved,
        hora_inicio: startTimeResolved,
        hora_fim: endTimeResolved,
        check_in: !!task.checkIn,
        check_out: !!task.checkOut,
        endereco: resolvedAddress,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: String(task.taskUrl || ""),
        auvo_survey_url: String(task.survey || ""),
        questionario_id: targetQ ? String(targetQ.questionnaireId) : null,
        questionario_respostas: answers,
        questionario_preenchido: hasFilledQ,
        orcamento_realizado: !!gcOrc,
        os_realizada: !!gcOs,
        atualizado_em: new Date().toISOString(),
        // Equipment from snapshot (will be merged with existing DB values below)
        equipamento_nome: snapshot?.equipmentName || null,
        equipamento_id_serie: snapshot?.equipmentSerial || null,
      };

      // GC Orçamento fields
      if (gcOrc) {
        row.gc_orcamento_id = gcOrc.gc_orcamento_id;
        row.gc_orcamento_codigo = gcOrc.gc_orcamento_codigo;
        row.gc_orc_cliente = gcOrc.gc_orc_cliente;
        row.gc_orc_situacao = gcOrc.gc_orc_situacao;
        row.gc_orc_situacao_id = gcOrc.gc_orc_situacao_id;
        row.gc_orc_cor_situacao = gcOrc.gc_orc_cor_situacao;
        row.gc_orc_valor_total = gcOrc.gc_orc_valor_total;
        row.gc_orc_vendedor = gcOrc.gc_orc_vendedor;
        row.gc_orc_data = gcOrc.gc_orc_data;
        row.gc_orc_link = gcOrc.gc_orc_link;
      }

      // GC OS fields
      if (gcOs) {
        row.gc_os_id = gcOs.gc_os_id;
        row.gc_os_codigo = gcOs.gc_os_codigo;
        row.gc_os_cliente = gcOs.gc_os_cliente;
        row.gc_os_situacao = gcOs.gc_os_situacao;
        row.gc_os_situacao_id = gcOs.gc_os_situacao_id;
        row.gc_os_cor_situacao = gcOs.gc_os_cor_situacao;
        row.gc_os_valor_total = gcOs.gc_os_valor_total;
        row.gc_os_vendedor = gcOs.gc_os_vendedor;
        row.gc_os_data = gcOs.gc_os_data;
        row.gc_os_data_saida = gcOs.gc_os_data_saida;
        row.gc_os_link = gcOs.gc_os_link;
        row.gc_os_tarefa_exec = gcOs.gc_os_tarefa_exec || null;
      }

      rows.push(row);
    }

    if (secondaryMatches > 0) {
      console.log(`[central-sync] Vínculo secundário (orientação): ${secondaryMatches} tarefas vinculadas a OS/Orçamento`);
    }

    // Fallback: include ALL GC OS tasks not returned by current Auvo window
    // This ensures all OS from GC are represented in the database regardless of Auvo date range
    const existingTaskOsKeys = new Set(rows.map((r) => `${String(r.auvo_task_id)}::${String(r.gc_os_id || "")}`));
    for (const [taskId, osList] of Object.entries(gcOsByTaskIdAll)) {
      for (const gcOs of osList as any[]) {
      if (existingTaskOsKeys.has(`${taskId}::${String(gcOs?.gc_os_id || "")}`)) continue;

      const gcOrc = gcOrcMap[taskId] || null;
      let fallbackSnapshot = taskSnapshotById.get(taskId) || null;
      if (!fallbackSnapshot) {
        fallbackSnapshot = await fetchAuvoTaskSnapshot(bearerToken, taskId);
        if (fallbackSnapshot) taskSnapshotById.set(taskId, fallbackSnapshot);
      }

      // Skip tasks that don't exist in Auvo (deleted/ghost tasks)
      if (!fallbackSnapshot) {
        console.log(`[central-sync] Ignorando taskId ${taskId} (OS ${gcOs?.gc_os_codigo}): tarefa não encontrada no Auvo (possível fantasma)`);
        continue;
      }

      const fallbackRow: any = {
        auvo_task_id: taskId,
        cliente: gcOs?.gc_os_cliente || gcOrc?.gc_orc_cliente || "Cliente não identificado",
        tecnico: "",
        tecnico_id: "",
        data_tarefa: gcOs?.gc_os_data || null,
        status_auvo: "Sem tarefa Auvo",
        orientacao: fallbackSnapshot?.orientation || "",
        pendencia: "",
        descricao: "",
        duracao_decimal: 0,
        hora_inicio: "",
        hora_fim: "",
        check_in: false,
        check_out: false,
        endereco: fallbackSnapshot?.address || "",
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`, 
        auvo_task_url: "",
        auvo_survey_url: "",
        questionario_id: null,
        questionario_respostas: [],
        questionario_preenchido: false,
        orcamento_realizado: !!gcOrc,
        os_realizada: true,
        atualizado_em: new Date().toISOString(),
        gc_os_id: gcOs.gc_os_id,
        gc_os_codigo: gcOs.gc_os_codigo,
        gc_os_cliente: gcOs.gc_os_cliente,
        gc_os_situacao: gcOs.gc_os_situacao,
        gc_os_situacao_id: gcOs.gc_os_situacao_id,
        gc_os_cor_situacao: gcOs.gc_os_cor_situacao,
        gc_os_valor_total: gcOs.gc_os_valor_total,
        gc_os_vendedor: gcOs.gc_os_vendedor,
        gc_os_data: gcOs.gc_os_data,
        gc_os_data_saida: gcOs.gc_os_data_saida,
        gc_os_link: gcOs.gc_os_link,
        gc_os_tarefa_exec: gcOs.gc_os_tarefa_exec || null,
      };

      if (gcOrc) {
        fallbackRow.gc_orcamento_id = gcOrc.gc_orcamento_id;
        fallbackRow.gc_orcamento_codigo = gcOrc.gc_orcamento_codigo;
        fallbackRow.gc_orc_cliente = gcOrc.gc_orc_cliente;
        fallbackRow.gc_orc_situacao = gcOrc.gc_orc_situacao;
        fallbackRow.gc_orc_situacao_id = gcOrc.gc_orc_situacao_id;
        fallbackRow.gc_orc_cor_situacao = gcOrc.gc_orc_cor_situacao;
        fallbackRow.gc_orc_valor_total = gcOrc.gc_orc_valor_total;
        fallbackRow.gc_orc_vendedor = gcOrc.gc_orc_vendedor;
        fallbackRow.gc_orc_data = gcOrc.gc_orc_data;
        fallbackRow.gc_orc_link = gcOrc.gc_orc_link;
      }

      rows.push(fallbackRow);
      existingTaskOsKeys.add(`${taskId}::${String(gcOs?.gc_os_id || "")}`);
      }
    }

    // Patch existing OS rows in period that still have empty address/orientation
    const { data: rowsMissingAddress } = await sbClient
      .from("tarefas_central")
      .select("auvo_task_id")
      .not("gc_os_id", "is", null)
      .gte("data_tarefa", startDate)
      .lte("data_tarefa", endDate)
      .or("endereco.is.null,endereco.eq.");

    if (rowsMissingAddress?.length) {
      const patchIds = rowsMissingAddress
        .map((r) => String((r as any).auvo_task_id || "").trim())
        .filter((id) => id && !existingTaskIds.has(id));

      console.log(`[central-sync] Patch endereço para ${patchIds.length} OS existentes sem endereço...`);
      const PARALLEL = 5;
      for (let i = 0; i < patchIds.length; i += PARALLEL) {
        const batch = patchIds.slice(i, i + PARALLEL);
        const results = await Promise.all(
          batch.map((id) => {
            const cached = taskSnapshotById.get(id);
            return cached ? Promise.resolve(cached) : fetchAuvoTaskSnapshot(bearerToken, id);
          })
        );
        batch.forEach((id, idx) => {
          const snapshot = results[idx];
          if (!snapshot || (!snapshot.address && !snapshot.orientation)) return;
          taskSnapshotById.set(id, snapshot);
          rows.push({
            auvo_task_id: id,
            endereco: snapshot.address || "",
            orientacao: snapshot.orientation || "",
            atualizado_em: new Date().toISOString(),
          });
        });
      }
    }

    // Preserve existing values from DB to avoid losing GC/equipment data in partial syncs
    const rowTaskIds = rows.map((r) => String(r.auvo_task_id)).filter(Boolean);
    type ExistingTaskData = {
      equipamento_nome: string | null;
      equipamento_id_serie: string | null;
      gc_os_id: string | null;
      gc_os_codigo: string | null;
      gc_os_cliente: string | null;
      gc_os_situacao: string | null;
      gc_os_situacao_id: string | null;
      gc_os_cor_situacao: string | null;
      gc_os_valor_total: number | null;
      gc_os_vendedor: string | null;
      gc_os_data: string | null;
      gc_os_data_saida: string | null;
      gc_os_link: string | null;
      gc_orcamento_id: string | null;
      gc_orcamento_codigo: string | null;
      gc_orc_cliente: string | null;
      gc_orc_situacao: string | null;
      gc_orc_situacao_id: string | null;
      gc_orc_cor_situacao: string | null;
      gc_orc_valor_total: number | null;
      gc_orc_vendedor: string | null;
      gc_orc_data: string | null;
      gc_orc_link: string | null;
      os_realizada: boolean | null;
      orcamento_realizado: boolean | null;
    };

    const existingTaskMap: Record<string, ExistingTaskData> = {};
    for (let i = 0; i < rowTaskIds.length; i += 200) {
      const batch = rowTaskIds.slice(i, i + 200);
      const { data: dbRows } = await sbClient
        .from("tarefas_central")
        .select("auvo_task_id, equipamento_nome, equipamento_id_serie, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_valor_total, gc_os_vendedor, gc_os_data, gc_os_data_saida, gc_os_link, gc_orcamento_id, gc_orcamento_codigo, gc_orc_cliente, gc_orc_situacao, gc_orc_situacao_id, gc_orc_cor_situacao, gc_orc_valor_total, gc_orc_vendedor, gc_orc_data, gc_orc_link, os_realizada, orcamento_realizado")
        .in("auvo_task_id", batch);

      for (const r of dbRows || []) {
        existingTaskMap[r.auvo_task_id] = {
          equipamento_nome: r.equipamento_nome || null,
          equipamento_id_serie: r.equipamento_id_serie || null,
          gc_os_id: r.gc_os_id || null,
          gc_os_codigo: r.gc_os_codigo || null,
          gc_os_cliente: r.gc_os_cliente || null,
          gc_os_situacao: r.gc_os_situacao || null,
          gc_os_situacao_id: r.gc_os_situacao_id || null,
          gc_os_cor_situacao: r.gc_os_cor_situacao || null,
          gc_os_valor_total: r.gc_os_valor_total ?? null,
          gc_os_vendedor: r.gc_os_vendedor || null,
          gc_os_data: r.gc_os_data || null,
          gc_os_data_saida: r.gc_os_data_saida || null,
          gc_os_link: r.gc_os_link || null,
          gc_orcamento_id: r.gc_orcamento_id || null,
          gc_orcamento_codigo: r.gc_orcamento_codigo || null,
          gc_orc_cliente: r.gc_orc_cliente || null,
          gc_orc_situacao: r.gc_orc_situacao || null,
          gc_orc_situacao_id: r.gc_orc_situacao_id || null,
          gc_orc_cor_situacao: r.gc_orc_cor_situacao || null,
          gc_orc_valor_total: r.gc_orc_valor_total ?? null,
          gc_orc_vendedor: r.gc_orc_vendedor || null,
          gc_orc_data: r.gc_orc_data || null,
          gc_orc_link: r.gc_orc_link || null,
          os_realizada: r.os_realizada ?? null,
          orcamento_realizado: r.orcamento_realizado ?? null,
        };
      }
    }

    for (const row of rows) {
      const existing = existingTaskMap[row.auvo_task_id];
      if (!existing) continue;

      // Equipment
      if (!row.equipamento_nome && existing.equipamento_nome) row.equipamento_nome = existing.equipamento_nome;
      if (!row.equipamento_id_serie && existing.equipamento_id_serie) row.equipamento_id_serie = existing.equipamento_id_serie;

      // Preserve GC OS when current sync didn't find a match for the task
      if (!row.gc_os_id && existing.gc_os_id) {
        row.gc_os_id = existing.gc_os_id;
        row.gc_os_codigo = existing.gc_os_codigo;
        row.gc_os_cliente = existing.gc_os_cliente;
        row.gc_os_situacao = existing.gc_os_situacao;
        row.gc_os_situacao_id = existing.gc_os_situacao_id;
        row.gc_os_cor_situacao = existing.gc_os_cor_situacao;
        row.gc_os_valor_total = existing.gc_os_valor_total;
        row.gc_os_vendedor = existing.gc_os_vendedor;
        row.gc_os_data = existing.gc_os_data;
        row.gc_os_data_saida = existing.gc_os_data_saida;
        row.gc_os_link = existing.gc_os_link;
        row.os_realizada = existing.os_realizada ?? true;
      } else if (row.gc_os_id && (row.gc_os_valor_total === null || row.gc_os_valor_total === undefined) && existing.gc_os_valor_total !== null) {
        row.gc_os_valor_total = existing.gc_os_valor_total;
      }

      // Preserve GC orçamento when current sync didn't find a match
      if (!row.gc_orcamento_id && existing.gc_orcamento_id) {
        row.gc_orcamento_id = existing.gc_orcamento_id;
        row.gc_orcamento_codigo = existing.gc_orcamento_codigo;
        row.gc_orc_cliente = existing.gc_orc_cliente;
        row.gc_orc_situacao = existing.gc_orc_situacao;
        row.gc_orc_situacao_id = existing.gc_orc_situacao_id;
        row.gc_orc_cor_situacao = existing.gc_orc_cor_situacao;
        row.gc_orc_valor_total = existing.gc_orc_valor_total;
        row.gc_orc_vendedor = existing.gc_orc_vendedor;
        row.gc_orc_data = existing.gc_orc_data;
        row.gc_orc_link = existing.gc_orc_link;
        row.orcamento_realizado = existing.orcamento_realizado ?? true;
      } else if (row.gc_orcamento_id && (row.gc_orc_valor_total === null || row.gc_orc_valor_total === undefined) && existing.gc_orc_valor_total !== null) {
        row.gc_orc_valor_total = existing.gc_orc_valor_total;
      }
    }

    // Upsert in batches of 100
    for (const row of rows) {
      row.mirror_key = `${String(row.auvo_task_id)}::os:${String(row.gc_os_id || "")}::orc:${String(row.gc_orcamento_id || "")}`;
    }

    let upserted = 0;
    let errors = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sbClient
        .from("tarefas_central")
        .upsert(batch, { onConflict: "mirror_key", ignoreDuplicates: false, defaultToNull: false });
      
      if (error) {
        console.error(`[central-sync] Batch ${i}-${i + batch.length} error:`, error.message);
        errors++;
      } else {
        upserted += batch.length;
      }
    }

    // ── Persist native equipment-task relationships ──
    const equipTaskRelRows: any[] = [];
    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "");
      if (!taskId) continue;

      // Get equipmentsId from list endpoint and/or snapshot
      const listEquipIds: number[] = Array.isArray(task.equipmentsId) ? task.equipmentsId :
        Array.isArray(task.equipmentsID) ? task.equipmentsID : [];
      const snapshot = taskSnapshotById.get(taskId);
      const snapshotEquipIds = snapshot?.equipmentIds || [];

      // Merge both sources, deduplicate
      const allEquipIds = new Set<string>();
      for (const id of listEquipIds) allEquipIds.add(String(id));
      for (const id of snapshotEquipIds) allEquipIds.add(id);

      if (allEquipIds.size === 0) continue;

      const checkOutDateRaw = normalizeDate(task.checkOutDate || task.checkoutDate || snapshot?.checkOutDate);
      const statusCode = typeof task.taskStatus === "number" ? task.taskStatus
        : typeof task.taskStatus?.id === "number" ? task.taskStatus.id : 0;
      let statusAuvo = "Aberta";
      if (statusCode === 6) statusAuvo = "Pausada";
      else if (statusCode === 4 || statusCode === 5 || !!task.checkOut) statusAuvo = "Finalizada";
      else if (statusCode === 3) statusAuvo = "Em andamento";
      else if (statusCode === 2) statusAuvo = "Em deslocamento";
      else if (statusCode === 1) statusAuvo = "Aberta";

      const cliente = String(task.customerDescription || task.customerName || task.customer?.tradeName || "").trim();
      const tecnico = String(task.userToName || "").trim();
      const taskTypeId = String(task.taskType || "");
      const taskTypeDesc = String(task.taskTypeDescription || "");

      for (const eqId of allEquipIds) {
        equipTaskRelRows.push({
          auvo_equipment_id: eqId,
          auvo_task_id: taskId,
          auvo_task_type_id: taskTypeId || null,
          auvo_task_type_description: taskTypeDesc || null,
          status_auvo: statusAuvo,
          data_tarefa: normalizeDate(task.taskDate) || null,
          data_conclusao: checkOutDateRaw || null,
          cliente: cliente || null,
          tecnico: tecnico || null,
          auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
          source: "native_equipment_relation",
          synced_at: new Date().toISOString(),
        });
      }
    }

    if (equipTaskRelRows.length > 0) {
      console.log(`[central-sync] Upserting ${equipTaskRelRows.length} equipment-task relationships...`);
      let relUpserted = 0;
      for (let i = 0; i < equipTaskRelRows.length; i += 200) {
        const batch = equipTaskRelRows.slice(i, i + 200);
        const { error } = await sbClient
          .from("equipamento_tarefas_auvo")
          .upsert(batch, { onConflict: "auvo_equipment_id,auvo_task_id" });
        if (error) {
          console.error(`[central-sync] Equip-task rel batch error:`, error.message);
        } else {
          relUpserted += batch.length;
        }
      }
      console.log(`[central-sync] Equipment-task relationships upserted: ${relUpserted}`);
    }


    // ── Post-sync: persist atrasos AND pendências permanently ──
    // 1) Tasks past due and NOT finalized (still open)
    // 2) Tasks finalized AFTER scheduled date (were late but got done)
    // 3) Tasks with pendência (regardless of status)
    // All are persisted permanently via ON CONFLICT DO NOTHING so records are never lost
    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.substring(0, 8) + "01";
    try {
      // Fetch ALL tasks from this month that are past due (any status) or have pendência
      const { data: monthTasks } = await sbClient
        .from("tarefas_central")
        .select("auvo_task_id, tecnico_id, tecnico, cliente, orientacao, data_tarefa, data_conclusao, status_auvo, pendencia")
        .gte("data_tarefa", monthStart)
        .lte("data_tarefa", today);

      if (monthTasks && monthTasks.length > 0) {
        const naoExec: any[] = [];

        for (const t of monthTasks) {
          const isPastDue = t.data_tarefa < today;
          const isNotFinalized = !["Finalizada", "Cancelada"].includes(t.status_auvo || "");
          const isLateFinish = t.status_auvo === "Finalizada" && t.data_conclusao && t.data_conclusao > t.data_tarefa;
          const hasPendencia = !!(t.pendencia && String(t.pendencia).trim().length > 0);

          // Determine status_original label
          let statusOriginal = "";
          if (isPastDue && isNotFinalized) {
            statusOriginal = t.status_auvo || "Não finalizada";
          } else if (isLateFinish) {
            statusOriginal = "Finalizada com atraso";
          } else if (hasPendencia && isPastDue) {
            statusOriginal = "Com pendência";
          }

          // Build motivo
          let motivo = "";
          if (hasPendencia) {
            motivo = `Pendência: ${String(t.pendencia).trim().substring(0, 200)}`;
          }

          if (statusOriginal) {
            naoExec.push({
              auvo_task_id: t.auvo_task_id,
              tecnico_id: t.tecnico_id || "",
              tecnico_nome: t.tecnico || "",
              cliente: t.cliente || null,
              descricao: t.orientacao || null,
              data_planejada: t.data_tarefa,
              status_original: statusOriginal,
              motivo: motivo || null,
            });
          }
        }

        if (naoExec.length > 0) {
          const { error: naoExecErr } = await sbClient
            .from("atividades_nao_executadas")
            .upsert(naoExec, { onConflict: "auvo_task_id,data_planejada" });

          if (naoExecErr) console.error("[central-sync] Erro ao salvar não executadas:", naoExecErr);
          else console.log(`[central-sync] ${naoExec.length} atividades (atrasos/pendências) salvas permanentemente`);
        }
      }
    } catch (naoExecError) {
      console.warn("[central-sync] Erro ao detectar atividades não executadas:", naoExecError);
    }

    // Clean up tasks older than 6 months
    const { count: deleted } = await sbClient
      .from("tarefas_central")
      .delete({ count: "exact" })
      .lt("data_tarefa", cleanupCutoff);

    console.log(`[central-sync] Concluído: ${upserted} upserted, ${errors} erros, ${deleted || 0} removidos (> 6 meses)`);

    const auvoFailed = auvoTasks.length === 0;
    return {
      success: true,
      auvo_error: auvoFailed ? "API do Auvo retornou erro (502/503). Tarefas não foram atualizadas. Tente novamente em alguns minutos." : null,
      periodo: { inicio: startDate, fim: endDate },
      auvo_tarefas: auvoTasks.length,
      gc_orcamentos: Object.keys(gcOrcMap).length,
      gc_os: Object.keys(gcOsMap).length,
      upserted,
      errors,
      deleted: deleted || 0,
    };

}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.wait === true) {
      const result = await runCentralSync(body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    setTimeout(() => {
      runCentralSync(body).catch((err) => {
        console.error("[central-sync] Background error:", err);
      });
    }, 0);

    return new Response(JSON.stringify({
      success: true,
      background: true,
      message: "Sincronização iniciada em background",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[central-sync] Error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
