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
 * A OS só é descartada quando já está encerrada. A data da OS no GC é a data do
 * serviço (herdada do orçamento), NÃO a data de criação: usá-la como corte fazia
 * a previsão ficar eternamente "Aguardando geração da OS" mesmo com a OS pronta.
 * O corte por data continua existindo, porém apenas como desempate quando o mesmo
 * orçamento tem vários lotes de baixa parcial (ver selectOsForBudgetForecast).
 */
export function isOsEligibleForBudgetForecast(os: any, forecastCreatedAt: unknown): boolean {
  if (!os || !normalizeGcDocumentCode(os.gc_os_codigo)) return false;

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

/**
 * Escolhe as OS candidatas de um orçamento. Com mais de uma OS aberta (baixa
 * parcial) preferimos as criadas a partir da previsão; com uma única OS aberta
 * o vínculo é automático, independentemente da data do serviço.
 */
export function selectOsForBudgetForecast(osList: any[], forecastCreatedAt: unknown): any[] {
  const eligible = (osList || []).filter((os) => isOsEligibleForBudgetForecast(os, forecastCreatedAt));
  if (eligible.length <= 1) return eligible;

  const forecastDate = normalizeDateKey(forecastCreatedAt);
  if (!forecastDate) return eligible;
  const newer = eligible.filter((os) => {
    const osDate = normalizeDateKey(os.gc_os_data ?? os.data_entrada ?? os.data);
    return !osDate || osDate >= forecastDate;
  });
  return newer.length > 0 ? newer : eligible;
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
