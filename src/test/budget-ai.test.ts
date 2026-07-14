import { describe, expect, it, vi } from "vitest";
import { evaluateBudgetAiReadiness, extractBudgetAiPhotos, withBudgetAiTimeout } from "@/lib/budgetAi";

describe("budget AI context", () => {
  it("extracts URLs even when the answer contains text or multiple links", () => {
    const photos = extractBudgetAiPhotos([
      { question: "Fotos do defeito", reply: "Frente: https://cdn.test/a e https://cdn.test/b.jpg" },
    ]);
    expect(photos.map((photo) => photo.url)).toEqual(["https://cdn.test/a", "https://cdn.test/b.jpg"]);
    expect(photos.every((photo) => photo.category === "defect")).toBe(true);
  });

  it("samples a large photo sequence instead of keeping only the first images", () => {
    const reply = Array.from({ length: 12 }, (_, index) => `https://cdn.test/${index}.jpg`).join("\n");
    const photos = extractBudgetAiPhotos([{ question: "Fotos das peças", reply }], 6);
    expect(photos).toHaveLength(6);
    expect(photos[0].originalIndex).toBe(0);
    expect(photos.at(-1)?.originalIndex).toBe(11);
  });

  it("blocks calls with no useful technical context", () => {
    const readiness = evaluateBudgetAiReadiness({ equipment: "N/A", orientation: "", photos: [] });
    expect(readiness.canAnalyze).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it("allows a useful case and reports missing evidence as warnings", () => {
    const readiness = evaluateBudgetAiReadiness({
      equipment: "Forno Rational",
      orientation: "Forno não aquece",
      observations: "Resistência medida em aberto",
      photos: [],
    });
    expect(readiness.canAnalyze).toBe(true);
    expect(readiness.warnings).toContain("Nenhuma foto disponível para validação visual.");
  });

  it("interrupts an AI request that exceeds the frontend limit", async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const guarded = withBudgetAiTimeout(pending, 1000);
    const expectation = expect(guarded).rejects.toThrow("AI_REQUEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
    vi.useRealTimers();
  });
});
