import { describe, expect, it } from "vitest";
import { identifyKnownEquipment } from "../../supabase/functions/genspark-ai/equipment-identification";
import { evaluateBudgetSourcePreflight } from "../../supabase/functions/genspark-ai/source-preflight";
import {
  buildPdfPageSample,
  expandTechnicalTerms,
  scoreTechnicalText,
  unrelatedDocumentPenalty,
} from "../../supabase/functions/genspark-ai/technical-doc-relevance";

describe("identificação de modelos RATIONAL", () => {
  it.each([
    ["FORNO RATIONAL MOD LM100BE", "iCombi Pro"],
    ["FORNO RATIONAL MOD LM100DE", "iCombi Pro"],
    ["RATIONAL LM200DE", "iCombi Classic"],
  ])("mapeia %s para %s", (equipment, family) => {
    expect(identifyKnownEquipment(equipment)).toEqual({ manufacturer: ["rational"], modelFamily: family });
  });
});

describe("identificação e busca técnica UNOX", () => {
  it("mapeia XEBC para as famílias da biblioteca UNOX", () => {
    expect(identifyKnownEquipment("FORNO UNOX BAKERTOP MIND.Maps XEBC-06EU-E1RM")).toEqual({
      manufacturer: ["unox"],
      modelFamily: "BAKERTOP CHEFTOP MINDMaps",
    });
  });

  it("traduz placa power e dreno para os termos usados nos documentos", () => {
    const terms = expandTechnicalTerms(["placa", "power", "dreno"]);
    expect(terms).toEqual(expect.arrayContaining(["potencia", "placa potencia", "sifao", "mangote"]));
    expect(scoreTechnicalText("23 - PLACAS DE POTÊNCIA - CHEFTOP_BAKERTOP.pdf", terms)).toBeGreaterThan(0);
  });

  it("rebaixa documentos operacionais que não têm relação com a falha", () => {
    const terms = expandTechnicalTerms(["placa", "power", "ventilador"]);
    expect(unrelatedDocumentPenalty("Como colocar os fornos em modo show.pdf", terms)).toBeLessThan(0);
    expect(unrelatedDocumentPenalty("23 - PLACAS DE POTÊNCIA.pdf", terms)).toBe(0);
  });

  it("amostra início e páginas distribuídas de catálogos extensos", () => {
    const pages = buildPdfPageSample(280, 16);
    expect(pages.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(pages.length).toBe(16);
    expect(Math.max(...pages)).toBeGreaterThan(200);
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
