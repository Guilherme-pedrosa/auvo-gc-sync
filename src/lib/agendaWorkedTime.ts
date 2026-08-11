export type AgendaWorkedTimeSource = {
  id?: string | null;
  auvo_task_id?: string | null;
  check_in_iso?: string | null;
  check_out_iso?: string | null;
  duracao_decimal?: number | null;
  atualizado_em?: string | null;
};

export type AgendaTaskWorkedTime = {
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  inProgress: boolean;
  checkIn: Date | null;
  checkOut: Date | null;
  minutes: number;
};

const validDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("0001-01-01")) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
};

/**
 * Mesma regra funcional do relatório de horas:
 * - sem check-in, duração agendada nunca é trabalho;
 * - com duração oficial do Auvo, ela prevalece porque já desconta pausas;
 * - sem duração oficial, usa check-in → checkout como fallback.
 */
export function agendaTaskWorkedTime(source: AgendaWorkedTimeSource): AgendaTaskWorkedTime {
  const checkIn = validDate(source.check_in_iso);
  const checkOut = validDate(source.check_out_iso);
  if (!checkIn) {
    return { hasCheckIn: false, hasCheckOut: false, inProgress: false, checkIn: null, checkOut: null, minutes: 0 };
  }

  const officialHours = Number(source.duracao_decimal);
  let minutes = Number.isFinite(officialHours) && officialHours > 0
    ? Math.round(officialHours * 60)
    : 0;

  if (minutes === 0 && checkOut && checkOut.getTime() > checkIn.getTime()) {
    minutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000);
  }

  return {
    hasCheckIn: true,
    hasCheckOut: Boolean(checkOut),
    inProgress: !checkOut,
    checkIn,
    checkOut,
    minutes: Math.max(0, minutes),
  };
}

export function agendaWorkSnapshotQuality(source: AgendaWorkedTimeSource): number {
  const worked = agendaTaskWorkedTime(source);
  let score = 0;
  if (worked.hasCheckIn) score += 100;
  if (worked.hasCheckOut) score += 100;
  if (worked.minutes > 0) score += 300;
  return score;
}

export function summarizeAgendaWorkedTime(items: AgendaWorkedTimeSource[]) {
  const seen = new Set<string>();
  let totalMinutes = 0;
  let tasksWithWork = 0;
  let inProgress = 0;

  for (const item of items) {
    const key = String(item.auvo_task_id || item.id || "").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    const worked = agendaTaskWorkedTime(item);
    if (worked.minutes > 0) {
      totalMinutes += worked.minutes;
      tasksWithWork += 1;
    }
    if (worked.inProgress) inProgress += 1;
  }

  return { totalMinutes, tasksWithWork, inProgress };
}

export function formatWorkedMinutes(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

export function formatWorkedClock(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
