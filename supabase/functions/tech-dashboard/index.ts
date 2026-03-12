import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

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
