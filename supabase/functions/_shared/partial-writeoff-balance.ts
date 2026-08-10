export type PartialBalanceProduct = {
  produto_id: string;
  variacao_id: string | null;
  nome: string;
  quantidade: number;
  valor_total: number;
};

export type PickPackPendingItem = {
  line_key?: string;
  product_id: string;
  variation_id: string | null;
  product_name: string;
  product_code?: string;
  unit?: string;
  original_quantity: number;
  withdrawn_quantity: number;
  pending_quantity: number;
};

function normalizedId(value: unknown): string {
  const id = String(value ?? "").trim();
  return ["", "0", "null", "undefined"].includes(id.toLowerCase()) ? "" : id;
}

export function normalizePartialBudgetCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Impede que o Pick & Pack interfira em qualquer fluxo que não seja baixa parcial. */
export function shouldUsePickPackPartialBalance(group: unknown): boolean {
  return String(group ?? "").trim() === "baixa_parcial";
}

export function partialProductKey(productId: unknown, variationId?: unknown): string {
  const product = normalizedId(productId);
  const variation = normalizedId(variationId);
  return variation ? `${product}::${variation}` : product;
}

/** Converte o saldo oficial do Pick & Pack para o formato usado pelo calendário. */
export function pendingProductsFromPickPack<T extends PartialBalanceProduct>(
  originalProducts: T[],
  balanceItems: PickPackPendingItem[],
): T[] {
  const originals = new Map<string, { quantity: number; value: number; sample: T }>();
  for (const product of originalProducts) {
    const key = partialProductKey(product.produto_id, product.variacao_id);
    if (!key) continue;
    const current = originals.get(key) ?? { quantity: 0, value: 0, sample: product };
    current.quantity += Math.max(0, Number(product.quantidade) || 0);
    current.value += Math.max(0, Number(product.valor_total) || 0);
    originals.set(key, current);
  }

  const grouped = new Map<string, { item: PickPackPendingItem; pending: number }>();
  for (const item of balanceItems) {
    const key = partialProductKey(item.product_id, item.variation_id);
    const pending = Math.max(0, Number(item.pending_quantity) || 0);
    if (!key || pending <= 0.000001) continue;
    const current = grouped.get(key);
    if (current) current.pending += pending;
    else grouped.set(key, { item, pending });
  }

  return [...grouped.entries()].map(([key, { item, pending }]) => {
    const original = originals.get(key);
    const unitValue = original && original.quantity > 0 ? original.value / original.quantity : 0;
    return {
      ...(original?.sample ?? {} as T),
      produto_id: normalizedId(item.product_id),
      variacao_id: normalizedId(item.variation_id) || null,
      nome: String(item.product_name || original?.sample.nome || item.product_code || "Produto sem nome").trim(),
      quantidade: Number(pending.toFixed(6)),
      valor_total: Number((unitValue * pending).toFixed(2)),
    } as T;
  });
}
