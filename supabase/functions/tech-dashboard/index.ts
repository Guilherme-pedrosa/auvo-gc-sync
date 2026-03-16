import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date().toISOString().split("T")[0];
    const startDate = body.start_date || today;
    const endDate = body.end_date || today;

    console.log(`[tech-dashboard] Período: ${startDate} a ${endDate}`);

    // Fetch tasks from tarefas_central using data_conclusao (completion date) with fallback to data_tarefa
    const allTasks: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: chunk, error } = await sb
        .from("tarefas_central")
        .select("*")
        .gte("data_tarefa", startDate)
        .lte("data_tarefa", endDate)
        .range(from, from + 999);
      if (error) { console.error("[tech-dashboard] DB error:", error.message); break; }
      if (!chunk || chunk.length === 0) break;
      allTasks.push(...chunk);
      if (chunk.length < 1000) break;
    }

    // Also fetch tasks that have data_conclusao in range but data_tarefa outside (cross-month tasks)
    const crossMonthTasks: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: chunk, error } = await sb
        .from("tarefas_central")
        .select("*")
        .not("data_conclusao", "is", null)
        .gte("data_conclusao", startDate)
        .lte("data_conclusao", endDate)
        .or(`data_tarefa.lt.${startDate},data_tarefa.gt.${endDate},data_tarefa.is.null`)
        .range(from, from + 999);
      if (error) { console.error("[tech-dashboard] DB cross-month error:", error.message); break; }
      if (!chunk || chunk.length === 0) break;
      crossMonthTasks.push(...chunk);
      if (chunk.length < 1000) break;
    }

    // Merge, dedup by auvo_task_id
    const seen = new Set(allTasks.map((t: any) => t.auvo_task_id));
    for (const t of crossMonthTasks) {
      if (!seen.has(t.auvo_task_id)) {
        allTasks.push(t);
        seen.add(t.auvo_task_id);
      }
    }

    console.log(`[tech-dashboard] Total tasks from DB: ${allTasks.length} (${crossMonthTasks.length} cross-month)`);

    // Load valor_hora_config for cost calculation
    const { data: valorHoraConfigs } = await sb.from("valor_hora_config").select("*");
    const { data: grupos } = await sb.from("grupos_clientes").select("*");
    const { data: membros } = await sb.from("grupo_cliente_membros").select("*");

    const configs = valorHoraConfigs || [];
    const gruposList = grupos || [];
    const membrosList = membros || [];

    // Build group→members map
    const grupoMembrosMap: Record<string, string[]> = {};
    for (const g of gruposList) {
      grupoMembrosMap[g.id] = membrosList
        .filter((m: any) => m.grupo_id === g.id)
        .map((m: any) => m.cliente_nome);
    }

    const normalizeName = (name: string) =>
      name.toUpperCase()
        .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
        .replace(/[.\-\/]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    function getHourlyRate(tecnico: string, clienteAuvo: string, clienteGc: string): number {
      for (const nome of [clienteAuvo, clienteGc].filter(Boolean)) {
        const direct = configs.find(
          (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "cliente" && c.referencia_nome === nome
        );
        if (direct) return Number(direct.valor_hora) || 0;
      }
      const nAuvo = normalizeName(clienteAuvo);
      const nGc = normalizeName(clienteGc);
      for (const g of gruposList) {
        const gClientes = grupoMembrosMap[g.id] || [];
        const isInGroup = gClientes.some((gc: string) => {
          const n = normalizeName(gc);
          return n === nAuvo || n === nGc || (nAuvo && n.includes(nAuvo)) || (nAuvo && nAuvo.includes(n));
        });
        if (isInGroup) {
          const groupConfig = configs.find(
            (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "grupo" && c.grupo_id === g.id
          );
          if (groupConfig) return Number(groupConfig.valor_hora) || 0;
        }
      }
      return 0;
    }

    // Group by technician
    type TechAccum = {
      id: string;
      nome: string;
      tarefas_total: number;
      tarefas_finalizadas: number;
      tarefas_abertas: number;
      tarefas_com_pendencia: number;
      tempo_total_minutos: number;
      deslocamento_total_minutos: number;
      valor_total: number;
      tarefas_por_dia: Record<string, number>;
      finalizadas_por_dia: Record<string, number>;
    };

    const techMap: Record<string, TechAccum> = {};

    for (const t of allTasks) {
      const techId = String(t.tecnico_id || "").trim();
      const techName = String(t.tecnico || "").trim();
      if (!techId || !techName) continue;

      if (!techMap[techId]) {
        techMap[techId] = {
          id: techId,
          nome: techName,
          tarefas_total: 0,
          tarefas_finalizadas: 0,
          tarefas_abertas: 0,
          tarefas_com_pendencia: 0,
          tempo_total_minutos: 0,
          deslocamento_total_minutos: 0,
          valor_total: 0,
          tarefas_por_dia: {},
          finalizadas_por_dia: {},
        };
      }

      const tech = techMap[techId];
      tech.tarefas_total++;

      const finished = t.check_out === true;
      if (finished) tech.tarefas_finalizadas++;
      else tech.tarefas_abertas++;

      const pendencia = String(t.pendencia || "").trim();
      if (pendencia && pendencia.toLowerCase() !== "nenhuma" && pendencia !== "0") {
        tech.tarefas_com_pendencia++;
      }

      // Hours from duracao_decimal
      const duracao = Number(t.duracao_decimal) || 0;
      if (duracao > 0) {
        tech.tempo_total_minutos += duracao * 60;
      }

      // Displacement
      const deslocamento = Number(t.duracao_deslocamento) || 0;
      if (deslocamento > 0) {
        tech.deslocamento_total_minutos += deslocamento * 60;
      }

      // Value: use hourly rate config
      const cliente = t.cliente || t.gc_os_cliente || "";
      const clienteGc = t.gc_os_cliente || "";
      const rate = getHourlyRate(techName, cliente, clienteGc);
      if (rate > 0 && duracao > 0) {
        tech.valor_total += duracao * rate;
      }

      // Tasks per day (use completion date)
      const taskDate = t.data_conclusao || t.data_tarefa || startDate;
      tech.tarefas_por_dia[taskDate] = (tech.tarefas_por_dia[taskDate] || 0) + 1;
      if (finished) {
        tech.finalizadas_por_dia[taskDate] = (tech.finalizadas_por_dia[taskDate] || 0) + 1;
      }
    }

    // Calculate metrics
    const tecnicos = Object.values(techMap).map((tech) => {
      const dias = Object.keys(tech.tarefas_por_dia).length || 1;
      const taxaFinalizacao = tech.tarefas_total > 0
        ? Math.round((tech.tarefas_finalizadas / tech.tarefas_total) * 100)
        : 0;
      const mediaExecucoesDia = Math.round((tech.tarefas_finalizadas / dias) * 10) / 10;
      const tempoHoras = Math.round(tech.tempo_total_minutos / 60 * 10) / 10;
      const deslocamentoHoras = Math.round(tech.deslocamento_total_minutos / 60 * 10) / 10;
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
        deslocamento_horas: deslocamentoHoras,
        tempo_atividade_pct: tempoAtividadePct,
        dias_trabalhados: dias,
        valor_total: valorTotal,
        faturamento_hora: faturamentoHora,
        tarefas_por_dia: tech.tarefas_por_dia,
        finalizadas_por_dia: tech.finalizadas_por_dia,
      };
    }).sort((a, b) => b.faturamento_hora - a.faturamento_hora);

    const resumo = {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas: allTasks.length,
      total_finalizadas: allTasks.filter((t: any) => t.check_out === true).length,
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
