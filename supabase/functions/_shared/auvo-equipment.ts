export type AuvoEquipmentInfo = {
  id: string;
  name: string;
  identifier: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function collectIds(value: unknown, ids: Set<string>) {
  if (value === null || value === undefined || value === "") return;

  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }

  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const nestedId = clean(
      item.equipmentId ??
        item.equipmentID ??
        item.auvoEquipmentId ??
        item.auvo_equipment_id ??
        item.id,
    );
    if (nestedId) ids.add(nestedId);
    return;
  }

  const scalar = clean(value);
  if (scalar) ids.add(scalar);
}

/**
 * Extrai exclusivamente os IDs de equipamentos vinculados à tarefa do Auvo.
 * A API v2 documenta `equipmentsId`, mas respostas antigas e alguns proxies do
 * projeto usam variações escalares ou objetos aninhados.
 */
export function extractAuvoEquipmentIds(entity: unknown): string[] {
  if (!entity || typeof entity !== "object") return [];
  const task = entity as Record<string, unknown>;
  const ids = new Set<string>();

  for (const source of [
    task.equipmentsId,
    task.equipmentsID,
    task.equipmentIds,
    task.equipmentId,
    task.equipmentID,
    task.auvoEquipmentId,
    task.auvo_equipment_id,
    task.equipments,
    task.equipment,
    task.associatedEquipments,
  ]) {
    collectIds(source, ids);
  }

  return [...ids];
}

function infoFromObject(value: unknown): AuvoEquipmentInfo | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const nested = item.equipment && typeof item.equipment === "object"
    ? item.equipment as Record<string, unknown>
    : {};
  const id = clean(
    item.equipmentId ??
      item.equipmentID ??
      item.auvoEquipmentId ??
      item.auvo_equipment_id ??
      item.id,
  );
  const name = clean(
    item.equipmentName ?? item.nome ?? item.name ?? item.model ?? nested.name ?? nested.nome ?? nested.model,
  );
  const identifier = clean(
    item.equipmentIdentifier ??
      item.equipmentSerial ??
      item.identificador ??
      item.identifier ??
      item.serial ??
      nested.identificador ??
      nested.identifier ??
      nested.serial,
  );

  if (!id && !name && !identifier) return null;
  return { id, name, identifier };
}

/** Retorna nome/série quando a própria resposta já embute os equipamentos. */
export function extractAuvoInlineEquipmentInfo(entity: unknown): AuvoEquipmentInfo[] {
  if (!entity || typeof entity !== "object") return [];
  const task = entity as Record<string, unknown>;
  const candidates: unknown[] = [task];

  if (Array.isArray(task.equipments)) candidates.push(...task.equipments);
  else if (task.equipments) candidates.push(task.equipments);
  if (task.equipment) candidates.push(task.equipment);
  if (Array.isArray(task.associatedEquipments)) candidates.push(...task.associatedEquipments);

  const byKey = new Map<string, AuvoEquipmentInfo>();
  for (const candidate of candidates) {
    const info = infoFromObject(candidate);
    if (!info || (!info.name && !info.identifier)) continue;
    const key = info.id || `${info.name}\u0000${info.identifier}`;
    const current = byKey.get(key);
    byKey.set(key, {
      id: info.id || current?.id || "",
      name: info.name || current?.name || "",
      identifier: info.identifier || current?.identifier || "",
    });
  }

  return [...byKey.values()];
}

export function joinAuvoEquipmentInfo(infos: AuvoEquipmentInfo[]): { name: string; identifier: string } {
  const names = [...new Set(infos.map((item) => clean(item.name)).filter(Boolean))];
  const identifiers = [...new Set(infos.map((item) => clean(item.identifier)).filter(Boolean))];
  return { name: names.join(" / "), identifier: identifiers.join(" / ") };
}
