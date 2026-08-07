type AuvoTaskLike = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export type AuvoTaskAssignee = {
  id: string;
  nome: string;
};

/**
 * Resolve exclusivamente o responsável real da tarefa no Auvo.
 * Dados comerciais do GestãoClick, como vendedor, nunca participam deste vínculo.
 */
export function resolveAuvoTaskAssignee(task: AuvoTaskLike): AuvoTaskAssignee | null {
  const nestedUser = asRecord(task.userTo) || asRecord(task.collaborator);
  const id = String(
    task.idUserTo
      ?? task.userToId
      ?? task.collaboratorId
      ?? nestedUser?.userID
      ?? nestedUser?.id
      ?? "",
  ).trim();
  const nome = String(
    task.userToName
      ?? task.collaboratorName
      ?? nestedUser?.name
      ?? nestedUser?.login
      ?? "",
  ).trim();

  if (!id || !nome) return null;
  return { id, nome };
}
