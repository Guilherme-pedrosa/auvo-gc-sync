import { parseAuvoDurationMinutes } from "./auvo-duration.ts";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value != null && typeof value === "object" ? value as UnknownRecord : {};
}

function dateValue(task: unknown, keys: string[]): string | null {
  const record = asRecord(task);
  for (const key of keys) {
    const value = String(record[key] ?? "").trim();
    if (value && !value.startsWith("0001-01-01")) return value;
  }
  return null;
}

export function auvoCheckInDate(task: unknown): string | null {
  return dateValue(task, ["checkInDate", "CheckInDate", "checkinDate", "checkin_date", "dateCheckIn"]);
}

export function auvoCheckOutDate(task: unknown): string | null {
  return dateValue(task, ["checkOutDate", "CheckOutDate", "checkoutDate", "checkout_date", "dateCheckOut"]);
}

/**
 * Calcula somente horas efetivamente trabalhadas.
 * estimatedDuration/standardTime nunca entram neste cálculo.
 */
export function computeAuvoWorkedHours(task: unknown): number {
  const record = asRecord(task);
  const officialMinutes = parseAuvoDurationMinutes(record.duration ?? record.Duration);
  if (officialMinutes > 0) {
    return Math.round((officialMinutes / 60) * 10_000) / 10_000;
  }

  const checkIn = auvoCheckInDate(task);
  const checkOut = auvoCheckOutDate(task);
  if (checkIn && checkOut) {
    const inMs = new Date(checkIn).getTime();
    const outMs = new Date(checkOut).getTime();
    if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs) {
      const controls: unknown[] = Array.isArray(record.timeControl)
        ? record.timeControl
        : Array.isArray(record.TimeControl)
          ? record.TimeControl
          : [];
      let pausedMs = 0;
      for (const control of controls) {
        const pause = asRecord(control);
        const pauseStart = pause.pauseStart ?? pause.startPause ?? pause.start;
        const pauseEnd = pause.pauseEnd ?? pause.endPause ?? pause.end ?? pause.resumeDate;
        if (!pauseStart || !pauseEnd) continue;
        const diff = new Date(pauseEnd).getTime() - new Date(pauseStart).getTime();
        if (Number.isFinite(diff) && diff > 0) pausedMs += diff;
      }
      const workedMs = Math.max(0, outMs - inMs - pausedMs);
      return Math.round((workedMs / 3_600_000) * 10_000) / 10_000;
    }
  }

  if (checkIn) {
    const decimal = Number(String(record.durationDecimal ?? record.DurationDecimal ?? "0").replace(",", "."));
    if (Number.isFinite(decimal) && decimal > 0) {
      return Math.round(decimal * 10_000) / 10_000;
    }
  }

  return 0;
}
