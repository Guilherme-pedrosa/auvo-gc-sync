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
const AUVO_SAFE_START = "2020-01-01";
const AUVO_SAFE_END = "2030-12-31";
const MIN_DELAY_MS = 200;
const AUVO_TASKS_TIMEOUT_MS = 30_000;
let lastAuvoCall = 0;
let lastGcCall = 0;

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

type AuvoFetchResult = {
  tasks: any[];
  hadError: boolean;
  errorMessage: string | null;
};

type EquipmentPair = { nome: string | null; id: string | null };

const INVALID_EQUIPMENT_VALUES = new Set([
  "",
  ".",
  "-",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "sem equipamento",
  "sem identificacao",
  "sem identificação",
  "nao informado",
  "não informado",
]);

function sanitizeEquipmentValue(value: unknown): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  const comparable = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (INVALID_EQUIPMENT_VALUES.has(comparable)) return null;
  return normalized;
}

function inDateRange(dateValue: string | undefined, startDate: string, endDate: string): boolean {
  const dateOnly = String(dateValue || "").split("T")[0];
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return true;
  return dateOnly >= startDate && dateOnly <= endDate;
}

function extractEquipmentIds(entity: any): string[] {
  const rawSources = [
    entity?.equipmentsId,
    entity?.equipmentsID,
    entity?.equipmentIds,
    entity?.equipmentId,
    entity?.equipmentID,
  ];

  const ids: string[] = [];

  for (const source of rawSources) {
    if (Array.isArray(source)) {
      for (const value of source) {
        if (value === null || value === undefined) continue;
        if (typeof value === "object") {
          const nested = String((value as any).id || (value as any).equipmentId || "").trim();
          if (nested) ids.push(nested);
        } else {
          const scalar = String(value).trim();
          if (scalar) ids.push(scalar);
        }
      }
    } else if (source !== null && source !== undefined) {
      const scalar = String(source).trim();
      if (scalar) ids.push(scalar);
    }
  }

  return [...new Set(ids)];
}

function extractEquipmentFromEntity(entity: any): EquipmentPair & { equipmentIds: string[] } {
  if (!entity || typeof entity !== "object") {
    return { nome: null, id: null, equipmentIds: [] };
  }

  let nome = sanitizeEquipmentValue(
    entity?.equipmentName ||
    entity?.equipment?.name ||
    entity?.equipment?.model ||
    entity?.name ||
    null
  );

  let id = sanitizeEquipmentValue(
    entity?.equipmentIdentifier ||
    entity?.equipment?.identifier ||
    entity?.equipment?.serial ||
    entity?.identifier ||
    null
  );

  if ((!nome || !id) && Array.isArray(entity?.equipments) && entity.equipments.length > 0) {
    const first = entity.equipments[0];
    if (!nome) nome = sanitizeEquipmentValue(first?.name || first?.model || null);
    if (!id) id = sanitizeEquipmentValue(first?.identifier || first?.serial || null);
  }

  return {
    nome,
    id,
    equipmentIds: extractEquipmentIds(entity),
  };
}

