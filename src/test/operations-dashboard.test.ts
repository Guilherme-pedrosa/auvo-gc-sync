import { describe, expect, it } from "vitest";
import { buildOperationsDashboardSnapshot, dedupeTasks } from "@/lib/operationsDashboard";
import { buildTechnicianDashboardData, findTechnicianGoal, technicianGoalProgress, technicianOperationalScore } from "@/lib/technicianDashboard";

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
        { status_preventiva: "vencido", proxima_preventiva: "2026-08-20", atualizado_em: "2026-08-06T13:00:00Z" },
        { status_preventiva: "em_dia", proxima_preventiva: "2026-10-20", atualizado_em: "2026-08-06T13:00:00Z" },
      ],
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
});
