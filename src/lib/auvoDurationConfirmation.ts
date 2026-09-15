import { minutesToClock } from "./auvoDuration";

/** A successful request alone does not prove the task kept its planned duration. */
export function isAuvoDurationConfirmed(result: any, requestedMinutes: number): boolean {
  return Number.isInteger(requestedMinutes) && requestedMinutes > 0
    && result?.success === true && !(Number(result?.status) >= 400)
    && result?.duration?.verified === true
    && Number(result.duration.requestedMinutes) === requestedMinutes
    && Number(result.duration.actualMinutes) === requestedMinutes;
}

export function requireAuvoDurationConfirmation(result: any, requestedMinutes: number): void {
  if (!isAuvoDurationConfirmed(result, requestedMinutes)) {
    throw new Error(result?.error || `O Auvo não confirmou a duração planejada de ${minutesToClock(requestedMinutes)}. O valor local não foi atualizado.`);
  }
}
