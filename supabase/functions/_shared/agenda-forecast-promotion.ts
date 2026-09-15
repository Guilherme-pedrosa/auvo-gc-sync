import { auvoTaskTypeDescription, auvoTaskTypeId } from "./auvo-task-type.ts";
import { auvoTaskStatus } from "./auvo-task-status.ts";
import { auvoCheckInDate, auvoCheckOutDate, computeAuvoWorkedHours } from "./auvo-worked-time.ts";
import { resolveAuvoPlannedDuration } from "./auvo-duration.ts";

export const BUDGET_EXECUTION_FORECAST = "ORCAMENTO_EXECUCAO";

export function isPartialWriteoffBudget(budget: any): boolean {
  return String(budget?.situacao_id ?? "") === "9348312"
    || normalizeText(budget?.nome_situacao).includes("BAIXA PARCIAL");
}

export function normalizeGcDocumentCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

/** Only the explicit execution attribute is evidence of an execution task. */
export function explicitExecutionTaskIds(value: unknown): string[] {
  return [...new Set(String(value ?? "").split(/\D+/).filter((id) =>
    id.length >= 4 && Number.isSafeInteger(Number(id)) && Number(id) > 0
  ))];
}

export type BudgetExecutionTaskLink = {
  budgetCode: unknown;
  osCode: unknown;
  taskId: unknown;
};

export function mapGcOsBudgetExecutionLink(raw: any) {
  const attributes = Array.isArray(raw?.atributos) ? raw.atributos : [];
  const attribute = (id: string) => attributes
    .map((item: any) => item?.atributo || item)
    .filter((item: any) => String(item?.atributo_id ?? item?.id ?? "") === id)
    .map((item: any) => String(item?.conteudo ?? item?.valor ?? ""))
    .join("/");
  return {
    gc_os_id: String(raw?.id ?? ""),
    gc_os_codigo: normalizeGcDocumentCode(raw?.codigo),
    gc_orcamento_codigo: normalizeGcDocumentCode(attribute("81831")),
    gc_os_tarefa_exec: attribute("73344"),
    gc_os_tarefa_os: attribute("73343"),
    gc_os_data: raw?.data_entrada ?? raw?.data ?? null,
    gc_os_situacao: String(raw?.nome_situacao ?? ""),
    gc_os_cliente: String(raw?.nome_cliente ?? ""),
    gc_os_valor_total: Number(String(raw?.valor_total ?? "0").replace(",", ".")) || 0,
    ...(raw?.hash ? { gc_os_link: `https://gestaoclick.com/cobranca/${raw.hash}` } : {}),
  };
}

/** Same ID in TAREFA OS and EXEC is allowed; diagnostic-only IDs never are. */
export function validateBudgetExecutionTaskLink(rows: any[], expected: BudgetExecutionTaskLink) {
  const budgetCode = normalizeGcDocumentCode(expected.budgetCode);
  const osCode = normalizeGcDocumentCode(expected.osCode);
  const taskId = normalizeGcDocumentCode(expected.taskId);
  if (!budgetCode || !osCode || !taskId) return { valid: false, reason: "invalid_link" } as const;
  const orders = rows.filter((row) => normalizeGcDocumentCode(row?.gc_os_codigo) === osCode);
  if (!orders.length) return { valid: false, reason: "os_not_found" } as const;
  if (orders.some((row) => normalizeGcDocumentCode(row?.gc_orcamento_codigo ?? row?.gc_os_orcamento_codigo) !== budgetCode)) {
    return { valid: false, reason: "budget_mismatch" } as const;
  }
  const taskIds = [...new Set(orders.flatMap((row) => explicitExecutionTaskIds(row?.gc_os_tarefa_exec)))];
  if (!taskIds.length) return { valid: false, reason: "execution_not_linked" } as const;
  if (taskIds.length > 1) return { valid: false, reason: "ambiguous_execution" } as const;
  if (taskIds[0] !== taskId) return { valid: false, reason: "execution_mismatch" } as const;
  return { valid: true, reason: "confirmed", os: orders[0] } as const;
}

