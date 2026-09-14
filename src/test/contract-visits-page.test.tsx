import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  calls: [] as Array<{ table: string; from: number; to: number; order: string[] }>,
  failure: null as { table: string; from: number } | null,
  reconcile: vi.fn(async () => ({ inserted: 0, removed: 0, preserved: 0, year: 2026 })),
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: db.rpc,
    from(table: string) {
      const terms = (expression: string): string[] => {
        let depth = 0;
        let start = 0;
        const result: string[] = [];
        for (let index = 0; index < expression.length; index++) {
          if (expression[index] === "(") depth++;
          if (expression[index] === ")") depth--;
          if (expression[index] === "," && depth === 0) {
            result.push(expression.slice(start, index));
            start = index + 1;
          }
        }
        return [...result, expression.slice(start)];
      };
      const matches = (row: Record<string, any>, expression: string): boolean => {
        const group = /^(and|or)\((.*)\)$/.exec(expression);
        if (group) {
          const predicates = terms(group[2]).map(term => matches(row, term));
          return group[1] === "and" ? predicates.every(Boolean) : predicates.some(Boolean);
        }
        const [, key, operator, value] = /^([^.]+)\.([^.]+)\.(.*)$/.exec(expression)!;
        if (operator === "is" && value === "null") return row[key] == null;
        if (row[key] == null) return false;
        if (operator === "gte") return row[key] >= value;
        if (operator === "lt") return row[key] < value;
        throw new Error(`Unsupported test filter: ${expression}`);
      };
      const filters: Array<(row: Record<string, any>) => boolean> = [];
      const order: Array<{ key: string; ascending: boolean }> = [];
      let from = 0;
      let to = 999; // Default PostgREST cap in production.
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        gte: (key: string, value: unknown) => { filters.push(row => row[key] >= value!); return query; },
        lte: (key: string, value: unknown) => { filters.push(row => row[key] <= value!); return query; },
        or: (expression: string) => { filters.push(row => matches(row, `or(${expression})`)); return query; },
        order: (key: string, options?: { ascending?: boolean }) => {
          order.push({ key, ascending: options?.ascending !== false }); return query;
        },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          db.calls.push({ table, from, to, order: order.map(item => item.key) });
          if (db.failure?.table === table && db.failure.from === from) {
            return resolve({ data: null, error: { message: "Falha na segunda página" } });
          }
          const rows = (db.tables[table] || []).filter(row => filters.every(filter => filter(row)));
          rows.sort((a, b) => {
            for (const item of order) {
              const direction = item.ascending ? 1 : -1;
              if (a[item.key] < b[item.key]) return -direction;
              if (a[item.key] > b[item.key]) return direction;
            }
            return 0;
          });
          return resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
        },
      };
      return query;
    },
  },
}));
vi.mock("@/lib/contractVisitPlanning", () => ({
  todayISO: () => "2026-09-14",
  planningYearsFromDates: () => [2026],
  reconcileContractVisitYear: db.reconcile,
}));
vi.mock("@/components/agendamento/RegraVisitaTextoIA", () => ({ RegraVisitaTextoIA: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import VisitasContratuaisPage from "@/pages/agendamento/VisitasContratuaisPage";

const clients: QueryClient[] = [];
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><VisitasContratuaisPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

function forecast(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `forecast-${String(index).padStart(6, "0")}`,
    origem: "CONTRATO", previsao_tipo: "CONTRATO", contrato_id: "coifa",
    contrato_visita_config_id: "config", contrato_visita_numero: index + 1,
    data: "2026-09-01", hora_inicio: "08:00", hora_fim: "16:00",
    contrato_visita_competencia: "2026-09-01", ...overrides,
  };
}

function configureCoifa() {
  db.tables.contratos = [{
    id: "coifa", nome: "RESTAURANTE EXEMPLO COIFA", ativo: true, horas_mes_contratadas: 32,
    vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31",
  }];
  db.tables.contratos_visitas_config = [{
    id: "config", contrato_id: "coifa", ativo: true, qtd_visitas: 2, qtd_tecnicos: 2,
    duracao_minutos: 480, hora_inicio: "08:00", tecnico_ids: ["a", "b"],
    dias_semana: [2, 3], semanas_mes: [1], meses_ativos: [3, 9],
    visitas_consecutivas: true, planejamento_pendente: false,
  }];
  db.tables.rh_colaboradores = ["a", "b"].map(id => ({ id, nome: `Técnico ${id}`, ativo: true, cargo: "Técnico" }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T12:00:00"));
  db.tables = {};
  db.calls = [];
  db.failure = null;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
});

describe("carregamento e planejamento das visitas contratuais", () => {
  it("carrega mais de mil previsões e execuções com ordenação estável", async () => {
    db.tables.agenda_agendamentos = Array.from({ length: 1127 }, (_, index) => forecast(index));
    db.tables.contratos_visitas_execucoes = Array.from({ length: 1089 }, (_, index) => ({
      id: `execution-${String(index).padStart(6, "0")}`, contrato_id: "coifa",
      contrato_visita_config_id: "config", competencia: "2026-09-01", data_realizada: "2026-09-01",
      visita_numero: index + 1, horas_trabalhadas: 1, cliente: "Cliente", tecnicos: [], tarefa_ids: [],
    }));
    const client = renderPage();
    await waitFor(() => {
      expect(client.getQueryData(["contractual-visits", "forecasts", 2026])).toHaveLength(1127);
      expect(client.getQueryData(["contractual-visits", "executions", 2026])).toHaveLength(1089);
    });
    for (const table of ["agenda_agendamentos", "contratos_visitas_execucoes"]) {
      const calls = db.calls.filter(call => call.table === table);
      expect(calls.map(call => call.from)).toEqual([0, 500, 1000]);
      expect(calls.every(call => call.order[call.order.length - 1] === "id")).toBe(true);
    }
  });

  it("mantém a previsão no ano da competência após remarcação entre anos, inclusive além da milésima linha", async () => {
    const decemberMovedToJanuary = forecast(1000, {
      data: "2027-01-08", contrato_visita_competencia: "2026-12-01",
    });
    const januaryMovedToDecember = forecast(1001, {
      data: "2026-12-28", contrato_visita_competencia: "2027-01-01",
    });
    const legacyDecember = forecast(1002, {
      data: "2026-12-31", contrato_visita_competencia: null,
    });
    const legacyJanuary = forecast(1003, {
      data: "2027-01-01", contrato_visita_competencia: null,
    });
    db.tables.agenda_agendamentos = [
      ...Array.from({ length: 1000 }, (_, index) => forecast(index)),
      decemberMovedToJanuary, januaryMovedToDecember, legacyDecember, legacyJanuary,
    ];

    const client = renderPage();
    await waitFor(() => expect(client.getQueryData(["contractual-visits", "forecasts", 2026])).toHaveLength(1002));
    const forecasts2026 = client.getQueryData<Record<string, any>[]>(["contractual-visits", "forecasts", 2026])!;
    expect(forecasts2026).toContainEqual(decemberMovedToJanuary);
    expect(forecasts2026).toContainEqual(legacyDecember);
    expect(forecasts2026).not.toContainEqual(januaryMovedToDecember);
    expect(forecasts2026).not.toContainEqual(legacyJanuary);
    expect(db.calls.filter(call => call.table === "agenda_agendamentos").map(call => call.from)).toEqual([0, 500, 1000]);

    fireEvent.click(screen.getByRole("button", { name: "Próximo ano" }));
    await waitFor(() => expect(client.getQueryData(["contractual-visits", "forecasts", 2027])).toHaveLength(2));
    const forecasts2027 = client.getQueryData<Record<string, any>[]>(["contractual-visits", "forecasts", 2027])!;
    expect(forecasts2027).toEqual([januaryMovedToDecember, legacyJanuary]);
    expect(forecasts2027.some(row => forecasts2026.some(previous => previous.id === row.id))).toBe(false);
  });

  it("mantém as duas visitas consecutivas de coifa sem recalcular ao abrir a tela", async () => {
    configureCoifa();
    db.tables.agenda_agendamentos = [
      forecast(0), forecast(1, { data: "2026-09-02" }),
    ];
    const client = renderPage();
    await waitFor(() => expect(client.getQueryState(["contractual-visits", "forecasts", 2026])?.status).toBe("success"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
    expect(db.reconcile).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("não recalcula nem usa dados parciais quando a segunda página falha", async () => {
    configureCoifa();
    db.tables.agenda_agendamentos = Array.from({ length: 1127 }, (_, index) => forecast(index));
    db.failure = { table: "agenda_agendamentos", from: 500 };
    const client = renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Falha na segunda página"));
    expect(client.getQueryData(["contractual-visits", "forecasts", 2026])).toBeUndefined();
    expect(screen.getByRole("button", { name: "Abastecer agenda de 2026" })).toBeDisabled();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
    expect(db.reconcile).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
