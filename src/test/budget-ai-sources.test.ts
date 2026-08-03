import { describe, expect, it } from "vitest";
import { identifyKnownEquipment } from "../../supabase/functions/genspark-ai/equipment-identification";
import { evaluateBudgetSourcePreflight } from "../../supabase/functions/genspark-ai/source-preflight";

describe("identificação de modelos RATIONAL", () => {
  it.each([
    ["FORNO RATIONAL MOD LM100BE", "iCombi Pro"],
    ["FORNO RATIONAL MOD LM100DE", "iCombi Pro"],
    ["RATIONAL LM200DE", "iCombi Classic"],
  ])("mapeia %s para %s", (equipment, family) => {
    expect(identifyKnownEquipment(equipment)).toEqual({ manufacturer: ["rational"], modelFamily: family });
  });
});

describe("pré-validação das fontes da IA", () => {
  it("bloqueia a cobrança quando a biblioteca não foi carregada", () => {
    const result = evaluateBudgetSourcePreflight({ docsCount: 0, historyLoaded: true });
    expect(result.ready).toBe(false);
    expect(result.failures[0]).toContain("Biblioteca CHAT");
  });

  it("bloqueia a cobrança quando o histórico falhou", () => {
    const result = evaluateBudgetSourcePreflight({ docsCount: 2, historyLoaded: false, historyError: "timeout" });
    expect(result.ready).toBe(false);
    expect(result.failures[0]).toContain("timeout");
  });

  it("libera a análise quando as duas fontes foram consultadas", () => {
    expect(evaluateBudgetSourcePreflight({ docsCount: 2, historyLoaded: true }).ready).toBe(true);
  });
});
