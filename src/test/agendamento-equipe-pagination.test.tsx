import { act, createElement, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  calls: [] as Array<{ table: string; from: number; to: number; order: string[] }>,
  failure: null as { table: string; from: number; message: string } | null,
  pending: null as { table: string; from: number; wait: Promise<void> } | null,
  writeResult: { data: null, error: null } as { data: { id: string } | null; error: { message: string } | null },
  writes: [] as Array<{ table: string; operation: string; payload: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      const filters: Array<(row: Record<string, any>) => boolean> = [];
      const orders: Array<{ key: string; ascending: boolean }> = [];
      let from = 0;
      let to = 999; // Production PostgREST truncation, even without a range.
      const query: any = {
        select: () => query,
        insert: (payload: unknown) => { db.writes.push({ table, operation: "insert", payload }); return query; },
        update: (payload: unknown) => { db.writes.push({ table, operation: "update", payload }); return query; },
        single: async () => db.writeResult,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        gte: (key: string, value: unknown) => { filters.push(row => row[key] >= value!); return query; },
        lte: (key: string, value: unknown) => { filters.push(row => row[key] <= value!); return query; },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
        not: (key: string, _operator: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
        order: (key: string, options?: { ascending?: boolean }) => {
          orders.push({ key, ascending: options?.ascending !== false }); return query;
        },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        then: async (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          try {
            db.calls.push({ table, from, to, order: orders.map(order => order.key) });
            if (db.pending?.table === table && db.pending.from === from) await db.pending.wait;
            if (db.failure?.table === table && db.failure.from === from) {
              return resolve({ data: null, error: { message: db.failure.message } });
            }
            const rows = (db.tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
            rows.sort((a, b) => {
              for (const order of orders) {
                const direction = order.ascending ? 1 : -1;
                if (a[order.key] < b[order.key]) return -direction;
                if (a[order.key] > b[order.key]) return direction;
              }
              return 0;
            });
            return resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAgendamentos, useAgendaSemana, useSaveAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import { toast } from "sonner";

const days = ["2026-07-11", "2026-12-07"];
const clients: QueryClient[] = [];
const roots: Root[] = [];
function renderHook<T>(hook: () => T, options: { wrapper: (props: PropsWithChildren) => React.ReactElement }) {
  const result = { current: undefined as T };
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  function Probe() { result.current = hook(); return null; }
  act(() => root.render(createElement(options.wrapper, null, createElement(Probe))));
  return { result };
}
async function waitFor(check: () => void) {
  for (let attempts = 0; ; attempts++) {
    try { check(); return; } catch (error) { if (attempts >= 100) throw error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
function schedule(index: number) {
  return {
    id: String(index).padStart(6, "0"), data: "2026-09-09", hora_inicio: "08:00:00",
    hora_fim: "09:00:00", colaborador_id: "tecnico", colaborador_nome: "Técnico teste",
    cliente: "Cliente teste", status: "PREVISAO", origem: "MANUAL", auvo_task_id: null,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.calls = []; db.failure = null; db.pending = null;
  db.writeResult = { data: null, error: null }; db.writes = [];
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  clients.splice(0).forEach(client => client.clear());
});

describe("carregamento completo da grade Agendamento Equipe", () => {
  it("retorna 1.245 cartões e 1.205 células de veículos sem perder os últimos lançamentos", async () => {
    db.tables.agenda_agendamentos = Array.from({ length: 1245 }, (_, i) => schedule(1245 - i));
    db.tables.agenda_veiculo_dia = Array.from({ length: 1205 }, (_, i) => ({
      id: String(1205 - i).padStart(6, "0"), data: "2026-09-09", veiculo_id: "veiculo", texto: "Teste",
    }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgendaSemana(days), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.agendamentos).toHaveLength(1245);
    expect(result.current.data?.agendamentos.at(-1)?.id).toBe("001245");
    expect(new Set(result.current.data?.agendamentos.map(row => row.id)).size).toBe(1245);
    expect(result.current.data?.veiculoDias).toHaveLength(1205);
    expect(db.calls.filter(call => call.table === "agenda_agendamentos").map(call => call.from)).toEqual([0, 500, 1000]);
    expect(db.calls.every(call => call.order.at(-1) === "id")).toBe(true);
  });

  it("carrega também um dia com mais de 1.000 cartões e respeita o filtro da data", async () => {
    db.tables.agenda_agendamentos = Array.from({ length: 1245 }, (_, i) => schedule(i));
    db.tables.agenda_agendamentos.push({ ...schedule(9999), data: "2026-09-10" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgendamentos("2026-09-09"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1245);
    expect(result.current.data?.every(row => row.data === "2026-09-09")).toBe(true);
  });

  it.each([0, 500])("rejeita falha na página de offset %s sem publicar um resultado incompleto", async (from) => {
    db.tables.agenda_agendamentos = Array.from({ length: 1245 }, (_, i) => schedule(i));
    db.failure = { table: "agenda_agendamentos", from, message: "Leitura indisponível" };
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgendaSemana(days), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Leitura indisponível");
    expect(result.current.data).toBeUndefined();
  });

  it("mantém a última grade íntegra no cache durante a segunda página e após sua falha", async () => {
    const { client, wrapper } = setup();
    const previous = { agendamentos: [schedule(9999)], veiculoDias: [] };
    client.setQueryData(["agenda_semana", ...days], previous);
    db.tables.agenda_agendamentos = Array.from({ length: 1245 }, (_, i) => schedule(i));
    let release!: () => void;
    db.pending = { table: "agenda_agendamentos", from: 500, wait: new Promise(resolve => { release = resolve; }) };
    db.failure = { table: "agenda_agendamentos", from: 500, message: "Página interrompida" };
    const { result } = renderHook(() => useAgendaSemana(days), { wrapper });
    let request: Promise<unknown>;
    expect(result.current.isRefetchError).toBe(false);
    act(() => { request = result.current.refetch(); });
    await waitFor(() => expect(db.calls.some(call => call.table === "agenda_agendamentos" && call.from === 500)).toBe(true));
    expect(result.current.data).toEqual(previous);
    expect(client.getQueryData(["agenda_semana", ...days])).toEqual(previous);
    await act(async () => { release(); await request!; });
    await waitFor(() => expect(result.current.isRefetchError).toBe(true));
    expect(result.current.data).toEqual(previous);
    expect(client.getQueryData(["agenda_semana", ...days])).toEqual(previous);
  });

  it("enriquece uma tarefa cuja OS só está depois do milésimo snapshot central", async () => {
    db.tables.agenda_agendamentos = [{ ...schedule(1), auvo_task_id: "123", origem: "AUVO" }];
    db.tables.tarefas_central = Array.from({ length: 1245 }, (_, i) => ({
      id: String(i).padStart(6, "0"), auvo_task_id: "123", atualizado_em: "2026-09-09T12:00:00Z",
      gc_os_id: i === 1244 ? "os-ultima" : null, gc_os_codigo: i === 1244 ? "OS-1245" : null,
      gc_os_tarefa_exec: null, gc_os_cliente: "Cliente teste",
    }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgendaSemana(days), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.agendamentos[0].gc_os_id).toBe("os-ultima");
    expect(result.current.data?.agendamentos[0].gc_os_codigo).toBe("OS-1245");
  });

  it.each(["insert", "update"])("só confirma %s depois de receber a linha salva e atualiza os logs", async (operation) => {
    db.writeResult = { data: { id: "gravado" }, error: null };
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveAgendamento(), { wrapper });
    const payload = { ...(operation === "update" ? { id: "gravado" } : {}), cliente: "Teste", previsao_continuidade: true };
    await act(async () => { await expect(result.current.mutateAsync(payload)).resolves.toEqual({ id: "gravado" }); });
    expect(db.writes).toEqual([{ table: "agenda_agendamentos", operation, payload }]);
    expect(toast.success).toHaveBeenCalledWith("Previsão salva");
    for (const key of ["agenda_agendamentos", "agenda_semana", "agenda_agendamentos_logs", "agenda_agendamentos_logs_equipe"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it.each([null, { message: "JSON object requested, multiple (or no) rows returned" }])(
    "não anuncia sucesso quando update não retorna nenhuma linha (erro %j)", async (error) => {
      db.writeResult = { data: null, error };
      const { client, wrapper } = setup();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const { result } = renderHook(() => useSaveAgendamento(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ id: "registro-ausente", cliente: "Teste" })).rejects.toBeTruthy();
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    },
  );
});
