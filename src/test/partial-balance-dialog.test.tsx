import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChegadaItem } from "@/lib/agendamento";

const effects = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; method: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  reads: [] as Array<Array<[string, unknown]>>,
  changedBeforeSave: false,
  invoke: vi.fn(), rpc: vi.fn(), error: vi.fn(), success: vi.fn(),
  technicians: [{ id: "rh-1", nome: "Técnico Teste", auvo_user_id: "123", ativo: true, cargo: "Técnico", funcao: "" }],
}));

vi.mock("@/hooks/rh/useRh", () => ({ useColaboradores: () => ({ data: effects.technicians, isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { error: effects.error, success: effects.success } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-test" } } }) },
    functions: { invoke: effects.invoke }, rpc: effects.rpc,
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let writing = false;
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        insert: (payload: Record<string, unknown>) => {
          writing = true; effects.writes.push({ table, method: "insert", payload, filters }); return query;
        },
        update: (payload: Record<string, unknown>) => {
          writing = true; effects.writes.push({ table, method: "update", payload, filters }); return query;
        },
        maybeSingle: async () => {
          if (!writing) effects.reads.push(filters);
          return { data: writing && !effects.changedBeforeSave ? { id: "forecast-new" } : null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null })),
      };
      return query;
    },
  },
}));

import AgendarTarefaDialog, { type AgendarAlvo } from "@/components/financeiro/AgendarTarefaDialog";

const clients: QueryClient[] = [];
function target(overrides: Partial<AgendarAlvo> = {}): AgendarAlvo {
  return {
    auvo_task_id: "tarefa-anterior", exec_task_id: "tarefa-anterior", gc_os_codigo: "9044",
    gc_orcamento_codigo: "5334", cliente: "Cliente do saldo", equipamento: "Forno",
    data_tarefa: "2026-09-17", tecnico_id: "rh-1", tecnico_nome: "Técnico Teste",
    hora: "08:00", hora_fim: "10:00", previsao_detalhes: "Apenas peças restantes",
    saldo_baixa_parcial: {
      grupo: "baixa_parcial", saldo_baixa_parcial_status: "verified", tem_saldo_pendente: true,
      saldo_baixa_parcial_encerrado: false, produtos: [{ produto_id: "a", quantidade: 1 }],
      data_chegada: null, todos_em_estoque: false,
    } as ChegadaItem,
    ...overrides,
  };
}

function renderDialog(alvo = target()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const onSaved = vi.fn();
  render(<QueryClientProvider client={client}><AgendarTarefaDialog open alvo={alvo} onOpenChange={vi.fn()} onSaved={onSaved} /></QueryClientProvider>);
  return onSaved;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T12:00:00"));
  effects.writes = [];
  effects.reads = [];
  effects.changedBeforeSave = false;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
});

describe("reserva interna de saldo no diálogo financeiro", () => {
  it("salva saldo pendente separado da OS anterior sem invocar Auvo ou alterar tarefa", async () => {
    const onSaved = renderDialog();
    expect(screen.getByRole("heading", { name: "Planejar saldo da baixa parcial" })).toBeInTheDocument();
    expect(screen.getByText(/OS anterior 9044/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());

    expect(effects.writes).toHaveLength(1);
    expect(effects.writes[0]).toMatchObject({
      table: "agenda_agendamentos", method: "insert", payload: {
        origem: "MANUAL", previsao_continuidade: true, previsao_tipo: "SALDO_BAIXA_PARCIAL",
        conversao_status: "SALDO_PENDENTE", auvo_task_id: null,
        gc_os_codigo: "9044", gc_orcamento_codigo: "5334", data: "2026-09-17",
        colaborador_id: "rh-1", hora_inicio: "08:00", hora_fim: "10:00",
        previsao_detalhes: "Apenas peças restantes",
      },
    });
    expect(effects.reads[0]).toContainEqual(["previsao_tipo", "SALDO_BAIXA_PARCIAL"]);
    expect(effects.invoke).not.toHaveBeenCalled();
    expect(effects.rpc).not.toHaveBeenCalled();
  });

  it("edita a mesma reserva em vez de criar outra ou modificar sua OS", async () => {
    const onSaved = renderDialog(target({ previsao_id: "forecast-existing" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(effects.writes).toHaveLength(1);
    expect(effects.writes[0]).toMatchObject({
      method: "update", table: "agenda_agendamentos", filters: [["id", "forecast-existing"], ["previsao_continuidade", true], ["auvo_task_id", null]],
      payload: { previsao_tipo: "SALDO_BAIXA_PARCIAL", gc_os_codigo: "9044", auvo_task_id: null },
    });
    expect(effects.invoke).not.toHaveBeenCalled();
    expect(effects.rpc).not.toHaveBeenCalled();
  });

  it("não sobrescreve a tarefa quando a reserva converteu enquanto o diálogo estava aberto", async () => {
    const onSaved = renderDialog(target({ previsao_id: "forecast-converted", saldo_baixa_parcial: null }));
    effects.changedBeforeSave = true;
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(effects.error).toHaveBeenCalledWith(expect.stringContaining("já mudou ou foi convertida")));
    expect(onSaved).not.toHaveBeenCalled();
    expect(effects.success).not.toHaveBeenCalled();
    expect(effects.writes[0].filters).toContainEqual(["auvo_task_id", null]);
    expect(effects.invoke).not.toHaveBeenCalled();
  });

  it.each([
    { saldo_baixa_parcial_status: "not_found", saldo_baixa_parcial_encerrado: false, label: "Saldo a confirmar no Pick & Pack" },
    { saldo_baixa_parcial_status: "verified", saldo_baixa_parcial_encerrado: true, label: "Saldo encerrado · sem peças restantes" },
  ] as const)("bloqueia gravação quando $label", async ({ label, ...partial }) => {
    const base = target();
    const onSaved = renderDialog({ ...base, saldo_baixa_parcial: { ...base.saldo_baixa_parcial!, ...partial } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    expect(effects.error).toHaveBeenCalledWith(label);
    expect(effects.writes).toHaveLength(0);
    expect(effects.reads).toHaveLength(0);
    expect(effects.invoke).not.toHaveBeenCalled();
    expect(effects.rpc).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("preserva o tipo de primeira execução quando o orçamento não é baixa parcial", async () => {
    const onSaved = renderDialog(target({ saldo_baixa_parcial: null }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar previsão" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(effects.writes[0].payload).toMatchObject({
      previsao_tipo: "ORCAMENTO_EXECUCAO", conversao_status: "AGUARDANDO_TAREFA", auvo_task_id: null,
    });
  });
});
