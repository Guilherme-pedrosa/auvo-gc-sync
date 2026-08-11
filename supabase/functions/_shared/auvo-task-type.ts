type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value != null && typeof value === "object" ? value as UnknownRecord : {};
}

function firstText(values: unknown[]): string {
  for (const candidate of values) {
    const value = String(candidate ?? "").trim();
    if (value && value !== "null" && value !== "undefined" && value !== "[object Object]") {
      return value;
    }
  }
  return "";
}

/** Lê o ID nas diferentes formas retornadas pela listagem e pelo detalhe Auvo. */
export function auvoTaskTypeId(task: unknown): string {
  const record = asRecord(task);
  const nested = asRecord(record.taskType ?? record.TaskType);
  const primitiveTaskType = typeof record.taskType !== "object" ? record.taskType : null;
  const primitiveLegacyTaskType = typeof record.TaskType !== "object" ? record.TaskType : null;

  return firstText([
    nested.id,
    nested.ID,
    nested.taskTypeId,
    nested.taskTypeID,
    nested.TaskTypeId,
    nested.TaskTypeID,
    record.taskTypeId,
    record.taskTypeID,
    record.TaskTypeId,
    record.TaskTypeID,
    primitiveTaskType,
    primitiveLegacyTaskType,
  ]);
}

/** Lê o nome real do tipo sem recorrer a vínculo ou situação do GestãoClick. */
export function auvoTaskTypeDescription(task: unknown): string {
  const record = asRecord(task);
  const nested = asRecord(record.taskType ?? record.TaskType);

  return firstText([
    record.taskTypeDescription,
    record.TaskTypeDescription,
    nested.description,
    nested.name,
    nested.taskTypeDescription,
    nested.TaskTypeDescription,
    record.typeDescription,
    record.serviceTypeDescription,
  ]).substring(0, 500);
}

export function isConcreteAuvoTaskTypeDescription(value: unknown): boolean {
  const description = String(value ?? "").trim();
  if (!description) return false;
  const normalized = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return !/^TIPO\s+\d+$/.test(normalized)
    && !normalized.includes("TIPO NAO INFORMADO")
    && description !== "[object Object]";
}
