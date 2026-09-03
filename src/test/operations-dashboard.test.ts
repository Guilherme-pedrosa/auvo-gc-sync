import { describe, expect, it } from "vitest";
import { buildOperationsDashboardSnapshot, dedupeTasks } from "@/lib/operationsDashboard";
import { buildTechnicianAllowlist, buildTechnicianDashboardData, findTechnicianGoal, technicianGoalProgress, technicianOperationalScore, technicianQualityIssues } from "@/lib/technicianDashboard";

describe("operations dashboard aggregation", () => {
  it("keeps the newest task snapshot and does not double business totals", () => {
    const tasks = dedupeTasks([
      { auvo_task_id: "10", duracao_decimal: 2, atualizado_em: "2026-08-06T10:00:00Z" },
      { auvo_task_id: "10", duracao_decimal: 3, atualizado_em: "2026-08-06T11:00:00Z" },
      { auvo_task_id: "11", duracao_decimal: 1, atualizado_em: "2026-08-06T09:00:00Z" },
    ]);

    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.auvo_task_id === "10")?.duracao_decimal).toBe(3);
  });

  it("connects operational queues, quality and freshness into one snapshot", () => {
    const snapshot = buildOperationsDashboardSnapshot({
      tasks: [
        {
          auvo_task_id: "1",
          data_tarefa: "2026-08-06",
          status_auvo: "Finalizada",
          tecnico: "Ana",
          tecnico_id: "a",
          check_out: true,
          questionario_preenchido: false,
          duracao_decimal: 2.5,
          duracao_deslocamento: 0.5,
          os_realizada: true,
          atualizado_em: "2026-08-06T14:00:00Z",
        },
        {
          auvo_task_id: "2",
          data_tarefa: "2026-08-06",
          status_auvo: "Em andamento",
          tecnico: "Beto",
          tecnico_id: "b",
          check_in_iso: "2026-08-06T13:00:00Z",
          atualizado_em: "2026-08-06T14:00:00Z",
        },
      ],
      budgetCards: [
        { coluna: "falta_preenchimento", atualizado_em: "2026-08-06T13:00:00Z" },
        { coluna: "os_realizada", atualizado_em: "2026-08-06T13:00:00Z" },
      ],
      workshopCards: [{ coluna: "aguardando_os", atualizado_em: "2026-08-06T13:00:00Z" }],
      followupCards: [
        { coluna: "approval", atualizado_em: "2026-08-06T13:00:00Z" },
        { coluna: "validated", atualizado_em: "2026-08-06T13:00:00Z" },
      ],
      followupColumns: [
        { id: "approval", titulo: "Aguardando Aprovação" },
        { id: "validated", titulo: "Validado - Seguir processo" },
      ],
      preventiveRows: [
        // Atraso é por data + plano ativo (>30 dias e antes do mês vigente), não pelo status_preventiva.
        { identificador: "700100", status_preventiva: "vencido", proxima_preventiva: "2026-06-15", atualizado_em: "2026-08-06T13:00:00Z" },
        { identificador: "700200", status_preventiva: "vencido", proxima_preventiva: "2026-06-01", atualizado_em: "2026-08-06T13:00:00Z" },
        { identificador: "700300", status_preventiva: "agendado", proxima_preventiva: "2026-08-20", atualizado_em: "2026-08-06T13:00:00Z" },
        { identificador: "700400", status_preventiva: "em_dia", proxima_preventiva: "2026-10-20", atualizado_em: "2026-08-06T13:00:00Z" },
      ],
      plannedPreventiveIds: ["700100", "700300", "700400"],
      analysisRows: [
        { status_analise: "nova", prioridade: "critica", atualizado_em: "2026-08-06T13:00:00Z" },
        { status_analise: "resolvida", prioridade: "alta", atualizado_em: "2026-08-06T13:00:00Z" },
      ],
      missedActivities: 3,
      syncMeta: { id: "default", sync_status: "succeeded", sync_finished_at: "2026-08-06T13:00:00Z" },
    }, new Date("2026-08-06T15:00:00Z"));

    expect(snapshot.today.total).toBe(2);
    expect(snapshot.today.finished).toBe(1);
    expect(snapshot.month.hours).toBe(2.5);
    expect(snapshot.month.finishedWithoutQuestionnaire).toBe(1);
    expect(snapshot.month.checkInWithoutCheckout).toBe(1);
    expect(snapshot.budget.open).toBe(1);
    expect(snapshot.workshop.awaitingOs).toBe(1);
    expect(snapshot.followup.open).toBe(1);
    expect(snapshot.preventive.overdue).toBe(1);
    expect(snapshot.preventive.dueNext30Days).toBe(1);
    expect(snapshot.analyses.critical).toBe(1);
    expect(snapshot.freshness.every((item) => item.status === "healthy")).toBe(true);
  });
});

