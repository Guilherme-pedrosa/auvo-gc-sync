export const PREVENTIVA_TASK_TYPE_IDS = ["180175", "180176"] as const;

export const PREVENTIVA_TASK_TYPE_ID_SET = new Set<string>(PREVENTIVA_TASK_TYPE_IDS);

export function isPreventivaTaskType(id: string | null | undefined): id is string {
  return !!id && PREVENTIVA_TASK_TYPE_ID_SET.has(String(id));
}

function isoDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "";
}

export function shouldUsePlannedLastExecution(
  plannedDate: string | null | undefined,
  nativeDate: string | null | undefined,
  plannedTaskTypeId: string | null | undefined,
): boolean {
  const plan = isoDate(plannedDate);
  const native = isoDate(nativeDate);

  return isPreventivaTaskType(plannedTaskTypeId) && !!plan && (!native || plan > native);
}

export function isPlannedNextDateOutdated(
  plannedNextDate: string | null | undefined,
  lastExecutionDate: string | null | undefined,
): boolean {
  const next = isoDate(plannedNextDate);
  const last = isoDate(lastExecutionDate);

  return !!next && !!last && next <= last;
}
