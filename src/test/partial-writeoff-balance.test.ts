import { describe, expect, it } from "vitest";
import {
  pendingProductsFromPickPack,
  resolvePartialWriteoffArrival,
  shouldUsePickPackPartialBalance,
  type PartialBalanceProduct,
  type PickPackPendingItem,
} from "../../supabase/functions/_shared/partial-writeoff-balance";

function product(id: string, quantity: number, variation: string | null = null): PartialBalanceProduct {
  return {
    produto_id: id,
    variacao_id: variation,
    nome: `Produto ${id}`,
    quantidade: quantity,
    valor_total: quantity * 100,
  };
}

function balance(id: string, pending: number, variation: string | null = null): PickPackPendingItem {
  return {
    product_id: id,
    variation_id: variation,
    product_name: `Produto ${id}`,
    original_quantity: pending + 1,
    withdrawn_quantity: 1,
    pending_quantity: pending,
  };
}

describe("saldo pendente vindo do Pick & Pack", () => {
  it("é habilitado exclusivamente para orçamento em baixa parcial", () => {
    expect(shouldUsePickPackPartialBalance("baixa_parcial")).toBe(true);
    expect(shouldUsePickPackPartialBalance("ag_compra")).toBe(false);
    expect(shouldUsePickPackPartialBalance("ag_chegada")).toBe(false);
    expect(shouldUsePickPackPartialBalance("garantia")).toBe(false);
    expect(shouldUsePickPackPartialBalance("ag_aprovacao")).toBe(false);
  });

  it("usa somente os itens e quantidades ainda pendentes", () => {
    const pending = pendingProductsFromPickPack([
      product("10", 1),
      product("20", 3),
      product("30", 1),
    ], [balance("20", 1), balance("30", 1)]);

    expect(pending.map((item) => [item.produto_id, item.quantidade])).toEqual([
      ["20", 1],
      ["30", 1],
    ]);
    expect(pending[0].valor_total).toBe(100);
  });

  it("não mistura saldos entre variações do mesmo produto", () => {
    const pending = pendingProductsFromPickPack([
      product("10", 1, "azul"),
      product("10", 1, "vermelha"),
    ], [balance("10", 1, "vermelha")]);

    expect(pending).toHaveLength(1);
    expect(pending[0].variacao_id).toBe("vermelha");
  });

  it("agrega linhas repetidas do mesmo produto", () => {
    const pending = pendingProductsFromPickPack(
      [product("10", 4)],
      [balance("10", 1), balance("10", 2)],
    );

    expect(pending).toHaveLength(1);
    expect(pending[0].quantidade).toBe(3);
  });

  it("separa saldo encerrado de estoque disponível e não oferece nova previsão", () => {
    const pending = pendingProductsFromPickPack([product("10", 2)], [balance("10", 0)]);
    const state = resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: pending, missingProducts: [],
      allInStock: true, today: "2026-09-14",
    });
    expect(state).toEqual({
      saldo_baixa_parcial_encerrado: true, tem_saldo_pendente: false,
      data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
  });

  it.each(["not_found", "unavailable"] as const)("não interpreta %s como saldo zero ou chegada confirmada", status => {
    const state = resolvePartialWriteoffArrival({
      group: "baixa_parcial", status, pendingProducts: [],
      missingProducts: [{ quantidade: 1, pedidos_compra: [{ estado: "pendente", data_chegada: "2026-09-15" }] }],
      allInStock: true, today: "2026-09-14",
    });
    expect(state).toEqual({
      saldo_baixa_parcial_encerrado: false, tem_saldo_pendente: null,
      data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
  });

  it("mantém três peças restantes sem data quando elas não têm PC de reposição", () => {
    const pending = [product("20", 1), product("30", 1), product("40", 1)];
    const state = resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: pending, missingProducts: pending,
      allInStock: false, today: "2026-09-14",
    });
    expect(state).toEqual({
      saldo_baixa_parcial_encerrado: false, tem_saldo_pendente: true,
      data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
  });

  it("ignora PCs históricos, cancelados e sem estado confirmado das peças restantes", () => {
    const pending = [{ quantidade: 1, pedidos_compra: [
      { estado: "chegou", data_chegada: "2026-09-15" },
      { estado: "cancelado", data_chegada: "2026-09-20" },
      { estado: "desconhecido", data_chegada: "2026-09-25" },
    ] }];
    expect(resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: pending, missingProducts: pending,
      allInStock: false, today: "2026-09-14",
    })).toMatchObject({ tem_saldo_pendente: true, data_chegada: null, proxima_reposicao: null });
  });

  it("não promete chegada do saldo inteiro quando só uma das três peças tem prazo", () => {
    const missing = [
      { quantidade: 1, pedidos_compra: [{ estado: "pendente", data_chegada: "2026-09-20" }] },
      { quantidade: 1, pedidos_compra: [] },
      { quantidade: 1, pedidos_compra: [{ estado: "pendente", data_chegada: null }] },
    ];
    const before = JSON.stringify(missing);
    expect(resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: missing, missingProducts: missing,
      allInStock: false, today: "2026-09-14",
    })).toMatchObject({
      tem_saldo_pendente: true, saldo_baixa_parcial_encerrado: false,
      data_chegada: null, proxima_reposicao: null, pode_agendar: false,
    });
    expect(JSON.stringify(missing)).toBe(before);
    expect(missing[0].pedidos_compra[0].data_chegada).toBe("2026-09-20");
  });

  it("usa o maior prazo quando todas as peças faltantes têm PC pendente com data", () => {
    const missing = ["2026-09-20", "2026-09-18", "2026-09-23"].map(date => ({
      quantidade: 1, pedidos_compra: [{ estado: "pendente", data_chegada: date }],
    }));
    expect(resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: missing, missingProducts: missing,
      allInStock: false, today: "2026-09-14",
    })).toMatchObject({ data_chegada: "2026-09-23", proxima_reposicao: "2026-09-23", pode_agendar: false });
  });

  it("usa somente a última chegada pendente das peças ainda faltantes", () => {
    const pending = [
      { quantidade: 1, pedidos_compra: [{ estado: "pendente", data_chegada: "2026-10-20" }] },
      { quantidade: 1, pedidos_compra: [
        { estado: "pendente", data_chegada: "2026-09-17" },
        { estado: "pendente", data_chegada: "2026-09-19" },
        { estado: "cancelado", data_chegada: "2026-10-30" },
        { estado: "pendente", data_chegada: "sem data" },
      ] },
    ];
    const state = resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: pending,
      missingProducts: [pending[1]], allInStock: false, today: "2026-09-14",
    });
    expect(state).toMatchObject({
      tem_saldo_pendente: true, saldo_baixa_parcial_encerrado: false,
      data_chegada: "2026-09-19", proxima_reposicao: "2026-09-19", pode_agendar: false,
    });
  });

  it("permite agendar o saldo positivo quando todas as peças restantes estão disponíveis", () => {
    const state = resolvePartialWriteoffArrival({
      group: "baixa_parcial", status: "verified", pendingProducts: [product("20", 1)],
      missingProducts: [], allInStock: true, today: "2026-09-14",
    });
    expect(state).toEqual({
      saldo_baixa_parcial_encerrado: false, tem_saldo_pendente: true,
      data_chegada: "2026-09-14", proxima_reposicao: null, pode_agendar: true,
    });
  });

  it.each(["ag_compra", "ag_chegada", "garantia", "ag_aprovacao"])("não muda o cálculo de chegada de %s", group => {
    expect(resolvePartialWriteoffArrival({
      group, status: "not_applicable", pendingProducts: [], missingProducts: [],
      allInStock: true, today: "2026-09-14",
    })).toBeNull();
  });
});
