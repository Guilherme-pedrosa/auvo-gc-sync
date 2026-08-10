import { describe, expect, it } from "vitest";
import {
  isManagedTaskType,
  managedBaseTaskTypeId,
  managedTaskTypeDescription,
  minutesToAuvoTimeSpan,
  normalizeRequestedDurationMinutes,
  parseAuvoDurationMinutes,
} from "../../supabase/functions/_shared/auvo-duration";

describe("duração de tarefas Auvo", () => {
  it("interpreta TimeSpan devolvido pelo Auvo", () => {
    expect(parseAuvoDurationMinutes("02:30:00")).toBe(150);
    expect(parseAuvoDurationMinutes("1.01:15:00")).toBe(1515);
    expect(parseAuvoDurationMinutes("00:00:00")).toBe(0);
  });

  it("serializa minutos no campo oficial tasktypes.standartTime", () => {
    expect(minutesToAuvoTimeSpan(150)).toBe("02:30:00");
    expect(minutesToAuvoTimeSpan(1500)).toBe("1.01:00:00");
    expect(normalizeRequestedDurationMinutes(5)).toBe(15);
  });

  it("gera uma variante determinística e recupera o tipo base", () => {
    const description = managedTaskTypeDescription(180176, 120, "Visita Preventiva Contrato");

    expect(description).toBe("[WEDO:180176:120] Visita Preventiva Contrato · 2h");
    expect(isManagedTaskType(description)).toBe(true);
    expect(managedBaseTaskTypeId(description)).toBe(180176);
  });

  it("não empilha prefixos ao reutilizar uma variante", () => {
    const description = managedTaskTypeDescription(
      180176,
      180,
      "[WEDO:180176:120] Visita Preventiva Contrato · 2h",
    );

    expect(description).toBe("[WEDO:180176:180] Visita Preventiva Contrato · 3h");
  });
});
