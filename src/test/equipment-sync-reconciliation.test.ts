import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  equipmentTaskRelationKey,
  findStaleEquipmentTaskRelationIds,
} from "../../supabase/functions/equipment-sync/reconciliation";

const root = resolve(__dirname, "../..");
const equipmentSync = readFileSync(
  resolve(root, "supabase/functions/equipment-sync/index.ts"),
  "utf8",
);

describe("reconciliação dos vínculos equipamento/tarefa do Auvo", () => {
  it("remove do cache uma tarefa excluída no Auvo", () => {
    const observed = new Set<string>();
    const stale = findStaleEquipmentTaskRelationIds([
      {
        id: "cache-77297506",
        auvo_equipment_id: "4103384",
        auvo_task_id: "77297506",
      },
    ], observed);

    expect(stale).toEqual(["cache-77297506"]);
  });

  it("remove o vínculo antigo quando a tarefa muda de equipamento", () => {
    const observed = new Set([
      equipmentTaskRelationKey("equipamento-novo", "77297506"),
    ]);
    const stale = findStaleEquipmentTaskRelationIds([
      {
        id: "vinculo-antigo",
        auvo_equipment_id: "4103384",
        auvo_task_id: "77297506",
      },
      {
        id: "vinculo-atual",
        auvo_equipment_id: "equipamento-novo",
        auvo_task_id: "77297506",
      },
    ], observed);

    expect(stale).toEqual(["vinculo-antigo"]);
  });

  it("só reconcilia após leitura completa e gravação sem erro", () => {
    expect(equipmentSync).toContain("windowFetchComplete && windowUpsertSucceeded");
    expect(equipmentSync).toContain("relationship_rows_deleted");
    expect(equipmentSync).toContain('status: 4');
    expect(equipmentSync).toContain('.eq("source", "native_equipment_relation")');
  });
});
