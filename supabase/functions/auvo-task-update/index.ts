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
    mirror_key: `${taskId}::os:${String(row?.gc_os_id || "")}::orc:${String(row?.gc_orcamento_id || "")}`,
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
        const targetMirrorKey = mirror_key || `${auvo_task_id}::os:${String(row?.gc_os_id || "")}::orc:${String(row?.gc_orcamento_id || "")}`;

        const { data: updatedRow, error: updateError } = await admin
          .from("tarefas_central")
          .update(patch)
          .eq("mirror_key", targetMirrorKey)
          .select("mirror_key")
          .limit(1)
          .maybeSingle();

        if (updateError) throw updateError;

        if (!updatedRow) {
          const { error: insertError } = await admin
            .from("tarefas_central")
            .insert({ ...row, mirror_key: targetMirrorKey });
          if (insertError) throw insertError;
        }

        return new Response(
          JSON.stringify({ success: true, count: 1, status: 200 }),
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
      // PATCH é idempotente para os campos enviados → retry seguro em 502/503/timeout
      let response: Response;
      try {
        response = await patchWithRetry(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(patches),
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
      try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

      return new Response(
        JSON.stringify({ data, status: response.status, reqId }),
        { status: response.ok ? 200 : response.status, headers: respHeaders }
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

      // 4) Payload Auvo (PUT /tasks)
      const taskPayload: any = {
        idUserTo: Number(idUserTo),
        customerId: Number(customerId),
        taskType: Number(taskTypeId),
        taskDate: startISO,
        taskEndDate: endISO,
        priority: Number(priority),
        orientation: String(orientation || "Preventiva programada").substring(0, 500),
        equipmentsId: [String(auvoEquipmentId)],
        address: {
          address: cust?.address || "",
          latitude: cust?.latitude ?? 0,
          longitude: cust?.longitude ?? 0,
        },
        sendSatisfactionSurvey: false,
      };

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

      // Auvo costuma devolver taskId em result.taskID (sucesso = 200/201)
      const newTaskId =
        data?.result?.taskID ?? data?.result?.taskId ?? data?.result?.id ?? null;

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

    return new Response(
      JSON.stringify({ error: `action inválida: ${action}. Use: edit, upsert, get, get-equipment, list-users, list-task-types, create-preventive-task, persist-central` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[auvo-task-update][reqId=${reqId}] Erro:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, reqId }),
      { status: 500, headers: respHeaders }
    );
  }
});