async function loadPersistedEquipmentMap(sbClient: any, taskIds: string[]) {
  const uniqueTaskIds = [...new Set(taskIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const map: Record<string, { equipamento_nome: string | null; equipamento_id_serie: string | null }> = {};

  for (let i = 0; i < uniqueTaskIds.length; i += 200) {
    const batch = uniqueTaskIds.slice(i, i + 200);
    const { data, error } = await sbClient
      .from("tarefas_central")
      .select("auvo_task_id, equipamento_nome, equipamento_id_serie")
      .in("auvo_task_id", batch);

    if (error) {
      console.warn("[budget-kanban] Erro ao carregar equipamentos persistidos:", error.message);
      continue;
    }

    for (const row of data || []) {
      const taskId = String(row.auvo_task_id || "").trim();
      if (!taskId) continue;
      map[taskId] = {
        equipamento_nome: row.equipamento_nome || null,
        equipamento_id_serie: row.equipamento_id_serie || null,
      };
    }
  }

  return map;
}

async function fetchAuvoTaskForEquipment(bearerToken: string, taskId: string): Promise<any | null> {
  const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
  const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
  if (!response.ok) return null;
  const json = await response.json().catch(() => ({}));
  return json?.result || json || null;
}

async function fetchAuvoEquipmentById(bearerToken: string, equipmentId: string): Promise<any | null> {
  const normalizedId = String(equipmentId || "").trim();
  if (!normalizedId) return null;

  const url = `${AUVO_BASE_URL}/equipments/${encodeURIComponent(normalizedId)}`;
  const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
  if (!response.ok) return null;

  const json = await response.json().catch(() => ({}));
  return json?.result || json || null;
}

async function resolveAndPersistMissingEquipment(
  sbClient: any,
  bearerToken: string,
  items: any[],
  taskById: Record<string, any>,
) {
  const unresolved = items.filter((item) =>
    !sanitizeEquipmentValue(item.equipamento_nome) || !sanitizeEquipmentValue(item.equipamento_id_serie)
  );

  if (unresolved.length === 0) return;

  console.log(`[budget-kanban] Resolvendo equipamento para ${unresolved.length} cards durante sync...`);

  const equipmentCache: Record<string, EquipmentPair> = {};
  const taskDetailCache: Record<string, any | null> = {};
  const unresolvedByTaskId = new Map<string, any>(
    unresolved.map((item) => [String(item.auvo_task_id || "").trim(), item])
  );
  const rowsToPersist: {
    auvo_task_id: string;
    equipamento_nome: string | null;
    equipamento_id_serie: string | null;
    atualizado_em: string;
  }[] = [];

  const PARALLEL = 8;
  for (let i = 0; i < unresolved.length; i += PARALLEL) {
    const batch = unresolved.slice(i, i + PARALLEL);

    const resolvedBatch = await Promise.all(
      batch.map(async (item) => {
        const taskId = String(item.auvo_task_id || "").trim();
        if (!taskId) return null;

        let nome = sanitizeEquipmentValue(item.equipamento_nome);
        let id = sanitizeEquipmentValue(item.equipamento_id_serie);
        let equipmentIds: string[] = [];

        const sourceTask = taskById[taskId];
        if (sourceTask) {
          const extracted = extractEquipmentFromEntity(sourceTask);
          if (!nome) nome = extracted.nome;
          if (!id) id = extracted.id;
          equipmentIds = extracted.equipmentIds;
        }

        if ((!nome || !id) && (!sourceTask || equipmentIds.length === 0)) {
          if (!(taskId in taskDetailCache)) {
            taskDetailCache[taskId] = await fetchAuvoTaskForEquipment(bearerToken, taskId);
          }

          const taskDetail = taskDetailCache[taskId];
          if (taskDetail) {
            const extracted = extractEquipmentFromEntity(taskDetail);
            if (!nome) nome = extracted.nome;
            if (!id) id = extracted.id;
            if (equipmentIds.length === 0) equipmentIds = extracted.equipmentIds;
          }
        }

        if ((!nome || !id) && equipmentIds.length > 0) {
          for (const equipmentId of equipmentIds) {
            if (!equipmentCache[equipmentId]) {
              const equipmentData = await fetchAuvoEquipmentById(bearerToken, equipmentId);
              const extractedEquipment = extractEquipmentFromEntity(equipmentData || {});
              equipmentCache[equipmentId] = {
                nome: extractedEquipment.nome,
                id: extractedEquipment.id,
              };
            }

            const cachedEquipment = equipmentCache[equipmentId];
            if (!nome) nome = sanitizeEquipmentValue(cachedEquipment?.nome);
            if (!id) id = sanitizeEquipmentValue(cachedEquipment?.id);
            if (nome && id) break;
          }
        }

        nome = sanitizeEquipmentValue(nome);
        id = sanitizeEquipmentValue(id);
        if (!nome && !id) return null;

        return { taskId, nome, id };
      })
    );

    for (const resolved of resolvedBatch) {
      if (!resolved) continue;

      const item = unresolvedByTaskId.get(resolved.taskId);
      if (!item) continue;

      const prevNome = sanitizeEquipmentValue(item.equipamento_nome);
      const prevId = sanitizeEquipmentValue(item.equipamento_id_serie);

      if (!prevNome && resolved.nome) item.equipamento_nome = resolved.nome;
      if (!prevId && resolved.id) item.equipamento_id_serie = resolved.id;

      const changedNome = !!resolved.nome && resolved.nome !== prevNome;
      const changedId = !!resolved.id && resolved.id !== prevId;
      if (changedNome || changedId) {
        rowsToPersist.push({
          auvo_task_id: resolved.taskId,
          equipamento_nome: resolved.nome || prevNome || null,
          equipamento_id_serie: resolved.id || prevId || null,
          atualizado_em: new Date().toISOString(),
        });
      }
    }
  }

  if (rowsToPersist.length === 0) {
    console.log("[budget-kanban] Nenhum novo equipamento resolvido no sync.");
    return;
  }

  for (let i = 0; i < rowsToPersist.length; i += 100) {
    const batch = rowsToPersist.slice(i, i + 100);
    const { error } = await sbClient
      .from("tarefas_central")
      .upsert(batch, { onConflict: "auvo_task_id" });

    if (error) {
      console.warn("[budget-kanban] Falha ao persistir equipamentos na central:", error.message);
    }
  }

  console.log(`[budget-kanban] Equipamentos resolvidos e persistidos no sync: ${rowsToPersist.length}`);
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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auvo login failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchAuvoTasksWithQuestionnaire(
  bearerToken: string,
  startDate: string,
  endDate: string
): Promise<AuvoFetchResult> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 50;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };
  let hadError = false;
  let errorMessage: string | null = null;

  console.log(`[budget-kanban] Auvo paramFilter: ${JSON.stringify(filterObj)}`);

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    console.log(`[budget-kanban] Auvo page ${page}`);
    let response: Response;
    try {
      const now = Date.now();
      const elapsed = now - lastAuvoCall;
      if (elapsed < MIN_DELAY_MS) await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
      lastAuvoCall = Date.now();
      response = await fetchWithTimeout(url, { headers: auvoHeaders(bearerToken) }, AUVO_TASKS_TIMEOUT_MS);
    } catch (err) {
      hadError = true;
      errorMessage = `Auvo /tasks timeout ou conexão cancelada na página ${page}`;
      console.error(`[budget-kanban] ${errorMessage}:`, err);
      break;
    }

    if (response.status === 404) break;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      hadError = true;
      errorMessage = `Auvo /tasks erro ${response.status}: ${errBody.substring(0, 300)}`;
      console.error(`[budget-kanban] ${errorMessage}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];

    for (const task of entities) {
      const questionnaires = task.questionnaires || [];
      const hasTarget = questionnaires.some((q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID);
      if (hasTarget) allTasks.push(task);
    }

    const totalItems = Number(data?.result?.pagedSearchReturnData?.totalItems || 0);
    console.log(`[budget-kanban] Page ${page}: ${entities.length} tasks, ${allTasks.length} com questionário ${QUESTIONNAIRE_ID}`);
    if (entities.length < pageSize || (totalItems > 0 && page * pageSize >= totalItems)) break;
    page++;
  }

  if (allTasks.length > 0) {
    const sample = allTasks[0];
    console.log(`[budget-kanban] Sample task fields: taskID=${sample.taskID}, customerDescription=${sample.customerDescription}, customerName=${sample.customerName}, customerId=${sample.customerId}, externalId=${sample.externalId}`);
  }

  return { tasks: allTasks, hadError, errorMessage };
}

// Fetch GC orçamentos and build a map of taskID -> orçamento data
async function fetchGcOrcamentosMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string
): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  const MAX_PAGES = 30;
  const CONCURRENCY = 5;

  const fetchPage = async (page: number): Promise<{ records: any[]; totalPages: number } | null> => {
    let url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    if (startDate) url += `&data_inicio=${startDate}`;
    if (endDate) url += `&data_fim=${endDate}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!response.ok) {
        console.error(`[budget-kanban] GC orcamentos page ${page} error: ${response.status}`);
        return null;
      }
      const data = await response.json();
      return {
        records: Array.isArray(data?.data) ? data.data : [],
        totalPages: data?.meta?.total_paginas || 1,
      };
    }
    return null;
  };

  const ingest = (records: any[]) => {
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
            gc_cliente: String(orc.nome_cliente || ""),
            gc_situacao: String(orc.nome_situacao || ""),
            gc_situacao_id: String(orc.situacao_id || ""),
            gc_cor_situacao: String(orc.cor_situacao || ""),
            gc_valor_total: String(orc.valor_total || "0"),
            gc_vendedor: String(orc.nome_vendedor || ""),
            gc_data: String(orc.data || ""),
            gc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
          };
        }
      }
    }
  };

  // Fetch page 1 to discover totalPages
  const first = await fetchPage(1);
  if (!first) return map;
  ingest(first.records);
  const totalPages = Math.min(first.totalPages, MAX_PAGES);
  console.log(`[budget-kanban] GC orçamentos: ${totalPages} páginas (paralelo x${CONCURRENCY})`);

  // Fetch remaining pages in parallel batches
  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const batch: number[] = [];
    for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(p);
    const results = await Promise.all(batch.map(fetchPage));
    for (const r of results) if (r) ingest(r.records);
  }
  console.log(`[budget-kanban] GC orçamentos done: ${Object.keys(map).length} com tarefa`);
  return map;
}

