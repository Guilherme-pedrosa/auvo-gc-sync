import { describe, expect, it } from "vitest";
import {
  forecastDateMeetsMinimum,
  forecastInitialDate,
  latestForecastForDocument,
  latestMissingPartsArrival,
  missingPartArrivalDates,
  type ChegadaItem,
  type PecaEmFalta,
  type PrevisaoAgendamento,
} from "@/lib/agendamento";

const item = {
  vinculo_tipo: "orcamento",
  vinculo_codigo: "1234",
  orcamento_codigo: "1234",
  os_codigo: "",
} as ChegadaItem;

function forecast(id: string, atualizadoEm: string, overrides: Partial<PrevisaoAgendamento> = {}): PrevisaoAgendamento {
  return {
    id,
    data: "2026-08-20",
    colaborador_nome: "Técnico",
    colaborador_id: "rh-1",
    gc_orcamento_codigo: "1234",
    gc_os_codigo: null,
    previsao_detalhes: null,
    hora_inicio: "08:00:00",
    hora_fim: "10:00:00",
    atualizado_em: atualizadoEm,
    ...overrides,
  };
}

describe("previsões de agendamento", () => {
  it("mostra todos os prazos da peça e usa o maior no calendário", () => {
    const part = {
      produto_id: "p1",
      nome: "PLACA POWER",
      quantidade: 2,
      estoque_atual: 0,
      deficit: 2,
      pedidos_compra: [
        { codigo: "1", id: "1", situacao_id: "1", situacao: "Aberto", data_chegada: "2026-08-20", data_chegada_texto: "", estado: "pendente", gc_link: "" },
        { codigo: "2", id: "2", situacao_id: "1", situacao: "Aberto", data_chegada: "2026-08-27", data_chegada_texto: "", estado: "pendente", gc_link: "" },
        { codigo: "3", id: "3", situacao_id: "1", situacao: "Cancelado", data_chegada: "2026-09-15", data_chegada_texto: "", estado: "cancelado", gc_link: "" },
      ],
    } satisfies PecaEmFalta;

    expect(missingPartArrivalDates(part)).toEqual(["2026-08-20", "2026-08-27"]);
    expect(latestMissingPartsArrival([part])).toBe("2026-08-27");
  });

  it("permite prever orçamento sem estoque a partir da reposição", () => {
    expect(forecastInitialDate(null, "2026-08-15", "2026-08-20", "2026-08-10")).toBe("2026-08-20");
    expect(forecastDateMeetsMinimum("2026-08-19", "2026-08-20")).toBe(false);
    expect(forecastDateMeetsMinimum("2026-08-20", "2026-08-20")).toBe(true);
    expect(forecastDateMeetsMinimum("2026-08-21", "2026-08-20")).toBe(true);
  });

  it("permite previsão manual quando a reposição ainda não tem data", () => {
    expect(forecastInitialDate(null, null, null, "2026-08-10")).toBe("2026-08-10");
    expect(forecastDateMeetsMinimum("2026-08-12", null)).toBe(true);
  });

  it("carrega a previsão mais recentemente atualizada", () => {
    const result = latestForecastForDocument(item, [
      forecast("antiga", "2026-08-09T10:00:00Z"),
      forecast("nova", "2026-08-10T10:00:00Z", { colaborador_nome: "Técnico novo" }),
    ]);

    expect(result?.id).toBe("nova");
    expect(result?.colaborador_nome).toBe("Técnico novo");
  });

  it("não reaproveita previsão de outro orçamento", () => {
    const result = latestForecastForDocument(item, [
      forecast("outro", "2026-08-10T10:00:00Z", { gc_orcamento_codigo: "9999" }),
    ]);

    expect(result).toBeNull();
  });

  it("usa a OS como vínculo alternativo", () => {
    const osItem = { ...item, vinculo_tipo: "os", vinculo_codigo: "555", orcamento_codigo: "", os_codigo: "555" } as ChegadaItem;
    const result = latestForecastForDocument(osItem, [
      forecast("os", "2026-08-10T10:00:00Z", { gc_orcamento_codigo: null, gc_os_codigo: "555" }),
    ]);

    expect(result?.id).toBe("os");
  });
});
