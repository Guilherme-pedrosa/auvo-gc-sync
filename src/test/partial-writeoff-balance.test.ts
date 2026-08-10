import { describe, expect, it } from "vitest";
import {
  pendingProductsFromPickPack,
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
});
