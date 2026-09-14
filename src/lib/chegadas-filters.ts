import type { ChegadaItem } from "./agendamento";

export type ChegadaDocumentType = "todos" | "orcamentos" | "pedidos";

export function normalizeChegadaSearch(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
}

export function isPedidoCompra(item: ChegadaItem): boolean {
  if (item.doc_tipo) return item.doc_tipo === "compra";
  if (item.orcamento_id) return false;
  if (item.compra_id) return true;
  if (item.orcamento_codigo) return false;
  return Boolean(item.compra_codigo);
}

// Um PC pode abastecer vários orçamentos. Ele nunca identifica o card do orçamento.
export function chegadaItemKey(item: ChegadaItem): string {
  return isPedidoCompra(item)
    ? `pc-${item.compra_id || item.compra_codigo}`
    : `or-${item.orcamento_id || item.orcamento_codigo || item.vinculo_codigo || item.documento_link}`;
}

export function matchesChegadaDocumentType(item: ChegadaItem, type: ChegadaDocumentType): boolean {
  return type === "todos" || (type === "pedidos" ? isPedidoCompra(item) : !isPedidoCompra(item));
}

export function chegadaSituacao(item: ChegadaItem): string {
  return item.situacao?.trim() || "Sem situação";
}

/** As buscas global e por coluna consultam os mesmos campos exibidos no card. */
export function matchesChegadaSearch(item: ChegadaItem, search: string): boolean {
  const term = normalizeChegadaSearch(search);
  if (!term) return true;
  const parts = [...(item.produtos ?? []), ...(item.pecas_em_falta ?? [])];
  const orders = [
    ...(item.pedidos_detalhes ?? []),
    ...parts.flatMap(part => part.pedidos_compra ?? []),
  ];
  const budget = item.orcamento_codigo || (item.vinculo_tipo === "orcamento" ? item.vinculo_codigo : "");
  const os = item.os_codigo || (item.vinculo_tipo === "os" ? item.vinculo_codigo : "");
  const values = [
    item.cliente, item.fornecedor, item.equipamento, item.vinculo_texto, item.vinculo_codigo,
    item.situacao, item.documento_situacao, item.observacao_extra, item.previsao_tecnico,
    budget && `OR ${budget} Orçamento ${budget}`, os && `OS ${os}`,
    item.compra_codigo && `PC ${item.compra_codigo}`,
    ...(item.pedidos_compra ?? []).map(code => `PC ${code}`),
    ...orders.flatMap(order => [`PC ${order.codigo}`, order.situacao]),
    ...parts.map(part => part.nome),
  ].map(normalizeChegadaSearch);
  return values.some(value => value.includes(term));
}
