import { auvoTaskTypeId } from "./auvo-task-type.ts";

export const BUDGET_EXECUTION_FORECAST = "ORCAMENTO_EXECUCAO";

export function normalizeGcDocumentCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function normalizeDateKey(value: unknown): string | null {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Uma previsão nasce no orçamento e só pode ser convertida pela nova OS criada
 * depois dela. Isso é especialmente importante em baixa parcial: as OS dos
 * lotes anteriores continuam apontando para o mesmo NÚMERO ORÇAMENTO no GC.
 */
export function isOsEligibleForBudgetForecast(os: any, forecastCreatedAt: unknown): boolean {
  if (!os || !normalizeGcDocumentCode(os.gc_os_codigo)) return false;

  const forecastDate = normalizeDateKey(forecastCreatedAt);
  const osDate = normalizeDateKey(os.gc_os_data ?? os.data_entrada ?? os.data);
  if (forecastDate && osDate && osDate < forecastDate) return false;

  const status = normalizeText(os.gc_os_situacao ?? os.nome_situacao);
  const terminalStatus = [
    "EXECUTAD",
    "FINALIZ",
    "ENCERRAD",
    "CANCELAD",
    "EXCLUID",
    "NOTA EMITIDA",
  ].some((part) => status.includes(part));
  if (terminalStatus) return false;

  return true;
}

export function normalizeClock(value: unknown): string | null {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function forecastDurationMinutes(start: unknown, end: unknown): number {
  const normalizedStart = normalizeClock(start);
  const normalizedEnd = normalizeClock(end);
  if (!normalizedStart || !normalizedEnd) return 0;
  const [startHour, startMinute] = normalizedStart.split(":").map(Number);
  const [endHour, endMinute] = normalizedEnd.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const duration = endTotal >= startTotal
    ? endTotal - startTotal
    : (24 * 60 - startTotal) + endTotal;
  return duration > 0 ? duration : 0;
}

function normalizedStatus(task: any): string {
  return String(
    task?.taskStatus?.description
      ?? task?.status?.description
      ?? task?.status
      ?? "",
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function auvoTaskHasStarted(task: any): boolean {
  if (!task) return false;
  if (task.finished === true || task.checkIn === true || task.checkOut === true) return true;
  if (task.checkInDate || task.checkOutDate || task.checkinDate || task.checkoutDate) return true;
  const status = normalizedStatus(task);
  return ["finaliz", "andamento", "paus", "execucao", "executando"].some((part) => status.includes(part));
}

export function taskStartMinuteKey(task: any): string {
  return String(task?.taskDate ?? task?.task_date ?? task?.date ?? "").slice(0, 16);
}

export function taskAssignedUserId(task: any): number | null {
  const value = Number(task?.idUserTo ?? task?.id_user_to ?? task?.userTo?.id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function taskTypeId(task: any): number | null {
  const value = Number(auvoTaskTypeId(task));
  return Number.isFinite(value) && value > 0 ? value : null;
}
