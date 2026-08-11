export type AuvoReconciliationWindow = {
  startDate: string;
  endDate: string;
  complete: boolean;
};

export type LocalAuvoTaskCandidate = {
  auvo_task_id: string;
  task_date: string;
};

const validTaskId = (value: unknown) => /^[1-9][0-9]*$/.test(String(value ?? "").trim());

export function findMissingAuvoTaskIds(
  rows: LocalAuvoTaskCandidate[],
  observedTaskIds: Iterable<string>,
  windows: AuvoReconciliationWindow[],
): string[] {
  const observed = new Set([...observedTaskIds].map((value) => String(value).trim()).filter(validTaskId));
  const completeWindows = windows.filter((window) => window.complete);
  const missing = new Set<string>();

  for (const row of rows) {
    const taskId = String(row.auvo_task_id || "").trim();
    const date = String(row.task_date || "").substring(0, 10);
    if (!validTaskId(taskId) || !date || observed.has(taskId)) continue;
    const covered = completeWindows.some((window) => date >= window.startDate && date <= window.endDate);
    if (covered) missing.add(taskId);
  }

  return [...missing];
}

export function isConfirmedDeletedAuvoStatus(firstStatus: number | null, secondStatus: number | null): boolean {
  const deletedStatuses = new Set([404, 410]);
  return firstStatus !== null
    && secondStatus !== null
    && deletedStatuses.has(firstStatus)
    && deletedStatuses.has(secondStatus);
}
