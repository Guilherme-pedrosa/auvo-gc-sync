import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isManagedTaskType,
  managedBaseTaskTypeId,
  managedTaskTypeDescription,
  minutesToAuvoTimeSpan,
  normalizeRequestedDurationMinutes,
  parseAuvoDurationMinutes,
} from "../_shared/auvo-duration.ts";
import {
  auvoCheckInDate,
  auvoCheckOutDate,
  computeAuvoWorkedHours,
} from "../_shared/auvo-worked-time.ts";
import { auvoTaskTypeDescription } from "../_shared/auvo-task-type.ts";
import {
  BUDGET_EXECUTION_FORECAST,
  auvoTaskHasStarted,
  forecastDurationMinutes,
  isOsEligibleForBudgetForecast,
  normalizeClock,
  normalizeGcDocumentCode,
  taskAssignedUserId,
  taskStartMinuteKey,
  taskTypeId,
} from "../_shared/agenda-forecast-promotion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

// Idempotent retry for PATCH only — backoff 2s, 4s, 8s on 502/503/timeout.
// NEVER use for POST/PUT-create endpoints (não-idempotentes).
async function patchWithRetry(
  url: string,
  init: RequestInit,
  reqId: string,
): Promise<Response> {
  const BACKOFF = [2000, 4000, 8000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < BACKOFF.length; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.status === 502 || resp.status === 503) {
        if (attempt < BACKOFF.length - 1) {
          console.warn(`[auvo-task-update][reqId=${reqId}] PATCH ${resp.status}, retry ${attempt + 1}/${BACKOFF.length - 1} em ${BACKOFF[attempt]}ms`);
          await new Promise(r => setTimeout(r, BACKOFF[attempt]));
          continue;
        }
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < BACKOFF.length - 1) {
        console.warn(`[auvo-task-update][reqId=${reqId}] PATCH timeout/network, retry ${attempt + 1}/${BACKOFF.length - 1} em ${BACKOFF[attempt]}ms`);
        await new Promise(r => setTimeout(r, BACKOFF[attempt]));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("PATCH retry exhausted");
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

type AuvoTaskTypeResolution = {
  id: number;
  baseId: number;
  description: string;
  durationMinutes: number;
  managed: boolean;
  raw: any;
};

function taskTypeDurationMinutes(taskType: any): number {
  return parseAuvoDurationMinutes(
    taskType?.standartTime ?? taskType?.standardTime ?? taskType?.defaultTime,
  );
}

async function fetchTaskTypeById(
  taskTypeId: number,
  headers: Record<string, string>,
): Promise<any> {
  const candidates = ["tasktypes", "taskTypes"];
  let lastError = "";
  for (const path of candidates) {
    const response = await fetch(`${AUVO_BASE_URL}/${path}/${taskTypeId}`, { headers });
    if (response.status === 404) continue;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = `${path}/${taskTypeId} HTTP ${response.status}: ${JSON.stringify(data).substring(0, 300)}`;
      continue;
    }
    return data?.result || data;
  }
  throw new Error(lastError || `Tipo de tarefa Auvo ${taskTypeId} não encontrado`);
}

async function listTaskTypesFromAuvo(
  headers: Record<string, string>,
  description?: string,
): Promise<any[]> {
  const all: any[] = [];
  const paramFilter = encodeURIComponent(JSON.stringify(description ? { description } : {}));
  for (let page = 1; page <= 10; page++) {
    const url = `${AUVO_BASE_URL}/tasktypes/?paramFilter=${paramFilter}&page=${page}&pageSize=100&order=asc`;
    const response = await fetch(url, { headers });
    if (response.status === 404) break;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Falha ao listar tipos de tarefa no Auvo (${response.status}): ${JSON.stringify(data).substring(0, 300)}`);
    }
    const items = data?.result?.entityList || data?.result || data?.data || [];
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

function taskTypeClonePayload(base: any, description: string, durationMinutes: number) {
  const requirements = base?.requirements && typeof base.requirements === "object"
    ? {
        fillReport: !!base.requirements.fillReport,
        getSignature: !!base.requirements.getSignature,
        fillRolledKilometer: !!base.requirements.fillRolledKilometer,
        emailTheTask: !!base.requirements.emailTheTask,
        minimumNumberOfPhotos: Number(base.requirements.minimumNumberOfPhotos || 0),
        requiredQuestionnaires: Array.isArray(base.requirements.requiredQuestionnaires)
          ? base.requirements.requiredQuestionnaires.map(Number).filter(Number.isFinite)
          : [],
      }
    : undefined;

  const payload: any = {
    description,
    standartTime: minutesToAuvoTimeSpan(durationMinutes),
    sendSatisfactionSurvey: !!base?.sendSatisfactionSurvey,
    sendDigitalOs: !!base?.sendDigitalOs,
    active: true,
    ...(requirements ? { requirements } : {}),
  };
  const questionnaireId = Number(
    base?.standartQuestionnaireId ?? base?.standardQuestionnaireId ?? 0,
  );
  if (questionnaireId > 0) payload.standartQuestionnaireId = questionnaireId;
  return payload;
}

async function ensureTaskTypeDuration(
  requestedTaskTypeId: number,
  requestedDuration: unknown,
  headers: Record<string, string>,
  reqId: string,
): Promise<AuvoTaskTypeResolution> {
  const durationMinutes = normalizeRequestedDurationMinutes(requestedDuration);
  const selected = await fetchTaskTypeById(requestedTaskTypeId, headers);
  const selectedDescription = String(selected?.description || `Tipo ${requestedTaskTypeId}`);
  const encodedBaseId = managedBaseTaskTypeId(selectedDescription);
  const baseId = encodedBaseId || requestedTaskTypeId;
  const base = encodedBaseId ? await fetchTaskTypeById(baseId, headers) : selected;
  const baseDescription = String(base?.description || selectedDescription);

  if (taskTypeDurationMinutes(selected) === durationMinutes) {
    return {
      id: requestedTaskTypeId,
      baseId,
      description: selectedDescription,
      durationMinutes,
      managed: isManagedTaskType(selectedDescription),
      raw: selected,
    };
  }

  if (taskTypeDurationMinutes(base) === durationMinutes) {
    return {
      id: baseId,
      baseId,
      description: baseDescription,
      durationMinutes,
      managed: false,
      raw: base,
    };
  }

  const managedDescription = managedTaskTypeDescription(baseId, durationMinutes, baseDescription);
  const existing = (await listTaskTypesFromAuvo(headers, managedDescription)).find((item) =>
    String(item?.description || "").trim() === managedDescription &&
    taskTypeDurationMinutes(item) === durationMinutes
  );
  if (existing) {
    const existingId = Number(existing.id ?? existing.taskTypeId);
    if (Number.isFinite(existingId) && existingId > 0) {
      return {
        id: existingId,
        baseId,
        description: managedDescription,
        durationMinutes,
        managed: true,
        raw: existing,
      };
    }
  }

  const payload = taskTypeClonePayload(base, managedDescription, durationMinutes);
  let response: Response | null = null;
  let data: any = {};
  try {
    response = await fetch(`${AUVO_BASE_URL}/tasktypes/`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    data = await response.json().catch(() => ({}));
  } catch (err) {
    console.warn(`[auvo-task-update][reqId=${reqId}] falha de rede ao criar tipo gerenciado:`, err);
  }
  if (!response || !response.ok) {
    // Auvo pode recusar a criação do tipo (500). Não bloquear a tarefa:
    // seguir com o tipo base e sua duração padrão.
    console.warn(
      `[auvo-task-update][reqId=${reqId}] Auvo recusou tipo com duração ${durationMinutes} min (${response?.status ?? "network"}): ${JSON.stringify(data).substring(0, 300)} — usando tipo base ${baseId}`,
    );
    return {
      id: baseId,
      baseId,
      description: baseDescription,
      durationMinutes: taskTypeDurationMinutes(base) || durationMinutes,
      managed: false,
      raw: base,
    };
  }
  const created = data?.result || data;
  let createdId = Number(created?.id ?? created?.taskTypeId);
  let createdRecord = created;
  // The current Apiary contract documents 201 without guaranteeing a body.
  // Resolve the id by the deterministic description when the body is empty.
  if (!Number.isFinite(createdId) || createdId <= 0) {
    const createdFromList = (await listTaskTypesFromAuvo(headers, managedDescription)).find((item) =>
      String(item?.description || "").trim() === managedDescription &&
      taskTypeDurationMinutes(item) === durationMinutes
    );
    createdId = Number(createdFromList?.id ?? createdFromList?.taskTypeId);
    createdRecord = createdFromList || created;
  }
  if (!Number.isFinite(createdId) || createdId <= 0) {
    console.warn(`[auvo-task-update][reqId=${reqId}] tipo criado sem ID retornado — usando tipo base ${baseId}`);
    return {
      id: baseId,
      baseId,
      description: baseDescription,
      durationMinutes: taskTypeDurationMinutes(base) || durationMinutes,
      managed: false,
      raw: base,
    };
  }
  console.log(`[auvo-task-update][reqId=${reqId}] tipo gerenciado criado id=${createdId} base=${baseId} duração=${durationMinutes}`);
  return {
    id: createdId,
    baseId,
    description: managedDescription,
    durationMinutes,
    managed: true,
    raw: { ...payload, ...createdRecord },
  };
}

async function fetchTaskById(taskId: number, headers: Record<string, string>): Promise<any> {
  const response = await fetch(`${AUVO_BASE_URL}/tasks/${taskId}`, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Falha ao buscar tarefa Auvo ${taskId} (${response.status}): ${JSON.stringify(data).substring(0, 400)}`);
  }
  return data?.result || data;
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Credenciais internas de banco não configuradas");
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function markForecastConversion(
  admin: ReturnType<typeof createClient>,
  forecastId: string,
  status: string,
  error: string | null,
  osCode?: string | null,
) {
  const patch: Record<string, unknown> = {
    conversao_status: status,
    conversao_erro: error,
    conversao_tentada_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
  if (osCode !== undefined) patch.gc_os_codigo = osCode;
  const { error: updateError } = await admin
    .from("agenda_agendamentos")
    .update(patch)
    .eq("id", forecastId);
  if (updateError) {
    console.error(`[auvo-task-update] falha ao registrar conversão ${forecastId}: ${updateError.message}`);
  }
}

async function promoteBudgetForecast(
  admin: ReturnType<typeof createClient>,
  headers: Record<string, string>,
  body: any,
  reqId: string,
) {
  const budgetCode = normalizeGcDocumentCode(body?.gcOrcamentoCodigo ?? body?.gc_orcamento_codigo);
  const osCode = normalizeGcDocumentCode(body?.gcOsCodigo ?? body?.gc_os_codigo);
  const execTaskId = normalizeGcDocumentCode(body?.execTaskId ?? body?.auvo_task_id);
  if (!budgetCode || !osCode || !execTaskId) {
    return { success: false, promoted: false, reason: "invalid_link", error: "Orçamento, OS e tarefa de execução são obrigatórios" };
  }

  const { data: forecast, error: forecastError } = await admin
    .from("agenda_agendamentos")
    .select("*")
    .eq("gc_orcamento_codigo", budgetCode)
    .eq("previsao_tipo", BUDGET_EXECUTION_FORECAST)
    .maybeSingle();
  if (forecastError) throw forecastError;
  if (!forecast) {
    return { success: true, promoted: false, reason: "no_forecast", budgetCode, osCode, execTaskId };
  }

  if (!forecast.previsao_continuidade) {
    const sameTask = normalizeGcDocumentCode(forecast.auvo_task_id) === execTaskId;
    return {
      success: sameTask,
      promoted: false,
      alreadyPromoted: sameTask,
      reason: sameTask ? "already_promoted" : "forecast_already_converted",
      agenda: forecast,
    };
  }

  // Segunda trava: mesmo que algum sincronizador envie uma OS antiga do mesmo
  // orçamento, nunca convertemos a previsão por um lote anterior da baixa parcial.
  const { data: osRows, error: osReadError } = await admin
    .from("tarefas_central")
    .select("gc_os_codigo,gc_os_data,gc_os_situacao,gc_os_tarefa_os,gc_os_tarefa_exec,gc_orcamento_codigo")
    .eq("gc_os_codigo", osCode)
    .limit(20);
  if (osReadError) {
    console.warn(`[auvo-task-update][reqId=${reqId}] não foi possível validar a OS ${osCode}: ${osReadError.message}`);
  } else {
    const linkedOs = (osRows || []).find((row: any) =>
      normalizeGcDocumentCode(row.gc_orcamento_codigo) === budgetCode
    ) || osRows?.[0];
    if (linkedOs && !isOsEligibleForBudgetForecast(linkedOs, forecast.criado_em)) {
      await markForecastConversion(admin, forecast.id, "AGUARDANDO_OS", null, null);
      return {
        success: true,
        promoted: false,
        reason: "stale_os",
        forecastId: forecast.id,
        budgetCode,
        ignoredOsCode: osCode,
      };
    }
  }

  await markForecastConversion(admin, forecast.id, "PROCESSANDO", null, osCode);

  try {
    const startTime = normalizeClock(forecast.hora_inicio);
    const durationMinutes = forecastDurationMinutes(forecast.hora_inicio, forecast.hora_fim);
    if (!startTime || durationMinutes < 15) {
      throw new Error("A previsão não possui horário/duração válidos");
    }
    if (!forecast.colaborador_id) {
      throw new Error("A previsão não possui técnico do RH");
    }

    const { data: collaborator, error: collaboratorError } = await admin
      .from("rh_colaboradores")
      .select("id,nome,auvo_user_id")
      .eq("id", forecast.colaborador_id)
      .maybeSingle();
    if (collaboratorError) throw collaboratorError;
    const auvoUserId = Number(collaborator?.auvo_user_id);
    if (!collaborator || !Number.isFinite(auvoUserId) || auvoUserId <= 0) {
      await markForecastConversion(
        admin,
        forecast.id,
        "BLOQUEADA",
        "O técnico previsto não possui usuário Auvo vinculado no RH",
        osCode,
      );
      return { success: false, promoted: false, reason: "technician_not_linked", forecastId: forecast.id };
    }

    const numericTaskId = Number(execTaskId);
    const currentTask = await fetchTaskById(numericTaskId, headers);
    if (auvoTaskHasStarted(currentTask)) {
      await markForecastConversion(
        admin,
        forecast.id,
        "BLOQUEADA",
        `A tarefa Auvo ${execTaskId} já foi iniciada ou finalizada`,
        osCode,
      );
      return { success: false, promoted: false, reason: "task_started", forecastId: forecast.id, execTaskId };
    }

    const currentTaskTypeId = taskTypeId(currentTask);
    if (!currentTaskTypeId) throw new Error(`Tarefa ${execTaskId} não devolveu um tipo de tarefa válido`);
    const durationResolution = await ensureTaskTypeDuration(
      currentTaskTypeId,
      durationMinutes,
      headers,
      reqId,
    );

    const desiredStart = `${forecast.data}T${startTime}:00`;
    const patches: Array<{ op: string; path: string; value: unknown }> = [];
    if (taskStartMinuteKey(currentTask) !== desiredStart.slice(0, 16)) {
      patches.push({ op: "replace", path: "/taskDate", value: desiredStart });
    }
    if (taskAssignedUserId(currentTask) !== auvoUserId) {
      patches.push({ op: "replace", path: "/idUserTo", value: auvoUserId });
    }
    if (taskTypeId(currentTask) !== durationResolution.id) {
      patches.push({ op: "replace", path: "/taskType", value: durationResolution.id });
    }

    if (patches.length) {
      const response = await patchWithRetry(`${AUVO_BASE_URL}/tasks/${numericTaskId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patches),
      }, reqId);
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Auvo recusou o agendamento (${response.status}): ${raw.substring(0, 400)}`);
      }
    }

    const verifiedTask = await fetchTaskById(numericTaskId, headers);
    const verifiedStart = taskStartMinuteKey(verifiedTask) === desiredStart.slice(0, 16);
    const verifiedUser = taskAssignedUserId(verifiedTask) === auvoUserId;
    const verifiedType = taskTypeId(verifiedTask) === durationResolution.id;
    if (!verifiedStart || !verifiedUser || !verifiedType) {
      throw new Error(
        `Auvo não confirmou o planejamento completo (data=${verifiedStart}, técnico=${verifiedUser}, duração=${verifiedType})`,
      );
    }

    const { data: promoted, error: promotionError } = await admin.rpc("promover_previsao_orcamento", {
      p_previsao_id: forecast.id,
      p_orcamento_codigo: budgetCode,
      p_os_codigo: osCode,
      p_auvo_task_id: execTaskId,
    });
    if (promotionError) throw promotionError;

    const promotedRow = Array.isArray(promoted) ? promoted[0] : promoted;
    const { data: plannedAgenda, error: plannedAgendaError } = await admin
      .from("agenda_agendamentos")
      .update({ duracao_planejada_minutos: durationMinutes })
      .eq("id", forecast.id)
      .select("*")
      .single();
    if (plannedAgendaError) throw plannedAgendaError;
    await admin
      .from("tarefas_central")
      .update({
        gc_os_codigo: osCode,
        gc_orcamento_codigo: budgetCode,
        data_tarefa: forecast.data,
        hora_inicio: `${startTime}:00`,
        hora_fim: forecast.hora_fim,
        duracao_decimal: durationMinutes / 60,
        tecnico_id: String(auvoUserId),
        tecnico: collaborator.nome,
        atualizado_em: new Date().toISOString(),
      })
      .eq("auvo_task_id", execTaskId);

    console.log(`[auvo-task-update][reqId=${reqId}] previsão ${forecast.id} promovida: ORC ${budgetCode} -> OS ${osCode} -> tarefa ${execTaskId}`);
    return {
      success: true,
      promoted: true,
      forecastId: forecast.id,
      budgetCode,
      osCode,
      execTaskId,
      patches,
      agenda: plannedAgenda || promotedRow,
    };
  } catch (error) {
    const message = (error as Error).message || String(error);
    await markForecastConversion(admin, forecast.id, "ERRO", message, osCode);
    console.error(`[auvo-task-update][reqId=${reqId}] falha ao promover previsão ${forecast.id}: ${message}`);
    return { success: false, promoted: false, reason: "promotion_failed", error: message, forecastId: forecast.id };
  }
}

function hasOwn(obj: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// A API v2 do Auvo NÃO aceita estimatedDuration/taskEndDate em nenhuma escrita:
// - PATCH /tasks/{id} devolve 400 "The target location specified by path segment ... was not found"
// - PUT /tasks (upsert) ignora silenciosamente o campo (verificado em produção)
// A duração da tarefa no Auvo vem do "standardTime" do Tipo de Tarefa (/taskTypes).
// Portanto esses caminhos são descartados antes do PATCH para não quebrar a edição.
const PATCH_UNSUPPORTED_PATHS = ["estimatedDuration", "taskEndDate"];

function setIfProvided(result: any, row: any, key: string, targetKey: string = key) {
  if (!hasOwn(row, key)) return;
  result[targetKey] = row[key] ?? null;
}

function sanitizeCentralRow(row: any) {
  const taskId = String(row?.auvo_task_id || "").trim();
  if (!taskId) return null;

  // IMPORTANT: only persist keys that were explicitly provided.
  // This prevents partial updates (drag/edit) from nulling GC values and other fields.
  const result: any = {
    auvo_task_id: taskId,
    mirror_key: String(row?.mirror_key || "").trim()
      || `${taskId}::os:${String(row?.gc_os_id || "")}::orc:${String(row?.gc_orcamento_id || "")}`,
    atualizado_em: new Date().toISOString(),
  };

  setIfProvided(result, row, "cliente");
  setIfProvided(result, row, "tecnico");
  setIfProvided(result, row, "tecnico_id");
  setIfProvided(result, row, "data_tarefa");
  setIfProvided(result, row, "status_auvo");
  setIfProvided(result, row, "hora_inicio");
  setIfProvided(result, row, "hora_fim");
  setIfProvided(result, row, "duracao_decimal");
  setIfProvided(result, row, "check_in");
  setIfProvided(result, row, "check_out");
  setIfProvided(result, row, "endereco");
  setIfProvided(result, row, "auvo_link");
  setIfProvided(result, row, "gc_os_codigo");
  setIfProvided(result, row, "gc_os_situacao");
  setIfProvided(result, row, "gc_os_valor_total");
  setIfProvided(result, row, "gc_os_link");
  setIfProvided(result, row, "gc_orcamento_codigo");
  setIfProvided(result, row, "gc_orc_situacao");
  setIfProvided(result, row, "gc_orc_valor_total");
  setIfProvided(result, row, "gc_orc_link");
  setIfProvided(result, row, "pendencia");
  setIfProvided(result, row, "equipamento_nome");
  setIfProvided(result, row, "equipamento_id_serie");

  // orientacao accepts either "orientacao" or legacy "descricao"
  if (hasOwn(row, "orientacao")) {
    result.orientacao = row.orientacao ?? null;
  } else if (hasOwn(row, "descricao")) {
    result.orientacao = row.descricao ?? null;
  }

  if (hasOwn(row, "questionario_respostas")) {
    result.questionario_respostas = row.questionario_respostas;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const reqId = req.headers.get("x-request-id") || crypto.randomUUID();
  const respHeaders = { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": reqId };

  try {
    const apiKey = Deno.env.get("AUVO_APP_KEY");
    const apiToken = Deno.env.get("AUVO_TOKEN");
    if (!apiKey || !apiToken) {
      return new Response(
        JSON.stringify({ error: "Credenciais Auvo não configuradas" }),
        { status: 500, headers: respHeaders }
      );
    }

    const body = await req.json();
    const { action } = body;
    console.log(`[auvo-task-update][reqId=${reqId}] action=${action}`);

    if (action === "persist-central") {
      const isSingleRowPatch = !!body?.row && !Array.isArray(body?.rows);
      const rowsInput = Array.isArray(body?.rows)
        ? body.rows
        : body?.row
          ? [body.row]
          : [];

      if (rowsInput.length === 0) {
        return new Response(
          JSON.stringify({ error: "rows é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rows = rowsInput
        .map((r: any) => sanitizeCentralRow(r))
        .filter((r: any) => !!r);

      if (rows.length === 0) {
        return new Response(
          JSON.stringify({ error: "Nenhuma linha válida para persistir" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = getAdminClient();

      // Single-row patch requests (drag/edit) should not null unrelated columns.
      if (isSingleRowPatch && rows.length === 1) {
        const row = rows[0];
        const { auvo_task_id, mirror_key, ...patch } = row;
        const explicitMirrorKey = String(rowsInput[0]?.mirror_key || "").trim();
        const targetMirrorKey = mirror_key;

        let { data: updatedRows, error: updateError } = await admin
          .from("tarefas_central")
          .update(patch)
          .eq("mirror_key", targetMirrorKey)
          .select("mirror_key");

        if (updateError) throw updateError;

        // Fallback: quando o chamador não informou mirror_key/gc ids, a chave
        // derivada não existe. Atualiza todos os espelhos da mesma tarefa Auvo
        // em vez de criar uma linha fantasma.
        if ((!updatedRows || updatedRows.length === 0) && !explicitMirrorKey) {
          const fallback = await admin
            .from("tarefas_central")
            .update(patch)
            .eq("auvo_task_id", auvo_task_id)
            .select("mirror_key");
          if (fallback.error) throw fallback.error;
          updatedRows = fallback.data;
        }

        if (!updatedRows || updatedRows.length === 0) {
          const { error: insertError } = await admin
            .from("tarefas_central")
            .insert({ ...row, mirror_key: targetMirrorKey });
          if (insertError) throw insertError;
        }

        return new Response(
          JSON.stringify({ success: true, count: updatedRows?.length || 1, status: 200 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Bulk sync keeps upsert behavior (full dataset refresh).
      const { error } = await admin
        .from("tarefas_central")
        .upsert(rows, { onConflict: "mirror_key" });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, count: rows.length, status: 200 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Login to Auvo
    const bearerToken = await auvoLogin(apiKey, apiToken);
    const headers = { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" };

    if (action === "sync-local") {
      const taskId = Number(body?.taskId);
      if (!Number.isFinite(taskId) || taskId <= 0) {
        return new Response(
          JSON.stringify({ success: false, error: "taskId é obrigatório", reqId }),
          { status: 400, headers: respHeaders },
        );
      }

      const task = await fetchTaskById(taskId, headers);
      const admin = getAdminClient();
      const { data: existingRows, error: existingError } = await admin
        .from("tarefas_central")
        .select("mirror_key,gc_os_id,gc_os_codigo,gc_orcamento_id,gc_orcamento_codigo")
        .eq("auvo_task_id", String(taskId))
        .order("atualizado_em", { ascending: false })
        .limit(20);
      if (existingError) throw existingError;
      // Se uma sincronização antiga deixou uma duplicata task-only mais nova,
      // recuperamos a linha que ainda guarda o vínculo GC em vez de degradá-la.
      const existing = existingRows?.find((row: any) =>
        row?.gc_os_id || row?.gc_os_codigo || row?.gc_orcamento_id || row?.gc_orcamento_codigo
      ) || existingRows?.[0] || null;

      const { data: agendaRows, error: agendaError } = await admin
        .from("agenda_agendamentos")
        .select("cliente,colaborador_nome,colaborador_id,data,hora_inicio,hora_fim,descricao,gc_os_codigo,gc_orcamento_codigo")
        .eq("auvo_task_id", String(taskId))
        .limit(1);
      if (agendaError) throw agendaError;
      const agenda = agendaRows?.[0] || null;

      const taskDate = String(task?.taskDate ?? task?.date ?? "");
      const taskEndDate = String(task?.taskEndDate ?? task?.endDate ?? "");
      const checkInDate = auvoCheckInDate(task) || "";
      const checkOutDate = auvoCheckOutDate(task) || "";
      const status = String(task?.taskStatus?.description ?? task?.status?.description ?? task?.status ?? "").trim();
      const customer = String(task?.customerDescription ?? task?.customerName ?? task?.customer?.tradeName ?? "").trim();
      const technician = String(task?.userToName ?? task?.userTo?.name ?? "").trim();
      const technicianId = String(task?.idUserTo ?? task?.userTo?.id ?? "").trim();
      const orientation = String(task?.orientation ?? task?.description ?? "").trim();
      const plannedDurationMinutes = parseAuvoDurationMinutes(
        task?.estimatedDuration ?? task?.estimated_duration,
      );
      const currentTaskTypeId = taskTypeId(task);
      let currentTaskTypeDescription = auvoTaskTypeDescription(task);
      if (currentTaskTypeId && !currentTaskTypeDescription) {
        try {
          const taskType = await fetchTaskTypeById(currentTaskTypeId, headers);
          currentTaskTypeDescription = String(taskType?.description ?? taskType?.name ?? "").trim();
        } catch (error) {
          console.warn(`[auvo-task-update][reqId=${reqId}] tipo ${currentTaskTypeId} não resolvido: ${(error as Error).message}`);
        }
      }
      const workedHours = computeAuvoWorkedHours(task);
      const timePart = (value: string) => value.length >= 16 ? value.slice(11, 16) : "";
      const patch: Record<string, unknown> = {
        atualizado_em: new Date().toISOString(),
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
      };
      const setKnown = (key: string, value: unknown) => {
        if (value == null || (typeof value === "string" && !value.trim())) return;
        patch[key] = value;
      };

      setKnown("cliente", customer || agenda?.cliente);
      setKnown("tecnico", technician || agenda?.colaborador_nome);
      setKnown("tecnico_id", technicianId);
      setKnown("data_tarefa", taskDate.slice(0, 10) || agenda?.data);
      setKnown("hora_inicio", timePart(checkInDate) || timePart(taskDate) || agenda?.hora_inicio);
      setKnown("hora_fim", timePart(checkOutDate) || timePart(taskEndDate) || agenda?.hora_fim);
      setKnown("status_auvo", status);
      setKnown("orientacao", orientation || agenda?.descricao);
      setKnown("task_type_id", currentTaskTypeId);
      setKnown("descricao", currentTaskTypeDescription);
      setKnown("gc_os_codigo", agenda?.gc_os_codigo || existing?.gc_os_codigo);
      setKnown("gc_orcamento_codigo", agenda?.gc_orcamento_codigo || existing?.gc_orcamento_codigo);
      if (workedHours > 0) patch.duracao_decimal = workedHours;
      setKnown("check_in_iso", checkInDate);
      setKnown("check_out_iso", checkOutDate);
      if (hasOwn(task, "checkIn") || checkInDate) patch.check_in = task?.checkIn === true || !!checkInDate;
      if (hasOwn(task, "checkOut") || checkOutDate) patch.check_out = task?.checkOut === true || !!checkOutDate;

      if (plannedDurationMinutes > 0) {
        const { error: agendaDurationError } = await admin
          .from("agenda_agendamentos")
          .update({ duracao_planejada_minutos: plannedDurationMinutes })
          .eq("auvo_task_id", String(taskId));
        if (agendaDurationError) throw agendaDurationError;
      }

      const existingMirrorKey = String(existing?.mirror_key || "").trim();
      const mirrorKey = existingMirrorKey || `${taskId}::os:::orc:`;
      if (existingMirrorKey) {
        const { error: updateError } = await admin
          .from("tarefas_central")
          .update(patch)
          .eq("mirror_key", existingMirrorKey);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await admin
          .from("tarefas_central")
          .upsert({
            auvo_task_id: String(taskId),
            mirror_key: mirrorKey,
            ...patch,
          }, { onConflict: "mirror_key", defaultToNull: false });
        if (insertError) throw insertError;
      }

      const { data: syncedRows, error: syncedError } = await admin
        .from("tarefas_central")
        .select("*")
        .eq("auvo_task_id", String(taskId))
        .order("atualizado_em", { ascending: false })
        .limit(1);
      if (syncedError) throw syncedError;

      return new Response(
        JSON.stringify({ success: true, status: 200, data: syncedRows?.[0] || null, reqId }),
        { status: 200, headers: respHeaders },
      );
    }

    if (action === "promote-budget-forecast") {
      const result = await promoteBudgetForecast(getAdminClient(), headers, body, reqId);
      return new Response(JSON.stringify({ ...result, status: 200, reqId }), {
        status: 200,
        headers: respHeaders,
      });
    }

    if (action === "edit") {
      // Edit task using JSONPatch
      // body: { action: "edit", taskId: number, patches: [{op, path, value}] }
      const { taskId, patches } = body;
      if (!taskId || !patches || !Array.isArray(patches)) {
        return new Response(
          JSON.stringify({ error: "taskId e patches são obrigatórios" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const unsupportedDurationPatch = patches.find((patch: any) => {
        const path = String(patch?.path || "").replace(/^\//, "").toLowerCase();
        return path === "taskenddate" || path === "estimatedduration";
      });
      if (unsupportedDurationPatch) {
        return new Response(
          JSON.stringify({
            success: false,
            status: 400,
            error: `O campo ${unsupportedDurationPatch.path} não é gravável em /tasks. Use set-task-duration ou edit-schedule.`,
            reqId,
          }),
          { status: 200, headers: respHeaders },
        );
      }

      const url = `${AUVO_BASE_URL}/tasks/${taskId}`;

      // Descarta campos que a API v2 não aceita em escrita (duração / data fim)
      const patchable = patches.filter((p: any) => !PATCH_UNSUPPORTED_PATHS.includes(p?.path));
      const ignoredPaths = patches
        .filter((p: any) => PATCH_UNSUPPORTED_PATHS.includes(p?.path))
        .map((p: any) => p.path);
      if (ignoredPaths.length > 0) {
        console.warn(`[auvo-task-update][reqId=${reqId}] campos não suportados pela API Auvo ignorados: ${ignoredPaths.join(", ")}`);
      }

      if (patchable.length === 0) {
        return new Response(
          JSON.stringify({ data: null, status: 200, ignoredPaths, reqId }),
          { status: 200, headers: respHeaders }
        );
      }

      // PATCH é idempotente para os campos enviados → retry seguro em 502/503/timeout
      let response: Response;
      try {
        response = await patchWithRetry(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(patchable),
        }, reqId);
      } catch (err) {
        console.error(`[auvo-task-update][reqId=${reqId}] PATCH /tasks/${taskId} falhou após retries:`, err);
        return new Response(
          JSON.stringify({ success: false, status: 503, retryable: true, message: "Auvo instável. Tente novamente.", reqId }),
          { status: 200, headers: respHeaders }
        );
      }

      const responseText = await response.text();
      let data;
      try { 
        data = JSON.parse(responseText); 
      } catch { 
        data = { raw: responseText }; 
      }

      console.log(`[auvo-task-update][reqId=${reqId}] action=edit status=${response.status} response=`, responseText.substring(0, 500));

      return new Response(
        JSON.stringify({ data, status: response.status, ignoredPaths, reqId }),
        { status: 200, headers: respHeaders }
      );
    }

    if (action === "upsert") {
      // Upsert task (create or update)
      // body: { action: "upsert", task: { id, idUserTo, taskDate, ... } }
      const { task } = body;
      if (!task) {
        return new Response(
          JSON.stringify({ error: "task é obrigatório" }),
          { status: 400, headers: respHeaders }
        );
      }

      const url = `${AUVO_BASE_URL}/tasks`;
      // Não-idempotente (cria tarefa). Nunca fazer retry automático aqui.
      let response: Response;
      try {
        response = await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify(task),
        });
      } catch (err) {
        console.error(`[auvo-task-update][reqId=${reqId}] upsert /tasks erro de rede:`, err);
        return new Response(
          JSON.stringify({ success: false, status: 503, retryable: true, message: "Auvo instável. Tente novamente.", reqId }),
          { status: 200, headers: respHeaders }
        );
      }

      if (response.status === 502 || response.status === 503) {
        console.error(`[auvo-task-update][reqId=${reqId}] upsert /tasks ${response.status} — não fazendo retry (POST não-idempotente)`);
        return new Response(
          JSON.stringify({ success: false, status: response.status, retryable: true, message: "Auvo instável. Tente novamente.", reqId }),
          { status: 200, headers: respHeaders }
        );
      }

      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

      return new Response(
        JSON.stringify({ data, status: response.status, reqId }),
        { status: response.ok ? 200 : response.status, headers: respHeaders }
      );
    }

    if (action === "get") {
      // Get single task
      const { taskId } = body;
      if (!taskId) {
        return new Response(
          JSON.stringify({ data: null, status: 400, error: "taskId é obrigatório" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const url = `${AUVO_BASE_URL}/tasks/${taskId}`;
      const response = await fetch(url, { headers });
      const data = await response.json().catch(() => ({}));

      // Always return 200 to prevent supabase.functions.invoke() from treating 404 as fatal
      return new Response(
        JSON.stringify({ data, status: response.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get-equipment") {
      const { equipmentId } = body;
      if (!equipmentId) {
        return new Response(
          JSON.stringify({ error: "equipmentId é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const url = `${AUVO_BASE_URL}/equipments/${equipmentId}`;
      const response = await fetch(url, { headers });
      const data = await response.json().catch(() => ({}));

      return new Response(
        JSON.stringify({ data, status: response.status }),
        { status: response.ok ? 200 : response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list-users") {
      // List users (to get technician IDs)
      let page = 1;
      const allUsers: any[] = [];
      const MAX_PAGES = 10;

      while (page <= MAX_PAGES) {
        const url = `${AUVO_BASE_URL}/users/?page=${page}&pageSize=100`;
        const response = await fetch(url, { headers });

        if (response.status === 404) break;
        if (!response.ok) {
          const text = await response.text();
          console.error(`[auvo-task-update] Users page ${page} error: ${text.substring(0, 200)}`);
          break;
        }

        const json = await response.json();
        const users = json?.result?.entityList || json?.result || [];
        if (!Array.isArray(users) || users.length === 0) break;

        allUsers.push(...users);
        page++;
      }

      return new Response(
        JSON.stringify({ data: allUsers, status: 200 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list-task-types") {
      const all = await listTaskTypesFromAuvo(headers);
      console.log(`[auvo-task-update] list-task-types: path=tasktypes count=${all.length}`);
      return new Response(
        JSON.stringify({ data: all, status: 200, _debug: { path: "tasktypes", count: all.length } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "set-task-duration" || action === "edit-schedule") {
      const taskId = Number(body?.taskId);
      if (!Number.isFinite(taskId) || taskId <= 0) {
        return new Response(
          JSON.stringify({ error: "taskId é obrigatório" }),
          { status: 400, headers: respHeaders },
        );
      }

      const task = await fetchTaskById(taskId, headers);
      const currentTaskTypeId = Number(
        task?.taskType?.id ?? task?.taskTypeId ?? task?.taskType,
      );
      const patches: Array<{ op: string; path: string; value: unknown }> = [];
      let durationResolution: AuvoTaskTypeResolution | null = null;

      if (body?.durationMinutes !== undefined) {
        if (!Number.isFinite(currentTaskTypeId) || currentTaskTypeId <= 0) {
          throw new Error(`Tarefa ${taskId} não devolveu um tipo de tarefa válido`);
        }
        durationResolution = await ensureTaskTypeDuration(
          currentTaskTypeId,
          body.durationMinutes,
          headers,
          reqId,
        );
        if (durationResolution.id !== currentTaskTypeId) {
          patches.push({ op: "replace", path: "/taskType", value: durationResolution.id });
        }
      }

      if (action === "edit-schedule") {
        if (body?.taskDate) {
          patches.push({ op: "replace", path: "/taskDate", value: String(body.taskDate) });
        }
        if (body?.idUserTo !== undefined && body?.idUserTo !== null && body?.idUserTo !== "") {
          const idUserTo = Number(body.idUserTo);
          if (!Number.isFinite(idUserTo) || idUserTo <= 0) throw new Error("idUserTo inválido");
          patches.push({ op: "replace", path: "/idUserTo", value: idUserTo });
        }
      }

      if (patches.length > 0) {
        const response = await patchWithRetry(`${AUVO_BASE_URL}/tasks/${taskId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(patches),
        }, reqId);
        const responseText = await response.text();
        let responseData: any;
        try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }
        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, status: response.status, data: responseData, reqId }),
            { status: 200, headers: respHeaders },
          );
        }
      }

      const verifiedTask = await fetchTaskById(taskId, headers);
      const actualDurationMinutes = parseAuvoDurationMinutes(
        verifiedTask?.estimatedDuration ?? verifiedTask?.estimated_duration,
      );
      const requestedDurationMinutes = durationResolution?.durationMinutes || null;
      const durationVerified = requestedDurationMinutes === null || actualDurationMinutes === requestedDurationMinutes;

      return new Response(
        JSON.stringify({
          success: true,
          status: 200,
          taskId,
          patches,
          duration: durationResolution ? {
            requestedMinutes: requestedDurationMinutes,
            actualMinutes: actualDurationMinutes || null,
            verified: durationVerified,
            taskTypeId: durationResolution.id,
            baseTaskTypeId: durationResolution.baseId,
            managedTaskType: durationResolution.managed,
          } : null,
          warning: durationResolution && !durationVerified
            ? `Auvo não confirmou a duração solicitada (${requestedDurationMinutes} min)`
            : null,
          reqId,
        }),
        { status: 200, headers: respHeaders },
      );
    }

    if (action === "list-questionnaires") {
      // Lista questionários disponíveis no Auvo (v2: GET /questionnaires/)
      const candidates = ["questionnaires", "questionnaire"];
      const all: any[] = [];
      let lastErr = "";
      let usedPath = "";
      for (const path of candidates) {
        let page = 1;
        let gotAny = false;
        while (page <= 10) {
          const url = `${AUVO_BASE_URL}/${path}/?paramFilter=${encodeURIComponent(JSON.stringify({}))}&page=${page}&pageSize=100`;
          const response = await fetch(url, { headers });
          if (!response.ok) {
            lastErr = `${path} p${page} HTTP ${response.status}`;
            break;
          }
          const json = await response.json();
          const items = json?.result?.entityList || json?.result || json?.data || [];
          if (!Array.isArray(items) || items.length === 0) break;
          all.push(...items);
          gotAny = true;
          if (items.length < 100) break;
          page++;
        }
        if (gotAny) { usedPath = path; break; }
      }
      console.log(`[auvo-task-update] list-questionnaires: path=${usedPath} count=${all.length} lastErr=${lastErr}`);
      return new Response(
        JSON.stringify({ data: all, status: 200, _debug: { path: usedPath, count: all.length, lastErr } }),
        { status: 200, headers: respHeaders }
      );
    }

    if (action === "create-preventive-task") {
      // Cria uma tarefa de preventiva no Auvo a partir de um equipamento
      // body: { auvoEquipmentId, idUserTo, taskTypeId, dateISO ("YYYY-MM-DD"),
      //         startTime ("HH:mm"), durationMinutes?, orientation?, priority? }
      const {
        auvoEquipmentId,
        idUserTo,
        taskTypeId,
        dateISO,
        startTime = "08:00",
        durationMinutes = 120,
        orientation = "",
        priority = 1,
        questionnaireId = null,
      } = body || {};

      if (!auvoEquipmentId || !idUserTo || !taskTypeId || !dateISO) {
        return new Response(
          JSON.stringify({ error: "auvoEquipmentId, idUserTo, taskTypeId e dateISO são obrigatórios" }),
          { status: 400, headers: respHeaders }
        );
      }

      // 1) Buscar equipamento para obter customerId / address
      const eqUrl = `${AUVO_BASE_URL}/equipments/${auvoEquipmentId}`;
      const eqResp = await fetch(eqUrl, { headers });
      const eqData = await eqResp.json().catch(() => ({}));
      if (!eqResp.ok) {
        return new Response(
          JSON.stringify({ error: "Falha ao buscar equipamento no Auvo", status: eqResp.status, data: eqData }),
          { status: 200, headers: respHeaders }
        );
      }
      const eq = eqData?.result || eqData;
      const customerId = Number(eq?.associatedCustomerId ?? eq?.customerId ?? eq?.idCustomer ?? 0);
      if (!customerId) {
        return new Response(
          JSON.stringify({ error: "Equipamento não está vinculado a um cliente no Auvo (associatedCustomerId)" }),
          { status: 200, headers: respHeaders }
        );
      }

      // 2) Buscar cliente para pegar endereço
      const custUrl = `${AUVO_BASE_URL}/customers/${customerId}`;
      const custResp = await fetch(custUrl, { headers });
      const custData = await custResp.json().catch(() => ({}));
      const cust = custData?.result || custData || {};

      // 3) Resolver o tipo que representa a duração solicitada.
      // A API v2 deriva estimatedDuration de tasktypes.standartTime. Para
      // manter duração por agendamento sem alterar o tipo original, usamos
      // uma variante gerenciada e reutilizável do tipo selecionado.
      const durationResolution = await ensureTaskTypeDuration(
        Number(taskTypeId),
        durationMinutes,
        headers,
        reqId,
      );

      // 4) Montar a data de início
      const startISO = `${dateISO}T${startTime}:00`;

      // 5) Payload oficial Auvo (POST /tasks/). taskEndDate e
      // estimatedDuration não fazem parte do contrato de escrita de tasks.
      const taskPayload: any = {
        idUserFrom: Number(idUserTo),
        idUserTo: Number(idUserTo),
        customerId: Number(customerId),
        taskType: durationResolution.id,
        taskDate: startISO,
        priority: Number(priority),
        orientation: String(orientation || "Preventiva programada").substring(0, 5000),
        equipmentsId: [Number(auvoEquipmentId)],
        address: cust?.address || eq?.address || "Endereço não informado",
        latitude: Number(cust?.latitude ?? eq?.latitude ?? 0),
        longitude: Number(cust?.longitude ?? eq?.longitude ?? 0),
        sendSatisfactionSurvey: !!durationResolution.raw?.sendSatisfactionSurvey,
      };

      const defaultQuestionnaireId = Number(
        durationResolution.raw?.standartQuestionnaireId ??
        durationResolution.raw?.standardQuestionnaireId ??
        0,
      );
      const selectedQuestionnaireId = questionnaireId != null && String(questionnaireId).trim() !== ""
        ? Number(questionnaireId)
        : defaultQuestionnaireId;
      if (selectedQuestionnaireId > 0) taskPayload.questionnaireId = selectedQuestionnaireId;

      const url = `${AUVO_BASE_URL}/tasks/`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(taskPayload),
        });
      } catch (err) {
        console.error(`[auvo-task-update][reqId=${reqId}] create-preventive-task erro de rede:`, err);
        return new Response(
          JSON.stringify({ success: false, status: 503, retryable: true, message: "Auvo instável. Tente novamente.", reqId }),
          { status: 200, headers: respHeaders }
        );
      }

      const respText = await response.text();
      let data: any;
      try { data = JSON.parse(respText); } catch { data = { raw: respText }; }

      if (!response.ok) {
        console.error(`[auvo-task-update][reqId=${reqId}] create-preventive-task Auvo ${response.status}:`, respText);
      }

      // Auvo costuma devolver taskId em result.taskID (sucesso = 200/201)
      const r = data?.result ?? {};
      const newTaskId =
        r?.taskID ?? r?.taskId ?? r?.id ??
        r?.entity?.taskID ?? r?.entity?.taskId ?? r?.entity?.id ??
        r?.task?.taskID ?? r?.task?.taskId ?? r?.task?.id ??
        data?.taskID ?? data?.taskId ?? data?.id ?? null;
      console.log(`[auvo-task-update][reqId=${reqId}] create-preventive-task status=${response.status} taskId=${newTaskId} body=`, respText.substring(0, 800));

      let actualDurationMinutes = parseAuvoDurationMinutes(
        r?.estimatedDuration ?? r?.estimated_duration,
      );
      if (response.ok && newTaskId && !actualDurationMinutes) {
        try {
          const verifiedTask = await fetchTaskById(Number(newTaskId), headers);
          actualDurationMinutes = parseAuvoDurationMinutes(
            verifiedTask?.estimatedDuration ?? verifiedTask?.estimated_duration,
          );
        } catch (verifyError) {
          console.warn(`[auvo-task-update][reqId=${reqId}] não foi possível verificar duração da tarefa ${newTaskId}:`, verifyError);
        }
      }
      const durationVerified = actualDurationMinutes === durationResolution.durationMinutes;

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: response.status,
          taskId: newTaskId,
          data,
          payload: taskPayload,
          duration: {
            requestedMinutes: durationResolution.durationMinutes,
            actualMinutes: actualDurationMinutes || null,
            verified: durationVerified,
            taskTypeId: durationResolution.id,
            baseTaskTypeId: durationResolution.baseId,
            managedTaskType: durationResolution.managed,
          },
          warning: response.ok && !durationVerified
            ? `Tarefa criada, mas o Auvo não confirmou ${durationResolution.durationMinutes} min de duração`
            : null,
          reqId,
        }),
        { status: response.ok ? 200 : 200, headers: respHeaders }
      );
    }

    if (action === "list-customers") {
      const { forceRefresh = false } = body;
      const admin = getAdminClient();

      if (!forceRefresh) {
        // Tenta buscar do cache primeiro
        const { data: cache, error: cacheErr } = await admin
          .from("auvo_clientes_cache")
          .select("auvo_id, nome, endereco")
          .eq("ativo", true)
          .order("nome");

        if (!cacheErr && cache && cache.length > 0) {
          console.log(`[auvo-task-update][reqId=${reqId}] list-customers returning from cache (count=${cache.length})`);
          return new Response(
            JSON.stringify({
              data: cache.map(c => ({ id: c.auvo_id, name: c.nome, address: c.endereco })),
              status: 200,
              cached: true
            }),
            { status: 200, headers: respHeaders }
          );
        }
      }

      // Se forceRefresh ou cache vazio, busca da API
      console.log(`[auvo-task-update][reqId=${reqId}] list-customers fetching from API (forceRefresh=${forceRefresh})`);
      let page = 1;
      const all: any[] = [];
      while (page <= 50) {
        const url = `${AUVO_BASE_URL}/customers/?paramFilter=${encodeURIComponent(JSON.stringify({ active: true }))}&page=${page}&pageSize=100`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) break;
        const json = await resp.json();
        const items = json?.result?.entityList || json?.result || [];
        if (!Array.isArray(items) || items.length === 0) break;
        all.push(...items);
        if (items.length < 100) break;
        page++;
      }

      if (all.length > 0) {
        const rows = all.map(c => ({
          auvo_id: Number(c.customerId ?? c.id),
          nome: String(c.name ?? c.tradeName ?? c.description ?? c.legalName ?? "Sem Nome"),
          external_id: String(c.externalId || "").trim() || null,
          cpf_cnpj: String(c.cpfCnpj || "").replace(/\D/g, "") || null,
          nome_legal: String(c.legalName || c.companyName || "").trim() || null,
          ativo: c.active !== false,
          endereco: c.address ?? null,
          cidade: c.city ?? null,
          estado: c.state ?? null,
          bairro: c.neighborhood ?? null,
          cep: c.zipCode ?? null,
          atualizado_em: new Date().toISOString()
        })).filter(r => !isNaN(r.auvo_id));

        const { error: upsertErr } = await admin
          .from("auvo_clientes_cache")
          .upsert(rows, { onConflict: "auvo_id" });

        if (upsertErr) console.error(`[auvo-task-update][reqId=${reqId}] cache upsert error:`, upsertErr);
      }

      return new Response(JSON.stringify({ data: all, status: 200, cached: false }), { status: 200, headers: respHeaders });
    }

    if (action === "list-customer-equipments") {
      const { customerId } = body;
      if (!customerId) {
        return new Response(JSON.stringify({ error: "customerId obrigatório" }), { status: 400, headers: respHeaders });
      }
      // API v2: o filtro correto é associatedCustomerId (customerId é ignorado e devolve tudo)
      const all: any[] = [];
      let page = 1;
      let lastStatus = 200;
      while (page <= 10) {
        const filter = JSON.stringify({ associatedCustomerId: Number(customerId), active: true });
        const url = `${AUVO_BASE_URL}/equipments/?paramFilter=${encodeURIComponent(filter)}&page=${page}&pageSize=100`;
        const resp = await fetch(url, { headers });
        lastStatus = resp.status;
        if (!resp.ok) break;
        const json = await resp.json().catch(() => ({}));
        const items = json?.result?.entityList || json?.result || [];
        if (!Array.isArray(items) || items.length === 0) break;
        all.push(...items);
        if (items.length < 100) break;
        page++;
      }
      const filtered = all.filter((e: any) =>
        String(e?.associatedCustomerId ?? e?.customerId ?? "") === String(customerId)
      );
      console.log(`[auvo-task-update][reqId=${reqId}] list-customer-equipments customer=${customerId} total=${all.length} filtrados=${filtered.length}`);
      return new Response(
        JSON.stringify({ data: filtered.length > 0 ? filtered : all, status: lastStatus }),
        { status: 200, headers: respHeaders }
      );
    }

    if (action === "create-task") {
      const {
        customerId,
        idUserTo,
        idUserFrom = null,
        taskTypeId,
        dateISO,
        startTime = "08:00",
        durationMinutes = 60,
        orientation = "",
        questionnaireId = null,
        equipmentId = null,
        equipmentIds = null,
        priority = 1,
        checkinType = 1,
        externalId = null,
        sendSatisfactionSurvey = false,
      } = body || {};

      if (!customerId || !idUserTo || !taskTypeId || !dateISO || !startTime) {
        return new Response(
          JSON.stringify({ success: false, error: "customerId, idUserTo, taskTypeId, dateISO e startTime são obrigatórios" }),
          { status: 200, headers: respHeaders }
        );
      }
      const dur = Math.max(15, Math.round(Number(durationMinutes) || 60));

      // Endereço/geolocalização vêm preferencialmente do cliente (regra Auvo)
      const custResp = await fetch(`${AUVO_BASE_URL}/customers/${customerId}`, { headers });
      const custJson = await custResp.json().catch(() => ({}));
      const cust = custJson?.result || custJson || {};
      if (!custResp.ok) {
        console.error(`[auvo-task-update][reqId=${reqId}] create-task cliente ${customerId} HTTP ${custResp.status}`);
      }

      const startISO = `${dateISO}T${startTime}:00`;
      const start = new Date(startISO);
      if (Number.isNaN(start.getTime())) {
        return new Response(
          JSON.stringify({ success: false, error: "Data/hora inválida" }),
          { status: 200, headers: respHeaders }
        );
      }

      // A API v2 calcula estimatedDuration a partir de tasktypes.standartTime.
      // Resolve uma variante gerenciada para que a duração escolhida pelo
      // usuário seja realmente aplicada também nas tarefas gerais.
      const durationResolution = await ensureTaskTypeDuration(
        Number(taskTypeId),
        dur,
        headers,
        reqId,
      );

      const eqList: number[] = (Array.isArray(equipmentIds) ? equipmentIds : equipmentId ? [equipmentId] : [])
        .map((v: unknown) => Number(v))
        .filter((n: number) => Number.isFinite(n) && n > 0);

      const taskPayload: any = {
        idUserFrom: Number(idUserFrom || idUserTo),
        idUserTo: Number(idUserTo),
        customerId: Number(customerId),
        taskType: durationResolution.id,
        taskDate: startISO,
        priority: Number(priority) || 1,
        checkinType: Number(checkinType) || 1,
        orientation: String(orientation || "Tarefa agendada").substring(0, 500),
        address: cust?.address || "Endereço não informado",
        latitude: Number(cust?.latitude ?? 0),
        longitude: Number(cust?.longitude ?? 0),
        sendSatisfactionSurvey: Boolean(sendSatisfactionSurvey || durationResolution.raw?.sendSatisfactionSurvey),
      };
      if (eqList.length > 0) taskPayload.equipmentsId = eqList;
      const defaultQuestionnaireId = Number(
        durationResolution.raw?.standartQuestionnaireId ??
        durationResolution.raw?.standardQuestionnaireId ??
        0,
      );
      const selectedQuestionnaireId = questionnaireId != null && String(questionnaireId).trim() !== ""
        ? Number(questionnaireId)
        : defaultQuestionnaireId;
      if (selectedQuestionnaireId > 0) taskPayload.questionnaireId = selectedQuestionnaireId;
      if (externalId) taskPayload.externalId = String(externalId);

      let response: Response;
      try {
        response = await fetch(`${AUVO_BASE_URL}/tasks/`, {
          method: "POST",
          headers,
          body: JSON.stringify(taskPayload),
        });
      } catch (err) {
        console.error(`[auvo-task-update][reqId=${reqId}] create-task erro de rede:`, err);
        return new Response(
          JSON.stringify({ success: false, retryable: true, error: "Auvo instável. Tente novamente." }),
          { status: 200, headers: respHeaders }
        );
      }

      const respText = await response.text();
      let data: any;
      try { data = JSON.parse(respText); } catch { data = { raw: respText }; }
      const r = data?.result ?? {};
      const newId =
        r?.taskID ?? r?.taskId ?? r?.id ??
        r?.entity?.taskID ?? r?.entity?.taskId ??
        data?.taskID ?? data?.taskId ?? null;

      if (!response.ok) {
        console.error(`[auvo-task-update][reqId=${reqId}] create-task Auvo ${response.status}:`, respText.substring(0, 800));
      }
      console.log(`[auvo-task-update][reqId=${reqId}] create-task status=${response.status} taskId=${newId}`);

      let actualDurationMinutes = parseAuvoDurationMinutes(
        r?.estimatedDuration ?? r?.estimated_duration,
      );
      if (response.ok && newId && !actualDurationMinutes) {
        try {
          const verifiedTask = await fetchTaskById(Number(newId), headers);
          actualDurationMinutes = parseAuvoDurationMinutes(
            verifiedTask?.estimatedDuration ?? verifiedTask?.estimated_duration,
          );
        } catch (verifyError) {
          console.warn(`[auvo-task-update][reqId=${reqId}] não foi possível verificar duração da tarefa ${newId}:`, verifyError);
        }
      }
      const durationVerified = actualDurationMinutes === durationResolution.durationMinutes;

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: response.status,
          taskId: newId ? String(newId) : null,
          error: response.ok ? null : (data?.message || data?.error || data?.raw || `HTTP ${response.status}`),
          data,
          payload: taskPayload,
          duration: {
            requestedMinutes: durationResolution.durationMinutes,
            actualMinutes: actualDurationMinutes || null,
            verified: durationVerified,
            taskTypeId: durationResolution.id,
            baseTaskTypeId: durationResolution.baseId,
            managedTaskType: durationResolution.managed,
          },
          warning: response.ok && !durationVerified
            ? `Tarefa criada, mas o Auvo não confirmou ${durationResolution.durationMinutes} min de duração`
            : null,
          reqId,
        }),
        { status: 200, headers: respHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: `action inválida: ${action}. Use: edit, edit-schedule, set-task-duration, sync-local, promote-budget-forecast, upsert, get, get-equipment, list-users, list-task-types, list-questionnaires, list-customers, list-customer-equipments, create-task, create-preventive-task, persist-central` }),
      { status: 400, headers: respHeaders }
    );
  } catch (error) {
    console.error(`[auvo-task-update][reqId=${reqId}] Erro:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, reqId }),
      { status: 500, headers: respHeaders }
    );
  }
});
