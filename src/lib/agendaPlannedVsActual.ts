import { agendaTaskWorkedTime, type AgendaWorkedTimeSource } from "@/lib/agendaWorkedTime";

export type AgendaOsPlanningSource = AgendaWorkedTimeSource & {
  gc_os_codigo?: string | null;
  tipo_tarefa_auvo?: string | null;
  duracao_planejada_minutos?: number | null;
};

export type AgendaOsDailyComparison = {
  plannedMinutes: number;
  plannedOsCount: number;
  comparedPlannedMinutes: number;
  actualCompletedMinutes: number;
  completedOsCount: number;
  pendingOsCount: number;
  inProgressOsCount: number;
  differenceMinutes: number;
};

const normalizeOsCode = (value: unknown) => String(value ?? "").replace(/\D/g, "");

const plannedMinutes = (value: unknown) => {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

const actualCandidateScore = (item: AgendaOsPlanningSource) => {
  const worked = agendaTaskWorkedTime(item);
  const type = String(item.tipo_tarefa_auvo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  let score = 0;
  if (worked.hasCheckOut && worked.minutes > 0) score += 200;
  if (type.includes("EXECUCAO")) score += 100;
  if (worked.inProgress) score += 50;
  if (plannedMinutes(item.duracao_planejada_minutos) > 0) score += 10;
  return score;
};

/**
 * Compara somente OS do GestaoClick. Preventivas, contratos e tarefas sem OS
 * continuam no total geral trabalhado, mas nunca entram no planejamento da OS.
 * Quando uma OS ainda nao terminou, ela entra no planejado do dia e nao reduz
 * artificialmente o comparativo das OS ja executadas.
 */
export function summarizeAgendaOsPlannedVsActual(
  items: AgendaOsPlanningSource[],
): AgendaOsDailyComparison {
  const byOs = new Map<string, AgendaOsPlanningSource[]>();
  for (const item of items) {
    const osCode = normalizeOsCode(item.gc_os_codigo);
    if (!osCode) continue;
    const rows = byOs.get(osCode) ?? [];
    rows.push(item);
    byOs.set(osCode, rows);
  }

  let plannedMinutesTotal = 0;
  let plannedOsCount = 0;
  let comparedPlannedMinutes = 0;
  let actualCompletedMinutes = 0;
  let completedOsCount = 0;
  let pendingOsCount = 0;
  let inProgressOsCount = 0;

  for (const rows of byOs.values()) {
    const osPlannedMinutes = Math.max(
      0,
      ...rows.map((item) => plannedMinutes(item.duracao_planejada_minutos)),
    );
    if (osPlannedMinutes <= 0) continue;

    plannedMinutesTotal += osPlannedMinutes;
    plannedOsCount += 1;

    const representative = [...rows].sort(
      (left, right) => actualCandidateScore(right) - actualCandidateScore(left),
    )[0];
    const worked = agendaTaskWorkedTime(representative);
    if (worked.hasCheckOut && worked.minutes > 0) {
      comparedPlannedMinutes += osPlannedMinutes;
      actualCompletedMinutes += worked.minutes;
      completedOsCount += 1;
    } else {
      pendingOsCount += 1;
      if (rows.some((item) => agendaTaskWorkedTime(item).inProgress)) {
        inProgressOsCount += 1;
      }
    }
  }

  return {
    plannedMinutes: plannedMinutesTotal,
    plannedOsCount,
    comparedPlannedMinutes,
    actualCompletedMinutes,
    completedOsCount,
    pendingOsCount,
    inProgressOsCount,
    differenceMinutes: actualCompletedMinutes - comparedPlannedMinutes,
  };
}

export function formatSignedAgendaMinutes(value: number) {
  const rounded = Math.round(Number(value) || 0);
  if (rounded === 0) return "no previsto";
  const sign = rounded > 0 ? "+" : "−";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const formatted = hours === 0
    ? `${minutes}min`
    : minutes === 0
      ? `${hours}h`
      : `${hours}h${String(minutes).padStart(2, "0")}`;
  return `${sign}${formatted}`;
}
