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
const AUVO_TASK_CHUNK_DAYS = 1;
let lastAuvoCall = 0;
let lastGcCall = 0;

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

function buildGcOsPublicLink(os: any): string | null {
  const hash = String(os?.hash || "").trim();
  return hash ? `https://gestaoclick.com/cobranca/${hash}` : null;
}

function buildGcOrcPublicLink(orc: any): string | null {
  const hash = String(orc?.hash || "").trim();
  return hash ? `https://gestaoclick.com/prop/${hash}` : null;
}

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

function normalizeDateTime(dateLike: unknown): string | null {
  const raw = String(dateLike || "").trim();
  if (!raw || raw.startsWith("0001-01-01")) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getGcAttrValue(atributos: any[], attrId: string): string {
  const found = atributos.find((a: any) => {
    const nested = a?.atributo || a;
    return String(nested.atributo_id || nested.id || "") === attrId;
  });
  const nested = found?.atributo || found;
  return String(nested?.conteudo || nested?.valor || "").trim();
}

function isValidAuvoTaskId(value: string): boolean {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) && !/^0+$/.test(id);
}

function collectGcAttrTaskIds(atributos: any[], attrId: string): string[] {
  const ids: string[] = [];
  for (const attr of atributos || []) {
    const nested = attr?.atributo || attr;
    if (String(nested?.atributo_id || nested?.id || "") !== attrId) continue;
    const raw = String(nested?.conteudo || nested?.valor || "").trim();
    for (const piece of raw.split(/[\/,;\s]+/)) {
      const id = piece.trim();
      if (isValidAuvoTaskId(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function normalizeTaskIdList(value: unknown): string {
  return String(value || "")
    .split(/[\/,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => isValidAuvoTaskId(part))
    .join("/");
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

function calculateDisplacementHours(displacementStart: unknown, checkIn: unknown): number {
  const start = String(displacementStart || "").trim();
  const end = String(checkIn || "").trim();
  if (!start || !end) return 0;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  const diffMs = endMs - startMs;
  if (diffMs <= 0 || diffMs >= 24 * 60 * 60 * 1000) return 0;
  return Math.round((diffMs / 3600000) * 10000) / 10000;
}

function subtractDisplacement(hours: number, displacementHours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (!Number.isFinite(displacementHours) || displacementHours <= 0) return Math.round(hours * 10000) / 10000;
  return Math.round(Math.max(0, hours - displacementHours) * 10000) / 10000;
}

// Calcula horas EFETIVAMENTE trabalhadas (sem pausas e sem deslocamento),
// replicando o que o Auvo mostra em "Tempo total de trabalho na tarefa".
// Prioridade:
//   1) task.duration "HH:MM:SS" — campo oficial do Auvo, JÁ desconta pausas
//   2) (checkOut − checkIn) − Σ pausas (timeControl)
//   3) task.durationDecimal (último recurso — pode incluir pausas em alguns retornos)
function computeAuvoWorkedHours(task: any): number {
  // Fonte 1: duration HH:MM:SS
  const durStr = String(task?.duration || task?.Duration || "").trim();
  const m = durStr.match(/^-?(\d+):-?(\d{1,2})(?::-?(\d{1,2}))?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    const s = m[3] ? parseInt(m[3], 10) : 0;
    const total = h + mi / 60 + s / 3600;
    if (total > 0) return Math.round(total * 10000) / 10000;
  }
  // Fonte 2: checkIn/checkOut menos pausas
  const checkIn = task?.checkInDate || task?.CheckInDate || task?.checkinDate || null;
  const checkOut = task?.checkOutDate || task?.CheckOutDate || task?.checkoutDate || null;
  if (checkIn && checkOut) {
    const inMs = new Date(checkIn).getTime();
    const outMs = new Date(checkOut).getTime();
    if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs) {
      const tc: any[] = Array.isArray(task?.timeControl) ? task.timeControl : [];
      let pauseSec = 0;
      for (const ev of tc) {
        const ps = ev?.pauseStart || ev?.startPause || ev?.start;
        const pe = ev?.pauseEnd || ev?.endPause || ev?.end || ev?.resumeDate;
        if (ps && pe) {
          const diff = new Date(pe).getTime() - new Date(ps).getTime();
          if (Number.isFinite(diff) && diff > 0) pauseSec += Math.floor(diff / 1000);
        }
      }
      const totalSec = Math.max(0, Math.floor((outMs - inMs) / 1000) - pauseSec);
      return Math.round((totalSec / 3600) * 10000) / 10000;
    }
  }
  // Fonte 3: durationDecimal (fallback)
  const dec = parseFloat(String(task?.durationDecimal || "0").replace(",", "."));
  return Number.isFinite(dec) && dec !== 0 ? Math.round(Math.abs(dec) * 10000) / 10000 : 0;
}

function taskRowQuality(row: any): number {
  const status = String(row?.status_auvo || "").toLowerCase();
  const hours = Number(row?.duracao_decimal) || 0;
  let score = 0;
  if (hours > 0) score += 1000;
  if (row?.check_in || row?.check_out) score += 250;
  if (row?.check_in_iso) score += 120;
  if (row?.check_out_iso) score += 120;
  if (String(row?.tecnico || "").trim()) score += 80;
  if (String(row?.data_conclusao || "").trim()) score += 40;
  if (status.includes("pendente vínculo") || status.includes("sem tarefa auvo")) score -= 500;
  return score;
}

function chooseBestExistingMirror(current: any | undefined, candidate: any): string | null {
  if (!candidate?.mirror_key) return current?.mirror_key || null;
  if (!current?.mirror_key) return candidate.mirror_key;
  const candScore = taskRowQuality(candidate);
  const curScore = taskRowQuality(current);
  if (candScore !== curScore) return candScore > curScore ? candidate.mirror_key : current.mirror_key;
  return String(candidate?.atualizado_em || "") > String(current?.atualizado_em || "") ? candidate.mirror_key : current.mirror_key;
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

function resolveAuvoTechnicianName(task: any): string {
  const userTo = task?.userTo || task?.user_to || task?.assignedUser || {};
  return String(task?.userToName || userTo?.name || userTo?.login || task?.technician || "").trim();
}

function resolveAuvoTechnicianId(task: any): string {
  const userTo = task?.userTo || task?.user_to || task?.assignedUser || {};
  return String(task?.idUserTo || task?.id_user_to || userTo?.userID || userTo?.id || "").trim();
}

type AuvoTaskSnapshot = {
  address: string;
  orientation: string;
  technicianName: string;
  technicianId: string;
  taskDate: string;
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
  questionnaires: any[];
  duration: string;
  durationDecimal: unknown;
  timeControl: any[];
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
  const technicianName = resolveAuvoTechnicianName(result);
  const technicianId = resolveAuvoTechnicianId(result);
  const taskDate = String(result?.taskDate || result?.task_date || result?.date || "").trim();
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
  const duration = String(result?.duration || result?.Duration || "").trim();
  const durationDecimal = result?.durationDecimal ?? result?.DurationDecimal ?? null;
  const timeControl = Array.isArray(result?.timeControl) ? result.timeControl : [];

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

  const questionnaires = Array.isArray(result?.questionnaires) ? result.questionnaires : [];
  return { address, orientation, technicianName, technicianId, taskDate, displacementStart, checkInDate, checkOutDate, taskEndDate, startTime, endTime, estimatedDuration, equipmentName, equipmentSerial, equipmentIds: equipIds, questionnaires, duration, durationDecimal, timeControl };
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

  if (page > MAX_PAGES) {
    console.warn(`[central-sync] TRUNCAMENTO: MAX_PAGES atingido em Auvo /tasks (${startDate}→${endDate})`);
  }

  return allTasks;
}

// Fetch ALL Auvo tasks in short date windows. The Auvo /tasks endpoint becomes
// very slow on full-month ranges and can hit the 150s function idle timeout;
// short windows keep each request bounded while still collecting every task.
async function fetchAuvoTasks(bearerToken: string, startDate: string, endDate: string): Promise<any[]> {
  const allTasks: any[] = [];
  const seenTaskIds = new Set<string>();
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start);
  while (current <= end) {
    const chunkStart = current.toISOString().split("T")[0];
    const chunkEndDate = new Date(current);
    chunkEndDate.setDate(chunkEndDate.getDate() + AUVO_TASK_CHUNK_DAYS - 1);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    const chunkEnd = chunkEndDate.toISOString().split("T")[0];

    console.log(`[central-sync] Buscando Auvo: ${chunkStart} → ${chunkEnd}`);
    const tasks = await fetchAuvoTasksForPeriod(bearerToken, chunkStart, chunkEnd);
    for (const task of tasks) {
      const taskId = String(task?.taskID || "").trim();
      if (taskId && seenTaskIds.has(taskId)) continue;
      if (taskId) seenTaskIds.add(taskId);
      allTasks.push(task);
    }
    console.log(`[central-sync] Janela ${chunkStart}: ${tasks.length} tarefas (${allTasks.length} únicas acumuladas)`);

    current.setTime(chunkEndDate.getTime());
    current.setDate(current.getDate() + 1);
  }

  return allTasks;
}

// Fetch ALL GC orçamentos (no date filter)
// Returns { byTaskId, byCodigo } for secondary linkage
function buildGcOrcPayload(orc: any) {
  return {
    gc_orcamento_id: String(orc.id),
    gc_orcamento_codigo: String(orc.codigo || ""),
    gc_orc_cliente: String(orc.nome_cliente || ""),
    gc_orc_situacao: String(orc.nome_situacao || ""),
    gc_orc_situacao_id: String(orc.situacao_id || ""),
    gc_orc_cor_situacao: String(orc.cor_situacao || ""),
    gc_orc_valor_total: parseFloat(orc.valor_total || "0"),
    gc_orc_valor_produtos: parseFloat(orc.valor_produtos || "0"),
    gc_orc_valor_servicos: parseFloat(orc.valor_servicos || "0"),
    gc_orc_vendedor: String(orc.nome_vendedor || ""),
    gc_orc_data: String(orc.data || "").split("T")[0] || null,
    gc_orc_link: buildGcOrcPublicLink(orc),
  };
}

async function fetchGcOrcamentos(gcHeaders: Record<string, string>): Promise<{ byTaskId: Record<string, any>; byCodigo: Record<string, any>; pagesFetched: number; totalPages: number }> {
  const map: Record<string, any> = {};
  const byCodigo: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 500;
  let pagesFetched = 0;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    let response: Response | null = null;
    const RATE_BACKOFF = [3000, 6000, 12000];
    for (let attempt = 0; attempt < RATE_BACKOFF.length; attempt++) {
      response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (response.status !== 429) break;
      console.warn(`[central-sync] GC orcamentos page ${page} 429, retry ${attempt + 1}/${RATE_BACKOFF.length} em ${RATE_BACKOFF[attempt]}ms`);
      await new Promise(r => setTimeout(r, RATE_BACKOFF[attempt]));
    }
    if (!response || response.status === 429) {
      console.error(`[central-sync] GC orcamentos page ${page}: 429 persistente após retries — retornando mapa parcial`);
      break;
    }
    if (!response.ok) break;

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const orc of records) {
      const atributos: any[] = orc.atributos || [];
      const orcPayload = buildGcOrcPayload(orc);

      // Reverse map by orçamento código
      const codigo = String(orc.codigo || "").trim();
      if (codigo) byCodigo[codigo] = orcPayload;

      for (const taskId of collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_ORC)) {
        map[taskId] = orcPayload;
      }
    }

    pagesFetched++;
    console.log(`[central-sync] GC orçamentos page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[central-sync] TRUNCAMENTO: MAX_PAGES atingido em GC orcamentos (totalPages=${totalPages})`);
  }
  return { byTaskId: map, byCodigo, pagesFetched, totalPages };
}

async function hydrateMissingOrcamentosByCodigo(gcHeaders: Record<string, string>, gcOrcResult: { byTaskId: Record<string, any>; byCodigo: Record<string, any> }, codigos: string[]) {
  const unique = [...new Set(codigos.map((c) => String(c || "").trim()).filter((c) => /^\d+$/.test(c) && !gcOrcResult.byCodigo[c]))];
  if (unique.length === 0) return 0;
  let hydrated = 0;
  const PARALLEL = 8;
  for (let i = 0; i < unique.length; i += PARALLEL) {
    const batch = unique.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(async (codigo) => {
      const url = `${GC_BASE_URL}/api/orcamentos?codigo=${encodeURIComponent(codigo)}&limite=5`;
      const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      const records: any[] = Array.isArray(data?.data) ? data.data : [];
      return records.find((orc) => String(orc?.codigo || "").trim() === codigo) || null;
    }));
    for (const orc of results) {
      if (!orc?.id) continue;
      const payload = buildGcOrcPayload(orc);
      const codigo = String(orc.codigo || "").trim();
      if (codigo) gcOrcResult.byCodigo[codigo] = payload;
      for (const taskId of collectGcAttrTaskIds(orc.atributos || [], GC_ATRIBUTO_TAREFA_ORC)) {
        gcOrcResult.byTaskId[taskId] = payload;
      }
      hydrated++;
    }
  }
  console.log(`[central-sync] Orçamentos hidratados por código via OS/81831: ${hydrated}/${unique.length}`);
  return hydrated;
}

// Hidrata OS GC pelo código (quando referenciada na orientação Auvo mas fora da janela de listagem)
async function hydrateMissingOsByCodigo(
  gcHeaders: Record<string, string>,
  gcOsResult: {
    byTaskId: Record<string, any>;
    byTaskIdAll: Record<string, any[]>;
    byExecTaskId: Record<string, any[]>;
    byCodigo: Record<string, any>;
    byOrcNumero: Record<string, any>;
  },
  codigos: string[],
) {
  const unique = [...new Set(codigos.map((c) => String(c || "").trim()).filter((c) => /^\d+$/.test(c) && !gcOsResult.byCodigo[c]))];
  if (unique.length === 0) return 0;
  let hydrated = 0;
  const PARALLEL = 8;
  for (let i = 0; i < unique.length; i += PARALLEL) {
    const batch = unique.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(async (codigo) => {
      const url = `${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(codigo)}&limite=5`;
      const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      const records: any[] = Array.isArray(data?.data) ? data.data : [];
      return records.find((os) => String(os?.codigo || "").trim() === codigo) || null;
    }));
    for (const os of results) {
      if (!os?.id) continue;
      const atributos: any[] = os.atributos || [];
      const gc_os_tarefa_os = collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_OS).join("/");
      const gc_os_tarefa_exec = collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_EXEC).join("/") || null;
      const osPayload: any = {
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
        gc_os_link: buildGcOsPublicLink(os),
        gc_os_link_cobranca: buildGcOsPublicLink(os),
        gc_os_tarefa_exec,
        gc_os_tarefa_os,
        gc_os_orcamento_codigo: null as string | null,
      };
      const codigo = String(os.codigo || "").trim();
      if (codigo) gcOsResult.byCodigo[codigo] = osPayload;
      const attrOrcNum = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === "81831";
      });
      if (attrOrcNum) {
        const nested = attrOrcNum?.atributo || attrOrcNum;
        const orcNum = String(nested?.conteudo || nested?.valor || "").trim();
        if (orcNum && /^\d+$/.test(orcNum)) {
          osPayload.gc_os_orcamento_codigo = orcNum;
          gcOsResult.byOrcNumero[orcNum] = osPayload;
        }
      }
      const tarefaOsIds = gc_os_tarefa_os.split("/").filter(Boolean);
      for (const taskId of tarefaOsIds) {
        if (!gcOsResult.byTaskId[taskId]) gcOsResult.byTaskId[taskId] = osPayload;
        const bucket = gcOsResult.byTaskIdAll[taskId] || [];
        if (!bucket.some((existing: any) => existing?.gc_os_id === osPayload.gc_os_id)) {
          bucket.push(osPayload);
          gcOsResult.byTaskIdAll[taskId] = bucket;
        }
      }
      const tarefaExecIds = String(gc_os_tarefa_exec || "").split("/").filter(Boolean);
      for (const execId of tarefaExecIds) {
        const bucket = gcOsResult.byExecTaskId[execId] || [];
        if (!bucket.some((existing: any) => existing?.gc_os_id === osPayload.gc_os_id)) {
          bucket.push(osPayload);
          gcOsResult.byExecTaskId[execId] = bucket;
        }
      }
      hydrated++;
    }
  }
  console.log(`[central-sync] OS hidratadas por código (orientação): ${hydrated}/${unique.length}`);
  return hydrated;
}

