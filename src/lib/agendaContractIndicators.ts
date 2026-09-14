import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";

export type AgendaContractIndicator = {
  contractCard: AgendaAgendamento;
  taskId: string;
  status: "vinculada" | "contabilizada";
  executionId: string | null;
};

export type AgendaContractExecutionEvidence = {
  id: string;
  contrato_visita_config_id: string;
  data_realizada?: string | null;
  tarefa_ids: readonly (string | number)[];
};

const taskId = (value: unknown) => {
  const id = String(value ?? "").trim();
  return /^\d+$/.test(id) ? id : "";
};
const isContractCard = (item: AgendaAgendamento) =>
  item.previsao_tipo === "CONTRATO" || item.previsao_tipo === "CONTRATO_REALIZADO";
const sameCell = (left: AgendaAgendamento, right: AgendaAgendamento) =>
  Boolean(left.colaborador_id && right.colaborador_id)
  && left.colaborador_id === right.colaborador_id && left.data === right.data;

/** Só associa IDs explícitos. Nome do cliente, técnico e conclusão no Auvo
 * não provam vínculo nem contabilização. Nenhum item de entrada é alterado. */
export function buildAgendaContractIndicators(
  items: readonly AgendaAgendamento[],
  executions: readonly AgendaContractExecutionEvidence[] = [],
) {
  const indicatorsByItemId = new Map<string, AgendaContractIndicator[]>();
  const hiddenContractCardIds = new Set<string>();
  const executionById = new Map(executions.map((execution) => [execution.id, execution]));
  const agendaByTaskId = new Map<string, AgendaAgendamento[]>();
  for (const item of items) {
    const id = taskId(item.auvo_task_id);
    if (!id || isContractCard(item)) continue;
    const related = agendaByTaskId.get(id) ?? [];
    related.push(item);
    agendaByTaskId.set(id, related);
  }

  for (const card of items) {
    if (!isContractCard(card) || !card.contrato_visita_config_id) continue;
    const executionId = card.contrato_visita_execucao_id || null;
    const execution = executionId ? executionById.get(executionId) : undefined;
    // O trigger preserva tarefa_ids programados; apenas os detalhes da execução
    // (ou a lista canônica da execução consultada) provam tarefas contabilizadas.
    const recognizedIds = new Set<string>();
    if (executionId) {
      if (execution && execution.contrato_visita_config_id === card.contrato_visita_config_id) {
        execution.tarefa_ids.forEach((value) => { const id = taskId(value); if (id) recognizedIds.add(id); });
      } else if (!execution && Array.isArray(card.contrato_visita_tarefas_detalhes)) {
        for (const detail of card.contrato_visita_tarefas_detalhes) {
          const id = taskId(detail?.tarefa_id);
          if (id) recognizedIds.add(id);
        }
      }
    }
    const scheduledIds = new Set((card.contrato_visita_tarefa_ids ?? []).map(taskId).filter(Boolean));
    const linkedIds = new Set([...scheduledIds, ...recognizedIds]);
    for (const id of linkedIds) {
      for (const item of agendaByTaskId.get(id) ?? []) {
        const performedDate = String(execution?.data_realizada || card.contrato_visita_realizada_em || "").slice(0, 10);
        const accounted = recognizedIds.has(id) && Boolean(performedDate) && performedDate === item.data;
        if (!accounted && !scheduledIds.has(id)) continue;
        const status = String(item.status_auvo || item.status || "").normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (!accounted && /cancel|exclu|pendente.vinculo/.test(status)) continue;
        const indicator: AgendaContractIndicator = {
          contractCard: card, taskId: id,
          status: accounted ? "contabilizada" : "vinculada",
          executionId: accounted ? executionId : null,
        };
        const indicators = indicatorsByItemId.get(item.id) ?? [];
        const existingIndex = indicators.findIndex(({ contractCard: existing }) =>
          existing.contrato_visita_config_id === card.contrato_visita_config_id
          && existing.contrato_visita_competencia === card.contrato_visita_competencia
          && existing.contrato_visita_numero === card.contrato_visita_numero);
        if (existingIndex === -1) indicators.push(indicator);
        else {
          const existing = indicators[existingIndex];
          if ((accounted && existing.status !== "contabilizada")
            || (existing.status === indicator.status && sameCell(card, item) && !sameCell(existing.contractCard, item))) {
            indicators[existingIndex] = indicator;
          }
        }
        indicatorsByItemId.set(item.id, indicators);
        // Fora da mesma célula, a previsão continua visível na data/responsável
        // programados. Ocultar aqui é apenas apresentação, jamais exclusão.
        if (sameCell(card, item)) hiddenContractCardIds.add(card.id);
      }
    }
  }
  return { indicatorsByItemId, hiddenContractCardIds };
}
