const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const GC_ATRIBUTO_TAREFA_OS = "73343";
const GC_ATRIBUTO_TAREFA_EXEC = "73344";
const GC_ATRIBUTO_TAREFA_ORC = "73341";

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`Auvo login failed (${response.status})`);
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

// Fetch all GC OS pages and build taskId -> OS map
async function fetchGcOsMap(gcHeaders: Record<string, string>): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    const response = await fetch(url, { headers: gcHeaders });
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
      const osData = {
        gc_os_codigo: String(os.codigo || ""),
        gc_os_situacao: String(os.nome_situacao || ""),
        gc_os_valor_total: parseFloat(os.valor_total || "0"),
        gc_os_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
      };

      // Check both attributes: 73343 (tarefa OS) and 73344 (tarefa execução)
      for (const attrId of [GC_ATRIBUTO_TAREFA_OS, GC_ATRIBUTO_TAREFA_EXEC]) {
        const attr = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === attrId;
        });
        if (attr) {
          const nested = attr?.atributo || attr;
          const taskId = String(nested?.conteudo || nested?.valor || "").trim();
          if (taskId && /^\d+$/.test(taskId)) {
            map.set(taskId, osData);
          }
        }
      }
    }
    page++;
  }
  console.log(`[auvo-agenda] GC OS map: ${map.size} entries`);
  return map;
}

// Fetch all GC orçamentos and build taskId -> orc map
async function fetchGcOrcMap(gcHeaders: Record<string, string>): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    const response = await fetch(url, { headers: gcHeaders });
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
          map.set(taskId, {
            gc_orcamento_codigo: String(orc.codigo || ""),
            gc_orc_situacao: String(orc.nome_situacao || ""),
            gc_orc_valor_total: parseFloat(orc.valor_total || "0"),
            gc_orc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
          });
        }
      }
    }
    page++;
  }
  console.log(`[auvo-agenda] GC Orc map: ${map.size} entries`);
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("AUVO_APP_KEY");
    const apiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

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

    // Fetch Auvo tasks + GC data in parallel
    const gcHeaders: Record<string, string> = gcAccessToken && gcSecretToken ? {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    } : {};
    const hasGc = !!gcAccessToken && !!gcSecretToken;

    const fetchTasks = async () => {
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
      return allTasks;
    };

    // Run in parallel: Auvo tasks + GC OS + GC Orçamentos
    const [allTasks, gcOsMap, gcOrcMap] = await Promise.all([
      fetchTasks(),
      hasGc ? fetchGcOsMap(gcHeaders) : Promise.resolve(new Map<string, any>()),
      hasGc ? fetchGcOrcMap(gcHeaders) : Promise.resolve(new Map<string, any>()),
    ]);

    console.log(`[auvo-agenda] ${allTasks.length} tasks, ${gcOsMap.size} OS, ${gcOrcMap.size} orçamentos`);

    // Map to simplified format + enrich with GC
    const enriched = allTasks.map((t: any) => {
      const taskId = String(t.taskID || t.taskId || t.id || "");

      const custDesc = String(t.customerDescription || "").trim();
      const custName = String(t.customerName || t.customer?.tradeName || t.customer?.companyName || "").trim();
      const cliente = custDesc || custName || "Sem cliente";

      const rawTecnico = String(t.userToName || "").trim();
      const tecnicoId = String(t.idUserTo || "");
      const tecnico = rawTecnico || usersMap.get(tecnicoId) || "Sem técnico";

      const rawDate = String(t.taskDate || "");
      const taskDate = rawDate ? rawDate.substring(0, 10) : "";

      const statusDesc = String(t.taskStatus?.description || t.status?.description || "").trim();
      const status = statusDesc || (t.finished ? "Finalizada" : (t.checkIn ? "Em andamento" : "Agendada"));

      // Extract time from taskDate and taskEndDate (format: 2025-03-16T08:00:00)
      const taskDateTime = rawDate.length >= 16 ? rawDate.substring(11, 16) : "";
      const rawEndDate = String(t.taskEndDate || t.endDate || t.scheduledEndDate || "");
      const taskEndDateTime = rawEndDate.length >= 16 ? rawEndDate.substring(11, 16) : "";
      const rawStartTime = String(t.startTime || t.startHour || "").trim();
      const rawEndTime = String(t.endTime || t.endHour || "").trim();
      const isFinished = !!t.finished || statusDesc === "Finalizada";
      
      // For non-finished tasks, prefer scheduled end time (taskEndDate) over actual endTime
      // because endTime may contain partial checkout timestamps
      const startTime = rawStartTime || taskDateTime || "";
      const endTime = isFinished
        ? (rawEndTime || taskEndDateTime || "")
        : (taskEndDateTime || rawEndTime || "");

      const address = typeof t.address === "object" ? "" : String(t.address || "").substring(0, 200);
      const description = String(t.orientation || t.description || "").substring(0, 500);

      // GC enrichment
      const os = gcOsMap.get(taskId);
      const orc = gcOrcMap.get(taskId);

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
        gc_os_codigo: os?.gc_os_codigo ?? null,
        gc_os_situacao: os?.gc_os_situacao ?? null,
        gc_os_valor_total: os?.gc_os_valor_total ?? null,
        gc_os_link: os?.gc_os_link ?? null,
        gc_orcamento_codigo: orc?.gc_orcamento_codigo ?? null,
        gc_orc_situacao: orc?.gc_orc_situacao ?? null,
        gc_orc_valor_total: orc?.gc_orc_valor_total ?? null,
        gc_orc_link: orc?.gc_orc_link ?? null,
        pendencia: null,
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
