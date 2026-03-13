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

    if (response.status === 404) break;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(`[budget-kanban] Auvo error ${response.status}: ${errBody.substring(0, 300)}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];

    for (const task of entities) {
      const questionnaires = task.questionnaires || [];
      const hasTarget = questionnaires.some((q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID);
      if (hasTarget) allTasks.push(task);
    }

    console.log(`[budget-kanban] Page ${page}: ${entities.length} tasks, ${allTasks.length} com questionário ${QUESTIONNAIRE_ID}`);
    if (entities.length < pageSize) break;
    page++;
  }

  // Log sample task fields for debugging customer resolution
  if (allTasks.length > 0) {
    const sample = allTasks[0];
    console.log(`[budget-kanban] Sample task fields: taskID=${sample.taskID}, customerDescription=${sample.customerDescription}, customerName=${sample.customerName}, customerId=${sample.customerId}, externalId=${sample.externalId}, customer=${JSON.stringify(sample.customer)?.substring(0,500)}`);
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
      console.error(`[budget-kanban] GC orcamentos error: ${response.status}`);
      break;
    }

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

    console.log(`[budget-kanban] GC orçamentos page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  return map;
}

// Fetch GC ordens de serviço and build a map of taskID -> OS data
async function fetchGcOsMap(
  gcHeaders: Record<string, string>,
  startDate?: string,
  endDate?: string
): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 30;

  while (page <= totalPages && page <= MAX_PAGES) {
    let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    if (startDate) url += `&data_inicio=${startDate}`;
    if (endDate) url += `&data_fim=${endDate}`;

    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
    if (response.status === 429) {
      console.warn("[budget-kanban] GC OS rate limit — aguardando 3s...");
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) {
      console.error(`[budget-kanban] GC OS error: ${response.status}`);
      break;
    }

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

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
            gc_link: `https://gestaoclick.com/ordens_servicos/visualizar/${os.id}`,
          };
        }
      }
    }

    console.log(`[budget-kanban] GC OS page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
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

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Load conciliation snapshot for customer name mapping
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbClient = createClient(supabaseUrl, supabaseKey);

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

    // Fetch in parallel: Auvo tasks + GC orçamentos + GC OS
    const [auvoTasks, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasksWithQuestionnaire(bearerToken, startDate, endDate),
      fetchGcOrcamentosMap(gcH, startDate, endDate),
      fetchGcOsMap(gcH, startDate, endDate),
    ]);

    console.log(`[budget-kanban] Auvo tasks: ${auvoTasks.length}, GC orçamentos: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

    // Build kanban items
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

      const clienteRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || ""
      ).trim();
      const clienteSnapshot = auvoTaskClienteMap[taskId] || "";
      const clienteGc = gcOrcMatch?.gc_cliente || gcOsMatch?.gc_cliente || "";
      let clienteFallback = "";
      if (!clienteRaw && !clienteSnapshot && !clienteGc) {
        const orient = String(task.orientation || "");
        const matchNome = orient.match(/(?:NOME|CLIENTE)\s*:\s*(.+?)(?:\n|$)/i);
        if (matchNome) clienteFallback = matchNome[1].trim();
      }
      const cliente = clienteRaw || clienteSnapshot || clienteGc || clienteFallback || "";
      const needsCustomerLookup = !cliente && task.customerId;

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        cliente: cliente || "Cliente não identificado",
        _customerId: needsCustomerLookup ? String(task.customerId) : null,
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

    // Resolve unidentified customers via Auvo /customers/{id}
    const unresolvedItems = items.filter((i: any) => i._customerId);
    if (unresolvedItems.length > 0) {
      console.log(`[budget-kanban] Buscando ${unresolvedItems.length} clientes não identificados via Auvo API`);
      const customerCache: Record<string, string> = {};
      for (const item of unresolvedItems) {
        const cid = (item as any)._customerId;
        if (customerCache[cid]) {
          (item as any).cliente = customerCache[cid];
          continue;
        }
        try {
          const url = `${AUVO_BASE_URL}/customers/${cid}`;
          const resp = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
          if (resp.ok) {
            const cData = await resp.json();
            const cust = cData?.result;
            const name = String(cust?.tradeName || cust?.companyName || cust?.name || "").trim();
            if (name) {
              customerCache[cid] = name;
              (item as any).cliente = name;
              console.log(`[budget-kanban] Customer ${cid} → ${name}`);
            }
          }
        } catch (e) {
          console.warn(`[budget-kanban] Erro ao buscar customer ${cid}:`, e);
        }
      }
    }

    // Remove internal field
    for (const item of items) { delete (item as any)._customerId; }

    // Sort: pendentes primeiro, depois por data desc
    items.sort((a: any, b: any) => {
      const aHasGc = a.orcamento_realizado || a.os_realizada;
      const bHasGc = b.orcamento_realizado || b.os_realizada;
      if (aHasGc !== bHasGc) return aHasGc ? 1 : -1;
      return b.data_tarefa.localeCompare(a.data_tarefa);
    });

    const resumo = {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas_com_questionario: items.length,
      orcamentos_realizados: items.filter((i: any) => i.orcamento_realizado).length,
      os_realizadas: items.filter((i: any) => i.os_realizada).length,
      pendentes: items.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
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
