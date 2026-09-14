import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestForecastForDocument, type ChegadaItem, type PedidoDetalheProduto, type PrevisaoAgendamento } from "@/lib/agendamento";
import {
  isPartialBalanceForecast,
  normalizeChegadaForPlanning,
  PARTIAL_BALANCE_FORECAST,
  partialBalanceConversionStatus,
  partialBalancePlanningStatus,
} from "@/lib/partialBalancePlanning";

const backend = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: { ok: true, itens: backend.rows }, error: null })) },
  },
}));

import { chegadaDoAgendamento, fetchPrevisoesChegada } from "@/lib/previsaoChegada";

function order(code: string, state: PedidoDetalheProduto["estado"], date: string | null): PedidoDetalheProduto {
  return {
    id: `pc-${code}`, codigo: code, estado: state, data_chegada: date,
    data_chegada_texto: date ?? "", situacao_id: "", situacao: state, gc_link: "",
  };
}

function product(id: string, orders: PedidoDetalheProduto[] = []): ChegadaItem["produtos"][number] {
  return {
    produto_id: id, variacao_id: null, nome: `Peça ${id}`, quantidade: 1, valor_total: 10,
    estoque_atual: 0, estoque_verificado: true, deficit: 1, critico: false, pedidos_compra: orders,
  };
}

function legacyArrival(code: string, overrides: Partial<ChegadaItem> = {}): ChegadaItem {
  const remaining = [product("a"), product("b"), product("c")];
  return {
    doc_tipo: "orcamento", orcamento_id: `orc-${code}`, orcamento_codigo: code,
    vinculo_tipo: "orcamento", vinculo_codigo: code, os_codigo: "9044", grupo: "baixa_parcial",
    saldo_baixa_parcial_status: "verified", produtos: remaining, pecas_em_falta: remaining,
    todos_em_estoque: false, pode_agendar: false, data_chegada: "2026-09-15",
    proxima_reposicao: null, data_chegada_orcamento: "2026-09-15",
    pedidos_detalhes: [order("antigo", "chegou", "2026-09-15")],
    ...overrides,
  } as ChegadaItem;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T12:00:00"));
  backend.rows = [];
});
afterEach(() => vi.useRealTimers());