// Extrai códigos de OS / Orçamento mencionados em texto de orientação Auvo
function extractReferencedCodes(text: string): { osCodigos: string[]; orcCodigos: string[] } {
  const osCodigos = new Set<string>();
  const orcCodigos = new Set<string>();
  if (!text) return { osCodigos: [], orcCodigos: [] };

  // Orçamento variantes: "Orçamento #5185", "OR N° 331", "ORÇAMENTO 331", "N° DO ORÇAMENTO 331", "ref. Orçamento #5082"
  const orcRe = /(?:N[°º]?\s*(?:DO\s+)?)?(?:OR|Or[çc]amento|OR[ÇC]AMENTO)\s*(?:N[°º]|#|:)?\s*(\d{2,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = orcRe.exec(text))) orcCodigos.add(m[1]);

  // OS variantes: "OS N° 9224", "OS 9224", "OS: 9224", "OS #9224"
  const osRe = /\bOS\s*(?:N[°º]|:|#)?\s*(\d{2,6})\b/gi;
  while ((m = osRe.exec(text))) {
    // descarta se vier de "TAREFA OS" (normalmente IDs de tarefa Auvo, 7-8 dígitos)
    const start = Math.max(0, m.index - 8);
    const prefix = text.slice(start, m.index).toUpperCase();
    if (prefix.includes("TAREFA")) continue;
    osCodigos.add(m[1]);
  }
  return { osCodigos: [...osCodigos], orcCodigos: [...orcCodigos] };
}

// Fetch GC OS with optional filters (situacao_ids, date range)
async function fetchGcOs(gcHeaders: Record<string, string>, options?: { situacaoIds?: string[]; dataInicio?: string; dataFim?: string }): Promise<{ byTaskId: Record<string, any>; byTaskIdAll: Record<string, any[]>; byExecTaskId: Record<string, any[]>; byCodigo: Record<string, any>; byOrcNumero: Record<string, any> }> {
  const map: Record<string, any> = {};
  const byTaskIdAll: Record<string, any[]> = {};
  const byExecTaskId: Record<string, any[]> = {};
  const byCodigo: Record<string, any> = {};
  const byOrcNumero: Record<string, any> = {};

  // If situacaoIds provided, fetch per situação; otherwise fetch all
  const situacaoIds = options?.situacaoIds?.length ? options.situacaoIds : [null];

  for (const sitId of situacaoIds) {
    let page = 1;
    let totalPages = 1;
    const MAX_PAGES = 500;

    while (page <= totalPages && page <= MAX_PAGES) {
      let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
      if (sitId) url += `&situacao_id=${sitId}`;
      if (options?.dataInicio) url += `&data_inicio=${options.dataInicio}`;
      if (options?.dataFim) url += `&data_fim=${options.dataFim}`;

      let response: Response | null = null;
      const RATE_BACKOFF = [3000, 6000, 12000];
      for (let attempt = 0; attempt < RATE_BACKOFF.length; attempt++) {
        response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
        if (response.status !== 429) break;
        console.warn(`[central-sync] GC ordens_servicos page ${page}${sitId ? ` sit=${sitId}` : ""} 429, retry ${attempt + 1}/${RATE_BACKOFF.length} em ${RATE_BACKOFF[attempt]}ms`);
        await new Promise(r => setTimeout(r, RATE_BACKOFF[attempt]));
      }
      if (!response || response.status === 429) {
        console.error(`[central-sync] GC ordens_servicos page ${page}${sitId ? ` sit=${sitId}` : ""}: 429 persistente após retries — retornando mapa parcial`);
        break;
      }
      if (!response.ok) break;

      const data = await response.json();
      const records: any[] = Array.isArray(data?.data) ? data.data : [];
      totalPages = data?.meta?.total_paginas || 1;

      for (const os of records) {
        const atributos: any[] = os.atributos || [];
        const gc_os_tarefa_os = collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_OS).join("/");
        const gc_os_tarefa_exec = collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_EXEC).join("/") || null;

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
          gc_os_link: buildGcOsPublicLink(os),
          gc_os_link_cobranca: buildGcOsPublicLink(os),
          gc_os_tarefa_exec,
          gc_os_tarefa_os,
          gc_os_orcamento_codigo: null as string | null,
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
            osPayload.gc_os_orcamento_codigo = orcNum;
            byOrcNumero[orcNum] = osPayload;
          }
        }

        // 73343 = TAREFA OS. É o único campo que vincula uma OS à tarefa Auvo.
        // 73344 = TAREFA EXECUÇÃO; nunca deve amarrar a OS no Kanban/central.
        const tarefaOsIds = gc_os_tarefa_os.split("/").filter(Boolean);
        for (const taskId of tarefaOsIds) {
          if (!map[taskId]) map[taskId] = osPayload;
          const bucket = byTaskIdAll[taskId] || [];
          if (!bucket.some((existing) => existing?.gc_os_id === osPayload.gc_os_id)) {
            bucket.push(osPayload);
            byTaskIdAll[taskId] = bucket;
          }
        }

        // Index by 73344 (TAREFA EXECUÇÃO) — usado APENAS para casar com orçamento (73341),
        // nunca para criar/atualizar vínculo de OS no Kanban.
        const tarefaExecIds = String(gc_os_tarefa_exec || "").split("/").filter(Boolean);
        for (const execId of tarefaExecIds) {
          const bucket = byExecTaskId[execId] || [];
          if (!bucket.some((existing) => existing?.gc_os_id === osPayload.gc_os_id)) {
            bucket.push(osPayload);
            byExecTaskId[execId] = bucket;
          }
        }
      }

      console.log(`[central-sync] GC OS${sitId ? ` sit=${sitId}` : ''} page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
      page++;
    }
    if (page > 500 && page <= totalPages) {
      console.warn(`[central-sync] TRUNCAMENTO: MAX_PAGES atingido em GC ordens_servicos${sitId ? ` sit=${sitId}` : ''} (totalPages=${totalPages})`);
    }
  }
  return { byTaskId: map, byTaskIdAll, byExecTaskId, byCodigo, byOrcNumero };
}

async function upsertGcOsShellRows(
  sbClient: any,
  gcOsResult: { byTaskIdAll: Record<string, any[]>; byCodigo: Record<string, any> },
  options?: { orphansOnly?: boolean },
) {
  const shells: any[] = [];
  const seen = new Set<string>();

  for (const osPayload of Object.values(gcOsResult.byCodigo || {})) {
    const taskIds = normalizeTaskIdList((osPayload as any).gc_os_tarefa_os).split("/").filter(Boolean);
    // Só 73343 (TAREFA OS) pode criar/atualizar vínculo de OS.
    const realTaskId = taskIds[0] || "";
    if (!(osPayload as any).gc_os_id) continue;
    // If no Auvo task linked, create a synthetic shell so the OS still appears (flagged red in UI)
    const primaryTaskId = realTaskId || `gc-only::${(osPayload as any).gc_os_id}`;
    const semTarefa = !realTaskId;
    // Quando rodando em modo "orphansOnly", só cria/atualiza shells de OS sem 73343
    // (as com 73343 são tratadas pelo fluxo Auvo-driven adiante e poderiam colidir
    // com mirror_keys que incluem o orçamento vinculado).
    if (options?.orphansOnly && !semTarefa) continue;

    const key = `${primaryTaskId}::${(osPayload as any).gc_os_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    shells.push({
      auvo_task_id: primaryTaskId,
      cliente: (osPayload as any).gc_os_cliente || "Cliente não identificado",
      tecnico: "",
      tecnico_id: "",
      data_tarefa: (osPayload as any).gc_os_data_saida || (osPayload as any).gc_os_data || null,
      status_auvo: semTarefa ? "Sem tarefa Auvo" : "Pendente vínculo Auvo",
      orientacao: "",
      pendencia: "",
      descricao: semTarefa ? "OS GestãoClick (sem tarefa Auvo vinculada)" : "OS GestãoClick",
      duracao_decimal: 0,
      hora_inicio: "",
      hora_fim: "",
      check_in: false,
      check_out: false,
      endereco: "",
      auvo_link: semTarefa ? "" : `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${primaryTaskId}`,
      auvo_task_url: "",
      auvo_survey_url: "",
      questionario_id: null,
      questionario_respostas: [],
      questionario_preenchido: false,
      os_realizada: true,
      orcamento_realizado: false,
      atualizado_em: new Date().toISOString(),
      gc_os_id: (osPayload as any).gc_os_id,
      gc_os_codigo: (osPayload as any).gc_os_codigo,
      gc_os_cliente: (osPayload as any).gc_os_cliente,
      gc_os_situacao: (osPayload as any).gc_os_situacao,
      gc_os_situacao_id: (osPayload as any).gc_os_situacao_id,
      gc_os_cor_situacao: (osPayload as any).gc_os_cor_situacao,
      gc_os_valor_total: (osPayload as any).gc_os_valor_total,
      gc_os_vendedor: (osPayload as any).gc_os_vendedor,
      gc_os_data: (osPayload as any).gc_os_data,
      gc_os_data_saida: (osPayload as any).gc_os_data_saida,
      gc_os_link: (osPayload as any).gc_os_link,
      gc_os_link_cobranca: (osPayload as any).gc_os_link_cobranca || null,
      gc_os_tarefa_exec: (osPayload as any).gc_os_tarefa_exec || null,
      gc_os_tarefa_os: (osPayload as any).gc_os_tarefa_os || null,
      mirror_key: `${primaryTaskId}::os:${(osPayload as any).gc_os_id}::orc:`,
    });
  }

  let upserted = 0;
  for (let i = 0; i < shells.length; i += 100) {
    const batch = shells.slice(i, i + 100);
    const { error } = await sbClient
      .from("tarefas_central")
      .upsert(batch, { onConflict: "mirror_key", ignoreDuplicates: false, defaultToNull: false });
    if (error) console.error("[central-sync] GC-first shell upsert error:", error.message);
    else upserted += batch.length;
  }

  return upserted;
}


type CentralSyncBody = {
  start_date?: unknown;
  end_date?: unknown;
  situacao_ids?: unknown;
  wait?: unknown;
  fast?: unknown;
  lite?: unknown;
  reports_only?: unknown;
  gc_status_only?: unknown;
};

async function refreshGcOsStatusesForReportsOnly(
  sbClient: any,
  gcHeaders: Record<string, string>,
  startDate: string,
  endDate: string,
  auvoTaskIdsInWindow: string[],
) {
  const taskIds = Array.from(new Set(auvoTaskIdsInWindow.map((id) => String(id || "").trim()).filter(Boolean)));

  // Hard time budget so we never timeout the function. If exceeded, return what was done.
  const HARD_BUDGET_MS = 25_000;
  const tStart = Date.now();
  const timeUp = () => Date.now() - tStart > HARD_BUDGET_MS;

  // Scope: only OS whose Auvo task (OS or Execução) is in this window. Avoids full-table scans.
  const targetOsIds = new Set<string>();
  const IN_CHUNK = 200;
  for (let i = 0; i < taskIds.length; i += IN_CHUNK) {
    if (timeUp()) break;
    const batch = taskIds.slice(i, i + IN_CHUNK);
    // (a) rows where OS task id matches
    const { data: rowsByOsTask } = await sbClient
      .from("tarefas_central")
      .select("gc_os_id")
      .not("gc_os_id", "is", null)
      .in("auvo_task_id", batch);
    for (const r of rowsByOsTask || []) {
      const id = String(r.gc_os_id || "").trim();
      if (id) targetOsIds.add(id);
    }
    // (b) rows whose exec-task reference contains one of the ids (handles slash-separated)
    const orExpr = batch.map((id) => `gc_os_tarefa_exec.ilike.%${id}%`).join(",");
    const { data: rowsByExec } = await sbClient
      .from("tarefas_central")
      .select("gc_os_id")
      .not("gc_os_id", "is", null)
      .or(orExpr);
    for (const r of rowsByExec || []) {
      const id = String(r.gc_os_id || "").trim();
      if (id) targetOsIds.add(id);
    }
  }

  let updated = 0;
  let processed = 0;
  const osIds = Array.from(targetOsIds);
  const PARALLEL = 8;
  for (let i = 0; i < osIds.length; i += PARALLEL) {
    if (timeUp()) {
      console.warn(`[central-sync] Budget esgotado em refreshGcOsStatusesForReportsOnly após ${processed}/${osIds.length} OS`);
      break;
    }
    const batch = osIds.slice(i, i + PARALLEL);
    const freshList = await Promise.all(batch.map(async (osId) => {
      const resp = await rateLimitedFetch(`${GC_BASE_URL}/api/ordens_servicos/${osId}`, { headers: gcHeaders }, "gc");
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      const os = data?.data || data;
      if (!os?.id) return null;
      const atributos: any[] = os.atributos || [];
      return {
        gc_os_id: String(os.id),
        gc_os_cliente: String(os.nome_cliente || ""),
        gc_os_situacao: String(os.nome_situacao || ""),
        gc_os_situacao_id: String(os.situacao_id || ""),
        gc_os_cor_situacao: String(os.cor_situacao || ""),
        gc_os_valor_total: parseFloat(os.valor_total || "0"),
        gc_os_vendedor: String(os.nome_vendedor || ""),
        gc_os_data_saida: String(os.data_saida || "").split("T")[0] || null,
        gc_os_tarefa_exec: collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_EXEC).join("/") || null,
      };
    }));

    const counts = await Promise.all(freshList.filter(Boolean).map(async (fresh: any) => {
      const updatePayload: any = {
        gc_os_cliente: fresh.gc_os_cliente,
        gc_os_situacao: fresh.gc_os_situacao,
        gc_os_situacao_id: fresh.gc_os_situacao_id,
        gc_os_cor_situacao: fresh.gc_os_cor_situacao,
        gc_os_valor_total: fresh.gc_os_valor_total,
        gc_os_vendedor: fresh.gc_os_vendedor,
        gc_os_data_saida: fresh.gc_os_data_saida,
        atualizado_em: new Date().toISOString(),
      };
      if (fresh.gc_os_tarefa_exec) updatePayload.gc_os_tarefa_exec = fresh.gc_os_tarefa_exec;
      const { count } = await sbClient
        .from("tarefas_central")
        .update(updatePayload, { count: "exact" })
        .eq("gc_os_id", fresh.gc_os_id);
      return count || 0;
    }));
    updated += counts.reduce((sum, count) => sum + count, 0);
    processed += batch.length;
  }

  console.log(`[central-sync] Reports-only GC OS status refresh: ${updated} registros atualizados (${processed}/${targetOsIds.size} OS verificadas em ${Date.now() - tStart}ms)`);
  return { checked: processed, updated };
}

