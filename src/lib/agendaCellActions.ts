import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";

/** A anotação livre da célula nunca reutiliza a identidade de uma visita. */
export function findManualAgendaEntry<T extends Pick<AgendaAgendamento, "auvo_task_id" | "origem" | "previsao_tipo" | "contrato_visita_config_id">>(items: readonly T[]): T | undefined {
  return items.find((item) => !item.auvo_task_id && (!item.origem || item.origem === "MANUAL")
    && item.previsao_tipo !== "CONTRATO" && item.previsao_tipo !== "CONTRATO_REALIZADO"
    && !item.contrato_visita_config_id);
}

/** O item escolhido sempre se move. O restante inclui só as previsões ainda
 * não cumpridas daquele contrato e responsável a partir da data escolhida. */
export function selectFutureContractVisitMoves<T extends {
  id: string; data: string; colaborador_id?: string | null; colaborador_nome: string;
  previsao_tipo?: string | null; contrato_visita_config_id?: string | null;
  contrato_visita_execucao_id?: string | null; contrato_visita_realizada_em?: string | null; status?: string | null;
}>(selected: T, candidates: readonly T[]): T[] {
  if (selected.previsao_tipo !== "CONTRATO" || !selected.contrato_visita_config_id) return [];
  const seen = new Set([selected.id]);
  const future = candidates.filter((item) => {
    if (seen.has(item.id) || item.previsao_tipo !== "CONTRATO"
      || item.contrato_visita_config_id !== selected.contrato_visita_config_id
      || item.data < selected.data || item.contrato_visita_execucao_id || item.contrato_visita_realizada_em
      || item.status === "CUMPRIDA_NO_MES") return false;
    const sameCollaborator = selected.colaborador_id
      ? item.colaborador_id === selected.colaborador_id
      : !item.colaborador_id && item.colaborador_nome === selected.colaborador_nome;
    if (!sameCollaborator) return false;
    seen.add(item.id);
    return true;
  });
  return [selected, ...future.sort((left, right) => left.data.localeCompare(right.data) || left.id.localeCompare(right.id))];
}
