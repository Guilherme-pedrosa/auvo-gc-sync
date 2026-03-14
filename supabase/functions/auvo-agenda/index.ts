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

    // Map to simplified format
    const mapped = allTasks.map((t: any) => {
      const taskId = String(t.taskID || t.taskId || t.id || "");
      const customerName = t.customer?.name || t.customerName || t.customer_name || "";
      const userName = t.userTo?.name || t.user?.name || t.userName || "";
      const userId = String(t.userTo?.userID || t.idUserTo || t.user_id || "");
      const rawDate = t.taskDate || t.task_date || "";
      const taskDate = rawDate ? rawDate.substring(0, 10) : "";
      const startTime = t.startTime || t.start_time || t.hora_inicio || "";
      const endTime = t.endTime || t.end_time || t.hora_fim || "";
      const status = t.taskStatus?.description || t.status?.description || t.status || "";
      const address = t.address?.address || t.address || "";
      const description = t.orientation || t.description || "";
      const checkedIn = !!t.checkInDate;
      const checkedOut = !!t.checkOutDate;

      return {
        auvo_task_id: taskId,
        cliente: customerName,
        tecnico: userName,
        tecnico_id: userId,
        data_tarefa: taskDate,
        hora_inicio: startTime,
        hora_fim: endTime,
        status_auvo: status,
        endereco: address,
        descricao: description,
        check_in: checkedIn,
        check_out: checkedOut,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
      };
    });

    return new Response(
      JSON.stringify({ data: mapped, total: mapped.length }),
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
