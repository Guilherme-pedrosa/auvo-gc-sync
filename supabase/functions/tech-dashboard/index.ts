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

    // Merge cross-month rows first.
    const seen = new Set(allTasks.map((t: any) => t.auvo_task_id));
    for (const t of crossMonthTasks) {
      if (!seen.has(t.auvo_task_id)) {
        allTasks.push(t);
        seen.add(t.auvo_task_id);
      }
    }

    // The mirror can temporarily contain more than one row for the same Auvo task.
    // Keep the newest snapshot so productivity, hours and value are never doubled.
    const taskSnapshots = new Map<string, any>();
    for (const task of allTasks) {
      const taskId = String(task.auvo_task_id || task.mirror_key || "").trim();
      if (!taskId) continue;
      const current = taskSnapshots.get(taskId);
      const currentTime = current?.atualizado_em ? Date.parse(current.atualizado_em) : 0;
      const candidateTime = task.atualizado_em ? Date.parse(task.atualizado_em) : 0;
      if (!current || candidateTime >= currentTime) taskSnapshots.set(taskId, task);
    }
    allTasks.splice(0, allTasks.length, ...taskSnapshots.values());

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
          return n === nAuvo || n === nGc;
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
      tarefas_sem_questionario: number;
      checkins_sem_checkout: number;
      tarefas_com_os: number;
      tarefas_com_falha_qualidade: number;
      tempo_total_minutos: number;
      deslocamento_total_minutos: number;
      valor_total: number;
      tarefas_por_dia: Record<string, number>;
      finalizadas_por_dia: Record<string, number>;
    };

    const techMap: Record<string, TechAccum> = {};
    const documentContributors = new Map<string, { value: number; techIds: Set<string> }>();

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
          tarefas_sem_questionario: 0,
          checkins_sem_checkout: 0,
          tarefas_com_os: 0,
          tarefas_com_falha_qualidade: 0,
          tempo_total_minutos: 0,
          deslocamento_total_minutos: 0,
          valor_total: 0,
          tarefas_por_dia: {},
          finalizadas_por_dia: {},
        };
      }

      const tech = techMap[techId];
      tech.tarefas_total++;

      const normalizedStatus = String(t.status_auvo || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
      const finished = t.check_out === true || normalizedStatus === "finalizada" || normalizedStatus === "concluida";
      if (finished) tech.tarefas_finalizadas++;
      else tech.tarefas_abertas++;

      const pendencia = String(t.pendencia || "").trim();
      const hasPendingIssue = Boolean(pendencia && pendencia.toLowerCase() !== "nenhuma" && pendencia !== "0");
      const missingQuestionnaire = finished && t.questionario_preenchido !== true;
      const openCheckIn = Boolean(t.check_in_iso && !t.check_out_iso);
      if (hasPendingIssue) {
        tech.tarefas_com_pendencia++;
      }
      if (missingQuestionnaire) tech.tarefas_sem_questionario++;
      if (openCheckIn) tech.checkins_sem_checkout++;
      if (t.os_realizada === true || t.gc_os_id) tech.tarefas_com_os++;
      if (hasPendingIssue || missingQuestionnaire || openCheckIn) tech.tarefas_com_falha_qualidade++;

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

      // Value: use GC OS value first, then GC orçamento, then hourly rate as fallback
      const gcOsValor = Number(t.gc_os_valor_total) || 0;
      const gcOrcValor = Number(t.gc_orc_valor_total) || 0;
      const documentKey = t.gc_os_id
        ? `os:${String(t.gc_os_id)}`
        : t.gc_orcamento_id
          ? `orc:${String(t.gc_orcamento_id)}`
          : "";
      const documentValue = gcOsValor > 0 ? gcOsValor : gcOrcValor;
      if (documentKey && documentValue > 0) {
        const contribution = documentContributors.get(documentKey) || { value: documentValue, techIds: new Set<string>() };
        contribution.value = Math.max(contribution.value, documentValue);
        contribution.techIds.add(techId);
        documentContributors.set(documentKey, contribution);
      } else {
        const cliente = t.cliente || t.gc_os_cliente || "";
        const clienteGc = t.gc_os_cliente || "";
        const rate = getHourlyRate(techName, cliente, clienteGc);
        if (rate > 0 && duracao > 0) {
          tech.valor_total += duracao * rate;
        }
      }

      // Tasks per day (use completion date)
      const taskDate = t.data_conclusao || t.data_tarefa || startDate;
      tech.tarefas_por_dia[taskDate] = (tech.tarefas_por_dia[taskDate] || 0) + 1;
      if (finished) {
        tech.finalizadas_por_dia[taskDate] = (tech.finalizadas_por_dia[taskDate] || 0) + 1;
      }
    }

    // Split shared documents across their technicians. The dashboard total now
    // reconciles with unique GC documents instead of multiplying their value.
    for (const contribution of documentContributors.values()) {
      const allocation = contribution.techIds.size > 0 ? contribution.value / contribution.techIds.size : 0;
      for (const techId of contribution.techIds) {
        if (techMap[techId]) techMap[techId].valor_total += allocation;
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
      const qualidadePct = tech.tarefas_total > 0
        ? Math.max(0, Math.round(((tech.tarefas_total - tech.tarefas_com_falha_qualidade) / tech.tarefas_total) * 100))
        : 0;

      return {
        id: tech.id,
        nome: tech.nome,
        tarefas_total: tech.tarefas_total,
        tarefas_finalizadas: tech.tarefas_finalizadas,
        tarefas_abertas: tech.tarefas_abertas,
        tarefas_com_pendencia: tech.tarefas_com_pendencia,
        tarefas_sem_questionario: tech.tarefas_sem_questionario,
        checkins_sem_checkout: tech.checkins_sem_checkout,
        tarefas_com_os: tech.tarefas_com_os,
        qualidade_pct: qualidadePct,
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
      total_finalizadas: tecnicos.reduce((total, tech) => total + tech.tarefas_finalizadas, 0),
      total_tecnicos: tecnicos.length,
      total_horas: Math.round(tecnicos.reduce((total, tech) => total + tech.tempo_horas, 0) * 10) / 10,
      total_deslocamento_horas: Math.round(tecnicos.reduce((total, tech) => total + tech.deslocamento_horas, 0) * 10) / 10,
      total_pendencias: tecnicos.reduce((total, tech) => total + tech.tarefas_com_pendencia, 0),
      total_sem_questionario: tecnicos.reduce((total, tech) => total + tech.tarefas_sem_questionario, 0),
      total_checkins_sem_checkout: tecnicos.reduce((total, tech) => total + tech.checkins_sem_checkout, 0),
      valor_total: Math.round(tecnicos.reduce((total, tech) => total + tech.valor_total, 0) * 100) / 100,
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
