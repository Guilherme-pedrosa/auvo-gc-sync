const MANAGED_TASK_TYPE_PATTERN = /^\[WEDO:(\d+):(\d+)\]\s*/i;

export function parseAuvoDurationMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  // .NET TimeSpan can be returned as HH:mm:ss or d.HH:mm:ss.
  const match = raw.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return 0;

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return 0;

  const total = days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 ? total : 0;
}

export function normalizeRequestedDurationMinutes(value: unknown, fallback = 60): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  // Auvo's agenda works in minute precision. Keep a practical upper bound of 7 days.
  return Math.min(7 * 24 * 60, Math.max(15, Math.round(parsed)));
}

export function minutesToAuvoTimeSpan(value: unknown): string {
  const totalMinutes = normalizeRequestedDurationMinutes(value);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainder = totalMinutes % (24 * 60);
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;
  const hhmmss = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  return days > 0 ? `${days}.${hhmmss}` : hhmmss;
}

export function managedTaskTypeDescription(baseTypeId: number, durationMinutes: number, baseDescription: string): string {
  const minutes = normalizeRequestedDurationMinutes(durationMinutes);
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  const label = minutesPart > 0 ? `${hoursPart}h${String(minutesPart).padStart(2, "0")}` : `${hoursPart}h`;
  const cleanBase = String(baseDescription || `Tipo ${baseTypeId}`)
    .replace(MANAGED_TASK_TYPE_PATTERN, "")
    .replace(/\s+·\s+\d+h(?:\d{2})?$/i, "")
    .trim();
  return `[WEDO:${baseTypeId}:${minutes}] ${cleanBase} · ${label}`.substring(0, 5000);
}

export function managedBaseTaskTypeId(description: unknown): number | null {
  const match = String(description ?? "").trim().match(MANAGED_TASK_TYPE_PATTERN);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function isManagedTaskType(description: unknown): boolean {
  return managedBaseTaskTypeId(description) !== null;
}
