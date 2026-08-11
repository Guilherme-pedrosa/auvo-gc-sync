import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractAuvoEquipmentIds,
  extractAuvoInlineEquipmentInfo,
  joinAuvoEquipmentInfo,
} from "../../supabase/functions/_shared/auvo-equipment";

describe("Auvo task equipment normalization", () => {
  it("reads the official equipmentsId field without confusing the task id", () => {
    expect(extractAuvoEquipmentIds({
      taskID: 77898022,
      equipmentsId: [109638, 109753],
    })).toEqual(["109638", "109753"]);
  });

  it("accepts legacy scalar and nested equipment variants", () => {
    expect(extractAuvoEquipmentIds({
      equipmentId: "200",
      equipments: [{ equipmentId: 201 }, { id: "202" }],
      associatedEquipments: [{ auvo_equipment_id: "203" }],
    })).toEqual(["200", "201", "202", "203"]);
  });

  it("keeps every attached equipment name and serial", () => {
    const info = extractAuvoInlineEquipmentInfo({
      equipments: [
        { id: 10, name: "FORNO COMBINADO", identifier: "SERIE-10" },
        { equipmentId: 11, model: "MÁQUINA DE GELO", serial: "SERIE-11" },
      ],
    });

    expect(joinAuvoEquipmentInfo(info)).toEqual({
      name: "FORNO COMBINADO / MÁQUINA DE GELO",
      identifier: "SERIE-10 / SERIE-11",
    });
  });

  it("repairs both the central mirror and the worked-hours report", () => {
    const central = readFileSync("supabase/functions/central-sync/index.ts", "utf8");
    const report = readFileSync("supabase/functions/horas-trabalhadas-fetch/index.ts", "utf8");

    expect(central).toContain("taskEquipmentIdsById");
    expect(central).toContain("reportTaskEquipmentIds");
    expect(central).toContain("Reports-only equipment links");
    expect(central).toContain('from("equipamentos_auvo")');
    expect(central).toContain("resolvedEquipment.name");
    expect(report).toContain("repairMissingTaskEquipment");
    expect(report).toContain('fetchAuvoTaskDetail(bearerToken!');
    expect(report).toContain('from("equipamento_tarefas_auvo")');
  });
});