// Fetch GC ordens de serviço and build a map of taskID -> OS data
async function fetchGcOsMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string
): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  const MAX_PAGES = 30;
  const CONCURRENCY = 5;

  const fetchPage = async (page: number): Promise<{ records: any[]; totalPages: number } | null> => {
    let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    if (startDate) url += `&data_inicio=${startDate}`;
    if (endDate) url += `&data_fim=${endDate}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!response.ok) {
        console.error(`[budget-kanban] GC OS page ${page} error: ${response.status}`);
        return null;
      }
      const data = await response.json();
      return {
        records: Array.isArray(data?.data) ? data.data : [],
        totalPages: data?.meta?.total_paginas || 1,
      };
    }
    return null;
  };

  const ingest = (records: any[]) => {
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
            gc_cliente: String(os.nome_cliente || ""),
            gc_situacao: String(os.nome_situacao || ""),
            gc_situacao_id: String(os.situacao_id || ""),
            gc_cor_situacao: String(os.cor_situacao || ""),
            gc_valor_total: String(os.valor_total || "0"),
            gc_vendedor: String(os.nome_vendedor || ""),
            gc_data: String(os.data || ""),
            gc_data_saida: String(os.data_saida || ""),
            gc_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          };
        }
      }
    }
  };

  const first = await fetchPage(1);
  if (!first) return map;
  ingest(first.records);
  const totalPages = Math.min(first.totalPages, MAX_PAGES);
  console.log(`[budget-kanban] GC OS: ${totalPages} páginas (paralelo x${CONCURRENCY})`);

  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const batch: number[] = [];
    for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(p);
    const results = await Promise.all(batch.map(fetchPage));
    for (const r of results) if (r) ingest(r.records);
  }
  console.log(`[budget-kanban] GC OS done: ${Object.keys(map).length} com tarefa`);
  return map;
}

function hasFilledQuestionnaireAnswers(item: any): boolean {
  const answers = Array.isArray(item?.questionario_respostas) ? item.questionario_respostas : [];
  return answers.some((answer: any) => {
    const reply = String(answer?.reply ?? answer?.resposta ?? answer?.answer ?? "").trim();
    return reply !== "" && !reply.startsWith("http");
  });
}

function budgetColumnForItem(item: any): string {
  if (item.os_realizada) return "os_realizada";
  if (item.orcamento_realizado) {
    const situacao = String(item.gc_orcamento?.gc_situacao || "sem_situacao").trim() || "sem_situacao";
    return `orc_${situacao.replace(/\s+/g, "_").toLowerCase()}`;
  }
  if (!hasFilledQuestionnaireAnswers(item)) return "falta_preenchimento";
  return "a_fazer";
}

function buildBudgetItemFromCentral(row: any) {
  const taskId = String(row.auvo_task_id || "").trim();
  const questionarioRespostas = Array.isArray(row.questionario_respostas) ? row.questionario_respostas : [];
  const hasOrcamento = Boolean(row.orcamento_realizado || row.gc_orcamento_id || row.gc_orcamento_codigo);
  const hasOs = Boolean(row.os_realizada || row.gc_os_id || row.gc_os_codigo);

  return {
    auvo_task_id: taskId,
    auvo_link: String(row.auvo_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`),
    auvo_task_url: String(row.auvo_task_url || row.auvo_link || ""),
    auvo_survey_url: String(row.auvo_survey_url || ""),
    cliente: String(row.cliente || row.gc_orc_cliente || row.gc_os_cliente || ""),
    tecnico: String(row.tecnico || ""),
    data_tarefa: String(row.data_tarefa || "").split("T")[0],
    orientacao: String(row.orientacao || row.descricao || ""),
    status_auvo: String(row.status_auvo || ""),
    questionario_respostas: questionarioRespostas,
    orcamento_realizado: hasOrcamento,
    os_realizada: hasOs,
    gc_orcamento: hasOrcamento ? {
      gc_orcamento_id: String(row.gc_orcamento_id || ""),
      gc_orcamento_codigo: String(row.gc_orcamento_codigo || ""),
      gc_cliente: String(row.gc_orc_cliente || row.cliente || ""),
      gc_situacao: String(row.gc_orc_situacao || ""),
      gc_situacao_id: String(row.gc_orc_situacao_id || ""),
      gc_cor_situacao: String(row.gc_orc_cor_situacao || ""),
      gc_valor_total: String(row.gc_orc_valor_total || "0"),
      gc_vendedor: String(row.gc_orc_vendedor || ""),
      gc_data: String(row.gc_orc_data || ""),
      gc_link: String(row.gc_orc_link || (row.gc_orcamento_id ? `https://gestaoclick.com/orcamentos_servicos/editar/${row.gc_orcamento_id}?retorno=%2Forcamentos_servicos` : "")),
    } : null,
    gc_os: hasOs ? {
      gc_os_id: String(row.gc_os_id || ""),
      gc_os_codigo: String(row.gc_os_codigo || ""),
      gc_cliente: String(row.gc_os_cliente || row.cliente || ""),
      gc_situacao: String(row.gc_os_situacao || ""),
      gc_situacao_id: String(row.gc_os_situacao_id || ""),
      gc_cor_situacao: String(row.gc_os_cor_situacao || ""),
      gc_valor_total: String(row.gc_os_valor_total || "0"),
      gc_vendedor: String(row.gc_os_vendedor || ""),
      gc_data: String(row.gc_os_data || ""),
      gc_link: String(row.gc_os_link || (row.gc_os_id ? `https://gestaoclick.com/ordens_servicos/editar/${row.gc_os_id}?retorno=%2Fordens_servicos` : "")),
    } : null,
    equipamento_nome: row.equipamento_nome || null,
    equipamento_id_serie: row.equipamento_id_serie || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbClient = createClient(supabaseUrl, supabaseKey);

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const mode = body.mode || "cache"; // "cache" = read DB, "sync" = fetch APIs + update DB
    const today = new Date().toISOString().split("T")[0];
    const startDate = body.start_date || "2026-01-01";
    const endDate = body.end_date || today;

    // === MODE: CACHE — read from DB ===
    if (mode === "cache") {
      const [{ data: cached }, { data: meta }, { data: colMeta }] = await Promise.all([
        sbClient.from("kanban_orcamentos_cache").select("*").order("coluna").order("posicao"),
        sbClient.from("kanban_sync_meta").select("*").eq("id", "default").single(),
        sbClient.from("kanban_sync_meta").select("*").eq("id", "custom_columns").single(),
      ]);

      let customColumns: { id: string; title: string; order: number }[] = [];
      try {
        if (colMeta?.periodo_inicio) customColumns = JSON.parse(colMeta.periodo_inicio);
      } catch {}

      const items = (cached || []).map((row: any) => ({
        ...row.dados,
        _coluna: row.coluna,
        _posicao: row.posicao,
      }));

      const filteredItems = items.filter((item: any) =>
        inDateRange(item.data_tarefa, startDate, endDate)
      );

      const persistedEquipmentMap = await loadPersistedEquipmentMap(
        sbClient,
        filteredItems.map((item: any) => String(item.auvo_task_id || ""))
      );

      const enrichedItems = filteredItems.map((item: any) => {
        const persisted = persistedEquipmentMap[String(item.auvo_task_id || "")];
        if (!persisted) return item;

        return {
          ...item,
          equipamento_nome: item.equipamento_nome || persisted.equipamento_nome || null,
          equipamento_id_serie: item.equipamento_id_serie || persisted.equipamento_id_serie || null,
        };
      });

      const resumo = {
        periodo: { inicio: startDate, fim: endDate },
        total_tarefas_com_questionario: enrichedItems.length,
        orcamentos_realizados: enrichedItems.filter((i: any) => i.orcamento_realizado).length,
        os_realizadas: enrichedItems.filter((i: any) => i.os_realizada).length,
        pendentes: enrichedItems.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
      };

      return new Response(JSON.stringify({
        resumo,
        items: enrichedItems,
        ultimo_sync: meta?.ultimo_sync || null,
        custom_columns: customColumns,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SAVE_POSITIONS — persist column/position changes from drag-drop ===
    if (mode === "save_positions") {
      const positions: { auvo_task_id: string; coluna: string; posicao: number }[] = body.positions || [];
      const customColumns: { id: string; title: string; order: number }[] = body.custom_columns || [];

      if (positions.length > 0) {
        for (let i = 0; i < positions.length; i += 50) {
          const batch = positions.slice(i, i + 50).map((p) => ({
            auvo_task_id: p.auvo_task_id,
            coluna: p.coluna,
            posicao: p.posicao,
            atualizado_em: new Date().toISOString(),
          }));
          await sbClient
            .from("kanban_orcamentos_cache")
            .upsert(batch, { onConflict: "auvo_task_id", ignoreDuplicates: false });
        }
      }

      // Save custom column metadata if provided
      if (customColumns.length > 0) {
        await sbClient
          .from("kanban_sync_meta")
          .upsert({ id: "custom_columns", periodo_inicio: JSON.stringify(customColumns) });
      }

      return new Response(JSON.stringify({ ok: true, saved: positions.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SYNC — fetch APIs, update cache ===
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

    if (!auvoApiKey || !auvoApiToken) {
      return new Response(JSON.stringify({ error: "Credenciais Auvo não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!gcAccessToken || !gcSecretToken) {
      return new Response(JSON.stringify({ error: "Credenciais GC não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // startDate/endDate already declared above


    console.log(`[budget-kanban] Período: ${startDate} a ${endDate}`);

    const backgroundSync = (async () => {
      const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
      await runBudgetKanbanSync({
        sbClient,
        bearerToken,
        gcAccessToken,
        gcSecretToken,
        startDate,
        endDate,
      });
    })().catch((err) => {
      console.error("[budget-kanban] Background error:", err);
    });

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(backgroundSync);
    } else {
      setTimeout(() => backgroundSync, 0);
    }

    return new Response(JSON.stringify({ ok: true, background: true, periodo: { inicio: startDate, fim: endDate } }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[budget-kanban] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================================
// Heavy sync routine — extracted so it can run as a background task
// ============================================================================
async function runBudgetKanbanSync(opts: {
  sbClient: any;
  bearerToken: string;
  gcAccessToken: string;
  gcSecretToken: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  const { sbClient, bearerToken, gcAccessToken, gcSecretToken, startDate, endDate } = opts;

  const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Load conciliation snapshot for customer name mapping

    const auvoTaskClienteMap: Record<string, string> = {};
    try {
      const { data: snapshotRows } = await sbClient
        .from("auvo_gc_sync_log")
        .select("detalhes")
        .eq("observacao", "CONCILIACAO_SNAPSHOT")
        .order("executado_em", { ascending: false })
        .limit(1);

      const detalhes = snapshotRows?.[0]?.detalhes as any;
      const itens: any[] = Array.isArray(detalhes?.itens) ? detalhes.itens : (Array.isArray(detalhes) ? detalhes : []);
      for (const item of itens) {
        const tid = String(item.auvo_task_id || "").trim();
        const nome = String(item.auvo_cliente || item.gc_cliente || "").trim();
        if (tid && nome) auvoTaskClienteMap[tid] = nome;
      }
      console.log(`[budget-kanban] Snapshot: ${Object.keys(auvoTaskClienteMap).length} task→cliente mappings`);
    } catch (err) {
      console.warn(`[budget-kanban] Erro ao carregar snapshot:`, err);
    }

    // Primeiro usa a tabela central já sincronizada: ela é mais rápida e já contém os vínculos GC.
    const { data: centralRows, error: centralError } = await sbClient
      .from("tarefas_central")
      .select("*")
      .gte("data_tarefa", startDate)
      .lte("data_tarefa", endDate)
      .eq("questionario_id", QUESTIONNAIRE_ID);

    if (centralError) {
      console.warn("[budget-kanban] Erro ao ler tarefas_central, usando APIs externas:", centralError.message);
    } else if ((centralRows || []).length > 0) {
      console.log(`[budget-kanban] Central encontrada: ${(centralRows || []).length} tarefas com questionário ${QUESTIONNAIRE_ID}`);

      const { data: existingCache } = await sbClient
        .from("kanban_orcamentos_cache")
        .select("auvo_task_id, coluna, posicao, dados");

      const existingMap: Record<string, { coluna: string; posicao: number; dados: any }> = {};
      for (const row of existingCache || []) {
        existingMap[row.auvo_task_id] = { coluna: row.coluna, posicao: row.posicao, dados: row.dados };
      }

      const now = new Date().toISOString();
      let movedCount = 0;
      let keptCount = 0;

      const items = (centralRows || [])
        .map(buildBudgetItemFromCentral)
        .filter((item: any) => item.auvo_task_id);

      items.sort((a: any, b: any) => {
        const aHasGc = a.orcamento_realizado || a.os_realizada;
        const bHasGc = b.orcamento_realizado || b.os_realizada;
        if (aHasGc !== bHasGc) return aHasGc ? 1 : -1;
        return String(b.data_tarefa || "").localeCompare(String(a.data_tarefa || ""));
      });

      const upsertRows = items.map((item: any, idx: number) => {
        const existing = existingMap[item.auvo_task_id];
        const autoColuna = budgetColumnForItem(item);

        let finalColuna = autoColuna;
        let finalPosicao = idx;

        if (existing) {
          const oldData = existing.dados || {};
          const hadUpdate =
            (!oldData.orcamento_realizado && item.orcamento_realizado) ||
            (!oldData.os_realizada && item.os_realizada) ||
            (oldData.gc_orcamento?.gc_situacao !== item.gc_orcamento?.gc_situacao && item.orcamento_realizado) ||
            (oldData.gc_os?.gc_situacao !== item.gc_os?.gc_situacao && item.os_realizada);
          const stuckInInitial = ["a_fazer", "falta_preenchimento"].includes(existing.coluna) && autoColuna !== existing.coluna;

          if (hadUpdate || stuckInInitial) {
            finalColuna = autoColuna;
            finalPosicao = 0;
            movedCount++;
          } else {
            finalColuna = existing.coluna;
            finalPosicao = existing.posicao;
            keptCount++;
          }
        }

        return {
          auvo_task_id: item.auvo_task_id,
          dados: item,
          coluna: finalColuna,
          posicao: finalPosicao,
          atualizado_em: now,
        };
      });

      for (let i = 0; i < upsertRows.length; i += 50) {
        const batch = upsertRows.slice(i, i + 50);
        await sbClient
          .from("kanban_orcamentos_cache")
          .upsert(batch, { onConflict: "auvo_task_id" });
      }

      await sbClient
        .from("kanban_sync_meta")
        .upsert({
          id: "default",
          ultimo_sync: now,
          periodo_inicio: startDate,
          periodo_fim: endDate,
        });

      console.log(`[budget-kanban] Cache atualizado via central: ${upsertRows.length} itens (${movedCount} movidos, ${keptCount} mantidos)`);
      return;
    }

    // Fallback: busca APIs externas quando a central ainda não tem o período.
    const [auvoPrimary, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasksWithQuestionnaire(bearerToken, startDate, endDate),
      fetchGcOrcamentosMap(gcH),
      fetchGcOsMap(gcH),
    ]);

    let auvoTasks = auvoPrimary.tasks;
    let auvoError = auvoPrimary.errorMessage;

    // Fallback robusto: se vier vazio sem erro no range escolhido, tenta range amplo e filtra localmente.
    // Se o Auvo retornou erro (ex.: 502), NÃO dispara busca 2020-2030 — isso piora timeout e cancela a sync.
    if (!auvoPrimary.hadError && auvoTasks.length === 0 && (startDate !== AUVO_SAFE_START || endDate !== AUVO_SAFE_END)) {
      console.warn("[budget-kanban] Tentando fallback Auvo com range amplo (2020-2030)");
      const auvoFallback = await fetchAuvoTasksWithQuestionnaire(bearerToken, AUVO_SAFE_START, AUVO_SAFE_END);
      if (!auvoError && auvoFallback.errorMessage) auvoError = auvoFallback.errorMessage;

      const fallbackFiltered = auvoFallback.tasks.filter((task: any) =>
        inDateRange(String(task.taskDate || ""), startDate, endDate)
      );

      if (fallbackFiltered.length > 0) {
        auvoTasks = fallbackFiltered;
        console.log(`[budget-kanban] Fallback Auvo recuperou ${auvoTasks.length} tarefas no período`);
      }
    }

    console.log(`[budget-kanban] Auvo tasks: ${auvoTasks.length}, GC orçamentos: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

    // Se Auvo falhar, não sobrescreve cache com vazio
    if (auvoTasks.length === 0 && auvoError) {
      console.warn(`[budget-kanban] Sync preservado por erro Auvo: ${auvoError}`);

      const { data: cached } = await sbClient
        .from("kanban_orcamentos_cache")
        .select("*")
        .order("coluna")
        .order("posicao");

      const { data: meta } = await sbClient
        .from("kanban_sync_meta")
        .select("*")
        .eq("id", "default")
        .single();

      const fallbackItems = (cached || [])
        .map((row: any) => ({ ...row.dados, _coluna: row.coluna, _posicao: row.posicao }))
        .filter((item: any) => inDateRange(item.data_tarefa, startDate, endDate));

      const resumo = {
        periodo: { inicio: startDate, fim: endDate },
        total_tarefas_com_questionario: fallbackItems.length,
        orcamentos_realizados: fallbackItems.filter((i: any) => i.orcamento_realizado).length,
        os_realizadas: fallbackItems.filter((i: any) => i.os_realizada).length,
        pendentes: fallbackItems.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
      };

      return new Response(JSON.stringify({
        success: false,
        error: auvoError,
        resumo,
        items: fallbackItems,
        ultimo_sync: meta?.ultimo_sync || null,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build kanban items — first pass (resolve what we can synchronously)
    const items = auvoTasks.map((task: any) => {
      const taskId = String(task.taskID || "");
      const gcOrcMatch = gcOrcMap[taskId] || null;
      const gcOsMatch = gcOsMap[taskId] || null;

      const targetQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      const answers = (targetQ?.answers || []).map((a: any) => ({
        question: String(a.questionDescription || ""),
        reply: String(a.reply || ""),
      }));

      // === CADEIA DE RESOLUÇÃO DO CLIENTE ===
      // 1. customerDescription (campo direto da task)
      const desc = String(task.customerDescription || "").trim();
      // 2. customerName / customer object
      const nameRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || ""
      ).trim();
      // 3. Snapshot (conciliação anterior)
      const nameSnapshot = auvoTaskClienteMap[taskId] || "";
      // 4. GC match (orçamento ou OS)
      const nameGc = gcOrcMatch?.gc_cliente || gcOsMatch?.gc_cliente || "";

      const clienteSync = desc || nameRaw || nameSnapshot || nameGc;

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: String(task.taskUrl || ""),
        auvo_survey_url: String(task.survey || ""),
        cliente: clienteSync || "",
        _customerId: (!clienteSync && task.customerId && Number(task.customerId) > 0) ? String(task.customerId) : null,
        _externalId: (!clienteSync && !task.customerId) ? String(task.externalId || "").trim() : null,
        _resolucao: clienteSync ? (desc ? "customerDescription" : nameRaw ? "customerName" : nameSnapshot ? "snapshot" : "gc_match") : "pendente",
        tecnico: String(task.userToName || ""),
        data_tarefa: String(task.taskDate || "").split("T")[0],
        orientacao: String(task.orientation || ""),
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        questionario_respostas: answers,
        orcamento_realizado: !!gcOrcMatch,
        os_realizada: !!gcOsMatch,
        gc_orcamento: gcOrcMatch,
        gc_os: gcOsMatch,
      };
    });

    // === RESOLUÇÃO ASYNC: customerId → Auvo /customers/{id} ===
    const needsCustomerLookup = items.filter((i: any) => i._customerId);
    if (needsCustomerLookup.length > 0) {
      console.log(`[budget-kanban] Resolvendo ${needsCustomerLookup.length} clientes via Auvo /customers/{id}`);
      const customerCache: Record<string, string> = {};
      for (const item of needsCustomerLookup) {
        const cid = (item as any)._customerId;
        if (customerCache[cid]) {
          (item as any).cliente = customerCache[cid];
          (item as any)._resolucao = "auvo_customer_api";
          continue;
        }
        try {
          const url = `${AUVO_BASE_URL}/customers/${cid}`;
          const resp = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
          if (resp.ok) {
            const cData = await resp.json();
            const cust = cData?.result;
            const name = String(cust?.tradeName || cust?.companyName || cust?.description || cust?.name || "").trim();
            if (name) {
              customerCache[cid] = name;
              (item as any).cliente = name;
              (item as any)._resolucao = "auvo_customer_api";
              console.log(`[budget-kanban] Customer ${cid} → ${name}`);
            }
          }
        } catch (e) {
          console.warn(`[budget-kanban] Erro customer ${cid}:`, e);
        }
      }
    }

    // === RESOLUÇÃO ASYNC: externalId → GC OS/cliente ===
    const needsExternalLookup = items.filter((i: any) => !(i as any).cliente && (i as any)._externalId);
    if (needsExternalLookup.length > 0) {
      console.log(`[budget-kanban] Resolvendo ${needsExternalLookup.length} clientes via externalId no GC`);
      for (const item of needsExternalLookup) {
        const extId = (item as any)._externalId;
        try {
          // Try fetching OS by codigo (externalId)
          const url = `${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(extId)}&limite=1`;
          const resp = await rateLimitedFetch(url, { headers: gcH }, "gc");
          if (resp.ok) {
            const data = await resp.json();
            const os = Array.isArray(data?.data) ? data.data[0] : null;
            if (os?.nome_cliente) {
              (item as any).cliente = String(os.nome_cliente);
              (item as any)._resolucao = "gc_externalId";
              console.log(`[budget-kanban] ExternalId ${extId} → ${os.nome_cliente}`);
            }
          }
        } catch (e) {
          console.warn(`[budget-kanban] Erro externalId ${extId}:`, e);
        }
      }
    }

    // Fallback final + log de não resolvidos
    const unresolved: string[] = [];
    for (const item of items) {
      if (!(item as any).cliente) {
        (item as any).cliente = "Cliente não identificado";
        (item as any)._resolucao = "nao_identificado";
        unresolved.push((item as any).auvo_task_id);
      }
    }
    if (unresolved.length > 0) {
      console.warn(`[budget-kanban] ${unresolved.length} tarefas sem cliente: ${unresolved.join(", ")}`);
    }

    // Log resolução summary
    const resolucaoCount: Record<string, number> = {};
    for (const item of items) {
      const r = (item as any)._resolucao || "unknown";
      resolucaoCount[r] = (resolucaoCount[r] || 0) + 1;
    }
    console.log(`[budget-kanban] Resolução clientes: ${JSON.stringify(resolucaoCount)}`);

    // Remove internal fields
    for (const item of items) {
      delete (item as any)._customerId;
      delete (item as any)._externalId;
      delete (item as any)._resolucao;
    }

    // Merge persisted equipment/serial data from central table
    const persistedEquipmentMap = await loadPersistedEquipmentMap(
      sbClient,
      items.map((item: any) => String(item.auvo_task_id || ""))
    );

    for (const item of items as any[]) {
      const persisted = persistedEquipmentMap[String(item.auvo_task_id || "")];
      if (!persisted) continue;
      if (!sanitizeEquipmentValue(item.equipamento_nome) && persisted.equipamento_nome) item.equipamento_nome = persisted.equipamento_nome;
      if (!sanitizeEquipmentValue(item.equipamento_id_serie) && persisted.equipamento_id_serie) item.equipamento_id_serie = persisted.equipamento_id_serie;
    }

    // During sync, resolve missing equipment directly from Auvo and persist in central table
    const auvoTaskById: Record<string, any> = {};
    for (const task of auvoTasks) {
      const taskId = String(task?.taskID || "").trim();
      if (taskId) auvoTaskById[taskId] = task;
    }

    await resolveAndPersistMissingEquipment(sbClient, bearerToken, items as any[], auvoTaskById);

    // Sort: pendentes primeiro, depois por data desc
    items.sort((a: any, b: any) => {
      const aHasGc = a.orcamento_realizado || a.os_realizada;
      const bHasGc = b.orcamento_realizado || b.os_realizada;
      if (aHasGc !== bHasGc) return aHasGc ? 1 : -1;
      return b.data_tarefa.localeCompare(a.data_tarefa);
    });

    // === UPSERT TO CACHE ===
    // Read existing cache WITH dados to detect real changes
    const { data: existingCache } = await sbClient
      .from("kanban_orcamentos_cache")
      .select("auvo_task_id, coluna, posicao, dados");
    
    const existingMap: Record<string, { coluna: string; posicao: number; dados: any }> = {};
    for (const row of existingCache || []) {
      existingMap[row.auvo_task_id] = { coluna: row.coluna, posicao: row.posicao, dados: row.dados };
    }

    const now = new Date().toISOString();
    let movedCount = 0;
    let keptCount = 0;

    const upsertRows = items.map((item: any, idx: number) => {
      const existing = existingMap[item.auvo_task_id];

      // Determine the "correct" column based on current data
      const autoColuna = budgetColumnForItem(item);

      let finalColuna: string;
      let finalPosicao: number;

      if (!existing) {
        // New item → auto-assign
        finalColuna = autoColuna;
        finalPosicao = idx;
      } else {
        // Existing item: check if data changed in ways that should trigger a move
        const oldData = existing.dados || {};
        const hadUpdate =
          // Gained an orçamento
          (!oldData.orcamento_realizado && item.orcamento_realizado) ||
          // Gained an OS
          (!oldData.os_realizada && item.os_realizada) ||
          // Orçamento situation changed
          (oldData.gc_orcamento?.gc_situacao !== item.gc_orcamento?.gc_situacao && item.orcamento_realizado) ||
          // OS situation changed
          (oldData.gc_os?.gc_situacao !== item.gc_os?.gc_situacao && item.os_realizada);

        // Also force-move if card is stuck in an initial column after its status changed
        const stuckInInitial = ["a_fazer", "falta_preenchimento"].includes(existing.coluna) && autoColuna !== existing.coluna;

        if (hadUpdate || stuckInInitial) {
          // Data changed or card misplaced → move to correct column
          finalColuna = autoColuna;
          finalPosicao = 0; // top of column
          movedCount++;
        } else {
          // No meaningful update → keep user's position
          finalColuna = existing.coluna;
          finalPosicao = existing.posicao;
          keptCount++;
        }
      }

      return {
        auvo_task_id: item.auvo_task_id,
        dados: item,
        coluna: finalColuna,
        posicao: finalPosicao,
        atualizado_em: now,
      };
    });

    console.log(`[budget-kanban] Posições: ${movedCount} movidos por atualização, ${keptCount} mantidos`);

    // Upsert in batches of 50
    for (let i = 0; i < upsertRows.length; i += 50) {
      const batch = upsertRows.slice(i, i + 50);
      await sbClient
        .from("kanban_orcamentos_cache")
        .upsert(batch, { onConflict: "auvo_task_id" });
    }

    // Não remover itens antigos do cache: preservar histórico e posições já salvas


    // Update sync metadata
    await sbClient
      .from("kanban_sync_meta")
      .upsert({
        id: "default",
        ultimo_sync: now,
        periodo_inicio: startDate,
        periodo_fim: endDate,
      });

    console.log(`[budget-kanban] Cache atualizado: ${upsertRows.length} itens`);

    console.log(`[budget-kanban] Sync concluído. Pendentes: ${items.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length}`);
}
