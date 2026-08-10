export type CachedEquipmentTaskRelation = {
  id: string;
  auvo_equipment_id: string;
  auvo_task_id: string;
};

export function equipmentTaskRelationKey(
  equipmentId: string | number,
  taskId: string | number,
): string {
  return `${String(equipmentId)}::${String(taskId)}`;
}

export function findStaleEquipmentTaskRelationIds(
  cachedRelations: CachedEquipmentTaskRelation[],
  observedRelationKeys: ReadonlySet<string>,
): string[] {
  return cachedRelations
    .filter((relation) => !observedRelationKeys.has(
      equipmentTaskRelationKey(relation.auvo_equipment_id, relation.auvo_task_id),
    ))
    .map((relation) => relation.id);
}
