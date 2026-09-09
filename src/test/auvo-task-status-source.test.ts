import { describe, expect, it } from "vitest";
import { auvoTaskStatus } from "../../supabase/functions/_shared/auvo-task-status";

describe("estado atual da tarefa no Auvo", () => {
  it("mantém pausada a tarefa 79424514 de Luiz, mesmo com check-in feito", () => {
    // Resposta real de GET /tasks/79424514, conferida em 09/09/2026.
    expect(auvoTaskStatus({ taskID: 79424514, taskStatus: 6, finished: false,
      checkIn: true, checkOut: false, timeControl: [], reasonForPause: "Fim de expediente" })).toBe("Pausada");
  });
  it.each([6, "6", { id: 6 }, { status: 6 }])("interpreta o status numérico %j", (taskStatus) => {
    expect(auvoTaskStatus({ taskStatus, checkIn: true })).toBe("Pausada");
  });
  it("não mantém a pausa antiga depois de o Auvo confirmar a retomada", () => {
    expect(auvoTaskStatus({ taskStatus: 3, checkIn: true, reasonForPause: "Fim de expediente" })).toBe("Em andamento");
  });
  it.each([[1, "Aberta"], [2, "Em deslocamento"], [3, "Em andamento"], [4, "Finalizada"], [5, "Finalizada"]])("interpreta %s como %s", (taskStatus, expected) => {
    expect(auvoTaskStatus({ taskStatus })).toBe(expected);
  });
  it("preserva descrição explícita e usa eventos apenas quando o status falta", () => {
    expect(auvoTaskStatus({ taskStatus: { description: "Pausada" }, checkIn: true })).toBe("Pausada");
    expect(auvoTaskStatus({ checkIn: true, timeControl: [{ pauseStart: "2026-09-08T17:00:00" }] })).toBe("Pausada");
    expect(auvoTaskStatus({ checkIn: true, timeControl: [{ pauseStart: "2026-09-08T17:00:00", pauseEnd: "2026-09-09T08:00:00" }] })).toBe("Em andamento");
    expect(auvoTaskStatus({ finished: true })).toBe("Finalizada");
  });
});