/** Re-read the provider before any task change; a stale/failed read is not proof. */
export async function readBudgetExecutionTaskLink(
  invoke: (name: string, options: any) => Promise<{ data: any; error: any }>,
  expected: BudgetExecutionTaskLink,
) {
  const osCode = normalizeGcDocumentCode(expected.osCode);
  const budgetCode = normalizeGcDocumentCode(expected.budgetCode);
  const readList = async (endpoint: string): Promise<any[]> => {
    const { data, error } = await invoke("gc-proxy", {
      body: { endpoint, method: "GET", source: "budget-forecast", force_refresh: true },
    });
    const responseStatus = Number(data?.status);
    if (error || !data || data.stale === true || !Number.isFinite(responseStatus) || responseStatus < 200 || responseStatus >= 300 || !Array.isArray(data.data?.data)) {
      throw new Error(`GC não confirmou o vínculo atual da OS ${osCode}${error?.message ? `: ${error.message}` : ""}`);
    }
    if (Number(data.data?.meta?.total_paginas ?? 1) > 1) {
      throw new Error(`GC devolveu uma consulta incompleta da OS ${osCode}; vínculo preservado`);
    }
    return data.data.data;
  };
  const budgets = (await readList(`/api/orcamentos?codigo=${encodeURIComponent(budgetCode)}&limite=5`))
    .filter((row) => normalizeGcDocumentCode(row?.codigo) === budgetCode);
  if (budgets.length !== 1) throw new Error(`GC não confirmou o orçamento ${budgetCode}; vínculo preservado`);
  if (isPartialWriteoffBudget(budgets[0])) return { valid: false, reason: "partial_balance" } as const;
  const orders = await readList(`/api/ordens_servicos?codigo=${encodeURIComponent(osCode)}&limite=5`);
  return validateBudgetExecutionTaskLink(orders.map(mapGcOsBudgetExecutionLink), expected);
}

/** A provider lookup must not overwrite a reservation changed while awaiting it. */
export function isUnchangedBudgetExecutionForecast(initial: any, current: any): boolean {
  if (!current || current.previsao_tipo !== BUDGET_EXECUTION_FORECAST
    || current.previsao_continuidade !== true || current.auvo_task_id) return false;
  return ["id", "data", "colaborador_id", "gc_orcamento_codigo"].every((key) => String(initial?.[key] ?? "") === String(current[key] ?? ""))
    && normalizeClock(initial.hora_inicio) === normalizeClock(current.hora_inicio)
    && normalizeClock(initial.hora_fim) === normalizeClock(current.hora_fim);
}

