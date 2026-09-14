import { describe, expect, it } from "vitest";
import type { ChegadaItem } from "@/lib/agendamento";
import { chegadaItemKey, isPedidoCompra, matchesChegadaSearch, normalizeChegadaSearch } from "@/lib/chegadas-filters";

const item = {
  doc_tipo: "orcamento", orcamento_id: "orc-5418", orcamento_codigo: "5418",
  compra_codigo: "4859", cliente: "SODEXO ONTEX", equipamento: "FRITADEIRA",
  pedidos_detalhes: [{ codigo: "4748", situacao: "Aprovada - AG COMPRA" }],
  pecas_em_falta: [{ nome: "TUBO DE COBRE 3/8", pedidos_compra: [{ codigo: "4618", situacao: "COMPRADO - AG CHEGADA" }] }],
  produtos: [{ nome: "MANGUEIRA DE PRESSÃO", pedidos_compra: [{ codigo: "4861", situacao: "Peças chegaram" }] }],
  previsao_tecnico: "João da Silva",
} as ChegadaItem;

describe("busca de chegadas por conteúdo do documento", () => {
  it.each(["  tubo de cobre  ", " PC   4748 ", "4618", "PC 4861", "mangueira de pressao", "joao", "Orçamento 5418", "OR 5418"])("encontra %s mesmo em peças/PCs secundários", search => {
    expect(matchesChegadaSearch(item, search)).toBe(true);
  });

  it("mantém vazia sem filtro e não aceita termo ausente", () => {
    expect(matchesChegadaSearch(item, "  ")).toBe(true);
    expect(matchesChegadaSearch(item, "compressor")).toBe(false);
    expect(normalizeChegadaSearch("  PRESSÃO\u00a0  DE ÁGUA  ")).toBe("pressao de agua");
  });

  it("tolera arrays ausentes em caches antigos", () => {
    expect(matchesChegadaSearch({ cliente: "Galpão Grill" } as ChegadaItem, "galpao")).toBe(true);
  });

  it("preserva PC antigo vinculado a orçamento quando o cache não informa doc_tipo", () => {
    const purchase = { ...item, doc_tipo: undefined, orcamento_id: undefined, compra_id: "pc-4859" };
    expect(isPedidoCompra(purchase)).toBe(true);
    expect(chegadaItemKey(purchase)).toBe("pc-pc-4859");
  });

  it("identifica o documento mesmo quando vários orçamentos compartilham um PC", () => {
    const other = { ...item, orcamento_id: "orc-6374", orcamento_codigo: "6374" };
    expect(chegadaItemKey(item)).not.toBe(chegadaItemKey(other));
    expect(chegadaItemKey(item)).toBe(chegadaItemKey({ ...item, compra_codigo: "novo-pc" }));
    expect(isPedidoCompra({ ...item, doc_tipo: undefined })).toBe(false);
    expect(isPedidoCompra({ ...item, doc_tipo: "compra" })).toBe(true);
    expect(chegadaItemKey({ ...item, doc_tipo: "compra" })).not.toBe(chegadaItemKey(item));
  });
});
