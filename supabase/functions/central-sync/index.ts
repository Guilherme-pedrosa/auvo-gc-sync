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
const FUTURE_DAYS_WINDOW = 30;
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

function normalizeDate(dateLike: unknown): string | null {
  const raw = String(dateLike || "").trim();
  if (!raw) return null;
  const d = raw.split("T")[0];
  if (!d || d === "0001-01-01") return null;
  return d;
}

// Fetch Auvo tasks for a single month window
async function fetchAuvoTasksForPeriod(bearerToken: string, startDate: string, endDate: string): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 30;
  const filterObj = { startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` };

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;

    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
    
    if (response.status === 404) {
      console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: 404 (fim)`);
      break;
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`[central-sync] Auvo ${startDate}→${endDate} page ${page} error ${response.status}: ${text.substring(0, 200)}`);
      break;
    }

    const json = await response.json();
    const tasks = json?.result?.entityList || json?.result?.Entities || json?.result?.tasks || json?.result || [];
    if (!Array.isArray(tasks) || tasks.length === 0) {
      console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: 0 tasks (fim)`);
      break;
    }

    allTasks.push(...tasks);
    console.log(`[central-sync] Auvo ${startDate}→${endDate} page ${page}: ${tasks.length} tasks`);

    if (tasks.length < pageSize) break;
    page++;
  }

  return allTasks;
}

// Fetch ALL Auvo tasks month-by-month to avoid API limits
async function fetchAuvoTasks(bearerToken: string, startDate: string, endDate: string): Promise<any[]> {
  const allTasks: any[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Split into monthly chunks
  const current = new Date(start);
  while (current <= end) {
    const monthStart = current.toISOString().split("T")[0];
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const clampedEnd = monthEnd > end ? endDate : monthEnd.toISOString().split("T")[0];

    console.log(`[central-sync] Buscando Auvo: ${monthStart} → ${clampedEnd}`);
    const tasks = await fetchAuvoTasksForPeriod(bearerToken, monthStart, clampedEnd);
    allTasks.push(...tasks);
    console.log(`[central-sync] Mês ${monthStart}: ${tasks.length} tarefas (acumulado: ${allTasks.length})`);

    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return allTasks;
}

// Fetch ALL GC orçamentos (no date filter)
async function fetchGcOrcamentos(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

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
            gc_orc_cliente: String(orc.nome_cliente || ""),
            gc_orc_situacao: String(orc.nome_situacao || ""),
            gc_orc_situacao_id: String(orc.situacao_id || ""),
            gc_orc_cor_situacao: String(orc.cor_situacao || ""),
            gc_orc_valor_total: parseFloat(orc.valor_total || "0"),
            gc_orc_vendedor: String(orc.nome_vendedor || ""),
            gc_orc_data: String(orc.data || "").split("T")[0] || null,
            gc_orc_link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
          };
        }
      }
    }

    console.log(`[central-sync] GC orçamentos page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
    page++;
  }
  return map;
}

