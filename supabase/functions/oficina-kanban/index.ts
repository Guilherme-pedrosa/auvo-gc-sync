import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";
const QUESTIONNAIRE_ID = "215146"; // Formulário de entrada oficina
const QUESTIONNAIRE_DEVOLUCAO_ID = "215147"; // Formulário de devolução
const GC_ATRIBUTO_TAREFA_OS = "73343";
const GC_ATRIBUTO_TAREFA_ORC = "73341";
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
  if (!response.ok) throw new Error(`Auvo login failed (${response.status})`);
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// Fetch ALL tasks in range, separating entry/return tasks and all others
async function fetchAllAuvoTasks(
  bearerToken: string,
  startDate: string,
  endDate: string
): Promise<{
  entryTasks: any[];
  allTasks: any[];
  hadError: boolean;
  errorMessage: string | null;
}> {
  const entryTasks: any[] = [];
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 30;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };
  let hadError = false;
  let errorMessage: string | null = null;

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");

    if (response.status === 404) break;
    if (!response.ok) {
      hadError = true;
      errorMessage = `Auvo /tasks erro ${response.status}`;
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];

    for (const task of entities) {
      allTasks.push(task);
      const questionnaires = task.questionnaires || [];
      const hasEntrada = questionnaires.some((q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID);
      const hasDevolucao = questionnaires.some((q: any) => String(q.questionnaireId) === QUESTIONNAIRE_DEVOLUCAO_ID);
      if (hasEntrada || hasDevolucao) entryTasks.push(task);
    }

    if (entities.length < pageSize) break;
    page++;
  }

  return { entryTasks, allTasks, hadError, errorMessage };
}

async function fetchGcOsMap(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 30;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
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
            gc_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          };
        }
      }
    }
    page++;
  }
  return map;
}

