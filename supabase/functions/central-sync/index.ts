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
};

async function fetchAuvoTaskSnapshot(bearerToken: string, taskId: string): Promise<AuvoTaskSnapshot | null> {
  const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
  const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
  if (!response.ok) return null;

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

  if (!address && !orientation) return null;
  return { address, orientation };
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

    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
    
    if (response.status === 404) {
      console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: 404 (fim)`);
      break;
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[central-sync] Auvo ${startDate}→${endDate} page ${page} error ${response.status}: ${text.substring(0, 200)}`);
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
async function fetchGcOrcamentos(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
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
      const attrTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_ORC;
      });
      if (attrTarefa) {
        const nested = attrTarefa?.atributo || attrTarefa;
        const taskId = String(nested?.conteudo || nested?.valor || "").trim();
        if (taskId && /^\d+$/.test(taskId)) {
          map[taskId] = {
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
        }
      }
    }

    console.log(`[central-sync] GC orçamentos page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  return map;
}

// Fetch ALL GC OS (no date filter)
async function fetchGcOs(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
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
      const attrTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_OS;
      });
      if (attrTarefa) {
        const nested = attrTarefa?.atributo || attrTarefa;
        const taskId = String(nested?.conteudo || nested?.valor || "").trim();
        if (taskId && /^\d+$/.test(taskId)) {
          map[taskId] = {
            gc_os_id: String(os.id),
            gc_os_codigo: String(os.codigo || ""),
            gc_os_cliente: String(os.nome_cliente || ""),
            gc_os_situacao: String(os.nome_situacao || ""),
            gc_os_situacao_id: String(os.situacao_id || ""),
            gc_os_cor_situacao: String(os.cor_situacao || ""),
            gc_os_valor_total: parseFloat(os.valor_total || "0"),
            gc_os_vendedor: String(os.nome_vendedor || ""),
            gc_os_data: String(os.data_entrada || os.data || "").split("T")[0] || null,
            gc_os_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          };
        }
      }
    }

    console.log(`[central-sync] GC OS page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbClient = createClient(supabaseUrl, supabaseKey);

    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

    if (!auvoApiKey || !auvoApiToken || !gcAccessToken || !gcSecretToken) {
      return new Response(JSON.stringify({ error: "Credenciais não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate period (request body overrides default 6-month + future window)
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + FUTURE_DAYS_WINDOW);

    const body = await req.json().catch(() => ({}));
    const bodyStart = normalizeDate(body?.start_date);
    const bodyEnd = normalizeDate(body?.end_date);

    const startDate = bodyStart || sixMonthsAgo.toISOString().split("T")[0];
    const endDate = bodyEnd || futureDate.toISOString().split("T")[0];
    const cleanupCutoff = sixMonthsAgo.toISOString().split("T")[0];

    console.log(`[central-sync] Período: ${startDate} a ${endDate} (limpeza < ${cleanupCutoff})`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Fetch all data in parallel
    const [auvoTasks, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasks(bearerToken, startDate, endDate),
      fetchGcOrcamentos(gcH),
      fetchGcOs(gcH),
    ]);

    console.log(`[central-sync] Auvo: ${auvoTasks.length} tarefas, GC Orç: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

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

    // Enrich ALL OS-linked tasks with direct Auvo task detail (list endpoint is unreliable for addresses)
    const taskSnapshotById = new Map<string, AuvoTaskSnapshot>();
    const candidateTaskIds: string[] = [];
    const seenCandidates = new Set<string>();

    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "").trim();
      if (!taskId || !gcOsMap[taskId] || seenCandidates.has(taskId)) continue;
      candidateTaskIds.push(taskId);
      seenCandidates.add(taskId);
    }

    if (candidateTaskIds.length > 0) {
      console.log(`[central-sync] Buscando endereço via Auvo detalhe para TODAS ${candidateTaskIds.length} OS (paralelo 10)...`);
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
      console.log(`[central-sync] Endereços obtidos: ${taskSnapshotById.size}/${candidateTaskIds.length}`);
    }

    // Build rows for upsert
    const rows: any[] = [];
    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "");
      if (!taskId) continue;

      const gcOrc = gcOrcMap[taskId] || null;
      const gcOs = gcOsMap[taskId] || null;

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
      const checkOutDateRaw = normalizeDate(task.checkOutDate || task.checkoutDate);
      // displacementStart is a datetime string from Auvo
      const displacementStartRaw = String(task.displacementStart || "").trim();

      // Calculate displacement duration (displacementStart → checkInDate) in decimal hours
      let duracaoDeslocamento: number | null = null;
      if (displacementStartRaw && task.checkInDate) {
        const dStart = new Date(displacementStartRaw);
        const dEnd = new Date(String(task.checkInDate));
        if (!isNaN(dStart.getTime()) && !isNaN(dEnd.getTime())) {
          const diffMs = dEnd.getTime() - dStart.getTime();
          if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) { // sanity: < 24h
            duracaoDeslocamento = Math.round((diffMs / 3600000) * 100) / 100;
          }
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
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        orientacao: resolvedOrientation,
        pendencia: String(task.pendency ?? "").trim(),
        descricao: resolveTaskType(task),
        duracao_decimal: parseFloat(task.durationDecimal || "0") || 0,
        hora_inicio: String(task.startTime || task.startHour || ""),
        hora_fim: String(task.endTime || task.endHour || ""),
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
        row.gc_os_link = gcOs.gc_os_link;
      }

      rows.push(row);
    }

    // Fallback: include only NEW GC OS tasks not returned by current Auvo window
    // (prevents overwriting existing rows when sync window is narrow)
    const existingTaskIds = new Set(rows.map((r) => String(r.auvo_task_id)));
    for (const [taskId, gcOs] of Object.entries(gcOsMap)) {
      if (existingTaskIds.has(taskId) || existingTaskIdsInDb.has(taskId)) continue;
      const osDate = normalizeDate(gcOs?.gc_os_data);
      if (!osDate || osDate < startDate || osDate > endDate) continue;

      const gcOrc = gcOrcMap[taskId] || null;
      let fallbackSnapshot = taskSnapshotById.get(taskId) || null;
      if (!fallbackSnapshot) {
        fallbackSnapshot = await fetchAuvoTaskSnapshot(bearerToken, taskId);
        if (fallbackSnapshot) taskSnapshotById.set(taskId, fallbackSnapshot);
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
        gc_os_link: gcOs.gc_os_link,
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

    // Upsert in batches of 100
    let upserted = 0;
    let errors = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sbClient
        .from("tarefas_central")
        .upsert(batch, { onConflict: "auvo_task_id", ignoreDuplicates: false });
      
      if (error) {
        console.error(`[central-sync] Batch ${i}-${i + batch.length} error:`, error.message);
        errors++;
      } else {
        upserted += batch.length;
      }
    }

    // Clean up tasks older than 6 months
    const { count: deleted } = await sbClient
      .from("tarefas_central")
      .delete({ count: "exact" })
      .lt("data_tarefa", cleanupCutoff);

    console.log(`[central-sync] Concluído: ${upserted} upserted, ${errors} erros, ${deleted || 0} removidos (> 6 meses)`);

    return new Response(JSON.stringify({
      success: true,
      periodo: { inicio: startDate, fim: endDate },
      auvo_tarefas: auvoTasks.length,
      gc_orcamentos: Object.keys(gcOrcMap).length,
      gc_os: Object.keys(gcOsMap).length,
      upserted,
      errors,
      deleted: deleted || 0,
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
