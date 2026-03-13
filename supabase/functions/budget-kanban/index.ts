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
const AUVO_SAFE_START = "2020-01-01";
const AUVO_SAFE_END = "2030-12-31";
const MIN_DELAY_MS = 200;
let lastAuvoCall = 0;
let lastGcCall = 0;

type AuvoFetchResult = {
  tasks: any[];
  hadError: boolean;
  errorMessage: string | null;
};

function inDateRange(dateValue: string | undefined, startDate: string, endDate: string): boolean {
  const dateOnly = String(dateValue || "").split("T")[0];
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return true;
  return dateOnly >= startDate && dateOnly <= endDate;
}

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
): Promise<AuvoFetchResult> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 20;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };
  let hadError = false;
  let errorMessage: string | null = null;

  console.log(`[budget-kanban] Auvo paramFilter: ${JSON.stringify(filterObj)}`);

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    console.log(`[budget-kanban] Auvo page ${page}`);
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");

    if (response.status === 404) break;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      hadError = true;
      errorMessage = `Auvo /tasks erro ${response.status}: ${errBody.substring(0, 300)}`;
      console.error(`[budget-kanban] ${errorMessage}`);
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

  if (allTasks.length > 0) {
    const sample = allTasks[0];
    console.log(`[budget-kanban] Sample task fields: taskID=${sample.taskID}, customerDescription=${sample.customerDescription}, customerName=${sample.customerName}, customerId=${sample.customerId}, externalId=${sample.externalId}, customer=${JSON.stringify(sample.customer)?.substring(0,500)}`);
  }

  return { tasks: allTasks, hadError, errorMessage };
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
            gc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbClient = createClient(supabaseUrl, supabaseKey);

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const mode = body.mode || "cache"; // "cache" = read DB, "sync" = fetch APIs + update DB
    const today = new Date().toISOString().split("T")[0];
    const startDate = body.start_date || "2026-01-01";
    const endDate = body.end_date || today;

    // === MODE: CACHE — read from DB ===
    if (mode === "cache") {
      const { data: cached } = await sbClient
        .from("kanban_orcamentos_cache")
        .select("*")
        .order("coluna")
        .order("posicao");

      const { data: meta } = await sbClient
        .from("kanban_sync_meta")
        .select("*")
        .eq("id", "default")
        .single();

      const items = (cached || []).map((row: any) => ({
        ...row.dados,
        _coluna: row.coluna,
        _posicao: row.posicao,
      }));

      const filteredItems = items.filter((item: any) =>
        inDateRange(item.data_tarefa, startDate, endDate)
      );

      const resumo = {
        periodo: { inicio: startDate, fim: endDate },
        total_tarefas_com_questionario: filteredItems.length,
        orcamentos_realizados: filteredItems.filter((i: any) => i.orcamento_realizado).length,
        os_realizadas: filteredItems.filter((i: any) => i.os_realizada).length,
        pendentes: filteredItems.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
      };

      return new Response(JSON.stringify({
        resumo,
        items: filteredItems,
        ultimo_sync: meta?.ultimo_sync || null,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SAVE_POSITIONS — persist column/position changes from drag-drop ===
    if (mode === "save_positions") {
      const positions: { auvo_task_id: string; coluna: string; posicao: number }[] = body.positions || [];
      if (positions.length > 0) {
        for (let i = 0; i < positions.length; i += 50) {
          const batch = positions.slice(i, i + 50).map((p) => ({
            auvo_task_id: p.auvo_task_id,
            coluna: p.coluna,
            posicao: p.posicao,
            atualizado_em: new Date().toISOString(),
          }));
          await sbClient
            .from("kanban_orcamentos_cache")
            .upsert(batch, { onConflict: "auvo_task_id", ignoreDuplicates: false });
        }
      }
      return new Response(JSON.stringify({ ok: true, saved: positions.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SYNC — fetch APIs, update cache ===
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

    // startDate/endDate already declared above


    console.log(`[budget-kanban] Período: ${startDate} a ${endDate}`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Load conciliation snapshot for customer name mapping

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
    const [auvoPrimary, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasksWithQuestionnaire(bearerToken, startDate, endDate),
      fetchGcOrcamentosMap(gcH, startDate, endDate),
      fetchGcOsMap(gcH, startDate, endDate),
    ]);

    let auvoTasks = auvoPrimary.tasks;
    let auvoError = auvoPrimary.errorMessage;

    // Fallback robusto: se vier vazio/erro no range escolhido, tenta range amplo no Auvo e filtra localmente
    if ((auvoPrimary.hadError || auvoTasks.length === 0) && (startDate !== AUVO_SAFE_START || endDate !== AUVO_SAFE_END)) {
      console.warn("[budget-kanban] Tentando fallback Auvo com range amplo (2020-2030)");
      const auvoFallback = await fetchAuvoTasksWithQuestionnaire(bearerToken, AUVO_SAFE_START, AUVO_SAFE_END);
      if (!auvoError && auvoFallback.errorMessage) auvoError = auvoFallback.errorMessage;

      const fallbackFiltered = auvoFallback.tasks.filter((task: any) =>
        inDateRange(String(task.taskDate || ""), startDate, endDate)
      );

      if (fallbackFiltered.length > 0) {
        auvoTasks = fallbackFiltered;
        console.log(`[budget-kanban] Fallback Auvo recuperou ${auvoTasks.length} tarefas no período`);
      }
    }

    console.log(`[budget-kanban] Auvo tasks: ${auvoTasks.length}, GC orçamentos: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

    // Se Auvo falhar, não sobrescreve cache com vazio
    if (auvoTasks.length === 0 && auvoError) {
      console.warn(`[budget-kanban] Sync preservado por erro Auvo: ${auvoError}`);

      const { data: cached } = await sbClient
        .from("kanban_orcamentos_cache")
        .select("*")
        .order("coluna")
        .order("posicao");

      const { data: meta } = await sbClient
        .from("kanban_sync_meta")
        .select("*")
        .eq("id", "default")
        .single();

      const fallbackItems = (cached || [])
        .map((row: any) => ({ ...row.dados, _coluna: row.coluna, _posicao: row.posicao }))
        .filter((item: any) => inDateRange(item.data_tarefa, startDate, endDate));

      const resumo = {
        periodo: { inicio: startDate, fim: endDate },
        total_tarefas_com_questionario: fallbackItems.length,
        orcamentos_realizados: fallbackItems.filter((i: any) => i.orcamento_realizado).length,
        os_realizadas: fallbackItems.filter((i: any) => i.os_realizada).length,
        pendentes: fallbackItems.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
      };

      return new Response(JSON.stringify({
        success: false,
        error: auvoError,
        resumo,
        items: fallbackItems,
        ultimo_sync: meta?.ultimo_sync || null,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build kanban items — first pass (resolve what we can synchronously)
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

      // === CADEIA DE RESOLUÇÃO DO CLIENTE ===
      // 1. customerDescription (campo direto da task)
      const desc = String(task.customerDescription || "").trim();
      // 2. customerName / customer object
      const nameRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || ""
      ).trim();
      // 3. Snapshot (conciliação anterior)
      const nameSnapshot = auvoTaskClienteMap[taskId] || "";
      // 4. GC match (orçamento ou OS)
      const nameGc = gcOrcMatch?.gc_cliente || gcOsMatch?.gc_cliente || "";

      const clienteSync = desc || nameRaw || nameSnapshot || nameGc;

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        cliente: clienteSync || "",
        _customerId: (!clienteSync && task.customerId && Number(task.customerId) > 0) ? String(task.customerId) : null,
        _externalId: (!clienteSync && !task.customerId) ? String(task.externalId || "").trim() : null,
        _resolucao: clienteSync ? (desc ? "customerDescription" : nameRaw ? "customerName" : nameSnapshot ? "snapshot" : "gc_match") : "pendente",
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

    // === RESOLUÇÃO ASYNC: customerId → Auvo /customers/{id} ===
    const needsCustomerLookup = items.filter((i: any) => i._customerId);
    if (needsCustomerLookup.length > 0) {
      console.log(`[budget-kanban] Resolvendo ${needsCustomerLookup.length} clientes via Auvo /customers/{id}`);
      const customerCache: Record<string, string> = {};
      for (const item of needsCustomerLookup) {
        const cid = (item as any)._customerId;
        if (customerCache[cid]) {
          (item as any).cliente = customerCache[cid];
          (item as any)._resolucao = "auvo_customer_api";
          continue;
        }
        try {
          const url = `${AUVO_BASE_URL}/customers/${cid}`;
          const resp = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
          if (resp.ok) {
            const cData = await resp.json();
            const cust = cData?.result;
            const name = String(cust?.tradeName || cust?.companyName || cust?.description || cust?.name || "").trim();
            if (name) {
              customerCache[cid] = name;
              (item as any).cliente = name;
              (item as any)._resolucao = "auvo_customer_api";
              console.log(`[budget-kanban] Customer ${cid} → ${name}`);
            }
          }
        } catch (e) {
          console.warn(`[budget-kanban] Erro customer ${cid}:`, e);
        }
      }
    }

    // === RESOLUÇÃO ASYNC: externalId → GC OS/cliente ===
    const needsExternalLookup = items.filter((i: any) => !(i as any).cliente && (i as any)._externalId);
    if (needsExternalLookup.length > 0) {
      console.log(`[budget-kanban] Resolvendo ${needsExternalLookup.length} clientes via externalId no GC`);
      for (const item of needsExternalLookup) {
        const extId = (item as any)._externalId;
        try {
          // Try fetching OS by codigo (externalId)
          const url = `${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(extId)}&limite=1`;
          const resp = await rateLimitedFetch(url, { headers: gcH }, "gc");
          if (resp.ok) {
            const data = await resp.json();
            const os = Array.isArray(data?.data) ? data.data[0] : null;
            if (os?.nome_cliente) {
              (item as any).cliente = String(os.nome_cliente);
              (item as any)._resolucao = "gc_externalId";
              console.log(`[budget-kanban] ExternalId ${extId} → ${os.nome_cliente}`);
            }
          }
        } catch (e) {
          console.warn(`[budget-kanban] Erro externalId ${extId}:`, e);
        }
      }
    }

    // Fallback final + log de não resolvidos
    const unresolved: string[] = [];
    for (const item of items) {
      if (!(item as any).cliente) {
        (item as any).cliente = "Cliente não identificado";
        (item as any)._resolucao = "nao_identificado";
        unresolved.push((item as any).auvo_task_id);
      }
    }
    if (unresolved.length > 0) {
      console.warn(`[budget-kanban] ${unresolved.length} tarefas sem cliente: ${unresolved.join(", ")}`);
    }

    // Log resolução summary
    const resolucaoCount: Record<string, number> = {};
    for (const item of items) {
      const r = (item as any)._resolucao || "unknown";
      resolucaoCount[r] = (resolucaoCount[r] || 0) + 1;
    }
    console.log(`[budget-kanban] Resolução clientes: ${JSON.stringify(resolucaoCount)}`);

    // Remove internal fields
    for (const item of items) {
      delete (item as any)._customerId;
      delete (item as any)._externalId;
      delete (item as any)._resolucao;
    }

    // Sort: pendentes primeiro, depois por data desc
    items.sort((a: any, b: any) => {
      const aHasGc = a.orcamento_realizado || a.os_realizada;
      const bHasGc = b.orcamento_realizado || b.os_realizada;
      if (aHasGc !== bHasGc) return aHasGc ? 1 : -1;
      return b.data_tarefa.localeCompare(a.data_tarefa);
    });

    // === UPSERT TO CACHE ===
    // Read existing cache to preserve column/position for known items
    const { data: existingCache } = await sbClient
      .from("kanban_orcamentos_cache")
      .select("auvo_task_id, coluna, posicao");
    
    const existingMap: Record<string, { coluna: string; posicao: number }> = {};
    for (const row of existingCache || []) {
      existingMap[row.auvo_task_id] = { coluna: row.coluna, posicao: row.posicao };
    }

    const now = new Date().toISOString();
    const upsertRows = items.map((item: any, idx: number) => {
      const existing = existingMap[item.auvo_task_id];
      // Determine default column for new items
      let defaultColuna = "a_fazer";
      if (item.os_realizada) defaultColuna = "os_realizada";
      else if (item.orcamento_realizado) defaultColuna = `orc_${(item.gc_orcamento?.gc_situacao || "sem_situacao").replace(/\s+/g, "_").toLowerCase()}`;

      return {
        auvo_task_id: item.auvo_task_id,
        dados: item,
        coluna: existing ? existing.coluna : defaultColuna,
        posicao: existing ? existing.posicao : idx,
        atualizado_em: now,
      };
    });

    // Upsert in batches of 50
    for (let i = 0; i < upsertRows.length; i += 50) {
      const batch = upsertRows.slice(i, i + 50);
      await sbClient
        .from("kanban_orcamentos_cache")
        .upsert(batch, { onConflict: "auvo_task_id" });
    }

    // Não remover itens antigos do cache: preservar histórico e posições já salvas


    // Update sync metadata
    await sbClient
      .from("kanban_sync_meta")
      .upsert({
        id: "default",
        ultimo_sync: now,
        periodo_inicio: startDate,
        periodo_fim: endDate,
      });

    console.log(`[budget-kanban] Cache atualizado: ${upsertRows.length} itens`);

    const resumo = {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas_com_questionario: items.length,
      orcamentos_realizados: items.filter((i: any) => i.orcamento_realizado).length,
      os_realizadas: items.filter((i: any) => i.os_realizada).length,
      pendentes: items.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
    };

    return new Response(JSON.stringify({
      resumo,
      updated: upsertRows.length,
      ultimo_sync: now,
      from_cache: false,
    }), {
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
