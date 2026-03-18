import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

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

function sanitizeCentralRow(row: any) {
  const taskId = String(row?.auvo_task_id || "").trim();
  if (!taskId) return null;

  const result: any = {
    auvo_task_id: taskId,
    cliente: row?.cliente ?? null,
    tecnico: row?.tecnico ?? null,
    tecnico_id: row?.tecnico_id ?? null,
    data_tarefa: row?.data_tarefa ?? null,
    status_auvo: row?.status_auvo ?? null,
    hora_inicio: row?.hora_inicio ?? null,
    hora_fim: row?.hora_fim ?? null,
    check_in: row?.check_in ?? null,
    check_out: row?.check_out ?? null,
    endereco: row?.endereco ?? null,
    auvo_link: row?.auvo_link ?? null,
    orientacao: row?.orientacao ?? row?.descricao ?? null,
    gc_os_codigo: row?.gc_os_codigo ?? null,
    gc_os_situacao: row?.gc_os_situacao ?? null,
    gc_os_valor_total: row?.gc_os_valor_total ?? null,
    gc_os_link: row?.gc_os_link ?? null,
    gc_orcamento_codigo: row?.gc_orcamento_codigo ?? null,
    gc_orc_situacao: row?.gc_orc_situacao ?? null,
    gc_orc_valor_total: row?.gc_orc_valor_total ?? null,
    gc_orc_link: row?.gc_orc_link ?? null,
    pendencia: row?.pendencia ?? null,
    equipamento_nome: row?.equipamento_nome ?? null,
    equipamento_id_serie: row?.equipamento_id_serie ?? null,
    atualizado_em: new Date().toISOString(),
  };

  // Include questionario_respostas if provided
  if (row?.questionario_respostas !== undefined) {
    result.questionario_respostas = row.questionario_respostas;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("AUVO_APP_KEY");
    const apiToken = Deno.env.get("AUVO_TOKEN");
    if (!apiKey || !apiToken) {
      return new Response(
        JSON.stringify({ error: "Credenciais Auvo não configuradas" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;

    if (action === "persist-central") {
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
      const { error } = await admin
        .from("tarefas_central")
        .upsert(rows, { onConflict: "auvo_task_id" });

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
      const response = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patches),
      });

      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

      return new Response(
        JSON.stringify({ data, status: response.status }),
        { status: response.ok ? 200 : response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "upsert") {
      // Upsert task (create or update)
      // body: { action: "upsert", task: { id, idUserTo, taskDate, ... } }
      const { task } = body;
      if (!task) {
        return new Response(
          JSON.stringify({ error: "task é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const url = `${AUVO_BASE_URL}/tasks`;
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(task),
      });

      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

      return new Response(
        JSON.stringify({ data, status: response.status }),
        { status: response.ok ? 200 : response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get") {
      // Get single task
      const { taskId } = body;
      if (!taskId) {
        return new Response(
          JSON.stringify({ error: "taskId é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const url = `${AUVO_BASE_URL}/tasks/${taskId}`;
      const response = await fetch(url, { headers });
      const data = await response.json().catch(() => ({}));

      return new Response(
        JSON.stringify({ data, status: response.status }),
        { status: response.ok ? 200 : response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    return new Response(
      JSON.stringify({ error: `action inválida: ${action}. Use: edit, upsert, get, list-users, persist-central` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[auvo-task-update] Erro:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
