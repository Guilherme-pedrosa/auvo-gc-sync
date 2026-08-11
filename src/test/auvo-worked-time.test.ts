import { describe, expect, it } from "vitest";
import { computeAuvoWorkedHours } from "../../supabase/functions/_shared/auvo-worked-time";

describe("espelho de horas trabalhadas do Auvo", () => {
  it("ignora duração estimada e standardTime", () => {
    expect(computeAuvoWorkedHours({
      estimatedDuration: "08:00:00",
      standardTime: "08:00:00",
    })).toBe(0);
  });

  it("usa a duração oficial do Auvo", () => {
    expect(computeAuvoWorkedHours({ duration: "03:30:00" })).toBe(3.5);
  });

  it("desconta pausas do intervalo real", () => {
    expect(computeAuvoWorkedHours({
      checkInDate: "2026-08-10T08:00:00-03:00",
      checkOutDate: "2026-08-10T12:00:00-03:00",
      timeControl: [{
        pauseStart: "2026-08-10T10:00:00-03:00",
        pauseEnd: "2026-08-10T10:30:00-03:00",
      }],
    })).toBe(3.5);
  });

  it("não considera durationDecimal sem check-in", () => {
    expect(computeAuvoWorkedHours({ durationDecimal: 8 })).toBe(0);
  });
});
