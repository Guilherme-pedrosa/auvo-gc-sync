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
    const { startDate, endDate } = body;

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
    {
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

    const allTasks: any[] = [];
    let page = 1;
    const pageSize = 100;
    const MAX_PAGES = 20;
    const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };

    while (page <= MAX_PAGES) {
      const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
      const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;

      const response = await fetch(url, { headers });

      if (response.status === 404) break;
      if (!response.ok) {
        const text = await response.text();
        console.error(`[auvo-agenda] page ${page} error ${response.status}: ${text.substring(0, 200)}`);
        break;
      }

      const json = await response.json();
      const tasks = json?.result?.entityList || json?.result?.Entities || json?.result?.tasks || json?.result || [];
      if (!Array.isArray(tasks) || tasks.length === 0) break;

      allTasks.push(...tasks);
      if (tasks.length < pageSize) break;
      page++;
    }

    // Debug: log first task's raw keys
    if (allTasks.length > 0) {
      const sample = allTasks[0];
      console.log("[auvo-agenda] Sample task keys:", Object.keys(sample));
      console.log("[auvo-agenda] Sample task:", JSON.stringify(sample).substring(0, 1000));
    }

    // Map to simplified format
    const mapped = allTasks.map((t: any) => {
      const taskId = String(t.taskID || t.taskId || t.id || "");

      // Customer: try multiple fields; listing may return them empty
      const custDesc = String(t.customerDescription || "").trim();
      const custName = String(t.customerName || t.customer?.tradeName || t.customer?.companyName || "").trim();
      // Fallback: extract from orientation (e.g. first line often has context)
      const orientation = String(t.orientation || "").trim();
      const cliente = custDesc || custName || "Sem cliente";

      // Technician - resolve from users map if userToName is empty
      const rawTecnico = String(t.userToName || "").trim();
      const tecnicoId = String(t.idUserTo || "");
      const tecnico = rawTecnico || usersMap.get(tecnicoId) || "Sem técnico";

      // Date
      const rawDate = String(t.taskDate || "");
      const taskDate = rawDate ? rawDate.substring(0, 10) : "";

      // Status
      const statusDesc = String(t.taskStatus?.description || t.status?.description || "").trim();
      const status = statusDesc || (t.finished ? "Finalizada" : (t.checkIn ? "Em andamento" : "Agendada"));

      // Times
      const startTime = String(t.startTime || t.startHour || "");
      const endTime = String(t.endTime || t.endHour || "");

      // Address
      const address = typeof t.address === "object" ? "" : String(t.address || "").substring(0, 200);

      // Description
      const description = String(t.orientation || t.description || "").substring(0, 500);

      return {
        auvo_task_id: taskId,
        cliente,
        tecnico,
        tecnico_id: tecnicoId,
        data_tarefa: taskDate,
        hora_inicio: startTime,
        hora_fim: endTime,
        status_auvo: status,
        endereco: address,
        descricao: description,
        check_in: !!t.checkIn,
        check_out: !!t.checkOut,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
      };
    });

    // Enrich with GC values from tarefas_central
    const taskIds = mapped.map(m => m.auvo_task_id);
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const valoresMap = new Map<string, any>();
    if (taskIds.length > 0) {
      // Query in batches of 200
      for (let i = 0; i < taskIds.length; i += 200) {
        const batch = taskIds.slice(i, i + 200);
        const { data: rows } = await sb
          .from("tarefas_central")
          .select("auvo_task_id, gc_os_valor_total, gc_orc_valor_total, gc_os_situacao, gc_os_codigo, gc_os_link, gc_orc_situacao, gc_orcamento_codigo, gc_orc_link, pendencia")
          .in("auvo_task_id", batch);
        if (rows) {
          for (const row of rows) valoresMap.set(row.auvo_task_id, row);
        }
      }
    }

    const enriched = mapped.map(m => {
      const gc = valoresMap.get(m.auvo_task_id);
      return {
        ...m,
        gc_os_valor_total: gc?.gc_os_valor_total ?? null,
        gc_orc_valor_total: gc?.gc_orc_valor_total ?? null,
        gc_os_situacao: gc?.gc_os_situacao ?? null,
        gc_os_codigo: gc?.gc_os_codigo ?? null,
        gc_os_link: gc?.gc_os_link ?? null,
        gc_orc_situacao: gc?.gc_orc_situacao ?? null,
        gc_orcamento_codigo: gc?.gc_orcamento_codigo ?? null,
        gc_orc_link: gc?.gc_orc_link ?? null,
        pendencia: gc?.pendencia ?? null,
      };
    });

    return new Response(
      JSON.stringify({ data: enriched, total: enriched.length }),
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