describe("technician dashboard rules", () => {
  it("deduplicates tasks and splits a shared GC document between technicians", () => {
    const dashboard = buildTechnicianDashboardData([
      {
        auvo_task_id: "1",
        atualizado_em: "2026-08-06T10:00:00Z",
        tecnico_id: "a",
        tecnico: "Ana",
        data_tarefa: "2026-08-06",
        status_auvo: "Finalizada",
        questionario_preenchido: true,
        gc_os_id: "os-1",
        gc_os_valor_total: 1000,
        os_realizada: true,
      },
      {
        auvo_task_id: "1",
        atualizado_em: "2026-08-06T11:00:00Z",
        tecnico_id: "a",
        tecnico: "Ana",
        data_tarefa: "2026-08-06",
        status_auvo: "Finalizada",
        questionario_preenchido: true,
        gc_os_id: "os-1",
        gc_os_valor_total: 1000,
        os_realizada: true,
      },
      {
        auvo_task_id: "2",
        atualizado_em: "2026-08-06T10:00:00Z",
        tecnico_id: "b",
        tecnico: "Beto",
        data_tarefa: "2026-08-06",
        status_auvo: "Finalizada",
        questionario_preenchido: true,
        gc_os_id: "os-1",
        gc_os_valor_total: 1000,
        os_realizada: true,
      },
    ], "2026-08-01", "2026-08-06");

    expect(dashboard.resumo.total_tarefas).toBe(2);
    expect(dashboard.resumo.valor_total).toBe(1000);
    expect(dashboard.tecnicos.find((tech) => tech.id === "a")?.valor_total).toBe(500);
    expect(dashboard.tecnicos.find((tech) => tech.id === "b")?.valor_total).toBe(500);
  });

  it("matches abbreviated goals and only scores clean quality when all issues are zero", () => {
    const goal = findTechnicianGoal("Ayrton Carvalho", [
      { nome_tecnico: "Ayrton", meta_faturamento: 21600, ativo: true },
    ]);

    expect(goal?.meta_faturamento).toBe(21600);
    expect(technicianGoalProgress(10800, goal)).toBe(50);
    expect(technicianOperationalScore({
      tarefas_total: 10,
      tarefas_finalizadas: 8,
      tarefas_com_pendencia: 0,
      tarefas_sem_questionario: 1,
      checkins_sem_checkout: 0,
      taxa_finalizacao: 80,
      media_execucoes_dia: 2,
      tempo_atividade_pct: 75,
    })).toBe(75);
  });

  it("feeds schedule, form, report and photo divergences into the technician dashboard", () => {
    const dashboard = buildTechnicianDashboardData([{
      auvo_task_id: "quality-1",
      tecnico_id: "a",
      tecnico: "Ana",
      cliente: "Cliente",
      data_tarefa: "2026-08-06",
      status_auvo: "Finalizada",
      questionario_preenchido: true,
      questionario_respostas: [
        { question: "OBSERVAÇÕES", reply: "ok" },
        { question: "FOTOS DA EXECUÇÃO", reply: "https://auvo-producao.s3.amazonaws.com/foto-1.jpg" },
      ],
    }], "2026-08-01", "2026-08-06", null, null, [{
      auvo_task_id: "schedule-1",
      tecnico_id: "a",
      tecnico_nome: "Ana",
      data_planejada: "2026-08-05",
      motivo: "Não realizou atendimento no dia planejado",
    }]);

    expect(dashboard.tecnicos[0]).toMatchObject({
      tarefas_nao_atendidas: 1,
      tarefas_com_formulario_incompleto: 0,
      tarefas_sem_relato: 1,
      tarefas_com_poucas_fotos: 1,
      qualidade_pct: 0,
    });
    expect(dashboard.resumo).toMatchObject({
      total_nao_atendidas: 1,
      total_formularios_incompletos: 0,
      total_sem_relato: 1,
      total_poucas_fotos: 1,
    });

    const qualityRecord = dashboard.divergencias.find((record) => record.taskId === "quality-1");
    expect(qualityRecord?.issues.map((issue) => issue.kind).sort()).toEqual(["photos", "report"]);
    expect(qualityRecord?.issues.every((issue) => issue.detail.length > 0)).toBe(true);
    const scheduleRecord = dashboard.divergencias.find((record) => record.taskId === "schedule-1");
    expect(scheduleRecord?.issues[0]).toMatchObject({ kind: "schedule", detail: "Não realizou atendimento no dia planejado" });
  });

  it("keeps summary cards on the same base as the table when an allowlist is provided", () => {
    const dashboard = buildTechnicianDashboardData([
      { auvo_task_id: "1", tecnico_id: "207034", tecnico: "Ayrton Carvalho", data_tarefa: "2026-09-01", status_auvo: "Finalizada", questionario_preenchido: true },
      { auvo_task_id: "2", tecnico_id: "999", tecnico: "Maria Eduarda", data_tarefa: "2026-09-01", status_auvo: "Finalizada", questionario_preenchido: true },
      { auvo_task_id: "3", tecnico_id: "", tecnico: "", data_tarefa: "2026-09-02", status_auvo: "Aberta" },
    ], "2026-09-01", "2026-09-03", buildTechnicianAllowlist([{ nome: "AYRTON EULER", auvo_user_id: "207034" }]));

    expect(dashboard.resumo.total_tarefas).toBe(1);
    expect(dashboard.resumo.total_finalizadas).toBe(1);
    expect(dashboard.resumo.tarefas_fora_painel).toBe(2);
    expect(dashboard.fora_painel.map((task) => task.tecnico)).toContain("Maria Eduarda");
    expect(dashboard.fora_painel.map((task) => task.tecnico)).toContain("Sem técnico");
  });

  it("treats today's open check-in as running and older ones as alerts with detail records", () => {
    const now = new Date("2026-09-03T15:00:00");
    const dashboard = buildTechnicianDashboardData([
      { auvo_task_id: "old", tecnico_id: "a", tecnico: "Ana", cliente: "Cliente A", data_tarefa: "2026-09-01", status_auvo: "Em andamento", check_in_iso: "2026-09-01T13:00:00" },
      { auvo_task_id: "today", tecnico_id: "a", tecnico: "Ana", cliente: "Cliente B", data_tarefa: "2026-09-03", status_auvo: "Em andamento", check_in_iso: "2026-09-03T14:00:00" },
    ], "2026-09-01", "2026-09-03", null, null, [], now);

    const ana = dashboard.tecnicos[0];
    expect(ana.checkins_sem_checkout).toBe(1);
    expect(ana.tarefas_em_execucao).toBe(1);
    expect(dashboard.resumo.total_checkins_sem_checkout).toBe(1);
    expect(dashboard.resumo.total_em_execucao).toBe(1);
    const checkinRecord = dashboard.divergencias.find((record) => record.issues.some((issue) => issue.kind === "checkin"));
    expect(checkinRecord?.taskId).toBe("old");
    // O card global de alertas soma as mesmas categorias do marcador por técnico.
    const cardTotal = dashboard.resumo.total_nao_atendidas + dashboard.resumo.total_formularios_incompletos
      + dashboard.resumo.total_sem_relato + dashboard.resumo.total_poucas_fotos + dashboard.resumo.total_checkins_sem_checkout;
    const badgeTotal = dashboard.tecnicos.reduce((total, tech) => total + technicianQualityIssues(tech), 0);
    expect(cardTotal).toBe(badgeTotal);
  });
});
