import { describe, expect, it } from "vitest";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import { buildAgendaContractIndicators } from "@/lib/agendaContractIndicators";

const base: AgendaAgendamento = { id: "plan", data: "2026-09-14", hora_inicio: "08:00", hora_fim: "09:00", colaborador_id: "tech", colaborador_nome: "Técnico", cliente: "Cliente", veiculo_id: null, descricao: null, status: "PREVISAO" };
const card = (changes: Partial<AgendaAgendamento> = {}): AgendaAgendamento => ({ ...base, origem: "CONTRATO", previsao_tipo: "CONTRATO", contrato_visita_config_id: "config", contrato_visita_competencia: "2026-09-01", contrato_visita_numero: 1, ...changes });
const task = (id: string, changes: Partial<AgendaAgendamento> = {}): AgendaAgendamento => ({ ...base, id: `task-${id}`, origem: "AUVO", auvo_task_id: id, status: "AGENDADO", ...changes });

describe("indicadores contratuais por IDs", () => {
  it("mantém previsão sem tarefa e não relaciona apenas pelo nome/data/técnico", () => {
    const result = buildAgendaContractIndicators([card(), task("100")]);
    expect(result.indicatorsByItemId.size).toBe(0);
    expect(result.hiddenContractCardIds.size).toBe(0);
  });
  it("vincula ID exato na mesma célula e oculta só a faixa redundante", () => {
    const plan = card({ contrato_visita_tarefa_ids: ["100"] });
    Object.freeze(plan);
    const result = buildAgendaContractIndicators([plan, task("100"), task("1000")]);
    expect(result.indicatorsByItemId.get("task-100")?.[0]).toMatchObject({ contractCard: plan, taskId: "100", status: "vinculada", executionId: null });
    expect(result.indicatorsByItemId.has("task-1000")).toBe(false);
    expect([...result.hiddenContractCardIds]).toEqual([plan.id]);
  });
  it("não transforma tarefa programada em contabilizada por execução de outra tarefa ou status Auvo", () => {
    const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"], contrato_visita_execucao_id: "exec", contrato_visita_realizada_em: "2026-09-14", contrato_visita_tarefas_detalhes: [{ tarefa_id: "200", horas: 4 }] }), task("100", { status_auvo: "Finalizada" }), task("200")]);
    expect(result.indicatorsByItemId.get("task-100")?.[0].status).toBe("vinculada");
    expect(result.indicatorsByItemId.get("task-200")?.[0]).toMatchObject({ status: "contabilizada", executionId: "exec" });
  });
  it("preserva previsão em outro dia, outro técnico ou sem responsável ID", () => {
    for (const changes of [{ data: "2026-09-15" }, { colaborador_id: "other" }, { colaborador_id: null }]) {
      const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"] }), task("100", changes)]);
      expect(result.indicatorsByItemId.get("task-100")?.[0].status).toBe("vinculada");
      expect(result.hiddenContractCardIds.size).toBe(0);
    }
  });
  it("mantém ambos contratos explícitos e deduplica cópias do mesmo slot", () => {
    const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"] }), card({ id: "copy", contrato_visita_tarefa_ids: ["100"] }), card({ id: "coifa", contrato_visita_config_id: "coifa", contrato_visita_tarefa_ids: ["100"] }), task("100")]);
    expect(result.indicatorsByItemId.get("task-100")).toHaveLength(2);
  });
  it("não esconde previsão quando a tarefa vinculada não está entre os itens visíveis", () => {
    const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"] }), task("200")]);
    expect(result.hiddenContractCardIds.size).toBe(0);
  });
  it("não anuncia vínculo futuro de tarefa cancelada", () => {
    const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"] }), task("100", { status_auvo: "Cancelada" })]);
    expect(result.indicatorsByItemId.size).toBe(0);
    expect(result.hiddenContractCardIds.size).toBe(0);
  });
  it("prefere IDs canônicos da execução a detalhes potencialmente antigos", () => {
    const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"], contrato_visita_execucao_id: "exec", contrato_visita_tarefas_detalhes: [{ tarefa_id: "100" }] }), task("100"), task("200")], [{ id: "exec", contrato_visita_config_id: "config", data_realizada: "2026-09-14", tarefa_ids: [200] }]);
    expect(result.indicatorsByItemId.get("task-100")?.[0].status).toBe("vinculada");
    expect(result.indicatorsByItemId.get("task-200")?.[0].status).toBe("contabilizada");
  });
  it("não afirma contabilização de uma tarefa movida para outro dia ou sem data de realização", () => {
    for (const performed of [null, "2026-09-13"]) {
      const result = buildAgendaContractIndicators([card({ contrato_visita_tarefa_ids: ["100"], contrato_visita_execucao_id: "exec", contrato_visita_realizada_em: performed, contrato_visita_tarefas_detalhes: [{ tarefa_id: "100" }] }), task("100")]);
      expect(result.indicatorsByItemId.get("task-100")?.[0].status).toBe("vinculada");
    }
  });
});
