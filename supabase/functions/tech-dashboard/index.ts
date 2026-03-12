import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";

function parseCurrency(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const raw = value.trim();
  if (!raw) return 0;
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  let normalized = raw;
  if (hasDot && hasComma) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (hasComma) normalized = raw.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Auvo login failed (${response.status}): ${errBody.substring(0, 200)}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Fetch all FINALIZED tasks from Auvo for a date range, paginated.
 * 
 * IMPORTANT - Auvo API V2 spec:
 * - paramFilter é JSON string URL-encoded
 * - startDate e endDate são OBRIGATÓRIOS no formato yyyy-MM-ddTHH:mm:ss (sem timezone, sem Z)
 * - status=3 = finalizedAutomaticallyOrManually
 */
async function fetchAllAuvoTasks(
  bearerToken: string,
  startDate: string, // yyyy-MM-dd
  endDate: string    // yyyy-MM-dd
): Promise<{ tasks: any[]; error: string | null }> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 10; // Safety limit

  // Formato exigido pela spec: yyyy-MM-ddTHH:mm:ss (sem Z, sem timezone)
  const formattedStart = `${startDate}T00:00:00`;
  const formattedEnd = `${endDate}T23:59:59`;

  console.log(`[tech-dashboard] startDate=${formattedStart}, endDate=${formattedEnd}`);

  while (page <= MAX_PAGES) {
    // paramFilter: JSON stringified + URL encoded, com status=3 (finalizadas)
    const filterObj = {
      startDate: formattedStart,
      endDate: formattedEnd,
      status: 3,
    };
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;

    console.log(`[tech-dashboard] Fetching page ${page} (filter: startDate=${formattedStart}, endDate=${formattedEnd}, status=3)`);

    const response = await fetch(url, { headers: auvoHeaders(bearerToken) });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      const errorMsg = `Auvo tasks API retornou ${response.status}: ${errBody.substring(0, 500)}`;
      console.error(`[tech-dashboard] ${errorMsg}`);
      return { tasks: allTasks, error: errorMsg };
    }

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(`[tech-dashboard] JSON parse error on page ${page}`);
      return { tasks: allTasks, error: "Resposta inválida (não é JSON) da API Auvo" };
    }

    const entities = data?.result?.entityList || data?.result?.Entities || [];

    if (page === 1 && entities.length > 0) {
      console.log(`[tech-dashboard] First task keys: ${Object.keys(entities[0]).join(", ")}`);
      console.log(`[tech-dashboard] First task sample: ${JSON.stringify(entities[0]).substring(0, 1000)}`);
      // Log value-related fields
      const t0 = entities[0];
      console.log(`[tech-dashboard] Value fields: expense=${JSON.stringify(t0.expense)?.substring(0,200)}, services=${JSON.stringify(t0.services)?.substring(0,500)}, products=${JSON.stringify(t0.products)?.substring(0,500)}, additionalCosts=${JSON.stringify(t0.additionalCosts)?.substring(0,200)}`);
    }

    allTasks.push(...entities);
    console.log(`[tech-dashboard] Page ${page}: ${entities.length} tasks (total acumulado: ${allTasks.length})`);

    if (entities.length < pageSize) break;
    page++;
  }

  if (page > MAX_PAGES) {
    console.warn(`[tech-dashboard] Atingiu limite de ${MAX_PAGES} páginas, total parcial: ${allTasks.length}`);
  }

  return { tasks: allTasks, error: null };
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

    const today = new Date();
    const startDate = body.start_date || today.toISOString().split("T")[0];
    const endDate = body.end_date || today.toISOString().split("T")[0];

    console.log(`[tech-dashboard] Período solicitado: ${startDate} a ${endDate}`);

    // Login Auvo
    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    // Fetch finalized tasks
    const { tasks, error: auvoError } = await fetchAllAuvoTasks(bearerToken, startDate, endDate);
    console.log(`[tech-dashboard] Total tasks retornadas: ${tasks.length}`);

    // Collect externalIds (GC OS codes) to fetch values from GC
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN") || "";
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN") || "";
    const gcHeaders: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // Build map: GC OS codigo → valor_total
    const gcValorMap: Record<string, number> = {};
    if (gcAccessToken && gcSecretToken) {
      try {
        let gcPage = 1;
        let gcTotalPages = 1;
        while (gcPage <= gcTotalPages && gcPage <= 10) {
          let gcUrl = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${gcPage}`;
          if (startDate) gcUrl += `&data_inicio=${startDate}`;
          if (endDate) gcUrl += `&data_fim=${endDate}`;
          const gcResp = await fetch(gcUrl, { headers: gcHeaders });
          if (!gcResp.ok) {
            console.warn(`[tech-dashboard] GC OS list error: ${gcResp.status}`);
            break;
          }
          const gcData = await gcResp.json();
          const gcRecords: any[] = Array.isArray(gcData?.data) ? gcData.data : [];
          gcTotalPages = gcData?.meta?.total_paginas || 1;
          for (const os of gcRecords) {
            const codigo = String(os.codigo || "").trim();
            if (codigo) {
              gcValorMap[codigo] = parseCurrency(os.valor_total);
            }
          }
          console.log(`[tech-dashboard] GC página ${gcPage}/${gcTotalPages}: ${gcRecords.length} OS carregadas`);
          gcPage++;
        }
        console.log(`[tech-dashboard] GC valor map: ${Object.keys(gcValorMap).length} OS com valor`);
      } catch (err) {
        console.warn(`[tech-dashboard] Erro ao buscar valores GC:`, err);
      }
    }

    // Group by technician
    const techMap: Record<string, {
      id: string;
      nome: string;
      tarefas_total: number;
      tarefas_finalizadas: number;
      tarefas_abertas: number;
      tarefas_com_checkin: number;
      tarefas_com_checkout: number;
      tarefas_com_pendencia: number;
      tempo_total_minutos: number;
      valor_total: number;
      tarefas_por_dia: Record<string, number>;
      finalizadas_por_dia: Record<string, number>;
    }> = {};

    for (const task of tasks) {
      const techId = String(task.idUserTo || task.userToId || task.collaboratorId || "");
      const techName = String(task.userToName || task.collaboratorName || "Desconhecido").trim();
      if (!techId || techName === "Desconhecido") continue;

      if (!techMap[techId]) {
        techMap[techId] = {
          id: techId,
          nome: techName,
          tarefas_total: 0,
          tarefas_finalizadas: 0,
          tarefas_abertas: 0,
          tarefas_com_checkin: 0,
          tarefas_com_checkout: 0,
          tarefas_com_pendencia: 0,
          tempo_total_minutos: 0,
          valor_total: 0,
          tarefas_por_dia: {},
          finalizadas_por_dia: {},
        };
      }

      const tech = techMap[techId];
      tech.tarefas_total++;

      // Como filtramos status=3 (finalizadas), todas são finalizadas
      // Mas verificamos o campo finished por segurança
      const finished = task.finished === true || task.finished === "true" || task.status === 3;
      if (finished) tech.tarefas_finalizadas++;
      else tech.tarefas_abertas++;

      if (task.checkIn === true) tech.tarefas_com_checkin++;
      if (task.checkOut === true) tech.tarefas_com_checkout++;

      const pendency = String(task.pendency ?? task.pendencia ?? "").trim();
      if (pendency && pendency.toLowerCase() !== "nenhuma" && pendency !== "" && pendency !== "0") {
        tech.tarefas_com_pendencia++;
      }

      // Usar durationDecimal do Auvo (horas decimais) — é o tempo real de trabalho na tarefa
      // calculado pelo próprio Auvo, evita somar check-in/check-out sobrepostos
      const durationDecimal = parseFloat(task.durationDecimal);
      if (!isNaN(durationDecimal) && durationDecimal > 0) {
        tech.tempo_total_minutos += durationDecimal * 60;
      } else {
        // Fallback: parse campo duration "HH:MM:SS"
        const durationStr = String(task.duration || "");
        const match = durationStr.match(/^(\d+):(\d+):(\d+)$/);
        if (match) {
          tech.tempo_total_minutos += parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 60;
        }
      }

      // Valor: somar services + products + additionalCosts + expense
      let taskTotal = 0;

      // Services
      if (Array.isArray(task.services)) {
        for (const s of task.services) {
          const item = s?.servico || s?.service || s;
          if (item && typeof item === "object") {
            const vt = parseCurrency(item.valor_total || item.totalValue || item.value);
            if (vt > 0) { taskTotal += vt; continue; }
            const qty = parseCurrency(item.quantidade || item.quantity || 1);
            const price = parseCurrency(item.valor_venda || item.valor || item.unitPrice || item.price || 0);
            taskTotal += qty * price;
          }
        }
      }

      // Products
      if (Array.isArray(task.products)) {
        for (const p of task.products) {
          const item = p?.produto || p?.product || p;
          if (item && typeof item === "object") {
            const vt = parseCurrency(item.valor_total || item.totalValue || item.value);
            if (vt > 0) { taskTotal += vt; continue; }
            const qty = parseCurrency(item.quantidade || item.quantity || 1);
            const price = parseCurrency(item.valor_venda || item.valor || item.unitPrice || item.price || 0);
            taskTotal += qty * price;
          }
        }
      }

      // Additional costs
      if (Array.isArray(task.additionalCosts)) {
        for (const c of task.additionalCosts) {
          const item = c?.custo || c?.cost || c;
          if (item && typeof item === "object") {
            taskTotal += parseCurrency(item.valor_total || item.totalValue || item.value || item.valor || 0);
          }
        }
      }

      // Expense (pode ser valor direto)
      const expenseVal = parseCurrency(task.expense);
      if (expenseVal > 0 && taskTotal === 0) {
        taskTotal = expenseVal;
      }

      tech.valor_total += taskTotal;

      // Tasks per day
      const taskDate = String(task.taskDate || task.date || startDate).split("T")[0];
      tech.tarefas_por_dia[taskDate] = (tech.tarefas_por_dia[taskDate] || 0) + 1;
      if (finished) {
        tech.finalizadas_por_dia[taskDate] = (tech.finalizadas_por_dia[taskDate] || 0) + 1;
      }
    }

    // Calculate metrics per technician
    const tecnicos = Object.values(techMap).map((tech) => {
      const dias = Object.keys(tech.tarefas_por_dia).length || 1;
      const taxaFinalizacao = tech.tarefas_total > 0
        ? Math.round((tech.tarefas_finalizadas / tech.tarefas_total) * 100)
        : 0;
      const mediaExecucoesDia = Math.round((tech.tarefas_finalizadas / dias) * 10) / 10;
      const tempoHoras = Math.round(tech.tempo_total_minutos / 60 * 10) / 10;
      const tempoAtividadePct = dias > 0
        ? Math.round((tech.tempo_total_minutos / (dias * 480)) * 100)
        : 0;

      const valorTotal = Math.round(tech.valor_total * 100) / 100;
      const faturamentoHora = tempoHoras > 0 ? Math.round((valorTotal / tempoHoras) * 100) / 100 : 0;

      return {
        id: tech.id,
        nome: tech.nome,
        tarefas_total: tech.tarefas_total,
        tarefas_finalizadas: tech.tarefas_finalizadas,
        tarefas_abertas: tech.tarefas_abertas,
        tarefas_com_pendencia: tech.tarefas_com_pendencia,
        taxa_finalizacao: taxaFinalizacao,
        media_execucoes_dia: mediaExecucoesDia,
        tempo_horas: tempoHoras,
        tempo_atividade_pct: tempoAtividadePct,
        dias_trabalhados: dias,
        valor_total: valorTotal,
        faturamento_hora: faturamentoHora,
        tarefas_por_dia: tech.tarefas_por_dia,
        finalizadas_por_dia: tech.finalizadas_por_dia,
      };
    }).sort((a, b) => b.tarefas_finalizadas - a.tarefas_finalizadas);

    // Summary
    const resumo = {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas: tasks.length,
      total_finalizadas: tasks.filter((t: any) => t.finished === true || t.finished === "true" || t.status === 3).length,
      total_tecnicos: tecnicos.length,
    };

    return new Response(JSON.stringify({ resumo, tecnicos, auvo_error: auvoError }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[tech-dashboard] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
