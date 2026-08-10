import { describe, expect, it } from "vitest";
import {
  addMinutesToClock,
  buildContractVisitForecasts,
  eligibleContractVisitDates,
  evenlyDistributedDates,
  isFieldTechnician,
  rotatingVisitTeams,
} from "@/lib/contractVisits";

describe("previsoes de visitas contratuais", () => {
  it("distribui as visitas pelo mes sem concentrar tudo na primeira semana", () => {
    const eligible = eligibleContractVisitDates("2026-09", [1, 2, 3, 4, 5]);
    expect(evenlyDistributedDates(eligible, 3)).toEqual([
      "2026-09-01",
      "2026-09-16",
      "2026-09-30",
    ]);
  });

  it("respeita inicio e fim da vigencia do contrato", () => {
    expect(eligibleContractVisitDates("2026-09", [1, 2, 3, 4, 5], "2026-09-10", "2026-09-18"))
      .toEqual(["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
  });

  it("faz rodizio quando ha mais tecnicos habilitados que vagas por visita", () => {
    expect(rotatingVisitTeams(["a", "b", "c"], 2, 3)).toEqual([
      ["a", "b"],
      ["c", "a"],
      ["b", "c"],
    ]);
  });

  it("gera data, equipe e duracao de cada visita", () => {
    const forecasts = buildContractVisitForecasts({
      competencia: "2026-09",
      qtdVisitas: 2,
      qtdTecnicos: 2,
      duracaoMinutos: 150,
      horaInicio: "08:30",
      tecnicoIds: ["a", "b", "c"],
      diasSemana: [1, 2, 3, 4, 5],
    });

    expect(forecasts).toEqual([
      { visitaNumero: 1, data: "2026-09-01", horaInicio: "08:30", horaFim: "11:00", tecnicoIds: ["a", "b"] },
      { visitaNumero: 2, data: "2026-09-30", horaInicio: "08:30", horaFim: "11:00", tecnicoIds: ["c", "a"] },
    ]);
  });

  it("usa a mesma regra de tecnicos e auxiliares do Agendamento Equipe", () => {
    expect(isFieldTechnician({ cargo: "Tecnico de campo" })).toBe(true);
    expect(isFieldTechnician({ funcao: "Auxiliar técnico" })).toBe(true);
    expect(isFieldTechnician({ cargo: "Financeiro" })).toBe(false);
  });

  it("nao permite que uma visita ultrapasse a meia-noite", () => {
    expect(() => addMinutesToClock("23:00", 120)).toThrow("DURACAO_ULTRAPASSA_DIA");
  });
});
