import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const GC_ATRIBUTO_TAREFA_ORC = "73341";
const GC_ATRIBUTO_TAREFA_OS = "73343";
const AUVO_SAFE_START = "2020-01-01";
const AUVO_SAFE_END = "2030-12-31";
const MIN_DELAY_MS = 200;
let lastAuvoCall = 0;
let lastGcCall = 0;

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

// Fetch ALL Auvo tasks (no questionnaire filter) and return tasks + unique questionnaires
async function fetchAuvoTasksAll(
  bearerToken: string,
  startDate: string,
  endDate: string
): Promise<{ tasks: any[]; questionnaires: { id: string; description: string }[]; hadError: boolean; errorMessage: string | null }> {
  const allTasks: any[] = [];
  const questionnaireMap = new Map<string, string>();
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 20;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };
  let hadError = false;
  let errorMessage: string | null = null;

  console.log(`[kanban-custom] Auvo paramFilter: ${JSON.stringify(filterObj)}`);

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    console.log(`[kanban-custom] Auvo page ${page}`);
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");

    if (response.status === 404) break;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      hadError = true;
      errorMessage = `Auvo /tasks erro ${response.status}: ${errBody.substring(0, 300)}`;
      console.error(`[kanban-custom] ${errorMessage}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];

    for (const task of entities) {
      const questionnaires = task.questionnaires || [];
      for (const q of questionnaires) {
        const qId = String(q.questionnaireId);
        if (!questionnaireMap.has(qId)) {
          questionnaireMap.set(qId, String(q.questionnaireDescription || `Questionário ${qId}`));
        }
      }
      allTasks.push(task);
    }

    console.log(`[kanban-custom] Page ${page}: ${entities.length} tasks, ${allTasks.length} total`);
    if (entities.length < pageSize) break;
    page++;
  }

  const questionnaires = Array.from(questionnaireMap.entries()).map(([id, description]) => ({ id, description }));

  return { tasks: allTasks, questionnaires, hadError, errorMessage };
}

// Filter tasks that have ANY of the specified questionnaire IDs
function filterTasksByQuestionnaires(tasks: any[], questionnaireIds: string[]): any[] {
  const idSet = new Set(questionnaireIds);
  return tasks.filter((task: any) => {
    const questionnaires = task.questionnaires || [];
    return questionnaires.some((q: any) => idSet.has(String(q.questionnaireId)));
  });
}

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
      console.warn("[kanban-custom] GC rate limit — aguardando 3s...");
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) {
      console.error(`[kanban-custom] GC orcamentos error: ${response.status}`);
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

    console.log(`[kanban-custom] GC orçamentos page ${page}/${totalPages}: ${records.length} registros`);
    page++;
  }
  return map;
}

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
      console.warn("[kanban-custom] GC OS rate limit — aguardando 3s...");
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) {
      console.error(`[kanban-custom] GC OS error: ${response.status}`);
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
            gc_data: String(os.data || os.data_entrada || ""),
            gc_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          };
        }
      }
    }

    console.log(`[kanban-custom] GC OS page ${page}/${totalPages}: ${records.length} registros`);
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

    const mode = body.mode || "cache";
    const today = new Date().toISOString().split("T")[0];
    const startDate = body.start_date || "2026-01-01";
    const endDate = body.end_date || today;
    const questionnaireIds: string[] = body.questionnaire_ids || [];
    const configId = questionnaireIds.length > 0 ? questionnaireIds.sort().join("_") : "default";

    // === MODE: LIST_QUESTIONNAIRES — fetch Auvo and return unique questionnaires ===
    if (mode === "list_questionnaires") {
      const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
      const auvoApiToken = Deno.env.get("AUVO_TOKEN");
      if (!auvoApiKey || !auvoApiToken) {
        return new Response(JSON.stringify({ error: "Credenciais Auvo não configuradas" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
      const result = await fetchAuvoTasksAll(bearerToken, startDate, endDate);

      return new Response(JSON.stringify({
        questionnaires: result.questionnaires,
        total_tasks: result.tasks.length,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: CACHE — read from DB ===
    if (mode === "cache") {
      const [{ data: cached }, { data: meta }, { data: colMeta }] = await Promise.all([
        sbClient.from("kanban_custom_cache").select("*").eq("config_id", configId).order("coluna").order("posicao"),
        sbClient.from("kanban_sync_meta").select("*").eq("id", `custom_default_${configId}`).single(),
        sbClient.from("kanban_sync_meta").select("*").eq("id", `custom_columns_${configId}`).single(),
      ]);

      let customColumns: { id: string; title: string; order: number }[] = [];
      try {
        if (colMeta?.periodo_inicio) customColumns = JSON.parse(colMeta.periodo_inicio);
      } catch {}

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
        custom_columns: customColumns,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SAVE_POSITIONS ===
    if (mode === "save_positions") {
      const positions: { auvo_task_id: string; coluna: string; posicao: number }[] = body.positions || [];
      const customColumns: { id: string; title: string; order: number }[] = body.custom_columns || [];

      if (positions.length > 0) {
        for (let i = 0; i < positions.length; i += 50) {
          const batch = positions.slice(i, i + 50).map((p) => ({
            auvo_task_id: p.auvo_task_id,
            config_id: configId,
            coluna: p.coluna,
            posicao: p.posicao,
            atualizado_em: new Date().toISOString(),
          }));
          await sbClient
            .from("kanban_custom_cache")
            .upsert(batch, { onConflict: "auvo_task_id,config_id", ignoreDuplicates: false });
        }
      }

      if (customColumns.length > 0) {
        await sbClient
          .from("kanban_sync_meta")
          .upsert({ id: `custom_columns_${configId}`, periodo_inicio: JSON.stringify(customColumns) });
      }

      return new Response(JSON.stringify({ ok: true, saved: positions.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SYNC ===
    if (questionnaireIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum questionário selecionado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    console.log(`[kanban-custom] Sync período: ${startDate} a ${endDate}, questionários: ${questionnaireIds.join(", ")}`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Load conciliation snapshot
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
    } catch (err) {
      console.warn(`[kanban-custom] Erro ao carregar snapshot:`, err);
    }

    // Fetch in parallel
    const [auvoResult, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasksAll(bearerToken, startDate, endDate),
      fetchGcOrcamentosMap(gcH, startDate, endDate),
      fetchGcOsMap(gcH, startDate, endDate),
    ]);

    let auvoTasks = filterTasksByQuestionnaires(auvoResult.tasks, questionnaireIds);
    const auvoError = auvoResult.errorMessage;

    // Fallback
    if ((auvoResult.hadError || auvoTasks.length === 0) && (startDate !== AUVO_SAFE_START || endDate !== AUVO_SAFE_END)) {
      console.warn("[kanban-custom] Tentando fallback Auvo com range amplo");
      const fallback = await fetchAuvoTasksAll(bearerToken, AUVO_SAFE_START, AUVO_SAFE_END);
      const fallbackFiltered = filterTasksByQuestionnaires(fallback.tasks, questionnaireIds)
        .filter((task: any) => inDateRange(String(task.taskDate || ""), startDate, endDate));

      if (fallbackFiltered.length > 0) {
        auvoTasks = fallbackFiltered;
        console.log(`[kanban-custom] Fallback recuperou ${auvoTasks.length} tarefas`);
      }
    }

    console.log(`[kanban-custom] Tasks filtradas: ${auvoTasks.length}, GC orç: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

    // Se Auvo falhar, preservar cache
    if (auvoTasks.length === 0 && auvoError) {
      const { data: cached } = await sbClient
        .from("kanban_custom_cache")
        .select("*")
        .eq("config_id", configId)
        .order("coluna").order("posicao");

      const fallbackItems = (cached || [])
        .map((row: any) => ({ ...row.dados, _coluna: row.coluna, _posicao: row.posicao }))
        .filter((item: any) => inDateRange(item.data_tarefa, startDate, endDate));

      return new Response(JSON.stringify({
        success: false,
        error: auvoError,
        resumo: {
          periodo: { inicio: startDate, fim: endDate },
          total_tarefas_com_questionario: fallbackItems.length,
          orcamentos_realizados: fallbackItems.filter((i: any) => i.orcamento_realizado).length,
          os_realizadas: fallbackItems.filter((i: any) => i.os_realizada).length,
          pendentes: fallbackItems.filter((i: any) => !i.orcamento_realizado && !i.os_realizada).length,
        },
        items: fallbackItems,
        from_cache: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build kanban items
    const qIdSet = new Set(questionnaireIds);
    const items = auvoTasks.map((task: any) => {
      const taskId = String(task.taskID || "");
      const gcOrcMatch = gcOrcMap[taskId] || null;
      const gcOsMatch = gcOsMap[taskId] || null;

      // Collect answers from ALL matching questionnaires
      const allAnswers: { question: string; reply: string }[] = [];
      for (const q of (task.questionnaires || [])) {
        if (qIdSet.has(String(q.questionnaireId))) {
          for (const a of (q.answers || [])) {
            allAnswers.push({
              question: String(a.questionDescription || ""),
              reply: String(a.reply || ""),
            });
          }
        }
      }

      const desc = String(task.customerDescription || "").trim();
      const nameRaw = String(task.customerName || task.customer?.tradeName || task.customer?.companyName || "").trim();
      const nameSnapshot = auvoTaskClienteMap[taskId] || "";
      const nameGc = gcOrcMatch?.gc_cliente || gcOsMatch?.gc_cliente || "";
      const clienteSync = desc || nameRaw || nameSnapshot || nameGc;

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: String(task.taskUrl || ""),
        auvo_survey_url: String(task.survey || ""),
        cliente: clienteSync || "",
        _customerId: (!clienteSync && task.customerId && Number(task.customerId) > 0) ? String(task.customerId) : null,
        _externalId: (!clienteSync && !task.customerId) ? String(task.externalId || "").trim() : null,
        _resolucao: clienteSync ? "resolved" : "pendente",
        tecnico: String(task.userToName || ""),
        data_tarefa: String(task.taskDate || "").split("T")[0],
        orientacao: String(task.orientation || ""),
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        questionario_respostas: allAnswers,
        orcamento_realizado: !!gcOrcMatch,
        os_realizada: !!gcOsMatch,
        gc_orcamento: gcOrcMatch,
        gc_os: gcOsMatch,
      };
    });

    // Resolve customers via Auvo API
    const needsCustomerLookup = items.filter((i: any) => i._customerId);
    if (needsCustomerLookup.length > 0) {
      const customerCache: Record<string, string> = {};
      for (const item of needsCustomerLookup) {
        const cid = (item as any)._customerId;
        if (customerCache[cid]) { (item as any).cliente = customerCache[cid]; continue; }
        try {
          const resp = await rateLimitedFetch(`${AUVO_BASE_URL}/customers/${cid}`, { headers: auvoHeaders(bearerToken) }, "auvo");
          if (resp.ok) {
            const cData = await resp.json();
            const cust = cData?.result;
            const name = String(cust?.tradeName || cust?.companyName || cust?.description || "").trim();
            if (name) { customerCache[cid] = name; (item as any).cliente = name; }
          }
        } catch {}
      }
    }

    // Resolve via externalId
    const needsExternalLookup = items.filter((i: any) => !(i as any).cliente && (i as any)._externalId);
    if (needsExternalLookup.length > 0) {
      for (const item of needsExternalLookup) {
        const extId = (item as any)._externalId;
        try {
          const resp = await rateLimitedFetch(`${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(extId)}&limite=1`, { headers: gcH }, "gc");
          if (resp.ok) {
            const data = await resp.json();
            const os = Array.isArray(data?.data) ? data.data[0] : null;
            if (os?.nome_cliente) (item as any).cliente = String(os.nome_cliente);
          }
        } catch {}
      }
    }

    // Fallback unresolved
    for (const item of items) {
      if (!(item as any).cliente) (item as any).cliente = "Cliente não identificado";
      delete (item as any)._customerId;
      delete (item as any)._externalId;
      delete (item as any)._resolucao;
    }

    // Sort
    items.sort((a: any, b: any) => {
      const aHasGc = a.orcamento_realizado || a.os_realizada;
      const bHasGc = b.orcamento_realizado || b.os_realizada;
      if (aHasGc !== bHasGc) return aHasGc ? 1 : -1;
      return b.data_tarefa.localeCompare(a.data_tarefa);
    });

    // === UPSERT TO CACHE ===
    const { data: existingCache } = await sbClient
      .from("kanban_custom_cache")
      .select("auvo_task_id, coluna, posicao, dados")
      .eq("config_id", configId);

    const existingMap: Record<string, { coluna: string; posicao: number; dados: any }> = {};
    for (const row of existingCache || []) {
      existingMap[row.auvo_task_id] = { coluna: row.coluna, posicao: row.posicao, dados: row.dados };
    }

    const now = new Date().toISOString();
    let movedCount = 0;
    let keptCount = 0;

    const upsertRows = items.map((item: any, idx: number) => {
      const existing = existingMap[item.auvo_task_id];

      let autoColuna = "a_fazer";
      if (item.os_realizada) autoColuna = "os_realizada";
      else if (item.orcamento_realizado) autoColuna = `orc_${(item.gc_orcamento?.gc_situacao || "sem_situacao").replace(/\s+/g, "_").toLowerCase()}`;

      let finalColuna: string;
      let finalPosicao: number;

      if (!existing) {
        finalColuna = autoColuna;
        finalPosicao = idx;
      } else {
        const oldData = existing.dados || {};
        const hadUpdate =
          (!oldData.orcamento_realizado && item.orcamento_realizado) ||
          (!oldData.os_realizada && item.os_realizada) ||
          (oldData.gc_orcamento?.gc_situacao !== item.gc_orcamento?.gc_situacao && item.orcamento_realizado) ||
          (oldData.gc_os?.gc_situacao !== item.gc_os?.gc_situacao && item.os_realizada);

        if (hadUpdate) {
          finalColuna = autoColuna;
          finalPosicao = 0;
          movedCount++;
        } else {
          finalColuna = existing.coluna;
          finalPosicao = existing.posicao;
          keptCount++;
        }
      }

      return {
        auvo_task_id: item.auvo_task_id,
        config_id: configId,
        dados: item,
        coluna: finalColuna,
        posicao: finalPosicao,
        atualizado_em: now,
      };
    });

    console.log(`[kanban-custom] Posições: ${movedCount} movidos, ${keptCount} mantidos`);

    for (let i = 0; i < upsertRows.length; i += 50) {
      const batch = upsertRows.slice(i, i + 50);
      await sbClient
        .from("kanban_custom_cache")
        .upsert(batch, { onConflict: "auvo_task_id,config_id" });
    }

    await sbClient
      .from("kanban_sync_meta")
      .upsert({
        id: `custom_default_${configId}`,
        ultimo_sync: now,
        periodo_inicio: startDate,
        periodo_fim: endDate,
      });

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
    console.error("[kanban-custom] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