// Fetch ALL GC OS (no date filter)
async function fetchGcOs(gcHeaders: Record<string, string>): Promise<Record<string, any>> {
  const map: Record<string, any> = {};
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

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
            gc_os_cliente: String(os.nome_cliente || ""),
            gc_os_situacao: String(os.nome_situacao || ""),
            gc_os_situacao_id: String(os.situacao_id || ""),
            gc_os_cor_situacao: String(os.cor_situacao || ""),
            gc_os_valor_total: parseFloat(os.valor_total || "0"),
            gc_os_vendedor: String(os.nome_vendedor || ""),
            gc_os_data: String(os.data_entrada || os.data || "").split("T")[0] || null,
            gc_os_link: `https://gestaoclick.com/ordens_servicos/editar/${os.id}?retorno=%2Fordens_servicos`,
          };
        }
      }
    }

    console.log(`[central-sync] GC OS page ${page}/${totalPages}: ${records.length} registros, ${Object.keys(map).length} com tarefa`);
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

    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");

    if (!auvoApiKey || !auvoApiToken || !gcAccessToken || !gcSecretToken) {
      return new Response(JSON.stringify({ error: "Credenciais não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate period (request body overrides default 6-month + future window)
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + FUTURE_DAYS_WINDOW);

    const body = await req.json().catch(() => ({}));
    const bodyStart = normalizeDate(body?.start_date);
    const bodyEnd = normalizeDate(body?.end_date);

    const startDate = bodyStart || sixMonthsAgo.toISOString().split("T")[0];
    const endDate = bodyEnd || futureDate.toISOString().split("T")[0];
    const cleanupCutoff = sixMonthsAgo.toISOString().split("T")[0];

    console.log(`[central-sync] Período: ${startDate} a ${endDate} (limpeza < ${cleanupCutoff})`);

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
    const gcH: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Fetch all data in parallel
    const [auvoTasks, gcOrcMap, gcOsMap] = await Promise.all([
      fetchAuvoTasks(bearerToken, startDate, endDate),
      fetchGcOrcamentos(gcH),
      fetchGcOs(gcH),
    ]);

    console.log(`[central-sync] Auvo: ${auvoTasks.length} tarefas, GC Orç: ${Object.keys(gcOrcMap).length}, GC OS: ${Object.keys(gcOsMap).length}`);

    if (auvoTasks.length === 0) {
      console.warn("[central-sync] Nenhuma tarefa retornada do Auvo; aplicando fallback apenas com dados do GC");
    }

    // Build rows for upsert
    const rows: any[] = [];
    for (const task of auvoTasks) {
      const taskId = String(task.taskID || "");
      if (!taskId) continue;

      const gcOrc = gcOrcMap[taskId] || null;
      const gcOs = gcOsMap[taskId] || null;

      // Customer resolution chain
      const desc = String(task.customerDescription || "").trim();
      const nameRaw = String(
        task.customerName || task.customer?.tradeName || task.customer?.companyName || ""
      ).trim();
      const nameGc = gcOrc?.gc_orc_cliente || gcOs?.gc_os_cliente || "";
      const cliente = desc || nameRaw || nameGc || "Cliente não identificado";

      // Questionnaire
      const targetQ = (task.questionnaires || []).find(
        (q: any) => String(q.questionnaireId) === QUESTIONNAIRE_ID
      );
      const answers = (targetQ?.answers || []).map((a: any) => ({
        question: String(a.questionDescription || ""),
        reply: String(a.reply || ""),
      }));
      const hasFilledQ = answers.some(
        (r: any) => r.reply && r.reply.trim() !== "" && !r.reply.startsWith("http")
      );

      const row: any = {
        auvo_task_id: taskId,
        cliente,
        tecnico: String(task.userToName || ""),
        tecnico_id: String(task.idUserTo || ""),
        data_tarefa: normalizeDate(task.taskDate) || gcOs?.gc_os_data || null,
        status_auvo: task.finished ? "Finalizada" : (task.checkIn ? "Em andamento" : "Aberta"),
        orientacao: String(task.orientation || "").substring(0, 500),
        pendencia: String(task.pendency ?? "").trim(),
        descricao: String(task.description || "").substring(0, 500),
        duracao_decimal: parseFloat(task.durationDecimal || "0") || 0,
        hora_inicio: String(task.startTime || task.startHour || ""),
        hora_fim: String(task.endTime || task.endHour || ""),
        check_in: !!task.checkIn,
        check_out: !!task.checkOut,
        endereco: typeof task.address === "object" ? "" : String(task.address || "").substring(0, 200),
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: String(task.taskUrl || ""),
        auvo_survey_url: String(task.survey || ""),
        questionario_id: targetQ ? String(targetQ.questionnaireId) : null,
        questionario_respostas: answers,
        questionario_preenchido: hasFilledQ,
        orcamento_realizado: !!gcOrc,
        os_realizada: !!gcOs,
        atualizado_em: new Date().toISOString(),
      };

      // GC Orçamento fields
      if (gcOrc) {
        row.gc_orcamento_id = gcOrc.gc_orcamento_id;
        row.gc_orcamento_codigo = gcOrc.gc_orcamento_codigo;
        row.gc_orc_cliente = gcOrc.gc_orc_cliente;
        row.gc_orc_situacao = gcOrc.gc_orc_situacao;
        row.gc_orc_situacao_id = gcOrc.gc_orc_situacao_id;
        row.gc_orc_cor_situacao = gcOrc.gc_orc_cor_situacao;
        row.gc_orc_valor_total = gcOrc.gc_orc_valor_total;
        row.gc_orc_vendedor = gcOrc.gc_orc_vendedor;
        row.gc_orc_data = gcOrc.gc_orc_data;
        row.gc_orc_link = gcOrc.gc_orc_link;
      }

      // GC OS fields
      if (gcOs) {
        row.gc_os_id = gcOs.gc_os_id;
        row.gc_os_codigo = gcOs.gc_os_codigo;
        row.gc_os_cliente = gcOs.gc_os_cliente;
        row.gc_os_situacao = gcOs.gc_os_situacao;
        row.gc_os_situacao_id = gcOs.gc_os_situacao_id;
        row.gc_os_cor_situacao = gcOs.gc_os_cor_situacao;
        row.gc_os_valor_total = gcOs.gc_os_valor_total;
        row.gc_os_vendedor = gcOs.gc_os_vendedor;
        row.gc_os_data = gcOs.gc_os_data;
        row.gc_os_link = gcOs.gc_os_link;
      }

      rows.push(row);
    }

    // Fallback: include GC OS linked to tarefa that was not returned by Auvo list (e.g. taskDate = 0001-01-01)
    const existingTaskIds = new Set(rows.map((r) => String(r.auvo_task_id)));
    for (const [taskId, gcOs] of Object.entries(gcOsMap)) {
      if (existingTaskIds.has(taskId)) continue;
      const gcOrc = gcOrcMap[taskId] || null;
      const fallbackRow: any = {
        auvo_task_id: taskId,
        cliente: gcOs?.gc_os_cliente || gcOrc?.gc_orc_cliente || "Cliente não identificado",
        tecnico: "",
        tecnico_id: "",
        data_tarefa: gcOs?.gc_os_data || null,
        status_auvo: "Sem tarefa Auvo",
        orientacao: "",
        pendencia: "",
        descricao: "",
        duracao_decimal: 0,
        hora_inicio: "",
        hora_fim: "",
        check_in: false,
        check_out: false,
        endereco: "",
        auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
        auvo_task_url: "",
        auvo_survey_url: "",
        questionario_id: null,
        questionario_respostas: [],
        questionario_preenchido: false,
        orcamento_realizado: !!gcOrc,
        os_realizada: true,
        atualizado_em: new Date().toISOString(),
        gc_os_id: gcOs.gc_os_id,
        gc_os_codigo: gcOs.gc_os_codigo,
        gc_os_cliente: gcOs.gc_os_cliente,
        gc_os_situacao: gcOs.gc_os_situacao,
        gc_os_situacao_id: gcOs.gc_os_situacao_id,
        gc_os_cor_situacao: gcOs.gc_os_cor_situacao,
        gc_os_valor_total: gcOs.gc_os_valor_total,
        gc_os_vendedor: gcOs.gc_os_vendedor,
        gc_os_data: gcOs.gc_os_data,
        gc_os_link: gcOs.gc_os_link,
      };

      if (gcOrc) {
        fallbackRow.gc_orcamento_id = gcOrc.gc_orcamento_id;
        fallbackRow.gc_orcamento_codigo = gcOrc.gc_orcamento_codigo;
        fallbackRow.gc_orc_cliente = gcOrc.gc_orc_cliente;
        fallbackRow.gc_orc_situacao = gcOrc.gc_orc_situacao;
        fallbackRow.gc_orc_situacao_id = gcOrc.gc_orc_situacao_id;
        fallbackRow.gc_orc_cor_situacao = gcOrc.gc_orc_cor_situacao;
        fallbackRow.gc_orc_valor_total = gcOrc.gc_orc_valor_total;
        fallbackRow.gc_orc_vendedor = gcOrc.gc_orc_vendedor;
        fallbackRow.gc_orc_data = gcOrc.gc_orc_data;
        fallbackRow.gc_orc_link = gcOrc.gc_orc_link;
      }

      rows.push(fallbackRow);
    }

    // Upsert in batches of 100
    let upserted = 0;
    let errors = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sbClient
        .from("tarefas_central")
        .upsert(batch, { onConflict: "auvo_task_id", ignoreDuplicates: false });
      
      if (error) {
        console.error(`[central-sync] Batch ${i}-${i + batch.length} error:`, error.message);
        errors++;
      } else {
        upserted += batch.length;
      }
    }

    // Clean up tasks older than 6 months
    const { count: deleted } = await sbClient
      .from("tarefas_central")
      .delete({ count: "exact" })
      .lt("data_tarefa", cleanupCutoff);

    console.log(`[central-sync] Concluído: ${upserted} upserted, ${errors} erros, ${deleted || 0} removidos (> 6 meses)`);

    return new Response(JSON.stringify({
      success: true,
      periodo: { inicio: startDate, fim: endDate },
      auvo_tarefas: auvoTasks.length,
      gc_orcamentos: Object.keys(gcOrcMap).length,
      gc_os: Object.keys(gcOsMap).length,
      upserted,
      errors,
      deleted: deleted || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[central-sync] Error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
