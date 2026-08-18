import { normalizeClientName } from "@/lib/clientMatching";

export type ContractVisitProgressConfig = {
  id: string;
  contrato_id: string;
  qtd_visitas: number;
};

export type ContractVisitProgressContract = {
  id: string;
  horas_mes_contratadas: number | null;
};

export type ContractVisitProgressExecution = {
  id: string;
  contrato_visita_config_id: string;
  competencia: string;
  horas_trabalhadas: number;
};

export type ContractVisitAgendaItem = {
  id: string;
  cliente: string;
  hora_inicio?: string | null;
  previsao_tipo?: string | null;
  contrato_visita_config_id?: string | null;
  contrato_visita_competencia?: string | null;
  contrato_visitas_cumpridas?: number;
  contrato_visitas_previstas?: number;
  contrato_horas_cumpridas?: number;
  contrato_horas_previstas?: number;
};

const competenceKey = (value: string | null | undefined) => String(value || "").slice(0, 7);

/**
 * Anexa ao card planejado o que já foi efetivamente cumprido na competência.
 * A execução reconhecida é a fonte de verdade; cards previstos não entram na soma.
 */
export function attachContractVisitProgress<T extends ContractVisitAgendaItem>(
  items: T[],
  configs: ContractVisitProgressConfig[],
  contracts: ContractVisitProgressContract[],
  executions: ContractVisitProgressExecution[],
): T[] {
  const configById = new Map(configs.map((config) => [config.id, config]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const progressByConfigMonth = new Map<string, { visits: number; hours: number }>();

  for (const execution of executions) {
    const key = `${execution.contrato_visita_config_id}|${competenceKey(execution.competencia)}`;
    const current = progressByConfigMonth.get(key) ?? { visits: 0, hours: 0 };
    progressByConfigMonth.set(key, {
      visits: current.visits + 1,
      hours: current.hours + Math.max(0, Number(execution.horas_trabalhadas) || 0),
    });
  }

  return items.map((item) => {
    if (item.previsao_tipo !== "CONTRATO" || !item.contrato_visita_config_id) return item;

    const config = configById.get(item.contrato_visita_config_id);
    if (!config) return item;

    const competence = competenceKey(item.contrato_visita_competencia || item.id);
    const progress = progressByConfigMonth.get(`${config.id}|${competence}`) ?? { visits: 0, hours: 0 };
    const contract = contractById.get(config.contrato_id);

    return {
      ...item,
      contrato_visitas_cumpridas: progress.visits,
      contrato_visitas_previstas: Math.max(0, Number(config.qtd_visitas) || 0),
      contrato_horas_cumpridas: Number(progress.hours.toFixed(2)),
      contrato_horas_previstas: Math.max(0, Number(contract?.horas_mes_contratadas) || 0),
    };
  });
}

/**
 * Mantém a ordem cronológica entre clientes, mas abre cada bloco de cliente
 * com o card da visita contratual antes das tarefas que justificam a visita.
 */
export function sortAgendaItemsWithContractPlanFirst<T extends ContractVisitAgendaItem>(items: T[]): T[] {
  const groups = new Map<string, Array<{ item: T; index: number }>>();

  items.forEach((item, index) => {
    const clientKey = normalizeClientName(item.cliente) || `__sem_cliente_${item.id}`;
    const group = groups.get(clientKey) ?? [];
    group.push({ item, index });
    groups.set(clientKey, group);
  });

  return [...groups.values()]
    .sort((left, right) => {
      const leftFirst = [...left].sort(compareByTimeAndIndex)[0];
      const rightFirst = [...right].sort(compareByTimeAndIndex)[0];
      return compareByTimeAndIndex(leftFirst, rightFirst);
    })
    .flatMap((group) => group.sort((left, right) => {
      const leftPlan = left.item.previsao_tipo === "CONTRATO" ? 0 : 1;
      const rightPlan = right.item.previsao_tipo === "CONTRATO" ? 0 : 1;
      return leftPlan - rightPlan || compareByTimeAndIndex(left, right);
    }).map(({ item }) => item));
}

function compareByTimeAndIndex<T extends ContractVisitAgendaItem>(
  left: { item: T; index: number },
  right: { item: T; index: number },
) {
  return String(left.item.hora_inicio || "").localeCompare(String(right.item.hora_inicio || ""))
    || left.index - right.index;
}