async function refreshGcOsFieldsForPeriod(sbClient: any, gcHeaders: Record<string, string>, startDate: string, endDate: string) {
  const osIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: chunk, error } = await sbClient
      .from("tarefas_central")
      .select("gc_os_id")
      .not("gc_os_id", "is", null)
      .gte("gc_os_data_saida", startDate)
      .lte("gc_os_data_saida", endDate)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!chunk || chunk.length === 0) break;
    for (const row of chunk) if (row.gc_os_id) osIds.add(String(row.gc_os_id));
    if (chunk.length < 1000) break;
  }

  let updated = 0;
  const PARALLEL = 10;
  const ids = Array.from(osIds);
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const batch = ids.slice(i, i + PARALLEL);
    const freshList = await Promise.all(batch.map(async (osId) => {
      const resp = await rateLimitedFetch(`${GC_BASE_URL}/api/ordens_servicos/${osId}`, { headers: gcHeaders }, "gc");
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      const os = data?.data || data;
      if (!os?.id) return null;
      const atributos: any[] = os.atributos || [];
      return {
        gc_os_id: String(os.id),
        gc_os_cliente: String(os.nome_cliente || ""),
        gc_os_situacao: String(os.nome_situacao || ""),
        gc_os_situacao_id: String(os.situacao_id || ""),
        gc_os_cor_situacao: String(os.cor_situacao || ""),
        gc_os_valor_total: parseFloat(os.valor_total || "0"),
        gc_os_vendedor: String(os.nome_vendedor || ""),
        gc_os_data_saida: String(os.data_saida || "").split("T")[0] || null,
        gc_os_tarefa_exec: collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_EXEC).join("/") || null,
        gc_os_tarefa_os: collectGcAttrTaskIds(atributos, GC_ATRIBUTO_TAREFA_OS).join("/") || null,
        gc_os_link: buildGcOsPublicLink(os),
        gc_os_link_cobranca: buildGcOsPublicLink(os),
      };
    }));

    const counts = await Promise.all(freshList.filter(Boolean).map(async (fresh: any) => {
      const updatePayload: any = {
        gc_os_cliente: fresh.gc_os_cliente,
        gc_os_situacao: fresh.gc_os_situacao,
        gc_os_situacao_id: fresh.gc_os_situacao_id,
        gc_os_cor_situacao: fresh.gc_os_cor_situacao,
        gc_os_valor_total: fresh.gc_os_valor_total,
        gc_os_vendedor: fresh.gc_os_vendedor,
        gc_os_data_saida: fresh.gc_os_data_saida,
        gc_os_link: fresh.gc_os_link,
        gc_os_link_cobranca: fresh.gc_os_link_cobranca || null,
        gc_os_tarefa_exec: fresh.gc_os_tarefa_exec,
        gc_os_tarefa_os: fresh.gc_os_tarefa_os,
        atualizado_em: new Date().toISOString(),
      };
      const { count, error } = await sbClient
        .from("tarefas_central")
        .update(updatePayload, { count: "exact" })
        .eq("gc_os_id", fresh.gc_os_id);
      if (error) console.error("[central-sync] gc_status_only update error:", error.message);
      return count || 0;
    }));
    updated += counts.reduce((sum, count) => sum + count, 0);
  }

  // ── FALLBACK: link GC OS to local rows via TAREFA EXECUÇÃO (73344) ──
  // Para OS cuja TAREFA OS (73343) está errada/duplicada, vinculamos pela
  // execução. Só preenche linhas locais sem gc_os_id (não sobrescreve).
  let execLinked = 0;
  try {
    const gcOsList = await fetchGcOs(gcHeaders, { dataInicio: startDate, dataFim: endDate });
    const execEntries: Array<[string, any]> = [];
    for (const osPayload of Object.values(gcOsList.byCodigo || {}) as any[]) {
      if (!osPayload?.gc_os_id) continue;
      const execIds = String(osPayload.gc_os_tarefa_exec || "").split("/").filter(Boolean);
      for (const execId of execIds) {
        if (execId) execEntries.push([execId, osPayload]);
      }
    }
    const PAR = 10;
    for (let i = 0; i < execEntries.length; i += PAR) {
      const slice = execEntries.slice(i, i + PAR);
      const results = await Promise.all(slice.map(async ([execTaskId, osPayload]: any) => {
        const updatePayload: any = {
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
          gc_os_link_cobranca: osPayload.gc_os_link_cobranca || null,
          gc_os_tarefa_exec: osPayload.gc_os_tarefa_exec || null,
          gc_os_tarefa_os: osPayload.gc_os_tarefa_os || null,
          os_realizada: true,
          atualizado_em: new Date().toISOString(),
        };
        const { count } = await sbClient
          .from("tarefas_central")
          .update(updatePayload, { count: "exact" })
          .eq("auvo_task_id", execTaskId)
          .is("gc_os_id", null);
        return count || 0;
      }));
      execLinked += results.reduce((s, c) => s + c, 0);
    }
    if (execLinked > 0) {
      console.log(`[central-sync] gc_status_only exec-fallback: ${execLinked} OS vinculadas via 73344`);
      updated += execLinked;
    }
  } catch (err) {
    console.error("[central-sync] gc_status_only exec-fallback error:", (err as Error).message);
  }

  return { checked: ids.length, updated };
}

