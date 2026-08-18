import { describe, expect, it } from "vitest";
import {
  attachContractVisitProgress,
  sortAgendaItemsWithContractPlanFirst,
} from "@/lib/agendaContractVisits";

describe("cards de visitas contratuais na agenda", () => {
  it("mostra no planejado a quantidade e as horas já cumpridas na competência", () => {
    const [card] = attachContractVisitProgress(
      [{
        id: "card",
        cliente: "SODEXO SAVOY",
        previsao_tipo: "CONTRATO",
        contrato_visita_config_id: "config",
        contrato_visita_competencia: "2026-08-01",
      }],
      [{ id: "config", contrato_id: "contract", qtd_visitas: 2 }],
      [{ id: "contract", horas_mes_contratadas: 32 }],
      [{
        id: "done",
        contrato_visita_config_id: "config",
        competencia: "2026-08-01",
        horas_trabalhadas: 8.25,
      }],
    );

    expect(card).toMatchObject({
      contrato_visitas_cumpridas: 1,
      contrato_visitas_previstas: 2,
      contrato_horas_cumpridas: 8.25,
      contrato_horas_previstas: 32,
    });
  });

  it("coloca o card contratual planejado ou realizado antes das tarefas do mesmo cliente", () => {
    const sorted = sortAgendaItemsWithContractPlanFirst([
      { id: "savoy-task-1", cliente: "SODEXO SAVOY", hora_inicio: "08:00" },
      { id: "nip-task", cliente: "NIP NAPOLI", hora_inicio: "08:30" },
      { id: "savoy-plan", cliente: "SODEXO SAVOY", hora_inicio: "09:00", previsao_tipo: "CONTRATO" },
      { id: "savoy-task-2", cliente: "SODEXO SAVOY", hora_inicio: "10:00" },
      { id: "nip-done", cliente: "NIP NAPOLI", hora_inicio: "09:30", previsao_tipo: "CONTRATO_REALIZADO" },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "savoy-plan",
      "savoy-task-1",
      "savoy-task-2",
      "nip-done",
      "nip-task",
    ]);
  });
});
