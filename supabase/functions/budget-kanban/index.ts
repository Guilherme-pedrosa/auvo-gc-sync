const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const QUESTIONNAIRE_ID = "216040";
const GC_ATRIBUTO_TAREFA_OS = "73341";
const MIN_DELAY_MS = 200;
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

// Fetch Auvo tasks that have questionnaire 216040
async function fetchAuvoTasksWithQuestionnaire(
  bearerToken: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 20;

  const formattedStart = `${startDate}T00:00:00`;
  const formattedEnd = `${endDate}T23:59:59`;

  while (page <= MAX_PAGES) {
    const filterObj = { startDate: formattedStart, endDate: formattedEnd };
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    console.log(`[budget-kanban] Auvo page ${page}`);
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");

    if (response.status === 404) {
      console.log(`[budget-kanban] Auvo 404 — sem tarefas no período`);
      break;
    }
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(`[budget-kanban] Auvo error ${response.status}: ${errBody.substring(0, 300)}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];

    // Log first task's customer fields for debugging
    if (page === 1 && entities.length > 0) {
      const t0 = entities[0];
      console.log(`[budget-kanban] Task sample customer fields: customerName=${t0.customerName}, customerId=${t0.customerId}, customer=${JSON.stringify(t0.customer)?.substring(0,300)}`);
    }

    // Filter tasks that have the target questionnaire
    for (const task of entities) {
      const questionnaires = task.questionnaires || [];
      const hasTarget = questionnaires.some(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      if (hasTarget) {
        allTasks.push(task);
      }
    }

    console.log(`[budget-kanban] Page ${page}: ${entities.length} tasks, ${allTasks.length} com questionário ${QUESTIONNAIRE_ID}`);
    if (entities.length < pageSize) break;
    page++;
  }

  return allTasks;
}

// Fetch GC orçamentos and build a map of taskID -> orçamento data
async function fetchGcOrcamentosMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string
): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 30;

  while (page <= totalPages && page <= MAX_PAGES) {
    let url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    if (startDate) url += `&data_inicio=${startDate}`;
    if (endDate) url += `&data_fim=${endDate}`;

    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");

    if (response.status === 429) {
      console.warn("[budget-kanban] GC rate limit — aguardando 3s...");
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) {
      console.error(`[budget-kanban] GC error: ${response.status}`);
      break;
    }

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const orc of records) {
      const atributos: any[] = orc.atributos || [];
      const attrTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        return String(nested.atributo_id || nested.id || "") === GC_ATRIBUTO_TAREFA_OS;
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
            gc_link: `https://gestaoclick.com/orcamentos/visualizar/${orc.id}`,
          };
        }
      }
    }

    console.log(`[budget-kanban] GC page ${page}/${totalPages}: ${records.length} orçamentos, ${Object.keys(map).length} com tarefa`);
    page++;
  }

  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date().toISOString().split("T")[0];
    const startDate = body.start_date || "2026-01-01";
    const endDate = body.end_date || today;

    console.log(`[budget-kanban] Período: ${startDate} a ${endDate}`);

    // Login Auvo
    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    const gcHeaders: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Fetch in parallel
    const [auvoTasks, gcMap] = await Promise.all([
      fetchAuvoTasksWithQuestionnaire(bearerToken, startDate, endDate),
      fetchGcOrcamentosMap(gcHeaders, startDate, endDate),
    ]);

    console.log(`[budget-kanban] Auvo tasks com questionário: ${auvoTasks.length}, GC orçamentos com tarefa: ${Object.keys(gcMap).length}`);

    // Build kanban items
    const items = auvoTasks.map((task: any) => {
      const taskId = String(task.taskID || "");
      const gcMatch = gcMap[taskId] || null;

      // Extract questionnaire answers
      const targetQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      const answers = (targetQ?.answers || []).map((a: any) => ({
        question: String(a.questionDescription || ""),
        reply: String(a.reply || ""),
      }));

      // Extract client name from multiple possible fields
      const clienteRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || 
        task.customerCompanyName || task.customerTradeName || ""
      ).trim();
      
      // Fallback: extract from orientation (usually first line has client info)
      let clienteFallback = "";
      if (!clienteRaw) {
        const orient = String(task.orientation || "");
        // Try patterns like "CLIENTE: xxx" or "NOME: xxx"
        const matchNome = orient.match(/(?:NOME|CLIENTE)\s*:\s*(.+?)(?:\n|$)/i);
        if (matchNome) clienteFallback = matchNome[1].trim();
        else clienteFallback = orient.split("\n")[0].substring(0, 80).trim();
      }

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/tarefas/visualizar/${taskId}`,
        cliente: clienteRaw || clienteFallback,
        tecnico: String(task.userToName || ""),
        data_tarefa: String(task.taskDate || "").split("T")[0],
        orientacao: String(task.orientation || "").substring(0, 200),
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        questionario_respostas: answers,
        // GC match
        orcamento_realizado: !!gcMatch,
        gc_orcamento: gcMatch,
      };
    });

    // Sort: pendentes primeiro, depois por data desc
    items.sort((a: any, b: any) => {
      if (a.orcamento_realizado !== b.orcamento_realizado) return a.orcamento_realizado ? 1 : -1;
      return b.data_tarefa.localeCompare(a.data_tarefa);
    });

    const resumo = {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas_com_questionario: items.length,
      orcamentos_realizados: items.filter((i: any) => i.orcamento_realizado).length,
      orcamentos_pendentes: items.filter((i: any) => !i.orcamento_realizado).length,
    };

    return new Response(JSON.stringify({ resumo, items }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[budget-kanban] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
