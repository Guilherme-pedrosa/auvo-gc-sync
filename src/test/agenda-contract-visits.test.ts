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
        contrato_visita_numero: 1,
      }],
      [{ id: "config", contrato_id: "contract", qtd_visitas: 2 }],
      [{
        id: "contract",
        nome: "CONTRATO SODEXO SAVOY",
        tipo_id: "maintenance",
        horas_mes_contratadas: 32,
      }],
      [{
        id: "done",
        contrato_visita_config_id: "config",
        competencia: "2026-08-01",
        visita_numero: 1,
        data_realizada: "2026-08-11",
        horas_trabalhadas: 8.25,
      }],
      [{ id: "maintenance", nome: "Manutenção Preventiva" }],
    );

    expect(card).toMatchObject({
      contrato_nome: "CONTRATO SODEXO SAVOY",
      contrato_tipo_id: "maintenance",
      contrato_tipo_nome: "Manutenção Preventiva",
      contrato_visitas_cumpridas: 1,
      contrato_visitas_previstas: 2,
      contrato_horas_cumpridas: 8.25,
      contrato_horas_previstas: 32,
      contrato_visita_execucao_id: "done",
      contrato_visita_realizada_em: "2026-08-11",
      contrato_visita_horas_realizadas: 8.25,
    });
  });

  it("anexa a execução somente ao número programado correspondente", () => {
    const cards = attachContractVisitProgress(
      [1, 2].map((visitaNumero) => ({
        id: `card-${visitaNumero}`,
        cliente: "HYPERMARCAS",
        previsao_tipo: "CONTRATO",
        contrato_visita_config_id: "config",
        contrato_visita_competencia: "2026-08-01",
        contrato_visita_numero: visitaNumero,
      })),
      [{ id: "config", contrato_id: "contract", qtd_visitas: 2 }],
      [{ id: "contract", nome: "HYPERMARCAS", tipo_id: null, horas_mes_contratadas: 32 }],
      [{
        id: "execution-1",
        contrato_visita_config_id: "config",
        competencia: "2026-08-01",
        visita_numero: 1,
        data_realizada: "2026-08-11",
        horas_trabalhadas: 12.5,
      }],
    );

    expect(cards[0]).toMatchObject({
      contrato_visita_execucao_id: "execution-1",
      contrato_visita_realizada_em: "2026-08-11",
      contrato_horas_cumpridas: 12.5,
      contrato_horas_previstas: 32,
    });
    expect(cards[1]).toMatchObject({
      contrato_visita_execucao_id: null,
      contrato_visitas_cumpridas: 1,
    });
  });

  it("identifica também o contrato no card de visita realizada", () => {
    const [card] = attachContractVisitProgress(
      [{
        id: "done-card",
        cliente: "1929 TRATTORIA MODERNA",
        previsao_tipo: "CONTRATO_REALIZADO",
        contrato_id: "coifa-contract",
      }],
      [],
      [{
        id: "coifa-contract",
        nome: "HIGIENIZAÇÃO COIFA 1929 TRATTORIA",
        tipo_id: "coifa",
        horas_mes_contratadas: 48,
      }],
      [],
      [{ id: "coifa", nome: "Higienização de coifas" }],
    );

    expect(card).toMatchObject({
      contrato_nome: "HIGIENIZAÇÃO COIFA 1929 TRATTORIA",
      contrato_tipo_nome: "Higienização de coifas",
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