describe("planejamento do saldo de baixa parcial", () => {
  it("corrige o snapshot legado do orçamento 5334 sem apagar suas três peças restantes", () => {
    const input = legacyArrival("5334");
    const result = normalizeChegadaForPlanning(input);

    expect(result).toMatchObject({
      orcamento_codigo: "5334", saldo_baixa_parcial_status: "verified", tem_saldo_pendente: true,
      saldo_baixa_parcial_encerrado: false, data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
    expect(result.produtos).toBe(input.produtos);
    expect(result.produtos).toHaveLength(3);
    expect(result.pecas_em_falta).toBe(input.pecas_em_falta);
    expect(input.data_chegada).toBe("2026-09-15");
    expect(result.pedidos_detalhes).toEqual(input.pedidos_detalhes);
  });

  it("separa o saldo confirmado em zero do orçamento 5332 de uma chegada agendável", () => {
    const result = normalizeChegadaForPlanning(legacyArrival("5332", {
      produtos: [], pecas_em_falta: [], todos_em_estoque: true, pode_agendar: true,
    }));
    expect(result).toMatchObject({
      tem_saldo_pendente: false, saldo_baixa_parcial_encerrado: true,
      data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
    expect(partialBalancePlanningStatus(result)).toBe("Saldo encerrado · sem peças restantes");
    expect(partialBalanceConversionStatus(result)).toBe("SALDO_ENCERRADO");
  });

  it("não zera o orçamento 6082 quando o Pick & Pack não localizou uma operação", () => {
    const result = normalizeChegadaForPlanning(legacyArrival("6082", {
      saldo_baixa_parcial_status: "not_found", produtos: [], pecas_em_falta: [],
      todos_em_estoque: true, pode_agendar: true,
    }));
    expect(result).toMatchObject({
      saldo_baixa_parcial_status: "not_found", tem_saldo_pendente: null,
      saldo_baixa_parcial_encerrado: false, data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
    expect(partialBalancePlanningStatus(result)).toBe("Saldo a confirmar no Pick & Pack");
    expect(partialBalanceConversionStatus(result)).toBe("SALDO_A_CONFIRMAR");
  });

  it("usa somente a chegada de PC pendente das peças restantes, mantendo o histórico separado", () => {
    const remaining = [product("a", [
      order("historico", "chegou", "2026-10-20"),
      order("cancelado", "cancelado", "2026-10-25"),
      order("incerto", "desconhecido", "2026-10-30"),
      order("aberto", "pendente", "2026-09-19"),
    ])];
    const result = normalizeChegadaForPlanning(legacyArrival("5334", {
      produtos: remaining, pecas_em_falta: remaining,
    }));
    expect(result.data_chegada).toBe("2026-09-19");
    expect(result.proxima_reposicao).toBe("2026-09-19");
    expect(partialBalancePlanningStatus(result)).toBe("Saldo restante · chegada prevista");
    expect(partialBalanceConversionStatus(result)).toBe("SALDO_PENDENTE");
  });

  it("mostra prazo não confirmado quando só há PCs históricos para as peças restantes", () => {
    const remaining = [product("a", [order("antigo", "chegou", "2026-09-15")])];
    const result = normalizeChegadaForPlanning(legacyArrival("5334", {
      produtos: remaining, pecas_em_falta: remaining,
    }));
    expect(result.data_chegada).toBeNull();
    expect(partialBalancePlanningStatus(result)).toBe("Saldo restante · prazo das peças não confirmado");
    expect(partialBalanceConversionStatus(result)).toBe("SALDO_PENDENTE");
  });

  it("mantém agendável o saldo positivo com estoque confirmado", () => {
    const result = normalizeChegadaForPlanning(legacyArrival("5334", {
      todos_em_estoque: true, pecas_em_falta: [],
    }));
    expect(result.pode_agendar).toBe(true);
    expect(result.data_chegada).toBe("2026-09-14");
    expect(partialBalancePlanningStatus(result)).toBe("Saldo restante disponível em estoque");
  });

  it.each(["ORCAMENTO_EXECUCAO", PARTIAL_BALANCE_FORECAST, "CONTINUACAO"])("nunca reclassifica tarefa Auvo real de tipo %s como previsão de saldo", type => {
    expect(isPartialBalanceForecast({
      previsao_tipo: type, previsao_continuidade: true, auvo_task_id: "79755965",
    }, legacyArrival("5334"))).toBe(false);
  });

  it("reconhece previsão manual antiga de orçamento e o novo tipo explícito de saldo", () => {
    const manual = { origem: "MANUAL", previsao_tipo: "ORCAMENTO_EXECUCAO", previsao_continuidade: true, auvo_task_id: null };
    expect(isPartialBalanceForecast(manual, legacyArrival("5334"))).toBe(true);
    expect(isPartialBalanceForecast({ ...manual, previsao_tipo: PARTIAL_BALANCE_FORECAST }, null)).toBe(true);
    expect(isPartialBalanceForecast({ ...manual, previsao_continuidade: false }, legacyArrival("5334"))).toBe(false);
    expect(isPartialBalanceForecast(manual, legacyArrival("5334", { grupo: "ag_chegada" }))).toBe(false);
  });

  it.each(["CONTINUACAO", "OS_EXECUCAO"])("preserva previsão manual %s de execução quando as peças já foram retiradas", type => {
    const closedArrival = normalizeChegadaForPlanning(legacyArrival("5332", {
      produtos: [], pecas_em_falta: [], todos_em_estoque: true,
    }));
    expect(closedArrival.saldo_baixa_parcial_encerrado).toBe(true);
    expect(isPartialBalanceForecast({
      previsao_tipo: type, previsao_continuidade: true, auvo_task_id: null,
    }, closedArrival)).toBe(false);
    expect(isPartialBalanceForecast({
      previsao_tipo: type, previsao_continuidade: true, auvo_task_id: null,
    }, legacyArrival("6082", { saldo_baixa_parcial_status: "not_found" }))).toBe(false);
  });

  it("preserva o fluxo normal de chegada fora da baixa parcial", () => {
    const unchanged = legacyArrival("7001", { grupo: "ag_chegada", pecas_em_falta: [] });
    expect(normalizeChegadaForPlanning(unchanged)).toBe(unchanged);
    const missing = [product("a", [order("aberto", "pendente", "2026-09-20")])];
    expect(normalizeChegadaForPlanning({ ...unchanged, pecas_em_falta: missing }).data_chegada).toBe("2026-09-20");
    expect(partialBalancePlanningStatus(null)).toBe("Saldo a confirmar no Pick & Pack");
  });

  it("normaliza snapshots antigos também na consulta usada pela grade de equipe", async () => {
    backend.rows = [legacyArrival("5334"), legacyArrival("6082", {
      saldo_baixa_parcial_status: "not_found", produtos: [], pecas_em_falta: [],
    })];
    const results = await fetchPrevisoesChegada();
    expect(results.map(item => item.data_chegada)).toEqual([null, null]);
    expect(results.map(item => item.tem_saldo_pendente)).toEqual([true, null]);
  });
});

describe("vínculo da chegada ao orçamento que identifica o saldo", () => {
  it("não reaproveita a reserva mais recente de outro orçamento por uma OS histórica compartilhada", () => {
    const correct = {
      id: "saldo-5334", gc_orcamento_codigo: "5334", gc_os_codigo: "10122",
      atualizado_em: "2026-09-14T10:00:00Z",
    } as PrevisaoAgendamento;
    const wrong = {
      id: "saldo-6082", gc_orcamento_codigo: "6082", gc_os_codigo: "9044",
      atualizado_em: "2026-09-14T18:00:00Z",
    } as PrevisaoAgendamento;
    const arrival = legacyArrival("5334", { os_codigo: "9044" });
    expect(latestForecastForDocument(arrival, [wrong, correct])).toBe(correct);
    expect(latestForecastForDocument(arrival, [wrong])).toBeNull();
  });

  it("prioriza orçamento exato mesmo que outra linha compartilhe a OS de uma baixa anterior", () => {
    const wrongBudget = legacyArrival("6082", { os_codigo: "9044" });
    const rightBudget = legacyArrival("5334", { os_codigo: "10122" });
    expect(chegadaDoAgendamento({ gc_orcamento_codigo: "5334", gc_os_codigo: "9044" }, [wrongBudget, rightBudget])).toBe(rightBudget);
    expect(chegadaDoAgendamento({ gc_orcamento_codigo: "5334", gc_os_codigo: "9044" }, [wrongBudget])).toBeNull();
  });

  it("permite vínculo por OS quando o agendamento não informa orçamento", () => {
    const arrival = legacyArrival("5334", { os_codigo: "9044" });
    expect(chegadaDoAgendamento({ gc_os_codigo: "9044" }, [arrival])).toBe(arrival);
    expect(chegadaDoAgendamento({ gc_os_codigo: "inexistente" }, [arrival])).toBeNull();
  });
});