async function runReportsOnlySync(sbClient: any, bearerToken: string, gcHeaders: Record<string, string>, startDate: string, endDate: string) {
  console.log(`[central-sync] Reports-only: buscando Auvo ${startDate} → ${endDate}`);

  // FIRST: pull GC OS in OPEN situations so they always appear in tarefas_central,
  // even when the Auvo task wasn't returned in the date window (or doesn't exist yet).
  // OS without Auvo link become "shell" rows flagged in the UI.
  const OPEN_OS_SITUACAO_IDS = [
    "7063579", // AGUARDANDO COMPRA DE PEÇAS
    "7063580", // AGUARDANDO CHEGADA DE PEÇAS
    "7659440", // AGUARDANDO FABRICAÇÃO
    "7063581", // PEDIDO EM CONFERENCIA
    "7063705", // PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO
    "7213493", // SERVICO AGUARDANDO EXECUCAO
    "7684665", // RETIRADA PELO TECNICO
    "7748831", // AGUARDANDO RETIRADA
    "8219136", // EM ROTA
    "7116099", // EXECUTADO – AG. NEGOCIAÇÃO
    "8889036", // FECHADO CHAMADO
  ];
  let gcShellUpserted = 0;
  let gcOsOpenCount = 0;
  try {
    const gcOsOpen = await fetchGcOs(gcHeaders, { situacaoIds: OPEN_OS_SITUACAO_IDS });
    gcOsOpenCount = Object.keys(gcOsOpen.byCodigo || {}).length;
    gcShellUpserted = await upsertGcOsShellRows(sbClient, gcOsOpen);
    console.log(`[central-sync] Reports-only GC shells: ${gcShellUpserted}/${gcOsOpenCount} OS em situações abertas processadas`);
  } catch (e) {
    console.error(`[central-sync] Reports-only GC shell fetch falhou: ${(e as Error).message}`);
  }

  const auvoTasks = await fetchAuvoTasks(bearerToken, startDate, endDate);
  console.log(`[central-sync] Reports-only Auvo: ${auvoTasks.length} tarefas`);

  const taskIds = auvoTasks
    .map((task: any) => String(task.taskID || "").trim())
    .filter(Boolean);

  const existingBestByTaskId = new Map<string, any>();
  for (let i = 0; i < taskIds.length; i += 200) {
    const batch = taskIds.slice(i, i + 200);
    const { data: existingRows } = await sbClient
      .from("tarefas_central")
      .select("auvo_task_id, mirror_key, status_auvo, duracao_decimal, check_in, check_out, check_in_iso, check_out_iso, tecnico, data_conclusao, atualizado_em")
      .in("auvo_task_id", batch);

    for (const row of existingRows || []) {
      const taskId = String(row.auvo_task_id || "").trim();
      const mirrorKey = String(row.mirror_key || "").trim();
      if (taskId && mirrorKey) {
        const chosenMirror = chooseBestExistingMirror(existingBestByTaskId.get(taskId), { ...row, mirror_key: mirrorKey });
        existingBestByTaskId.set(taskId, { ...row, mirror_key: chosenMirror });
      }
    }
  }

  const taskSnapshotById = new Map<string, AuvoTaskSnapshot>();
  const detailIds = Array.from(new Set(taskIds));
  if (detailIds.length > 0) {
    console.log(`[central-sync] Reports-only: buscando detalhe Auvo para ${detailIds.length} tarefas`);
    const PARALLEL = 10;
    for (let i = 0; i < detailIds.length; i += PARALLEL) {
      const batch = detailIds.slice(i, i + PARALLEL);
      const results = await Promise.all(batch.map((id) => fetchAuvoTaskSnapshot(bearerToken, id)));
      batch.forEach((id, idx) => {
        if (results[idx]) taskSnapshotById.set(id, results[idx]!);
      });
    }
    console.log(`[central-sync] Reports-only: detalhes obtidos ${taskSnapshotById.size}/${detailIds.length}`);
  }

  const rows = auvoTasks.map((task: any) => {
    const taskId = String(task.taskID || "").trim();
    if (!taskId) return null;
    const snapshot = taskSnapshotById.get(taskId) || null;
    const taskWithDetail = snapshot
      ? {
          ...task,
          duration: snapshot.duration || task.duration,
          durationDecimal: snapshot.durationDecimal ?? task.durationDecimal,
          timeControl: snapshot.timeControl?.length ? snapshot.timeControl : task.timeControl,
          checkInDate: snapshot.checkInDate || task.checkInDate,
          checkOutDate: snapshot.checkOutDate || task.checkOutDate,
          displacementStart: snapshot.displacementStart || task.displacementStart,
          estimatedDuration: snapshot.estimatedDuration || task.estimatedDuration,
        }
      : task;

    const questionnairesSource = Array.isArray(task.questionnaires) ? task.questionnaires : [];
    const targetQ = questionnairesSource.find((q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID);
    const answers = (targetQ?.answers || []).map((a: any) => ({
      question: String(a.questionDescription || ""),
      reply: String(a.reply || ""),
    }));
    const hasFilledQ = answers.some((r: any) => r.reply && r.reply.trim() !== "" && !r.reply.startsWith("http"));

    const statusCode = typeof task.taskStatus === "number" ? task.taskStatus
      : typeof task.taskStatus?.id === "number" ? task.taskStatus.id
      : typeof task.taskStatus === "object" ? Number(task.taskStatus?.id || task.taskStatus?.status || 0) : 0;

    const checkOutDateRaw = String(taskWithDetail.checkOutDate || taskWithDetail.checkoutDate || taskWithDetail.taskEndDate || taskWithDetail.taskEndDateTime || "").trim();
    const checkInDateRaw = String(taskWithDetail.checkInDate || taskWithDetail.checkinDate || "").trim();
    const checkInIso = normalizeDateTime(checkInDateRaw);
    const checkOutIso = normalizeDateTime(checkOutDateRaw);
    const displacementStartRaw = String(taskWithDetail.displacementStart || taskWithDetail.displacement_start || "").trim();
    const duracaoDeslocamento = calculateDisplacementHours(displacementStartRaw, checkInDateRaw);
    const hasCheckOut = !!task.checkOut || !!checkOutDateRaw;
    // Preferimos sempre o horário REAL de check-in/check-out (Auvo monitoring)
    // sobre o horário AGENDADO (startTime/endTime). Isso evita falsos alertas
    // de "Sem janela de trabalho" quando o técnico chegou bem antes/depois do agendado.
    const startTimeResolved =
      extractTimeFromDateStr(checkInDateRaw) ||
      String(taskWithDetail.startTime || taskWithDetail.startHour || snapshot?.startTime || "").trim() ||
      extractTimeFromDateStr(String(taskWithDetail.taskDate || snapshot?.taskDate || ""));
    let endTimeResolved =
      extractTimeFromDateStr(checkOutDateRaw) ||
      String(taskWithDetail.endTime || taskWithDetail.endHour || snapshot?.endTime || "").trim();
    const durationDecimalResolved = computeAuvoWorkedHours(taskWithDetail) || parseDurationToHours(taskWithDetail.estimatedDuration || snapshot?.estimatedDuration || "");

    if (!endTimeResolved && startTimeResolved && durationDecimalResolved > 0) {
      const startMinutes = parseClockToMinutes(startTimeResolved);
      if (startMinutes >= 0) endTimeResolved = minutesToClock(startMinutes + Math.round(durationDecimalResolved * 60));
    }

    return {
      auvo_task_id: taskId,
      cliente: String(task.customerDescription || task.customerName || task.customer?.tradeName || task.customer?.companyName || "Cliente não identificado").trim(),
      tecnico: resolveAuvoTechnicianName(task),
      tecnico_id: resolveAuvoTechnicianId(task),
      data_tarefa: normalizeDate(task.taskDate) || null,
      data_conclusao: normalizeDate(checkOutDateRaw) || null,
      check_in_iso: checkInIso,
      check_out_iso: checkOutIso,
      deslocamento_inicio: displacementStartRaw || null,
      duracao_deslocamento: duracaoDeslocamento || null,
      task_type_id: (() => {
        const tt = task.taskType ?? task.TaskType;
        if (tt == null) return null;
        if (typeof tt === "object") return String(tt.id ?? tt.taskTypeId ?? "") || null;
        return String(tt) || null;
      })(),
      status_auvo: (() => {
        if (statusCode === 6) return "Pausada";
        if (statusCode === 4 || statusCode === 5 || hasCheckOut) return "Finalizada";
        if (statusCode === 3) return "Em andamento";
        if (statusCode === 2) return "Em deslocamento";
        return "Aberta";
      })(),
      orientacao: String(task.orientation || "").substring(0, 500),
      pendencia: String(task.pendency ?? "").trim(),
      descricao: resolveTaskType(task),
      duracao_decimal: durationDecimalResolved,
      hora_inicio: startTimeResolved,
      hora_fim: endTimeResolved,
      check_in: !!(task.checkIn || task.checkInDate || task.checkinDate),
      check_out: hasCheckOut,
      endereco: resolveTaskAddress(task),
      auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
      auvo_task_url: String(task.taskUrl || ""),
      auvo_survey_url: String(task.survey || ""),
      questionario_id: targetQ ? String(targetQ.questionnaireId) : null,
      questionario_respostas: answers,
      questionario_preenchido: hasFilledQ,
      atualizado_em: new Date().toISOString(),
      mirror_key: existingBestByTaskId.get(taskId)?.mirror_key || `${taskId}::os:::orc:`,
    };
  }).filter(Boolean);

  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await sbClient
      .from("tarefas_central")
      .upsert(batch, { onConflict: "mirror_key", ignoreDuplicates: false, defaultToNull: false });

    if (error) {
      console.error(`[central-sync] Reports-only batch ${i}-${i + batch.length} error:`, error.message);
      errors++;
    } else {
      upserted += batch.length;
    }
  }

  const gcStatusRefresh = await refreshGcOsStatusesForReportsOnly(sbClient, gcHeaders, startDate, endDate, taskIds);

  return {
    success: true,
    mode: "reports-only",
    periodo: { inicio: startDate, fim: endDate },
    auvo_tarefas: auvoTasks.length,
    upserted,
    gc_os_abertas: gcOsOpenCount,
    gc_shells_upserted: gcShellUpserted,
    gc_os_status_checked: gcStatusRefresh.checked,
    gc_os_status_updated: gcStatusRefresh.updated,
    errors,
  };
}

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

    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    if (body?.gc_status_only === true) {
      const result = await refreshGcOsFieldsForPeriod(sbClient, gcH, startDate, endDate);
      return {
        success: true,
        mode: "gc-status-only",
        periodo: { inicio: startDate, fim: endDate },
        gc_os_checked: result.checked,
        gc_os_updated: result.updated,
        errors: 0,
      };
    }

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    if (body?.reports_only === true) {
      return await runReportsOnlySync(sbClient, bearerToken, gcH, startDate, endDate);
    }

    // Step 1: Fetch GC data first (faster, ~20s) — Auvo will come after status refresh
    const gcOsOptions = {
      situacaoIds: situacaoIds.length > 0 ? situacaoIds : undefined,
    };
    const [gcOrcResult, gcOsResult] = await Promise.all([
      fetchGcOrcamentos(gcH),
      fetchGcOs(gcH, gcOsOptions),
    ]);

    await hydrateMissingOrcamentosByCodigo(
      gcH,
      gcOrcResult,
      Object.values(gcOsResult.byCodigo || {}).map((os: any) => String(os?.gc_os_orcamento_codigo || ""))
    );

    const gcOrcMap = gcOrcResult.byTaskId;
    const gcOrcByCodigo = gcOrcResult.byCodigo;
    const gcOsMap = gcOsResult.byTaskId;
    const gcOsByTaskIdAll = gcOsResult.byTaskIdAll || {};
    const gcOsByExecTaskId = gcOsResult.byExecTaskId || {};
    const gcOsByCodigo = gcOsResult.byCodigo;
    const gcOsByOrcNumero = gcOsResult.byOrcNumero;

    console.log(`[central-sync] GC carregado: Orç: ${Object.keys(gcOrcMap).length}, OS: ${Object.keys(gcOsMap).length}`);

    // Helpers de amarração OS↔Orçamento via tarefas Auvo (73343 / 73344 / 73341)
    // - Orçamento (73341) geralmente aponta pra TAREFA EXECUÇÃO da OS, não pra TAREFA OS.
    // - Por isso, ao casar com orçamento, olhamos 73343 OU 73344.
    const findOrcForOs = (gcOs: any): any | null => {
      if (!gcOs) return null;
      const orcCodigo = String(gcOs.gc_os_orcamento_codigo || "").trim();
      if (orcCodigo && gcOrcByCodigo[orcCodigo]) return gcOrcByCodigo[orcCodigo];
      const candidates: string[] = [];
      const osIds = String(gcOs.gc_os_tarefa_os || "").split("/").filter(Boolean);
      const execIds = String(gcOs.gc_os_tarefa_exec || "").split("/").filter(Boolean);
      candidates.push(...osIds, ...execIds);
      for (const id of candidates) {
        if (gcOrcMap[id]) return gcOrcMap[id];
      }
      return null;
    };
    const findOsForTaskId = (taskId: string): any | null => {
      if (!taskId) return null;
      // 1) OS com 73343 == taskId
      if (gcOsMap[taskId]) return gcOsMap[taskId];
      // 2) OS com 73344 == taskId (orçamento aponta pra execução)
      const execBucket = gcOsByExecTaskId[taskId];
      if (execBucket && execBucket.length > 0) return execBucket[0];
      return null;
    };
    const applyOrcPayload = (target: any, orcPayload: any) => {
      if (!target || !orcPayload?.gc_orcamento_id) return;
      target.gc_orcamento_id = orcPayload.gc_orcamento_id;
      target.gc_orcamento_codigo = orcPayload.gc_orcamento_codigo;
      target.gc_orc_cliente = orcPayload.gc_orc_cliente;
      target.gc_orc_situacao = orcPayload.gc_orc_situacao;
      target.gc_orc_situacao_id = orcPayload.gc_orc_situacao_id;
      target.gc_orc_cor_situacao = orcPayload.gc_orc_cor_situacao;
      target.gc_orc_valor_total = orcPayload.gc_orc_valor_total;
      target.gc_orc_valor_produtos = orcPayload.gc_orc_valor_produtos;
      target.gc_orc_valor_servicos = orcPayload.gc_orc_valor_servicos;
      target.gc_orc_vendedor = orcPayload.gc_orc_vendedor;
      target.gc_orc_data = orcPayload.gc_orc_data;
      target.gc_orc_link = orcPayload.gc_orc_link;
      target.orcamento_realizado = true;
    };

    // Kick off Auvo fetch IN PARALLEL with the heavy GC refresh blocks below.
    // Auvo is network-bound and the refresh is DB-bound, so they overlap nicely.
    // Without this, the function frequently hits IDLE_TIMEOUT before Auvo even starts,
    // breaking the Horas Trabalhadas tab (which depends on Auvo data).
    const isFastGcOnly = situacaoIds.length > 0 && body?.fast === true;
    const isLiteSync = body?.lite === true;
    const auvoTasksPromise: Promise<any[]> = isFastGcOnly
      ? Promise.resolve([])
      : fetchAuvoTasks(bearerToken, startDate, endDate).catch((err) => {
          console.error(`[central-sync] Auvo fetch falhou: ${(err as Error).message}`);
          return [];
        });
    if (!isFastGcOnly) {
      console.log(`[central-sync] Auvo fetch iniciado em paralelo: ${startDate} → ${endDate}`);
    }

    // Remove vínculos antigos/duplicados de OS que não aparecem mais pelo campo 73343.
    // A chave válida é sempre tarefa Auvo + OS GC vinda de gcOsResult.byTaskIdAll (somente 73343).
    const validOsTaskKeys = new Set<string>();
    for (const [taskId, osList] of Object.entries(gcOsByTaskIdAll)) {
      for (const osPayload of osList as any[]) {
        if (taskId && osPayload?.gc_os_id) validOsTaskKeys.add(`${taskId}::${String(osPayload.gc_os_id)}`);
      }
    }
    const fetchedOsIds = [...new Set(Object.values(gcOsByCodigo).map((os: any) => String(os?.gc_os_id || "")).filter(Boolean))];
    let staleOsLinksDeleted = 0;
    for (let i = 0; i < fetchedOsIds.length; i += 100) {
      const batchIds = fetchedOsIds.slice(i, i + 100);
      const { data: linkedRows } = await sbClient
        .from("tarefas_central")
        .select("mirror_key, auvo_task_id, gc_os_id")
        .in("gc_os_id", batchIds);
      const staleKeys = (linkedRows || [])
        .filter((row: any) => !validOsTaskKeys.has(`${String(row.auvo_task_id)}::${String(row.gc_os_id)}`))
        .map((row: any) => String(row.mirror_key || ""))
        .filter(Boolean);
      if (staleKeys.length === 0) continue;
      const { count } = await sbClient
        .from("tarefas_central")
        .delete({ count: "exact" })
        .in("mirror_key", staleKeys);
      staleOsLinksDeleted += count || 0;
    }
    if (staleOsLinksDeleted > 0) {
      console.log(`[central-sync] Removidos ${staleOsLinksDeleted} vínculos de OS inválidos (não-73343)`);
    }

    const isGcSolicitadasOnly = situacaoIds.length > 0;
    let gcFirstUpserted = 0;
    if (isGcSolicitadasOnly) {
      gcFirstUpserted = await upsertGcOsShellRows(sbClient, gcOsResult);
      console.log(`[central-sync] GC-first: ${gcFirstUpserted} OS solicitadas gravadas antes do Auvo`);
    } else {
      // Sync normal: garante que OS GC sem TAREFA OS (73343) — ex.: só com 73344
      // ou totalmente desvinculadas — apareçam no central e tenham data_saida atualizada
      // mesmo quando a tarefa Auvo de execução está fora da janela sincronizada.
      gcFirstUpserted = await upsertGcOsShellRows(sbClient, gcOsResult, { orphansOnly: true });
      if (gcFirstUpserted > 0) {
        console.log(`[central-sync] GC orphan backfill: ${gcFirstUpserted} OS sem 73343 gravadas/atualizadas`);
      }
    }
    if (isGcSolicitadasOnly) {
      if (body?.fast === true) {
        return {
          success: true,
          mode: "gc-first-fast",
          periodo: { inicio: startDate, fim: endDate },
          gc_os: Object.keys(gcOsResult.byCodigo).length,
          upserted: gcFirstUpserted,
          errors: 0,
        };
      }
    }

    // ── IMMEDIATE: Late linkage — link existing DB tasks to GC OS/ORC when gc_os_id is null ──
    // Runs FIRST (before heavy lookups) to handle OS created after the task was synced
    {
      let lateLinkOS = 0;
      let lateLinkOrc = 0;
      // Run updates in parallel chunks to avoid IDLE_TIMEOUT.
      const osLinkEntries = Object.entries(gcOsResult.byTaskId).filter(([t, p]: any) => t && p?.gc_os_id);
      const PARALLEL_LINK = 20;
      for (let i = 0; i < osLinkEntries.length; i += PARALLEL_LINK) {
        const slice = osLinkEntries.slice(i, i + PARALLEL_LINK);
        const results = await Promise.all(slice.map(async ([taskId, osPayload]: any) => {
          const orcPayload = findOrcForOs(osPayload);
          const updatePayload: any = {
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
            gc_os_link_cobranca: osPayload.gc_os_link_cobranca || null,
            gc_os_tarefa_exec: osPayload.gc_os_tarefa_exec || null,
            os_realizada: true,
            atualizado_em: new Date().toISOString(),
          };
          if (orcPayload?.gc_orcamento_id) {
            applyOrcPayload(updatePayload, orcPayload);
          }
          const { count } = await sbClient
            .from("tarefas_central")
            .update(updatePayload, { count: "exact" })
            .eq("auvo_task_id", taskId)
            .is("gc_os_id", null);
          return count || 0;
        }));
        lateLinkOS += results.reduce((s, c) => s + c, 0);
      }

      const orcLinkEntries = Object.entries(gcOrcResult.byTaskId).filter(([t, p]: any) => t && p?.gc_orcamento_id);
      for (let i = 0; i < orcLinkEntries.length; i += PARALLEL_LINK) {
        const slice = orcLinkEntries.slice(i, i + PARALLEL_LINK);
        const results = await Promise.all(slice.map(async ([taskId, orcPayload]: any) => {
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
              gc_orc_valor_produtos: orcPayload.gc_orc_valor_produtos,
              gc_orc_valor_servicos: orcPayload.gc_orc_valor_servicos,
              gc_orc_vendedor: orcPayload.gc_orc_vendedor,
              gc_orc_data: orcPayload.gc_orc_data,
              gc_orc_link: orcPayload.gc_orc_link,
              orcamento_realizado: true,
              atualizado_em: new Date().toISOString(),
            }, { count: "exact" })
            .eq("auvo_task_id", taskId)
            .is("gc_orcamento_id", null);
          return count || 0;
        }));
        lateLinkOrc += results.reduce((s, c) => s + c, 0);
      }

      const osOrcEntries = Object.values(gcOsResult.byCodigo || {})
        .map((osPayload: any) => ({ osPayload, orcPayload: findOrcForOs(osPayload) }))
        .filter(({ osPayload, orcPayload }: any) => osPayload?.gc_os_id && orcPayload?.gc_orcamento_id);
      for (let i = 0; i < osOrcEntries.length; i += PARALLEL_LINK) {
        const slice = osOrcEntries.slice(i, i + PARALLEL_LINK);
        const results = await Promise.all(slice.map(async ({ osPayload, orcPayload }: any) => {
          const updatePayload: any = { atualizado_em: new Date().toISOString() };
          applyOrcPayload(updatePayload, orcPayload);
          const { count } = await sbClient
            .from("tarefas_central")
            .update(updatePayload, { count: "exact" })
            .eq("gc_os_id", osPayload.gc_os_id)
            .is("gc_orcamento_id", null);
          return count || 0;
        }));
        lateLinkOrc += results.reduce((s, c) => s + c, 0);
      }

      if (lateLinkOS > 0 || lateLinkOrc > 0) {
        console.log(`[central-sync] Late linkage: ${lateLinkOS} tarefas vinculadas a OS, ${lateLinkOrc} a orçamentos`);
      }

      // ── FALLBACK: link GC OS to local rows via TAREFA EXECUÇÃO (73344) ──
      // Quando a TAREFA OS (73343) está errada/duplicada/colide com outra OS, a OS
      // nunca é vinculada e some da premiação. Para premiação o que importa é o
      // 73344. Aqui ligamos pela execução APENAS quando a linha local ainda não
      // tem gc_os_id, sem sobrescrever vínculos existentes feitos pelo 73343.
      let lateLinkExec = 0;
      const execLinkEntries: Array<[string, any]> = [];
      for (const osPayload of Object.values(gcOsResult.byCodigo || {}) as any[]) {
        if (!osPayload?.gc_os_id) continue;
        const execIds = String(osPayload.gc_os_tarefa_exec || "").split("/").filter(Boolean);
        for (const execId of execIds) {
          if (execId) execLinkEntries.push([execId, osPayload]);
        }
      }
      for (let i = 0; i < execLinkEntries.length; i += PARALLEL_LINK) {
        const slice = execLinkEntries.slice(i, i + PARALLEL_LINK);
        const results = await Promise.all(slice.map(async ([execTaskId, osPayload]: any) => {
          const orcPayload = findOrcForOs(osPayload);
          const updatePayload: any = {
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
            gc_os_link_cobranca: osPayload.gc_os_link_cobranca || null,
            gc_os_tarefa_exec: osPayload.gc_os_tarefa_exec || null,
            gc_os_tarefa_os: osPayload.gc_os_tarefa_os || null,
            os_realizada: true,
            atualizado_em: new Date().toISOString(),
          };
          if (orcPayload?.gc_orcamento_id) {
            applyOrcPayload(updatePayload, orcPayload);
          }
          const { count } = await sbClient
            .from("tarefas_central")
            .update(updatePayload, { count: "exact" })
            .eq("auvo_task_id", execTaskId)
            .is("gc_os_id", null);
          return count || 0;
        }));
        lateLinkExec += results.reduce((s, c) => s + c, 0);
      }
      if (lateLinkExec > 0) {
        console.log(`[central-sync] Late linkage (TAREFA EXECUÇÃO/73344 fallback): ${lateLinkExec} OS vinculadas`);
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
          // Inclui OS com data_tarefa OU data_conclusao dentro do período
          // (Relatórios filtra por data execução; sem isso, OS com execução no mês
          // mas planejada em mês anterior nunca tinham situação atualizada)
          query = query.or(
            `and(data_tarefa.gte.${startDate},data_tarefa.lte.${endDate}),and(data_conclusao.gte.${startDate},data_conclusao.lte.${endDate})`
          );
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
      let pendingIndividualOsLookups = 0;
      if (missingOsIds.length > 0) {
        // Cap individual lookups to avoid IDLE_TIMEOUT (150s). Remaining IDs will be picked up next sync.
        const MAX_INDIVIDUAL = 80;
        const toFetch = missingOsIds.slice(0, MAX_INDIVIDUAL);
        if (missingOsIds.length > MAX_INDIVIDUAL) {
          pendingIndividualOsLookups = missingOsIds.length - MAX_INDIVIDUAL;
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
        (globalThis as any).__centralSyncPending = {
          os_individuais: pendingIndividualOsLookups,
          lookups_auvo: 0,
        };
      }

      let globalOsUpdated = 0;
      const osIdsArray = Array.from(dbOsIds);
      const PARALLEL_REFRESH = 20;
      for (let i = 0; i < osIdsArray.length; i += PARALLEL_REFRESH) {
        const slice = osIdsArray.slice(i, i + PARALLEL_REFRESH);
        const results = await Promise.all(slice.map(async (osId) => {
          const fresh = allGcOsById[osId];
          if (!fresh) return 0;
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
            .eq("gc_os_id", osId);
          return count || 0;
        }));
        globalOsUpdated += results.reduce((s, c) => s + c, 0);
      }

      // Second pass: fill gc_os_tarefa_exec for OS that have it null but GC has it
      let execFilled = 0;
      for (let i = 0; i < osIdsArray.length; i += PARALLEL_REFRESH) {
        const slice = osIdsArray.slice(i, i + PARALLEL_REFRESH);
        const results = await Promise.all(slice.map(async (osId) => {
          const fresh = allGcOsById[osId];
          if (!fresh?.gc_os_tarefa_exec) return 0;
          const { count } = await sbClient
            .from("tarefas_central")
            .update({
              gc_os_tarefa_exec: fresh.gc_os_tarefa_exec,
              atualizado_em: new Date().toISOString(),
            }, { count: "exact" })
            .eq("gc_os_id", osId)
            .is("gc_os_tarefa_exec", null);
          return count || 0;
        }));
        execFilled += results.reduce((s, c) => s + c, 0);
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
      const orcIdsArray = Array.from(dbOrcIds);
      for (let i = 0; i < orcIdsArray.length; i += PARALLEL_REFRESH) {
        const slice = orcIdsArray.slice(i, i + PARALLEL_REFRESH);
        const results = await Promise.all(slice.map(async (orcId) => {
          const fresh = allGcOrcById[orcId];
          if (!fresh) return 0;
          const { count } = await sbClient
            .from("tarefas_central")
            .update({
              gc_orc_situacao: fresh.gc_orc_situacao,
              gc_orc_situacao_id: fresh.gc_orc_situacao_id,
              gc_orc_cor_situacao: fresh.gc_orc_cor_situacao,
              gc_orc_valor_total: fresh.gc_orc_valor_total,
              gc_orc_valor_produtos: fresh.gc_orc_valor_produtos,
              gc_orc_valor_servicos: fresh.gc_orc_valor_servicos,
              gc_orc_vendedor: fresh.gc_orc_vendedor,
              gc_orc_cliente: fresh.gc_orc_cliente,
              atualizado_em: new Date().toISOString(),
            }, { count: "exact" })
            .eq("gc_orcamento_id", orcId);
          return count || 0;
        }));
        globalOrcUpdated += results.reduce((s, c) => s + c, 0);
      }

      console.log(`[central-sync] Atualização global de status: ${globalOsUpdated} OS e ${globalOrcUpdated} orçamentos atualizados no banco`);
    }

    // Step 3: NOW await Auvo (kicked off earlier in parallel with GC refresh)
    console.log(`[central-sync] Aguardando Auvo (iniciado em paralelo): ${startDate} → ${endDate}`);
    const auvoTasks = await auvoTasksPromise;
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
      // Full snapshots are expensive and can make manual report syncs time out.
      // Lite sync persists the list data first and skips detail-only enrichment.
      if (!isLiteSync) candidateTaskIds.push(taskId);
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

    // Pré-hidratação: varre orientações Auvo e busca no GC OS/Orçamentos referenciados
    // que não vieram na listagem (ex.: "OS N° 9224", "Orçamento #5082", "ORÇAMENTO 331").
    {
      const allOsCodes = new Set<string>();
      const allOrcCodes = new Set<string>();
      for (const task of auvoTasks) {
        const taskId = String(task.taskID || "");
        const snap = taskSnapshotById.get(taskId);
        const text = String(snap?.orientation || task.orientation || "");
        if (!text) continue;
        const refs = extractReferencedCodes(text);
        for (const c of refs.osCodigos) if (!gcOsByCodigo[c]) allOsCodes.add(c);
        for (const c of refs.orcCodigos) if (!gcOrcByCodigo[c]) allOrcCodes.add(c);
      }
      if (allOsCodes.size > 0) {
        console.log(`[central-sync] Hidratando ${allOsCodes.size} OS referenciadas em orientações...`);
        await hydrateMissingOsByCodigo(gcH, gcOsResult, [...allOsCodes]);
      }
      if (allOrcCodes.size > 0) {
        console.log(`[central-sync] Hidratando ${allOrcCodes.size} Orçamentos referenciados em orientações...`);
        await hydrateMissingOrcamentosByCodigo(gcH, gcOrcResult, [...allOrcCodes]);
      }
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

      const refs = extractReferencedCodes(orientation);

      // OS por código (loose): "OS N° 9224", "OS 9224", "OS:9224"
      if (!os) {
        for (const code of refs.osCodigos) {
          if (gcOsByCodigo[code]) { os = gcOsByCodigo[code]; break; }
        }
      }

      // Orçamento por código (loose): "Orçamento #5185", "ORÇAMENTO 331", "OR N° 331"
      for (const code of refs.orcCodigos) {
        if (!orc && gcOrcByCodigo[code]) orc = gcOrcByCodigo[code];
        if (!os && gcOsByOrcNumero[code]) os = gcOsByOrcNumero[code];
        if (orc && os) break;
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

      // Cross-link via 73343/73344 ↔ 73341
      // Se temos OS mas não orçamento, procura orçamento usando 73343 OU 73344 da OS.
      if (gcOs && !gcOrc) {
        const found = findOrcForOs(gcOs);
        if (found) gcOrc = found;
      }
      // Se temos orçamento mas não OS, procura OS cuja 73344 (execução) == taskId.
      if (gcOrc && !gcOs) {
        const found = findOsForTaskId(taskId);
        if (found) {
          gcOs = found;
          // E re-tenta orçamento via OS encontrada (caso 73341 aponte pra outra ponta)
          if (!gcOrc) gcOrc = findOrcForOs(gcOs);
        }
      }

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

      // Auvo é fonte de verdade. Array vazio = "ainda não preencheu";
      // não cair em snapshot antigo, isso congela o questionário no banco.
      const questionnairesSource = Array.isArray(task.questionnaires)
        ? task.questionnaires
        : [];
      const targetQ = questionnairesSource.find(
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
      const taskWithDetail = snapshot
        ? {
            ...task,
            duration: snapshot.duration || task.duration,
            durationDecimal: snapshot.durationDecimal ?? task.durationDecimal,
            timeControl: snapshot.timeControl?.length ? snapshot.timeControl : task.timeControl,
            checkInDate: snapshot.checkInDate || task.checkInDate,
            checkOutDate: snapshot.checkOutDate || task.checkOutDate,
            displacementStart: snapshot.displacementStart || task.displacementStart,
            estimatedDuration: snapshot.estimatedDuration || task.estimatedDuration,
          }
        : task;
      // Always prefer snapshot (detail endpoint) - it's more reliable than list
      const snapshotAddr = snapshot?.address && snapshot.address.length > 5 ? snapshot.address : "";
      const resolvedAddress = snapshotAddr || baseAddress;
      const resolvedOrientation = String(snapshot?.orientation || task.orientation || "").substring(0, 500);

      // Resolve checkout date for monthly accounting
      const checkOutDateRawFull = String(task.checkOutDate || task.checkoutDate || snapshot?.checkOutDate || "").trim();
      const checkOutDateRaw = normalizeDate(checkOutDateRawFull);
      // displacementStart: try list endpoint first, then snapshot
      const displacementStartRaw = String(task.displacementStart || task.displacement_start || snapshot?.displacementStart || "").trim();
      // checkInDate: try list endpoint first, then snapshot
      const checkInDateRaw = String(task.checkInDate || task.checkinDate || snapshot?.checkInDate || "").trim();
      const checkInIso = normalizeDateTime(checkInDateRaw);
      const checkOutIso = normalizeDateTime(checkOutDateRawFull);

      // Calculate displacement separately (displacementStart → checkInDate). It must not enter worked hours.
      const duracaoDeslocamento = calculateDisplacementHours(displacementStartRaw, checkInDateRaw) || null;

      const startTimeResolved =
        extractTimeFromDateStr(checkInDateRaw) ||
        String(task.startTime || task.startHour || snapshot?.startTime || "").trim() ||
        extractTimeFromDateStr(String(task.taskDate || ""));

      let endTimeResolved =
        extractTimeFromDateStr(checkOutDateRawFull) ||
        String(task.endTime || task.endHour || snapshot?.endTime || "").trim() ||
        extractTimeFromDateStr(String(task.taskEndDate || task.taskEndDateTime || snapshot?.taskEndDate || ""));

      const workedHoursRaw = computeAuvoWorkedHours(taskWithDetail);
      const estimatedDurationHours = parseDurationToHours(taskWithDetail.estimatedDuration || snapshot?.estimatedDuration || "");
      const durationDecimalResolved = workedHoursRaw > 0 ? workedHoursRaw : estimatedDurationHours;

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
        tecnico: resolveAuvoTechnicianName(task),
        tecnico_id: resolveAuvoTechnicianId(task),
        data_tarefa: normalizeDate(task.taskDate) || gcOs?.gc_os_data || null,
        data_conclusao: checkOutDateRaw || null,
        check_in_iso: checkInIso,
        check_out_iso: checkOutIso,
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
        check_in: !!(task.checkIn || checkInIso),
        check_out: !!(task.checkOut || checkOutIso),
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
        row.gc_orc_valor_produtos = gcOrc.gc_orc_valor_produtos;
        row.gc_orc_valor_servicos = gcOrc.gc_orc_valor_servicos;
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
        row.gc_os_link_cobranca = (gcOs as any).gc_os_link_cobranca || null;
        row.gc_os_tarefa_exec = gcOs.gc_os_tarefa_exec || null;
        row.gc_os_tarefa_os = gcOs.gc_os_tarefa_os || taskId;
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

      // Amarração orçamento: tenta primeiro pelo taskId (73343), depois via 73344 da OS
      const gcOrc = gcOrcMap[taskId] || findOrcForOs(gcOs) || null;
      let fallbackSnapshot = taskSnapshotById.get(taskId) || null;
      if (!fallbackSnapshot && !isLiteSync) {
        fallbackSnapshot = await fetchAuvoTaskSnapshot(bearerToken, taskId);
        if (fallbackSnapshot) taskSnapshotById.set(taskId, fallbackSnapshot);
      }

      // Skip tasks that don't exist in Auvo (deleted/ghost tasks)
      if (!fallbackSnapshot && !isGcSolicitadasOnly && !isLiteSync) {
        console.log(`[central-sync] Ignorando taskId ${taskId} (OS ${gcOs?.gc_os_codigo}): tarefa não encontrada no Auvo (possível fantasma)`);
        continue;
      }

      const fallbackRow: any = {
        auvo_task_id: taskId,
        cliente: gcOs?.gc_os_cliente || gcOrc?.gc_orc_cliente || "Cliente não identificado",
        tecnico: fallbackSnapshot?.technicianName || "",
        tecnico_id: fallbackSnapshot?.technicianId || "",
        data_tarefa: normalizeDate(fallbackSnapshot?.taskDate || fallbackSnapshot?.taskEndDate || fallbackSnapshot?.checkOutDate || fallbackSnapshot?.checkInDate) || gcOs?.gc_os_data || null,
        status_auvo: fallbackSnapshot ? "Sem tarefa Auvo" : "Pendente vínculo Auvo",
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
        gc_os_link_cobranca: (gcOs as any).gc_os_link_cobranca || null,
        gc_os_tarefa_exec: gcOs.gc_os_tarefa_exec || null,
        gc_os_tarefa_os: gcOs.gc_os_tarefa_os || taskId,
      };

      if (gcOrc) {
        fallbackRow.gc_orcamento_id = gcOrc.gc_orcamento_id;
        fallbackRow.gc_orcamento_codigo = gcOrc.gc_orcamento_codigo;
        fallbackRow.gc_orc_cliente = gcOrc.gc_orc_cliente;
        fallbackRow.gc_orc_situacao = gcOrc.gc_orc_situacao;
        fallbackRow.gc_orc_situacao_id = gcOrc.gc_orc_situacao_id;
        fallbackRow.gc_orc_cor_situacao = gcOrc.gc_orc_cor_situacao;
        fallbackRow.gc_orc_valor_total = gcOrc.gc_orc_valor_total;
        fallbackRow.gc_orc_valor_produtos = gcOrc.gc_orc_valor_produtos;
        fallbackRow.gc_orc_valor_servicos = gcOrc.gc_orc_valor_servicos;
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

    if (!isLiteSync && rowsMissingAddress?.length) {
      const patchIds = rowsMissingAddress
        .map((r) => String((r as any).auvo_task_id || "").trim())
        .filter((id) => id && !existingTaskIdsInDb.has(id));

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

      // Não preservar OS antiga quando a sync atual não encontrou 73343 para esta tarefa.
      // Isso evita ressuscitar vínculo contaminado pelo 73344 (TAREFA EXECUÇÃO).
      if (row.gc_os_id && (row.gc_os_valor_total === null || row.gc_os_valor_total === undefined) && existing.gc_os_valor_total !== null) {
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
      const tecnico = resolveAuvoTechnicianName(task);
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

    // Mirror Auvo: remover tarefas do período que não voltaram mais do Auvo
    // Só executa se o Auvo respondeu (length > 0) e somente apaga linhas SEM vínculo GC
    // (gc_os_id e gc_orcamento_id nulos) — GC-only nunca é removida por este passo.
    let ghostsDeleted = 0;
    try {
      if (auvoTasks.length > 0) {
        const auvoIdSet = new Set(auvoTasks.map((t: any) => String(t?.taskID ?? t?.taskId ?? t?.id ?? "")).filter(Boolean));

        // Carrega rows do período (Auvo-only) para comparar
        const periodRows: { mirror_key: string; auvo_task_id: string }[] = [];
        for (let from = 0; ; from += 1000) {
          const { data: chunk, error: chunkErr } = await sbClient
            .from("tarefas_central")
            .select("mirror_key, auvo_task_id, gc_os_id, gc_orcamento_id")
            .gte("data_tarefa", startDate)
            .lte("data_tarefa", endDate)
            .range(from, from + 999);
          if (chunkErr || !chunk || chunk.length === 0) break;
          for (const row of chunk as any[]) {
            if (!row?.auvo_task_id) continue;
            if (row.gc_os_id || row.gc_orcamento_id) continue; // preserva qualquer linha com vínculo GC
            if (!auvoIdSet.has(String(row.auvo_task_id))) {
              periodRows.push({ mirror_key: String(row.mirror_key), auvo_task_id: String(row.auvo_task_id) });
            }
          }
          if (chunk.length < 1000) break;
        }

        // Apaga em batches por mirror_key
        for (let i = 0; i < periodRows.length; i += 200) {
          const batchKeys = periodRows.slice(i, i + 200).map((r) => r.mirror_key);
          const { count: delCount, error: delErr } = await sbClient
            .from("tarefas_central")
            .delete({ count: "exact" })
            .in("mirror_key", batchKeys);
          if (delErr) {
            console.warn(`[central-sync] mirror-delete erro:`, delErr.message);
          } else {
            ghostsDeleted += delCount || 0;
          }
        }
        if (ghostsDeleted > 0) {
          console.log(`[central-sync] Mirror Auvo: removidas ${ghostsDeleted} tarefas Auvo-only que não existem mais (período ${startDate}..${endDate})`);
        }
      } else {
        console.warn(`[central-sync] Mirror Auvo pulado: Auvo retornou 0 tarefas (não vamos apagar nada por segurança)`);
      }
    } catch (mirrorErr) {
      console.warn(`[central-sync] Mirror Auvo falhou:`, (mirrorErr as Error).message);
    }

    const pending = (globalThis as any).__centralSyncPending || { os_individuais: 0, lookups_auvo: 0 };
    console.log(`[central-sync] Pendentes para próximo ciclo: OS individuais=${pending.os_individuais}, lookups Auvo=${pending.lookups_auvo}`);
    (globalThis as any).__centralSyncPending = { os_individuais: 0, lookups_auvo: 0 };

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
      ghosts_deleted: ghostsDeleted,
    };

}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.wait === true || body?.fast === true || body?.lite === true) {
      const result = await runCentralSync(body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const backgroundSync = runCentralSync(body).catch((err) => {
      console.error("[central-sync] Background error:", err);
    });

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(backgroundSync);
    } else {
      setTimeout(() => backgroundSync, 0);
    }

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