/** Provider facts only: reserved hours must never become worked contract hours. */
export function promotedExecutionMirrorRow(
  task: any,
  os: ReturnType<typeof mapGcOsBudgetExecutionLink>,
  technicianName: string,
  verifiedTaskTypeDescription = "",
) {
  const taskId = normalizeGcDocumentCode(task?.taskID ?? task?.taskId ?? task?.id);
  const taskDate = String(task?.taskDate ?? task?.task_date ?? task?.date ?? "");
  const endDate = String(task?.taskEndDate ?? task?.endDate ?? "");
  const checkIn = auvoCheckInDate(task);
  const checkOut = auvoCheckOutDate(task);
  const time = (value: string | null) => value && !value.startsWith("0001-01-01") && value.length >= 16 ? value.slice(11, 16) : null;
  const customer = String(task?.customerDescription ?? task?.customerName ?? task?.customer?.tradeName ?? "").trim();
  const orientation = String(task?.orientation ?? task?.description ?? "").trim();
  const report = String(task?.report ?? "").trim();
  return {
    ...os,
    auvo_task_id: taskId,
    mirror_key: `${taskId}::os:${os.gc_os_id}::orc:`,
    ...(customer ? { cliente: customer } : {}),
    tecnico_id: String(taskAssignedUserId(task) ?? ""),
    tecnico: String(task?.userToName ?? task?.userTo?.name ?? "").trim() || technicianName,
    data_tarefa: taskDate.slice(0, 10),
    hora_inicio: time(checkIn) || time(taskDate),
    hora_fim: time(checkOut) || time(endDate),
    status_auvo: auvoTaskStatus(task),
    task_type_id: taskTypeId(task),
    descricao: auvoTaskTypeDescription(task) || verifiedTaskTypeDescription,
    duracao_decimal: computeAuvoWorkedHours(task),
    check_in: task?.checkIn === true || !!checkIn,
    check_out: task?.checkOut === true || !!checkOut,
    check_in_iso: checkIn,
    check_out_iso: checkOut,
    auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
    ...(orientation ? { orientacao: orientation } : {}),
    ...(report ? { relato_usuario: report } : {}),
  };
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
  return auvoTaskStatus(task)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function auvoTaskHasStarted(task: any): boolean {
  if (!task) return false;
  if (task.finished === true || task.checkIn === true || task.checkOut === true) return true;
  if (auvoCheckInDate(task) || auvoCheckOutDate(task)) return true;
  const status = normalizedStatus(task);
  return ["finaliz", "desloc", "andamento", "paus", "execucao", "executando"].some((part) => status.includes(part));
}

export function taskStartMinuteKey(task: any): string {
  return String(task?.taskDate ?? task?.task_date ?? task?.date ?? "").slice(0, 16);
}

export function taskAssignedUserId(task: any): number | null {
  const value = Number(task?.idUserTo ?? task?.id_user_to ?? task?.userTo?.id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Read the execution's actual plan after an edit; never reapply its old reservation. */
export function preservedExecutionSchedule(
  task: any,
  expectedTaskId: string,
  expected: { taskDate?: string; idUserTo?: number; durationMinutes?: number } = {},
  duration: ReturnType<typeof resolveAuvoPlannedDuration> = resolveAuvoPlannedDuration(task),
) {
  const actualTaskId = normalizeGcDocumentCode(task?.taskID ?? task?.taskId ?? task?.id);
  if (actualTaskId !== expectedTaskId) throw new Error("Auvo não confirmou a tarefa de execução solicitada");
  const taskDate = taskStartMinuteKey(task);
  const startTime = normalizeClock(taskDate.slice(11));
  const date = taskDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(taskDate) || Number(date.slice(0, 4)) < 2000
    || !startTime || !Number.isFinite(Date.parse(`${taskDate}:00`))) {
    throw new Error("Auvo não confirmou a data atual da tarefa de execução");
  }
  const auvoUserId = taskAssignedUserId(task);
  if (!auvoUserId) throw new Error("Auvo não confirmou o responsável atual da tarefa de execução");
  if (duration.source === "unconfirmed" || !Number.isFinite(duration.minutes) || duration.minutes <= 0) {
    throw new Error("Auvo não confirmou a duração atual da tarefa de execução");
  }
  const durationMinutes = duration.minutes;
  if ((expected.taskDate !== undefined && String(expected.taskDate).slice(0, 16) !== taskDate)
    || (expected.idUserTo !== undefined && expected.idUserTo !== auvoUserId)
    || (expected.durationMinutes !== undefined && expected.durationMinutes !== durationMinutes)) {
    throw new Error("O planejamento da tarefa mudou no Auvo após a edição; atualize os dados antes de converter a previsão");
  }
  const [hours, minutes] = startTime.split(":").map(Number);
  const endMinutes = (hours * 60 + minutes + durationMinutes) % (24 * 60);
  return {
    auvoUserId,
    durationMinutes,
    data: date,
    hora_inicio: startTime,
    hora_fim: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
  };
}

export function taskTypeId(task: any): number | null {
  const value = Number(auvoTaskTypeId(task));
  return Number.isFinite(value) && value > 0 ? value : null;
}
