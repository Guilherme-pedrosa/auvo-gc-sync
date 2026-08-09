import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Credenciais internas de banco não configuradas");
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
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

      const url = `${AUVO_BASE_URL}/tasks/${taskId}`;

      // Separa campos que a API v2 não aceita via PATCH (duração / data fim)
      const patchable = patches.filter((p: any) => !PATCH_UNSUPPORTED_PATHS.includes(p?.path));
      const upsertOnly = patches.filter((p: any) => PATCH_UNSUPPORTED_PATHS.includes(p?.path));

      let durationResult: any = null;
      if (upsertOnly.length > 0) {
        const fields: Record<string, unknown> = {};
        for (const p of upsertOnly) {
          if (p.path === "estimatedDuration") {
            const d = normalizeDuration(p.value);
            if (d) fields.estimatedDuration = d;
          } else if (p.path === "taskEndDate" && p.value) {
            fields.taskEndDate = p.value;
          }
        }
        // taskDate pode estar sendo alterado no mesmo request → aplicar junto no upsert
        const datePatch = patchable.find((p: any) => p.path === "taskDate");
        if (datePatch?.value) fields.taskDate = datePatch.value;

        if (Object.keys(fields).length > 0) {
          try {
            durationResult = await upsertTaskFields(taskId, fields, headers, reqId);
          } catch (err) {
            console.error(`[auvo-task-update][reqId=${reqId}] upsert duração falhou:`, err);
            durationResult = { ok: false, status: 503, body: { message: String(err) } };
          }
        }
      }

      if (patchable.length === 0) {
        return new Response(
          JSON.stringify({
            data: durationResult?.body ?? null,
            status: durationResult?.ok ? 200 : (durationResult?.status ?? 200),
            duration: durationResult,
            reqId,
          }),
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
        JSON.stringify({ data, status: response.status, duration: durationResult, reqId }),
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
      // List task types (used for Auvo dropdowns)
      // Auvo v2 expects /taskTypes/ with mandatory paramFilter query.
      const candidates = ["taskTypes", "tasksType", "taskType"];
      const all: any[] = [];
      let lastErr = "";
      let usedPath = "";
      for (const path of candidates) {
        let page = 1;
        const MAX_PAGES = 10;
        let gotAny = false;
        let failedPath = false;
        while (page <= MAX_PAGES) {
          const url = `${AUVO_BASE_URL}/${path}/?paramFilter=${encodeURIComponent(JSON.stringify({}))}&page=${page}&pageSize=100`;
          const response = await fetch(url, { headers });
          if (response.status === 404) { failedPath = true; break; }
          if (!response.ok) {
            const text = await response.text();
            lastErr = `${path} p${page} HTTP ${response.status}: ${text.substring(0, 200)}`;
            console.error(`[auvo-task-update] ${lastErr}`);
            failedPath = true;
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
        if (!failedPath) { usedPath = path; break; }
      }
      console.log(`[auvo-task-update] list-task-types: path=${usedPath} count=${all.length} lastErr=${lastErr}`);
      return new Response(
        JSON.stringify({ data: all, status: 200, _debug: { path: usedPath, count: all.length, lastErr } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      // 3) Montar datas
      const startISO = `${dateISO}T${startTime}:00`;
      const start = new Date(`${startISO}`);
      const end = new Date(start.getTime() + Number(durationMinutes) * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const endISO = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
      // Auvo lê a duração SEMPRE como relógio "HH:mm" (ex.: 20 min => "00:20", 2h => "02:00").
      const totalMinutes = Math.max(1, Math.round(Number(durationMinutes) || 0));
      const estimatedDuration = `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;

      // 4) Payload Auvo (PUT /tasks)
      const taskPayload: any = {
        idUserFrom: Number(idUserTo),
        idUserTo: Number(idUserTo),
        customerId: Number(customerId),
        taskType: Number(taskTypeId),
        taskDate: startISO,
        taskEndDate: endISO,
        estimatedDuration,
        priority: Number(priority),
        orientation: String(orientation || "Preventiva programada").substring(0, 500),
        equipmentsId: [String(auvoEquipmentId)],
        address: cust?.address || eq?.address || "Endereço não informado",
        latitude: Number(cust?.latitude ?? eq?.latitude ?? 0),
        longitude: Number(cust?.longitude ?? eq?.longitude ?? 0),
        sendSatisfactionSurvey: false,
      };

      if (questionnaireId != null && String(questionnaireId).trim() !== "") {
        taskPayload.questionnaireId = Number(questionnaireId);
      }

      const url = `${AUVO_BASE_URL}/tasks`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "PUT",
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

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: response.status,
          taskId: newTaskId,
          data,
          payload: taskPayload,
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
          auvo_id: Number(c.id ?? c.customerId),
          nome: String(c.description ?? c.name ?? "Sem Nome"),
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
      const end = new Date(start.getTime() + dur * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const endISO = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
      // Auvo lê a duração como relógio "HH:mm"
      const estimatedDuration = `${pad(Math.floor(dur / 60))}:${pad(dur % 60)}`;

      const eqList: number[] = (Array.isArray(equipmentIds) ? equipmentIds : equipmentId ? [equipmentId] : [])
        .map((v: unknown) => Number(v))
        .filter((n: number) => Number.isFinite(n) && n > 0);

      const taskPayload: any = {
        idUserFrom: Number(idUserFrom || idUserTo),
        idUserTo: Number(idUserTo),
        customerId: Number(customerId),
        taskType: Number(taskTypeId),
        taskDate: startISO,
        taskEndDate: endISO,
        estimatedDuration,
        priority: Number(priority) || 1,
        checkinType: Number(checkinType) || 1,
        orientation: String(orientation || "Tarefa agendada").substring(0, 500),
        address: cust?.address || "Endereço não informado",
        latitude: Number(cust?.latitude ?? 0),
        longitude: Number(cust?.longitude ?? 0),
        sendSatisfactionSurvey: Boolean(sendSatisfactionSurvey),
      };
      if (eqList.length > 0) taskPayload.equipmentsId = eqList;
      if (questionnaireId != null && String(questionnaireId).trim() !== "") {
        taskPayload.questionnaireId = Number(questionnaireId);
      }
      if (externalId) taskPayload.externalId = String(externalId);

      let response: Response;
      try {
        response = await fetch(`${AUVO_BASE_URL}/tasks`, {
          method: "PUT",
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

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: response.status,
          taskId: newId ? String(newId) : null,
          error: response.ok ? null : (data?.message || data?.error || data?.raw || `HTTP ${response.status}`),
          data,
          payload: taskPayload,
        }),
        { status: 200, headers: respHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: `action inválida: ${action}. Use: edit, upsert, get, get-equipment, list-users, list-task-types, list-questionnaires, list-customers, list-customer-equipments, create-task, create-preventive-task, persist-central` }),
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
