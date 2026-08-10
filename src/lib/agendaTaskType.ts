const PREVENTIVE_TASK_TYPE_IDS = new Set(["180175", "180176"]);

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toUpperCase();

const splitTaskIds = (value: unknown) => String(value ?? "")
  .split(/\D+/)
  .map((id) => id.trim())
  .filter(Boolean);

export function cleanAuvoTaskTypeDescription(value: unknown): string {
  return String(value ?? "")
    .replace(/^\[WEDO:\d+:\d+\]\s*/i, "")
    .replace(/\s*[·-]\s*\d+h(?:\d+)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type AgendaTaskTypeInput = {
  taskId?: string | null;
  taskTypeId?: string | null;
  taskTypeDescription?: string | null;
  gcOsTaskIds?: string | null;
  gcExecutionTaskIds?: string | null;
};

/**
 * O tipo vem do cadastro da tarefa no Auvo. Os atributos 73343/73344 do GC
 * entram somente como fallback para identificar o papel da tarefa na OS.
 */
export function resolveAgendaTaskType(input: AgendaTaskTypeInput): string {
  const taskId = String(input.taskId || "").trim();
  const taskTypeId = String(input.taskTypeId || "").trim();
  const description = cleanAuvoTaskTypeDescription(input.taskTypeDescription);
  const normalizedDescription = normalize(description);

  if (PREVENTIVE_TASK_TYPE_IDS.has(taskTypeId) || normalizedDescription.includes("PREVENTIV")) {
    return "PREVENTIVA";
  }
  if (normalizedDescription.includes("EXECUCAO") || normalizedDescription.includes("EXECUTAR")) {
    return "EXECUÇÃO";
  }
  if (
    normalizedDescription === "OS"
    || normalizedDescription.includes("ORDEM DE SERVICO")
    || normalizedDescription.includes("TAREFA OS")
    || normalizedDescription.includes("VISITA OS")
  ) {
    return "OS";
  }

  if (taskId && splitTaskIds(input.gcExecutionTaskIds).includes(taskId)) return "EXECUÇÃO";
  if (taskId && splitTaskIds(input.gcOsTaskIds).includes(taskId)) return "OS";

  // Para tipos personalizados, exibe o nome real cadastrado no Auvo em vez de
  // inventar "SEM OS". O vínculo com a OS é uma informação separada.
  if (description && !/^Tipo\s+\d+$/i.test(description)) return description.toUpperCase();
  return "TIPO NÃO INFORMADO";
}

export function taskTypeRequiresGcOs(
  taskTypeDescription: unknown,
  resolvedType: string,
  taskTypeId?: string | null,
): boolean {
  const description = normalize(cleanAuvoTaskTypeDescription(taskTypeDescription));
  // A preventiva contratual é a única tarefa operacional conhecida que pode
  // existir sem uma OS do GestãoClick.
  return !(
    resolvedType === "PREVENTIVA"
    && (String(taskTypeId || "") === "180176" || description.includes("CONTRATO"))
  );
}
