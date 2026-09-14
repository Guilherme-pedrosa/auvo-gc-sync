import { act, cleanup, renderHook } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENDA_FORECAST_POLL_MS, AGENDA_FORECAST_STATE_FIELDS } from "@/lib/agendaForecastRefresh";

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  calls: [] as Array<{ table: string; columns: string; ids: unknown[] | null }>,
  failLight: false,
  lightWait: null as Promise<void> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let columns = "*";
      let ids: unknown[] | null = null;
      let from = 0;
      let to = 999;
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select: (value: string) => { columns = value; return query; },
        in: (key: string, values: unknown[]) => {
          if (key === "id") ids = values;
          filters.push(row => values.includes(row[key])); return query;
        },
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        not: (key: string, _op: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
        is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        gte: (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return query; },
        lte: (key: string, value: string) => { filters.push(row => String(row[key]) <= value); return query; },
        order: () => query,
        range: (start: number, end: number) => { from = start; to = end; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          db.calls.push({ table, columns, ids });
          const light = table === "agenda_agendamentos" && columns !== "*";
          if (light && db.lightWait) await db.lightWait;
          if (light && db.failLight) return resolve({ data: null, error: { message: "Rede indisponível" } });
          const rows = table === "agenda_agendamentos"
            ? db.rows.filter(row => filters.every(filter => filter(row))).slice(from, to + 1)
            : [];
          return resolve({ data: structuredClone(rows), error: null });
        },
      };
      return query;
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAgendaSemana } from "@/hooks/operacional/useAgendamentoEquipe";

const clients: QueryClient[] = [];
const days = ["2026-09-14", "2026-09-20"];
function forecast(id = "forecast-10239", overrides: Record<string, unknown> = {}) {
  return {
    id, data: "2026-09-18", hora_inicio: "09:00:00", hora_fim: "11:00:00",
    colaborador_id: "elton", colaborador_nome: "ELTON", cliente: "FR INCORPORADORA",
    origem: "MANUAL", status: "PREVISAO", auvo_task_id: null,
    gc_os_codigo: "10239", gc_orcamento_codigo: "6605", previsao_continuidade: true,
    previsao_tipo: "ORCAMENTO_EXECUCAO", conversao_status: "BLOQUEADA", conversao_erro: "Tarefa anterior iniciada",
    ...overrides,
  };
}

async function flush(milliseconds = 10) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useAgendaSemana(days), { wrapper });
  for (let index = 0; index < 20 && !hook.result.current.isSuccess; index++) await flush();
  expect(hook.result.current.isSuccess).toBe(true);
  return { ...hook, client };
}

const lightCalls = () => db.calls.filter(call => call.table === "agenda_agendamentos" && call.columns !== "*");
const fullCalls = () => db.calls.filter(call => call.table === "agenda_agendamentos" && call.columns === "*");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T12:00:00"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  focusManager.setFocused(true);
  db.rows = [forecast()]; db.calls = []; db.failLight = false; db.lightWait = null;
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("atualização automática das reservas convertidas na agenda", () => {
  it("consulta só o estado das reservas de conversão e ignora timestamps sem recarregar a escala", async () => {
    db.rows.push(
      forecast("saldo", { previsao_tipo: "SALDO_BAIXA_PARCIAL" }),
      forecast("continuacao", { previsao_tipo: "CONTINUACAO" }),
      forecast("real", { auvo_task_id: "777", previsao_continuidade: false, origem: "AUVO" }),
    );
    await mount();
    const count = db.calls.length;
    db.rows[0] = { ...db.rows[0], atualizado_em: "2026-09-14T15:01:00Z" };
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(lightCalls()).toEqual([{ table: "agenda_agendamentos", columns: AGENDA_FORECAST_STATE_FIELDS.join(","), ids: ["forecast-10239"] }]);
    expect(db.calls).toHaveLength(count + 1);
    expect(fullCalls()).toHaveLength(1);
  });

  it("substitui automaticamente a previsão pela tarefa real e encerra o monitor depois da conversão", async () => {
    const { result } = await mount();
    db.rows[0] = { ...db.rows[0], auvo_task_id: "79756778", origem: "AUVO", status: "AGENDADO",
      previsao_continuidade: false, conversao_status: "CONVERTIDA", conversao_erro: null };
    await flush(AGENDA_FORECAST_POLL_MS + 10);
    expect(result.current.data?.agendamentos[0]).toMatchObject({
      id: "forecast-10239", auvo_task_id: "79756778", conversao_status: "CONVERTIDA", previsao_continuidade: false,
    });
    expect(fullCalls()).toHaveLength(2);
    const count = lightCalls().length;
    await flush(AGENDA_FORECAST_POLL_MS * 2);
    expect(lightCalls()).toHaveLength(count);
  });

  it("atualiza mensagem de conversão somente quando o estado muda", async () => {
    const { result } = await mount();
    db.rows[0] = { ...db.rows[0], conversao_status: "AGUARDANDO_TAREFA", conversao_erro: null };
    await flush(AGENDA_FORECAST_POLL_MS + 10);
    expect(result.current.data?.agendamentos[0].conversao_status).toBe("AGUARDANDO_TAREFA");
    expect(fullCalls()).toHaveLength(2);
    await flush(AGENDA_FORECAST_POLL_MS + 10);
    expect(fullCalls()).toHaveLength(2);
  });

  it("não interpreta falha de leitura como remoção e retoma a consulta seguinte", async () => {
    const { result } = await mount();
    db.failLight = true;
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(fullCalls()).toHaveLength(1);
    expect(result.current.data?.agendamentos).toHaveLength(1);
    db.failLight = false;
    db.rows = [];
    await flush(AGENDA_FORECAST_POLL_MS + 10);
    expect(fullCalls()).toHaveLength(2);
    expect(result.current.data?.agendamentos).toHaveLength(0);
  });

  it("limpa o timer e ignora uma resposta que chega depois da desmontagem", async () => {
    const { unmount, client } = await mount();
    let release = () => {};
    db.lightWait = new Promise<void>(resolve => { release = resolve; });
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(lightCalls()).toHaveLength(1);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    unmount();
    db.rows = [];
    release();
    await flush(AGENDA_FORECAST_POLL_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
    expect(lightCalls()).toHaveLength(1);
  });

  it("recarrega ao recuperar foco mesmo dentro dos cinco minutos de cache", async () => {
    db.rows = [forecast("saldo", { previsao_tipo: "SALDO_BAIXA_PARCIAL" })];
    const { result } = await mount();
    db.rows[0] = { ...db.rows[0], cliente: "Cliente atualizado" };
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await flush();
    expect(result.current.data?.agendamentos[0].cliente).toBe("Cliente atualizado");
    expect(fullCalls()).toHaveLength(2);
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(lightCalls()).toHaveLength(0);
  });

  it("pagina o monitor por IDs e não consulta enquanto a aba está oculta", async () => {
    db.rows = Array.from({ length: 205 }, (_, index) => forecast(`f-${String(index).padStart(3, "0")}`));
    await mount();
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(lightCalls().map(call => call.ids?.length)).toEqual([200, 5]);
    expect(fullCalls()).toHaveLength(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await flush(AGENDA_FORECAST_POLL_MS);
    expect(lightCalls()).toHaveLength(2);
  });
});
