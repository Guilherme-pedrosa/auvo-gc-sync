import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";

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

// Fetch all tasks from Auvo for a date range, paginated
async function fetchAllAuvoTasks(
  bearerToken: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    const paramFilter = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const url = `${AUVO_BASE_URL}/tasks/?Page=${page}&PageSize=${pageSize}&Order=asc&ParamFilter=${paramFilter}`;
    console.log(`[tech-dashboard] Fetching page ${page}...`);
    const response = await fetch(url, { headers: auvoHeaders(bearerToken) });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(`[tech-dashboard] Error page ${page}: ${response.status} — ${errBody.substring(0, 300)}`);
      break;
    }
    
    let data: any;
    try { data = JSON.parse(responseText); } catch { break; }
    const entities = data?.result?.entityList || data?.result?.Entities || [];
    if (page === 1 && entities.length > 0) {
      console.log(`[tech-dashboard] First task keys: ${Object.keys(entities[0]).join(", ")}`);
      console.log(`[tech-dashboard] First task sample: ${JSON.stringify(entities[0]).substring(0, 1000)}`);
    }
    allTasks.push(...entities);
    console.log(`[tech-dashboard] Page ${page}: ${entities.length} tasks (total: ${allTasks.length})`);
    if (entities.length < pageSize) hasMore = false;
    else page++;
    // Safety limit
    if (page > 50) break;
  }

  return allTasks;
}

// Fetch OS count from GC for a date range
async function fetchGcOsCount(
  gcHeaders: Record<string, string>,
  dataInicio: string,
  dataFim: string
): Promise<{ total: number; porSituacao: Record<string, number> }> {
  let total = 0;
  const porSituacao: Record<string, number> = {};
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 20) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}&data_inicio=${dataInicio}&data_fim=${dataFim}`;
    const response = await fetch(url, { headers: gcHeaders });
    if (!response.ok) break;
    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const os of records) {
      total++;
      const sit = String(os.nome_situacao || "Desconhecida");
      porSituacao[sit] = (porSituacao[sit] || 0) + 1;
    }
    page++;
  }

  return { total, porSituacao };
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

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date();
    const startDate = body.start_date || today.toISOString().split("T")[0];
    const endDate = body.end_date || today.toISOString().split("T")[0];
    const periodo = body.periodo || "dia"; // dia, semana, mes

    console.log(`[tech-dashboard] Período: ${startDate} a ${endDate}`);

    // Login Auvo
    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    // Fetch all tasks
    const tasks = await fetchAllAuvoTasks(bearerToken, startDate, endDate);
    console.log(`[tech-dashboard] Total tasks: ${tasks.length}`);

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

      const finished = task.finished === true || task.finished === "true";
      if (finished) tech.tarefas_finalizadas++;
      else tech.tarefas_abertas++;

      if (task.checkIn === true) tech.tarefas_com_checkin++;
      if (task.checkOut === true) tech.tarefas_com_checkout++;

      const pendency = String(task.pendency ?? task.pendencia ?? "").trim();
      if (pendency && pendency.toLowerCase() !== "nenhuma" && pendency !== "" && pendency !== "0") {
        tech.tarefas_com_pendencia++;
      }

      // Calculate time from checkIn/checkOut timestamps
      const checkInTime = task.checkInDate || task.startDate || "";
      const checkOutTime = task.checkOutDate || task.endDate || "";
      if (checkInTime && checkOutTime) {
        try {
          const start = new Date(checkInTime).getTime();
          const end = new Date(checkOutTime).getTime();
          if (end > start) {
            tech.tempo_total_minutos += (end - start) / 60000;
          }
        } catch {}
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
      // Assuming 8h workday
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
      total_finalizadas: tasks.filter((t: any) => t.finished === true || t.finished === "true").length,
      total_tecnicos: tecnicos.length,
    };

    return new Response(JSON.stringify({ resumo, tecnicos }), {
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
