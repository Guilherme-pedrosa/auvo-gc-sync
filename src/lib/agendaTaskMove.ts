type Invoke = (name: string, options: { body: Record<string, unknown> }) => PromiseLike<{ data: any; error: any }>;

/** Serialize API snapshots and edits so an older snapshot cannot undo a drag. */
export function createAgendaWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** Confirm the dragged task in Auvo before moving its local agenda card. */
export async function confirmAgendaTaskMove(
  invoke: Invoke,
  input: { taskId: unknown; auvoUserId: unknown; date: string; startTime: string },
): Promise<void> {
  const taskId = Number(input.taskId);
  const userId = Number(input.auvoUserId);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new Error("A tarefa arrastada não possui um ID Auvo válido.");
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("O técnico de destino não possui vínculo válido com o Auvo. Vincule o usuário no cadastro do colaborador antes de mover a tarefa.");
  }
  const time = String(input.startTime || "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("A tarefa não possui data ou horário válido para reagendamento.");
  }
  const taskDate = `${input.date}T${time}:00`;
  const { data: edited, error: editError } = await invoke("auvo-task-update", {
    body: { action: "edit-schedule", taskId, taskDate, idUserTo: userId },
  });
  if (editError || edited?.success !== true || Number(edited?.status) >= 400) {
    throw new Error(edited?.error || edited?.data?.message || editError?.message || "O Auvo não confirmou a alteração do agendamento.");
  }
  const { data: response, error: readError } = await invoke("auvo-task-update", {
    body: { action: "get", taskId },
  });
  const task = response?.data?.result ?? response?.data;
  const status = Number(response?.status);
  if (readError || response?.success === false || !(status >= 200 && status < 300)
    || Number(task?.taskID ?? task?.taskId ?? task?.id) !== taskId) {
    throw new Error("O Auvo pode ter atualizado a tarefa, mas não foi possível confirmar o reagendamento. Atualize a escala antes de tentar novamente.");
  }
  const actualUser = Number(task.idUserTo ?? task.id_user_to ?? task.userTo?.userID ?? task.userTo?.id);
  const actualDate = String(task.taskDate ?? task.task_date ?? "").slice(0, 16);
  if (actualUser !== userId || actualDate !== taskDate.slice(0, 16)) {
    throw new Error("O Auvo não confirmou o técnico e a data de destino. O cartão não foi movido localmente; atualize a escala para conferir a tarefa.");
  }
}

/** Refresh every mirror for this exact task after its agenda row is saved. */
export async function refreshMovedAgendaTask(invoke: Invoke, taskId: string): Promise<void> {
  const { data, error } = await invoke("central-sync", {
    body: { report_step: "os_tasks", task_ids: [taskId], wait: true },
  });
  if (error || data?.success !== true || data?.report_step !== "os_tasks" || data?.incomplete
    || data?.warnings?.length || Number(data?.auvo_tarefas) !== 1 || !(Number(data?.upserted) > 0)) {
    throw new Error("A atualização dos relatórios da tarefa não foi confirmada.");
  }
}
