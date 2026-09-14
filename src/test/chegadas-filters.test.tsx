import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChegadaItem, PedidoDetalheProduto } from "@/lib/agendamento";

const backend = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({ data: { ok: true, itens: backend.rows, cache: "hit" }, error: null })),
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
  },
}));
vi.mock("@/components/financeiro/AgendarTarefaDialog", () => ({ default: () => null }));
vi.mock("@/components/financeiro/AgendamentoAiPanel", () => ({ default: () => null }));

import AgendamentoPage from "@/pages/financeiro/AgendamentoPage";

const clients: QueryClient[] = [];
const SITUACAO_ORCAMENTO = "COMPRADO - AGUARDANDO CHEGADA";
const SITUACAO_COMPRA = "Aprovada - AG COMPRA";

function purchase(codigo: string): PedidoDetalheProduto {
  return {
    codigo, id: `pc-${codigo}`, situacao_id: "pc-pendente", situacao: SITUACAO_COMPRA,
    data_chegada: "2026-09-15", data_chegada_texto: "15/09/2026", estado: "pendente", gc_link: "",
  };
}

function arrival(code: string, overrides: Partial<ChegadaItem> = {}): ChegadaItem {
  return {
    doc_tipo: "orcamento", orcamento_id: `orc-${code}`, compra_id: "", compra_codigo: "4833",
    pedidos_compra: ["4833"], pedidos_detalhes: [purchase("4833")],
    fornecedor: "Fornecedor de peças", situacao_id: "orc-pendente", situacao: SITUACAO_ORCAMENTO,
    grupo: "aguardando_chegada", data_emissao: "2026-09-01", data_chegada: "2026-09-15",
    data_chegada_texto: "15/09/2026", vinculo_tipo: "orcamento", vinculo_codigo: code,
    vinculo_texto: `Orçamento ${code}`, auvo_task_id: "", observacao_extra: "", valor_total: 100,
    produtos: [{
      produto_id: `produto-${code}`, variacao_id: null, nome: "Motor elétrico", quantidade: 1,
      valor_total: 100, estoque_atual: 0, estoque_verificado: false, deficit: 1,
      critico: false, pedidos_compra: [],
    }],
    gc_link: "", cliente: "RESTAURANTE ÁGUA", equipamento: "Forno",
    os_codigo: "", orcamento_codigo: code, documento_valor: 100,
    documento_situacao: SITUACAO_ORCAMENTO, documento_link: "", auvo_link: "",
    ...overrides,
  };
}

