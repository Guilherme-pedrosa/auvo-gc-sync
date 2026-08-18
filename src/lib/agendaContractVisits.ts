import { normalizeClientName } from "@/lib/clientMatching";

export type ContractVisitProgressConfig = {
  id: string;
  contrato_id: string;
  qtd_visitas: number;
};

export type ContractVisitProgressContract = {
  id: string;
  nome: string;
  tipo_id: string | null;
  horas_mes_contratadas: number | null;
};

export type ContractVisitProgressType = {
  id: string;
  nome: string;
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
  contrato_id?: string | null;
  contrato_visita_config_id?: string | null;
  contrato_visita_competencia?: string | null;
  contrato_nome?: string | null;
  contrato_tipo_id?: string | null;
  contrato_tipo_nome?: string | null;
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
  contractTypes: ContractVisitProgressType[] = [],
): T[] {
  const configById = new Map(configs.map((config) => [config.id, config]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const contractTypeById = new Map(contractTypes.map((type) => [type.id, type]));
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
    if (!isContractVisitCard(item)) return item;

    const config = item.contrato_visita_config_id
      ? configById.get(item.contrato_visita_config_id)
      : undefined;
    const contract = contractById.get(item.contrato_id || config?.contrato_id || "");
    const contractType = contract?.tipo_id
      ? contractTypeById.get(contract.tipo_id)
      : undefined;
    const identifiedItem = {
      ...item,
      contrato_id: contract?.id || item.contrato_id || null,
      contrato_nome: contract?.nome || null,
      contrato_tipo_id: contract?.tipo_id || null,
      contrato_tipo_nome: contractType?.nome || null,
    };

    if (item.previsao_tipo !== "CONTRATO" || !config) return identifiedItem;

    const competence = competenceKey(item.contrato_visita_competencia || item.id);
    const progress = progressByConfigMonth.get(`${config.id}|${competence}`) ?? { visits: 0, hours: 0 };

    return {
      ...identifiedItem,
      contrato_visitas_cumpridas: progress.visits,
      contrato_visitas_previstas: Math.max(0, Number(config.qtd_visitas) || 0),
      contrato_horas_cumpridas: Number(progress.hours.toFixed(2)),
      contrato_horas_previstas: Math.max(0, Number(contract?.horas_mes_contratadas) || 0),
    };
  });
}

/**
 * Mantém a ordem cronológica entre clientes, mas abre cada bloco de cliente
 * com o card da visita contratual, planejada ou realizada, antes das tarefas
 * que justificam a visita.
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
      const leftPlan = isContractVisitCard(left.item) ? 0 : 1;
      const rightPlan = isContractVisitCard(right.item) ? 0 : 1;
      return leftPlan - rightPlan || compareByTimeAndIndex(left, right);
    }).map(({ item }) => item));
}

function isContractVisitCard(item: ContractVisitAgendaItem) {
  return item.previsao_tipo === "CONTRATO" || item.previsao_tipo === "CONTRATO_REALIZADO";
}

function compareByTimeAndIndex<T extends ContractVisitAgendaItem>(
  left: { item: T; index: number },
  right: { item: T; index: number },
) {
  return String(left.item.hora_inicio || "").localeCompare(String(right.item.hora_inicio || ""))
    || left.index - right.index;
}
