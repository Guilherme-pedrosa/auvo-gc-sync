const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Auvo login failed (${response.status}): ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchAllTasks(
  bearerToken: string,
  startDate: string,
  endDate: string,
  status?: number // undefined = all statuses
): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 15;

  const filterObj: any = {
    startDate: `${startDate}T00:00:00`,
    endDate: `${endDate}T23:59:59`,
  };
  if (status !== undefined) filterObj.status = status;

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;
    const response = await fetch(url, { headers: auvoHeaders(bearerToken) });

    if (response.status === 404) break;
    if (!response.ok) {
      console.error(`[realtime-tracking] Page ${page}: ${response.status}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];
    allTasks.push(...entities);
    if (entities.length < pageSize) break;
    page++;
  }

  return allTasks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    if (!auvoApiKey || !auvoApiToken) {
      return new Response(JSON.stringify({ error: "Credenciais Auvo não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date().toISOString().split("T")[0];
    const targetDate = body.date || today;

    console.log(`[realtime-tracking] Buscando tarefas para ${targetDate}`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
    const tasks = await fetchAllTasks(bearerToken, targetDate, targetDate);

    console.log(`[realtime-tracking] Total: ${tasks.length} tarefas`);

    // Group by technician
    const techMap: Record<string, {
      id: string;
      nome: string;
      tarefas: any[];
    }> = {};

    for (const task of tasks) {
      const techId = String(task.idUserTo || task.userToId || task.collaboratorId || "");
      const techName = String(task.userToName || task.collaboratorName || "Desconhecido").trim();
      if (!techId || techName === "Desconhecido") continue;

      if (!techMap[techId]) {
        techMap[techId] = { id: techId, nome: techName, tarefas: [] };
      }

      // Determine status label
      let statusLabel = "Agendada";
      const s = task.status;
      if (s === 3 || task.finished === true || task.finished === "true") statusLabel = "Finalizada";
      else if (s === 2 || task.checkIn === true) statusLabel = "Em andamento";
      else if (s === 4) statusLabel = "Cancelada";
      else if (s === 1) statusLabel = "Agendada";

      const taskDate = String(task.taskDate || task.date || "").split("T")[0];
      const startTime = String(task.startTime || task.startHour || "");
      const endTime = String(task.endTime || task.endHour || "");
      const customer = task.customer?.name || task.customerName || task.customer || "";
      const address = task.address || task.customer?.address || "";

      techMap[techId].tarefas.push({
        taskId: String(task.taskID || task.id || ""),
        cliente: typeof customer === "object" ? customer.name || "" : String(customer),
        endereco: typeof address === "object" ? "" : String(address).substring(0, 100),
        status: statusLabel,
        horaInicio: startTime,
        horaFim: endTime,
        data: taskDate,
        checkIn: !!task.checkIn,
        checkOut: !!task.checkOut,
        pendencia: String(task.pendency ?? task.pendencia ?? "").trim(),
        descricao: String(task.description || task.orientation || "").substring(0, 150),
        duration: String(task.duration || ""),
      });
    }

    // Sort tasks by start time within each technician
    const tecnicos = Object.values(techMap).map((tech) => {
      tech.tarefas.sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""));
      const finalizadas = tech.tarefas.filter(t => t.status === "Finalizada").length;
      const emAndamento = tech.tarefas.filter(t => t.status === "Em andamento").length;
      const agendadas = tech.tarefas.filter(t => t.status === "Agendada").length;
      return {
        ...tech,
        resumo: {
          total: tech.tarefas.length,
          finalizadas,
          emAndamento,
          agendadas,
        }
      };
    }).sort((a, b) => {
      // Sort: em andamento first, then by total tasks
      if (a.resumo.emAndamento > 0 && b.resumo.emAndamento === 0) return -1;
      if (b.resumo.emAndamento > 0 && a.resumo.emAndamento === 0) return 1;
      return b.resumo.total - a.resumo.total;
    });

    return new Response(JSON.stringify({
      data: targetDate,
      total_tarefas: tasks.length,
      total_tecnicos: tecnicos.length,
      tecnicos,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[realtime-tracking] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