function fixtures(): ChegadaItem[] {
  const first = arrival("7001", {
    pedidos_compra: ["4833", "4748"], pedidos_detalhes: [purchase("4833"), purchase("4748")],
  });
  first.produtos[0] = { ...first.produtos[0], nome: "CABO DE IGNIÇÃO" };
  return [
    first,
    arrival("7002", { cliente: "CLÍNICA BETA", data_chegada: "2026-09-16" }),
    arrival("7003", { compra_codigo: "4618", data_chegada: "2026-09-07" }),
    arrival("7004", { compra_codigo: "", data_chegada: null, pedidos_compra: [], pedidos_detalhes: [] }),
    arrival("", {
      doc_tipo: "compra", orcamento_id: undefined, compra_id: "compra-9001", compra_codigo: "9001",
      cliente: "LOJA GAMA", vinculo_tipo: "texto", vinculo_codigo: "", vinculo_texto: "Compra avulsa",
      situacao: SITUACAO_COMPRA, situacao_id: "pc-pendente", pedidos_compra: [], pedidos_detalhes: [],
    }),
  ];
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><AgendamentoPage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("Orçamento 7001");
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function column(title: RegExp) {
  const section = screen.getByRole("heading", { name: title }).closest("section");
  if (!section) throw new Error("Coluna de chegadas não encontrada");
  return within(section);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T12:00:00"));
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  backend.rows = fixtures();
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("filtros da página de chegada de peças", () => {
  it("não reaproveita o card de outro orçamento quando ambos têm o mesmo PC", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderPage();

    for (let index = 0; index < 3; index++) {
      type("Buscar em todas as chegadas", "7002");
      expect(screen.getByText("Orçamento 7002")).toBeInTheDocument();
      expect(screen.queryByText("Orçamento 7001")).not.toBeInTheDocument();
      expect(screen.queryByText(/^OR 7001 ·/)).not.toBeInTheDocument();

      type("Buscar em todas as chegadas", "7001");
      expect(screen.getByText("Orçamento 7001")).toBeInTheDocument();
      expect(screen.queryByText("Orçamento 7002")).not.toBeInTheDocument();
      expect(screen.queryByText(/^OR 7002 ·/)).not.toBeInTheDocument();

      type("Buscar em todas as chegadas", "");
      expect(screen.getAllByText("Orçamento 7001")).toHaveLength(1);
      expect(screen.getAllByText("Orçamento 7002")).toHaveLength(1);
    }

    expect(errors.mock.calls.some(args => args.join(" ").includes("same key"))).toBe(false);
  });

  it("busca PC secundário e peças nas colunas, aceitando espaços e texto sem acentos", async () => {
    await renderPage();
    const previstas = () => column(/Orçamentos com chegada prevista/);

    type("Buscar nas chegadas previstas", "  4748  ");
    expect(previstas().getByText("Orçamento 7001")).toBeInTheDocument();
    expect(previstas().queryByText("Orçamento 7002")).not.toBeInTheDocument();

    type("Buscar nas chegadas previstas", "  cabo de ignicao  ");
    expect(previstas().getByText("Orçamento 7001")).toBeInTheDocument();
    expect(previstas().queryByText("Orçamento 7002")).not.toBeInTheDocument();

    type("Buscar nas chegadas atrasadas", "  motor eletrico  ");
    expect(column(/Orçamentos atrasados/).getByText("Orçamento 7003")).toBeInTheDocument();
    type("Buscar nas chegadas sem previsão", "  motor eletrico  ");
    expect(column(/Sem previsão de chegada/).getByText("Orçamento 7004")).toBeInTheDocument();
  });

  it("aplica a busca geral ao calendário e às listas sem transformar busca de coluna em filtro global", async () => {
    await renderPage();
    type("Buscar nas chegadas previstas", "7001");
    expect(screen.queryByText("Orçamento 7002")).not.toBeInTheDocument();
    expect(screen.getByText(/^OR 7002 ·/)).toBeInTheDocument();

    type("Buscar em todas as chegadas", "cabo de ignicao");
    expect(screen.getByText("Orçamento 7001")).toBeInTheDocument();
    expect(screen.getByText(/^OR 7001 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/^OR 7002 ·/)).not.toBeInTheDocument();
    expect(screen.queryByText("Orçamento 7003")).not.toBeInTheDocument();
    expect(screen.queryByText("Orçamento 7004")).not.toBeInTheDocument();
  });

  it("combina cliente e busca geral e permite limpar mesmo quando não há resultado", async () => {
    await renderPage();
    type("Filtrar chegadas por cliente", "  agua  ");
    type("Buscar em todas as chegadas", "4748");
    expect(screen.getByText("Orçamento 7001")).toBeInTheDocument();
    expect(screen.queryByText("Orçamento 7002")).not.toBeInTheDocument();
    expect(screen.queryByText("Orçamento 7003")).not.toBeInTheDocument();

    type("Filtrar chegadas por cliente", "beta");
    expect(screen.queryByText("Orçamento 7001")).not.toBeInTheDocument();
    expect(screen.queryByText("Orçamento 7002")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByLabelText("Buscar em todas as chegadas")).toHaveValue("");
    expect(screen.getByLabelText("Filtrar chegadas por cliente")).toHaveValue("");
    expect(screen.getByText("Orçamento 7001")).toBeInTheDocument();
    expect(screen.getByText("Orçamento 7002")).toBeInTheDocument();
  });

  it("mostra situações do tipo selecionado e aplica o checkbox ao documento", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Situação do documento/ }));
    expect(await screen.findByRole("checkbox", { name: SITUACAO_ORCAMENTO })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: SITUACAO_COMPRA })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: SITUACAO_ORCAMENTO }));
    await waitFor(() => expect(screen.queryByText("Orçamento 7001")).not.toBeInTheDocument());
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Pedidos \(/ }));
    fireEvent.click(screen.getByRole("button", { name: /Situação do documento/ }));
    expect(await screen.findByRole("checkbox", { name: SITUACAO_COMPRA })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: SITUACAO_ORCAMENTO })).not.toBeInTheDocument();
    expect(screen.getByText("Pedido de Compra 9001")).toBeInTheDocument();
  });
});
