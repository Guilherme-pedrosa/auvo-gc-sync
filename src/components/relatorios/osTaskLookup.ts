export const parseGcAuvoTaskIds = (value: unknown): string[] => [...new Set(
  String(value ?? "").split(/[\/,;\s]+/).map(id => id.trim())
    .filter(id => /^\d+$/.test(id) && !/^0+$/.test(id)),
)];

const isHydrated = (task: any): boolean => {
  const status = String(task?.status_auvo || "").trim();
  if (["Pendente vínculo Auvo", "Sem tarefa Auvo"].includes(status)) return false;
  return !!(status || task?.tecnico || task?.check_in || task?.check_out || task?.check_in_iso || task?.check_out_iso);
};

/** One Auvo task can have several OS/budget mirrors; use its latest confirmed data. */
export function buildAuvoTaskLookup(tasks: any[]): Map<string, any> {
  const lookup = new Map<string, any>();
  for (const task of tasks) {
    const id = String(task?.auvo_task_id || "").trim();
    if (!/^\d+$/.test(id)) continue;
    const previous = lookup.get(id);
    if (!previous || (isHydrated(task) !== isHydrated(previous)
      ? isHydrated(task)
      : String(task.atualizado_em || "") > String(previous.atualizado_em || ""))) {
      lookup.set(id, task);
    }
  }
  return lookup;
}

/** Only 73344 can supply execution status, technician or schedule. */
export function buildOsExecutionLookup(
  orders: any[],
  tasks: any[],
  taskLookup = buildAuvoTaskLookup(tasks),
): Map<string, any[]> {
  const result = new Map<string, any[]>();
  for (const order of orders) {
    const osId = String(order?.gc_os_id || "");
    if (!osId) continue;
    // Keep complete task snapshots together: combining a technician from one
    // execution with another execution's date/status invents an assignment.
    const executions = parseGcAuvoTaskIds(order.gc_os_tarefa_exec)
      .map(id => taskLookup.get(id))
      .filter(task => task && isHydrated(task));
    result.set(osId, executions);
  }
  return result;
}

/** Resolve 73343 independently of the mirror's historic GC relationship. */
export function buildOsDiagnosticLookup(orders: any[], tasks: any[], taskLookup = buildAuvoTaskLookup(tasks)): Map<string, any> {
  const related = new Map<string, any[]>();
  for (const task of tasks) {
    const osId = String(task?.gc_os_id || "");
    if (osId) related.set(osId, [...(related.get(osId) || []), task]);
  }
  const result = new Map<string, any>();
  for (const order of orders) {
    const osId = String(order?.gc_os_id || "");
    if (!osId) continue;
    const explicit = parseGcAuvoTaskIds(order.gc_os_tarefa_os);
    if (explicit.length) {
      const task = explicit.map(id => taskLookup.get(id)).find(Boolean);
      if (task) result.set(osId, task);
      // An unresolved explicit ID must never fall back to an old diagnosis or an execution.
      continue;
    }
    // Null/empty is a confirmed removal in GC. Legacy inference is only for rows
    // that never carried the explicit field, not for links the user removed.
    if (order.gc_os_tarefa_os !== undefined) continue;
    const executions = new Set(parseGcAuvoTaskIds(order.gc_os_tarefa_exec));
    const candidate = [order, ...(related.get(osId) || [])].find(task => {
      const id = String(task?.auvo_task_id || "");
      return /^\d+$/.test(id) && !executions.has(id);
    });
    if (candidate) result.set(osId, taskLookup.get(String(candidate.auvo_task_id)) || candidate);
  }
  return result;
}

export const getAuvoStatusFromTask = (task: any) => {
  const ts = task?.taskStatus;
  const statusCode = typeof ts === "number"
    ? ts
    : typeof ts?.id === "number"
      ? ts.id
      : Number(ts?.id || ts?.status || 0);

  if (statusCode === 6) return "Pausada";
  if (statusCode === 4 || statusCode === 5) return "Finalizada";
  if (statusCode === 3) return "Em andamento";
  if (statusCode === 2) return "Em deslocamento";
  if (statusCode === 1) return "Aberta";

  if (task?.checkOut) return "Finalizada";
  const tcs = task?.timeControl || [];
  if (tcs.some((tc: any) => tc.pauseStart && !tc.pauseEnd) || task?.reasonForPause) return "Pausada";
  if (task?.checkIn) return "Em andamento";
  return "Agendada";
};


export type LiveAuvoResolution = { taskId: string; tecnico: string; tecnicoId: string; dataTarefa: string; status: string };
export type LiveExecutionResolution = { execTaskId: string; resolvedTaskId?: string; tecnico: string; dataTarefa: string; status: string };

/** A confirmed unassignment/date removal must not inherit an older mirror. */
export function extractLiveTaskResolution(taskData: any, taskId: string): LiveAuvoResolution | null {
  const task = taskData?.data?.result ?? taskData?.data ?? taskData?.result ?? taskData;
  if (!task || String(task.taskID ?? task.taskId ?? task.id ?? "") !== taskId) return null;
  const user = task.userTo ?? task.user_to ?? task.assignedUser ?? {};
  const own = (key: string) => Object.prototype.hasOwnProperty.call(task, key);
  const rawUser = own("idUserTo") ? task.idUserTo : own("id_user_to") ? task.id_user_to : user.userID ?? user.id;
  const unassigned = rawUser !== undefined && !(Number(rawUser) > 0);
  const tecnicoId = unassigned ? "" : String(rawUser ?? "").trim();
  const tecnico = unassigned ? "" : String(task.userToName ?? user.name ?? user.login ?? task.technician ?? "").trim();
  const rawDate = own("taskDate") ? task.taskDate : own("task_date") ? task.task_date : task.date;
  const date = String(rawDate ?? "").slice(0, 10);
  const dataTarefa = /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith("0001-") ? date : "";
  return { taskId, tecnico, tecnicoId, dataTarefa, status: getAuvoStatusFromTask(task) };
}

/** Choose one task snapshot, never merge assignment/status across executions. */
export function resolveOsExecution(order: any, executions: any[], live?: LiveExecutionResolution): any | null {
  const explicit = parseGcAuvoTaskIds(order?.gc_os_tarefa_exec);
  const allowed = explicit.length ? explicit : parseGcAuvoTaskIds(live?.execTaskId);
  if (live?.resolvedTaskId && allowed.includes(live.resolvedTaskId)) {
    return { auvo_task_id: live.resolvedTaskId, tecnico: live.tecnico, data_tarefa: live.dataTarefa || null, status_auvo: live.status };
  }
  return executions.find(task => explicit.includes(String(task.auvo_task_id))) ?? null;
}