async function fetchGcOrcamentosMap(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 30;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${page}`;
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
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
    page++;
  }
  return map;
}

// Map orçamento situation to kanban column
function orcamentoSituacaoToColumn(situacao: string): string {
  const sit = (situacao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // "COMPRADO - AGUARDANDO CHEGADA" → peças solicitadas
  if (sit.includes("comprado") || sit.includes("chegada")) return "pecas_solicitadas";
  // "APROVADO - AGUARDANDO COMPRA" → aprovado (contains "aprovado" but NOT "aguardando aprovação")
  if (sit.includes("aprovado")) return "aprovado";
  // "Aguardando Aprovação", "Ag Informações / Correções" → orçamento
  return "orcamento";
}

// Determine which column an item belongs to based on its data
function autoAssignColumn(item: any): string {
  // If return form (215147) was filled → Devolvido (cycle complete)
  if (item.devolucao_preenchida) return "devolvido";

  // Has OS with completed situation
  if (item.gc_os) {
    const sit = (item.gc_os.gc_situacao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (sit.includes("conclu") || sit.includes("finaliz") || sit.includes("entregue")) return "concluido";
    if (sit.includes("execu")) return "em_execucao";
    if (sit.includes("peca") || sit.includes("material") || sit.includes("solicit")) return "pecas_solicitadas";
    if (item.gc_orcamento) return orcamentoSituacaoToColumn(item.gc_orcamento.gc_situacao);
    return "em_execucao";
  }
  
  if (item.gc_orcamento) return orcamentoSituacaoToColumn(item.gc_orcamento.gc_situacao);

  if (item.questionario_preenchido) return "aguardando_os";

  return "entrada";
}

function normalizeCode(value: string): string {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isUnknownEquipmentName(name: string): boolean {
  const n = String(name || "").trim().toLowerCase();
  return !n || n === "s" || n === "equipamento não identificado" || n === "equipamento nao identificado";
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
    const startDate = body.start_date || "2025-01-01";
    const endDate = body.end_date || today;

    // === MODE: CACHE ===
    if (mode === "cache") {
      const [{ data: cached }, { data: meta }, { data: colMeta }] = await Promise.all([
        sbClient.from("kanban_oficina_cache").select("*").order("coluna").order("posicao"),
        sbClient.from("kanban_sync_meta").select("*").eq("id", "oficina_default").single(),
        sbClient.from("kanban_sync_meta").select("*").eq("id", "oficina_columns").single(),
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

      return new Response(JSON.stringify({
        items,
        ultimo_sync: meta?.ultimo_sync || null,
        custom_columns: customColumns,
        from_cache: true,
        total: items.length,
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
            coluna: p.coluna,
            posicao: p.posicao,
            atualizado_em: new Date().toISOString(),
          }));
          await sbClient
            .from("kanban_oficina_cache")
            .upsert(batch, { onConflict: "auvo_task_id", ignoreDuplicates: false });
        }
      }

      if (customColumns.length > 0) {
        await sbClient
          .from("kanban_sync_meta")
          .upsert({ id: "oficina_columns", periodo_inicio: JSON.stringify(customColumns) });
      }

      return new Response(JSON.stringify({ ok: true, saved: positions.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE: SAVE_MANUAL_LINK ===
    if (mode === "save_manual_link") {
      const auvoTaskId = body.auvo_task_id;
      const manualOsTaskId = body.os_task_id || null;
      const manualGcOsCode = body.gc_os_code || null;
      const manualGcOrcCode = body.gc_orc_code || null;

      if (!auvoTaskId) {
        return new Response(JSON.stringify({ error: "auvo_task_id é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Read current cached item
      const { data: cached } = await sbClient
        .from("kanban_oficina_cache")
        .select("dados")
        .eq("auvo_task_id", auvoTaskId)
        .single();

      if (!cached) {
        return new Response(JSON.stringify({ error: "Card não encontrado no cache" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dados = cached.dados as any;
      let osMatched = !manualGcOsCode;
      let orcMatched = !manualGcOrcCode;

      // Update manual links
      if (manualOsTaskId) {
        dados.os_task_id = manualOsTaskId;
        dados.os_task_link = `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${manualOsTaskId}`;
      }

      // Try to fetch GC OS by code (accepts formats like "OS-123", "123", "#123")
      if (manualGcOsCode) {
        const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
        const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
        if (gcAccessToken && gcSecretToken) {
          const normalizedInput = normalizeCode(manualGcOsCode);
          const codeForQuery = String(manualGcOsCode).replace(/[^0-9A-Za-z-]/g, "") || String(manualGcOsCode);
          const gcH = { "access-token": gcAccessToken, "secret-access-token": gcSecretToken, "Content-Type": "application/json" };
          const url = `${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(codeForQuery)}&limite=20`;
          const resp = await rateLimitedFetch(url, { headers: gcH }, "gc");
          if (resp.ok) {
            const gcData = await resp.json();
            const records: any[] = Array.isArray(gcData?.data) ? gcData.data : [];
            const os = records.find((r: any) => normalizeCode(String(r.codigo || "")) === normalizedInput);
            if (os) {
              dados.gc_os = {
                gc_os_id: String(os.id),
                gc_os_codigo: String(os.codigo || ""),
                gc_cliente: String(os.nome_cliente || ""),
                gc_situacao: String(os.nome_situacao || ""),
                gc_situacao_id: String(os.situacao_id || ""),
                gc_cor_situacao: String(os.cor_situacao || ""),
                gc_valor_total: String(os.valor_total || "0"),
                gc_vendedor: String(os.nome_vendedor || ""),
                gc_data: String(os.data || ""),
                gc_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
              };
            }
          }
        }
      }

      // Try to fetch GC Orçamento by code (accepts formats like "Orç. #4974" or "4974")
      if (manualGcOrcCode) {
        const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
        const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
        if (gcAccessToken && gcSecretToken) {
          const normalizedInput = normalizeCode(manualGcOrcCode);
          const codeForQuery = String(manualGcOrcCode).replace(/[^0-9A-Za-z-]/g, "") || String(manualGcOrcCode);
          const gcH = { "access-token": gcAccessToken, "secret-access-token": gcSecretToken, "Content-Type": "application/json" };
          const url = `${GC_BASE_URL}/api/orcamentos?codigo=${encodeURIComponent(codeForQuery)}&limite=20`;
          const resp = await rateLimitedFetch(url, { headers: gcH }, "gc");
          if (resp.ok) {
            const gcData = await resp.json();
            const records: any[] = Array.isArray(gcData?.data) ? gcData.data : [];
            const orc = records.find((r: any) => normalizeCode(String(r.codigo || "")) === normalizedInput);
            if (orc) {
              dados.gc_orcamento = {
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
      }

      // Update equipment / client data from GC after manual link
      const gcCliente = dados.gc_os?.gc_cliente || dados.gc_orcamento?.gc_cliente || "";
      if (isUnknownEquipmentName(dados.equipamento_nome) && gcCliente) {
        dados.equipamento_nome = gcCliente;
      }

      if ((!dados.cliente || dados.cliente === "Cliente não identificado") && gcCliente) {
        dados.cliente = gcCliente;
      }

      const gcData = dados.gc_os?.gc_data || dados.gc_orcamento?.gc_data || "";
      if ((!dados.data_entrada || dados.data_entrada === "") && gcData) {
        dados.data_entrada = gcData;
      }

      // Auto-reassign column based on new data
      const newCol = autoAssignColumn(dados);

      await sbClient
        .from("kanban_oficina_cache")
        .update({ dados, coluna: newCol, atualizado_em: new Date().toISOString() })
        .eq("auvo_task_id", auvoTaskId);

      return new Response(JSON.stringify({ ok: true, dados, coluna: newCol }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    console.log(`[oficina-kanban] Sync período: ${startDate} a ${endDate}`);
    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Fetch in parallel
    const [auvoResult, gcOsMap, gcOrcMap] = await Promise.all([
      fetchAllAuvoTasks(bearerToken, startDate, endDate),
      fetchGcOsMap(gcH),
      fetchGcOrcamentosMap(gcH),
    ]);

    let entryTasks = auvoResult.entryTasks;
    let allAuvoTasks = auvoResult.allTasks;

    // Fallback: if empty, try wider range
    if ((auvoResult.hadError || entryTasks.length === 0) && startDate !== "2020-01-01") {
      console.warn("[oficina-kanban] Fallback com range amplo");
      const fallback = await fetchAllAuvoTasks(bearerToken, "2020-01-01", "2030-12-31");
      const filteredEntry = fallback.entryTasks.filter((t: any) => {
        const d = String(t.taskDate || "").split("T")[0];
        return d >= startDate && d <= endDate;
      });
      if (filteredEntry.length > 0) {
        entryTasks = filteredEntry;
        allAuvoTasks = fallback.allTasks;
      }
    }

    console.log(`[oficina-kanban] Entry tasks: ${entryTasks.length}, All tasks: ${allAuvoTasks.length}, GC OS: ${Object.keys(gcOsMap).length}, GC Orç: ${Object.keys(gcOrcMap).length}`);

    // If Auvo failed, preserve cache
    if (entryTasks.length === 0 && auvoResult.errorMessage) {
      const { data: cached } = await sbClient
        .from("kanban_oficina_cache").select("*").order("coluna").order("posicao");
      const items = (cached || []).map((row: any) => ({ ...row.dados, _coluna: row.coluna, _posicao: row.posicao }));
      return new Response(JSON.stringify({
        success: false, error: auvoResult.errorMessage,
        items, from_cache: true, total: items.length,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === BUILD EQUIPMENT → SIBLING TASKS INDEX ===
    // Map equipment_id → list of task IDs that reference it
    const equipToTasks: Record<number, string[]> = {};
    for (const task of allAuvoTasks) {
      const taskId = String(task.taskID || "");
      const eqIds: number[] = task.equipmentsId || [];
      for (const eqId of eqIds) {
        if (!equipToTasks[eqId]) equipToTasks[eqId] = [];
        equipToTasks[eqId].push(taskId);
      }
    }

    // Collect all equipment IDs from entry tasks to fetch names
    const allEquipmentIds = new Set<number>();
    for (const task of entryTasks) {
      const eqIds: number[] = task.equipmentsId || [];
      for (const id of eqIds) allEquipmentIds.add(id);
    }

    // Fetch equipment names from Auvo API
    const equipmentNameMap: Record<number, string> = {};
    if (allEquipmentIds.size > 0) {
      console.log(`[oficina-kanban] Buscando ${allEquipmentIds.size} equipamentos via API`);
      for (const eqId of allEquipmentIds) {
        try {
          const url = `${AUVO_BASE_URL}/equipments/${eqId}`;
          const resp = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
          if (resp.ok) {
            const eqData = await resp.json();
            const eq = eqData?.result;
            const name = String(eq?.description || eq?.name || eq?.identifier || "").trim();
            if (name) {
              equipmentNameMap[eqId] = name;
              console.log(`[oficina-kanban] Equipment ${eqId} → ${name}`);
            }
          } else {
            console.warn(`[oficina-kanban] Equipment ${eqId} fetch failed: ${resp.status}`);
          }
        } catch (e) {
          console.warn(`[oficina-kanban] Equipment ${eqId} error:`, e);
        }
      }
      console.log(`[oficina-kanban] Equipamentos resolvidos: ${Object.keys(equipmentNameMap).length}/${allEquipmentIds.size}`);
    }

    // Track claimed GC documents to prevent one OS/Orç being assigned to multiple cards
    const claimedOs = new Set<string>();
    const claimedOrc = new Set<string>();
    const claimedSiblings = new Set<string>();

    // Build items — entry tasks define cards, sibling tasks provide GC links
    const items = entryTasks.map((task: any) => {
      const taskId = String(task.taskID || "");
      const eqIds: number[] = task.equipmentsId || [];

      // Find GC OS/Orçamento via SIBLING tasks (same equipment, different task)
      let gcOsMatch: any = null;
      let gcOrcMatch: any = null;
      let osSiblingTaskId: string | null = null;

      // First check the entry task itself (direct match)
      if (gcOsMap[taskId] && !claimedOs.has(gcOsMap[taskId].gc_os_id)) {
        gcOsMatch = gcOsMap[taskId];
        claimedOs.add(gcOsMatch.gc_os_id);
      }
      if (gcOrcMap[taskId] && !claimedOrc.has(gcOrcMap[taskId].gc_orcamento_id)) {
        gcOrcMatch = gcOrcMap[taskId];
        claimedOrc.add(gcOrcMatch.gc_orcamento_id);
      }

      // Then check sibling tasks that share the SAME equipment
      // Only match if sibling has EXACTLY this equipment (not multi-equipment tasks ambiguously)
      if (!gcOsMatch || !gcOrcMatch) {
        for (const eqId of eqIds) {
          const siblingTaskIds = equipToTasks[eqId] || [];
          for (const sibId of siblingTaskIds) {
            if (sibId === taskId) continue;

            // Check if this sibling task has ONLY this equipment (or few)
            // to avoid cross-contamination from multi-equipment tasks
            const sibTask = allAuvoTasks.find((t: any) => String(t.taskID) === sibId);
            const sibEqIds: number[] = sibTask?.equipmentsId || [];

            // Only match if sibling shares THIS specific equipment
            // and hasn't been claimed by another entry task for a DIFFERENT equipment
            const sibKey = `${sibId}:${eqId}`;

            if (!gcOsMatch && gcOsMap[sibId] && !claimedOs.has(gcOsMap[sibId].gc_os_id)) {
              // Prefer siblings that only have this one equipment
              if (sibEqIds.length <= 1 || sibEqIds.every(id => eqIds.includes(id))) {
                gcOsMatch = gcOsMap[sibId];
                osSiblingTaskId = sibId;
                claimedOs.add(gcOsMatch.gc_os_id);
                claimedSiblings.add(sibKey);
                console.log(`[oficina-kanban] Task ${taskId} → OS found via sibling task ${sibId} (equipment ${eqId})`);
              }
            }
            if (!gcOrcMatch && gcOrcMap[sibId] && !claimedOrc.has(gcOrcMap[sibId].gc_orcamento_id)) {
              if (sibEqIds.length <= 1 || sibEqIds.every(id => eqIds.includes(id))) {
                gcOrcMatch = gcOrcMap[sibId];
                claimedOrc.add(gcOrcMatch.gc_orcamento_id);
                console.log(`[oficina-kanban] Task ${taskId} → Orçamento found via sibling task ${sibId} (equipment ${eqId})`);
              }
            }
            if (gcOsMatch && gcOrcMatch) break;
          }
          if (gcOsMatch && gcOrcMatch) break;
        }
      }

      const targetQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      const answers = (targetQ?.answers || []).map((a: any) => ({
        question: String(a.questionDescription || ""),
        reply: String(a.reply || ""),
      }));

      const hasFilledAnswers = answers.some(
        (a: any) => a.reply && a.reply.trim() !== "" && !a.reply.startsWith("http")
      );

      // Check return form (215147) on entry task AND sibling tasks
      let devolucaoPreenchida = false;
      let devolucaoAnswers: any[] = [];

      // Check on entry task itself
      const devolucaoQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_DEVOLUCAO_ID
      );
      if (devolucaoQ) {
        devolucaoAnswers = (devolucaoQ.answers || []).map((a: any) => ({
          question: String(a.questionDescription || ""),
          reply: String(a.reply || ""),
        }));
        devolucaoPreenchida = devolucaoAnswers.some(
          (a: any) => a.reply && a.reply.trim() !== "" && !a.reply.startsWith("http")
        );
      }

      // Also check sibling tasks for return form
      if (!devolucaoPreenchida) {
        for (const eqId of eqIds) {
          const siblingTaskIds = equipToTasks[eqId] || [];
          for (const sibId of siblingTaskIds) {
            if (sibId === taskId) continue;
            const sibTask = allAuvoTasks.find((t: any) => String(t.taskID) === sibId);
            if (!sibTask) continue;
            const sibDevQ = (sibTask.questionnaires || []).find(
              (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_DEVOLUCAO_ID
            );
            if (sibDevQ) {
              const sibDevAnswers = (sibDevQ.answers || []).map((a: any) => ({
                question: String(a.questionDescription || ""),
                reply: String(a.reply || ""),
              }));
              const sibDevFilled = sibDevAnswers.some(
                (a: any) => a.reply && a.reply.trim() !== "" && !a.reply.startsWith("http")
              );
              if (sibDevFilled) {
                devolucaoPreenchida = true;
                devolucaoAnswers = sibDevAnswers;
                console.log(`[oficina-kanban] Task ${taskId} → Devolução found via sibling task ${sibId}`);
                break;
              }
            }
          }
          if (devolucaoPreenchida) break;
        }
      }

      // Resolve equipment name
      let equipamento_nome = "";
      let equipamento_modelo = "";
      let equipamento_serie = "";

      // Helper: check if a reply is a real value (not just S/N confirmation)
      const isRealReply = (r: string) => {
        const trimmed = r.trim();
        if (!trimmed || trimmed.length <= 2) return false;
        const lower = trimmed.toLowerCase();
        if (["s", "n", "sim", "não", "nao", ".", "-", "ok"].includes(lower)) return false;
        if (trimmed.startsWith("http")) return false;
        return true;
      };

      // 1) Try equipment registration API
      for (const eqId of eqIds) {
        if (equipmentNameMap[eqId]) {
          equipamento_nome = equipmentNameMap[eqId];
          break;
        }
      }

      // 2) Fallback: extract from questionnaire answers (skip confirmations)
      if (!equipamento_nome) {
        for (const ans of answers) {
          const q = ans.question.toLowerCase();
          if (!isRealReply(ans.reply)) continue;
          if (q.includes("equipamento") || q.includes("aparelho") || q.includes("máquina") || q.includes("maquina")) {
            if (q.includes("modelo") || q.includes("type") || q.includes("tipo")) {
              equipamento_modelo = ans.reply;
            } else if (q.includes("série") || q.includes("serie") || q.includes("serial")) {
              equipamento_serie = ans.reply;
            } else if (!equipamento_nome && !q.includes("acessório") && !q.includes("acessorio")) {
              equipamento_nome = ans.reply;
            }
          }
          if (!equipamento_nome && (q.includes("nome") || q.includes("descrição") || q.includes("descricao")) && !q.includes("cliente")) {
            equipamento_nome = ans.reply;
          }
        }
      }

      // 3) Fallback: use task description
      if (!equipamento_nome) {
        const desc = String(task.taskDescription || task.description || "").trim();
        if (desc && desc.length > 3 && !desc.toLowerCase().startsWith("retirada") && !desc.toLowerCase().startsWith("entrada")) {
          equipamento_nome = desc;
        }
      }

      // 4) Fallback: use task type/title
      if (!equipamento_nome) {
        const title = String(task.taskTypeName || task.title || "").trim();
        if (title && title.length > 3) {
          equipamento_nome = title;
        }
      }

      const cliente = String(task.customerDescription || task.customerName || task.customer?.tradeName || "").trim();
      const dataTarefa = String(task.taskDate || "").split("T")[0];

      const entryDate = new Date(dataTarefa);
      const todayDate = new Date();
      const diasNoGalpao = Math.max(0, Math.floor((todayDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        auvo_task_id: taskId,
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: String(task.taskUrl || ""),
        os_task_id: osSiblingTaskId,
        os_task_link: osSiblingTaskId ? `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${osSiblingTaskId}` : null,
        equipamento_nome: equipamento_nome || (gcOsMatch?.gc_cliente || gcOrcMatch?.gc_cliente || "") || "Equipamento não identificado",
        equipamento_modelo,
        equipamento_serie,
        equipments_id: eqIds,
        cliente: cliente || "Cliente não identificado",
        tecnico: String(task.userToName || ""),
        data_tarefa: dataTarefa,
        data_entrada: dataTarefa,
        dias_no_galpao: diasNoGalpao,
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        questionario_preenchido: hasFilledAnswers,
        questionario_respostas: answers,
        devolucao_preenchida: devolucaoPreenchida,
        devolucao_respostas: devolucaoAnswers,
        gc_os: gcOsMatch,
        gc_orcamento: gcOrcMatch,
      };
    });

    // Read existing cache to preserve positions
    const { data: existingCache } = await sbClient
      .from("kanban_oficina_cache")
      .select("auvo_task_id, coluna, posicao, dados");

    const existingMap: Record<string, { coluna: string; posicao: number; dados: any }> = {};
    for (const row of existingCache || []) {
      existingMap[row.auvo_task_id] = { coluna: row.coluna, posicao: row.posicao, dados: row.dados };
    }

    const now = new Date().toISOString();
    const upsertRows = items.map((rawItem: any, idx: number) => {
      const existing = existingMap[rawItem.auvo_task_id];
      const item = { ...rawItem };

      if (existing?.dados) {
        const oldData = existing.dados || {};

        // Preserve manually linked docs when API sync doesn't return them
        if (!item.gc_os && oldData.gc_os) item.gc_os = oldData.gc_os;
        if (!item.gc_orcamento && oldData.gc_orcamento) item.gc_orcamento = oldData.gc_orcamento;

        // Preserve manual OS task linkage
        if (!item.os_task_id && oldData.os_task_id) {
          item.os_task_id = oldData.os_task_id;
          item.os_task_link = oldData.os_task_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${oldData.os_task_id}`;
        }

        // Preserve best known equipment/client data
        if (isUnknownEquipmentName(item.equipamento_nome) && oldData.equipamento_nome && !isUnknownEquipmentName(oldData.equipamento_nome)) {
          item.equipamento_nome = oldData.equipamento_nome;
        }
        if (!item.equipamento_modelo && oldData.equipamento_modelo) item.equipamento_modelo = oldData.equipamento_modelo;
        if (!item.equipamento_serie && oldData.equipamento_serie) item.equipamento_serie = oldData.equipamento_serie;
        if ((!item.cliente || item.cliente === "Cliente não identificado") && oldData.cliente) item.cliente = oldData.cliente;
      }

      // Final fallback: GC client name as equipment name when unidentified
      if (isUnknownEquipmentName(item.equipamento_nome)) {
        const gcName = item.gc_os?.gc_cliente || item.gc_orcamento?.gc_cliente || "";
        if (gcName) {
          item.equipamento_nome = gcName;
          if (!item.cliente || item.cliente === "Cliente não identificado") item.cliente = gcName;
        }
      }

      const autoCol = autoAssignColumn(item);

      let finalColuna: string;
      let finalPosicao: number;

      if (!existing) {
        finalColuna = autoCol;
        finalPosicao = idx;
      } else {
        const oldData = existing.dados || {};
        const hadUpdate =
          (!oldData.gc_os && item.gc_os) ||
          (!oldData.gc_orcamento && item.gc_orcamento) ||
          (oldData.gc_os?.gc_situacao !== item.gc_os?.gc_situacao) ||
          (oldData.gc_orcamento?.gc_situacao !== item.gc_orcamento?.gc_situacao) ||
          (!oldData.devolucao_preenchida && item.devolucao_preenchida) ||
          (!oldData.os_task_id && item.os_task_id) ||
          (isUnknownEquipmentName(oldData.equipamento_nome) && !isUnknownEquipmentName(item.equipamento_nome));

        if (hadUpdate) {
          finalColuna = autoCol;
          finalPosicao = 0;
        } else {
          finalColuna = existing.coluna;
          finalPosicao = existing.posicao;
        }
      }

      return {
        auvo_task_id: item.auvo_task_id,
        dados: item,
        coluna: finalColuna,
        posicao: finalPosicao,
        atualizado_em: now,
      };
    });

    // Upsert in batches
    for (let i = 0; i < upsertRows.length; i += 50) {
      const batch = upsertRows.slice(i, i + 50);
      await sbClient.from("kanban_oficina_cache").upsert(batch, { onConflict: "auvo_task_id" });
    }

    // Update sync metadata
    await sbClient.from("kanban_sync_meta").upsert({
      id: "oficina_default",
      ultimo_sync: now,
      periodo_inicio: startDate,
      periodo_fim: endDate,
    });

    console.log(`[oficina-kanban] Cache atualizado: ${upsertRows.length} itens`);

    return new Response(JSON.stringify({
      total: items.length,
      updated: upsertRows.length,
      ultimo_sync: now,
      from_cache: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[oficina-kanban] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
