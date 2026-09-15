import { describe, expect, it } from "vitest";
import { isAuvoDurationConfirmed, requireAuvoDurationConfirmation } from "@/lib/auvoDurationConfirmation";

const confirmed = { success: true, duration: { requestedMinutes: 150, actualMinutes: 150, verified: true } };

describe("confirmação da duração planejada pelo Auvo", () => {
  it("aceita somente a duração solicitada e relida na mesma resposta", () => {
    expect(isAuvoDurationConfirmed(confirmed, 150)).toBe(true);
    expect(() => requireAuvoDurationConfirmation(confirmed, 150)).not.toThrow();
  });
  it.each([
    { success: true },
    { ...confirmed, success: false },
    { ...confirmed, status: 400 },
    { ...confirmed, duration: { ...confirmed.duration, verified: false } },
    { ...confirmed, duration: { ...confirmed.duration, actualMinutes: 0 } },
    { ...confirmed, duration: { ...confirmed.duration, requestedMinutes: 120 } },
    { ...confirmed, duration: { ...confirmed.duration, actualMinutes: 120 } },
  ])("não transforma HTTP/success em confirmação de duração: %j", (result) => {
    expect(isAuvoDurationConfirmed(result, 150)).toBe(false);
    expect(() => requireAuvoDurationConfirmation(result, 150)).toThrow(/02:30/);
  });
});
