import { describe, expect, it, vi } from "vitest";
import { reconcileBudgetExecutionForecasts } from "../../supabase/functions/central-sync/budget-forecast-reconciliation";

const forecast = { id: "forecast-6563", gc_orcamento_codigo: "6563", criado_em: "2026-09-08T19:59:26Z", previsao_tipo: "ORCAMENTO_EXECUCAO", previsao_continuidade: true, auvo_task_id: null, conversao_status: "AGUARDANDO_OS" };
const order = { gc_os_id: "398336240", gc_os_codigo: "10234", gc_os_orcamento_codigo: "6563", gc_os_data: "2026-09-01", gc_os_situacao: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO", gc_os_tarefa_os: "77509677", gc_os_tarefa_exec: "79721161" };

function setup(rows = [{ ...forecast }], orders = [order]) {
  const updates: any[] = [];
  const db = {
    functions: { invoke: vi.fn().mockResolvedValue({ data: { promoted: true }, error: null }) },
    from: () => {
      const filters: Array<(row: any) => boolean> = [];
      let patch: any;
      const query: any = {
        select: () => query, order: () => query, limit: () => query,
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        is: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        update: (value: unknown) => { patch = value; return query; },
        then: (resolve: any) => {
          const selected = rows.filter((row) => filters.every((filter) => filter(row)));
          if (patch) for (const row of selected) { updates.push(patch); Object.assign(row, patch); }
          return Promise.resolve({ data: selected.map((row) => ({ ...row })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const readGc = vi.fn(async (path: string) => ({ data: path.startsWith("/api/orcamentos?") ? [{ codigo: "6563", cliente_id: "51584908" }] : orders }));
  return { db, deps: { readGc, mapOs: (row: any) => row }, updates, rows };
}

describe("descoberta da execução de previsões pelo documento GC", () => {
  it("agenda 6563 por OS10234/exec79721161 sem depender de tarefa no período Auvo", async () => {
    const { db, deps } = setup();
    const result = await reconcileBudgetExecutionForecasts(db, deps);
    expect(result.promoted).toBe(1);
    expect(db.functions.invoke).toHaveBeenCalledWith("auvo-task-update", { body: {
      action: "promote-budget-forecast", gcOrcamentoCodigo: "6563", gcOsCodigo: "10234", execTaskId: "79721161",
    } });
    expect(deps.readGc.mock.calls.every(([path]) => !/data_inicio|data_fim/.test(path))).toBe(true);
  });

  it("reavalia um vínculo anteriormente bloqueado quando a execução foi corrigida", async () => {
    const { db, deps } = setup([{ ...forecast, conversao_status: "BLOQUEADA" }]);
    expect((await reconcileBudgetExecutionForecasts(db, deps)).promoted).toBe(1);
  });

  it("nunca promove diagnóstico na ausência de execução explícita", async () => {
    const { db, deps, updates } = setup(undefined, [{ ...order, gc_os_tarefa_exec: "" }]);
    expect((await reconcileBudgetExecutionForecasts(db, deps)).waitingTask).toBe(1);
    expect(db.functions.invoke).not.toHaveBeenCalled();
    expect(updates[0].conversao_status).toBe("AGUARDANDO_TAREFA");
  });

  it("não confunde a reserva de saldo parcial ou uma tarefa já convertida", async () => {
    const { db, deps } = setup([
      { ...forecast, previsao_tipo: "SALDO_BAIXA_PARCIAL" },
      { ...forecast, previsao_continuidade: false, auvo_task_id: "79721161" },
    ]);
    expect((await reconcileBudgetExecutionForecasts(db, deps)).forecasts).toBe(0);
    expect(deps.readGc).not.toHaveBeenCalled();
  });

  it("preserva como saldo uma previsão antiga quando o GC passou a baixa parcial", async () => {
    const { db, deps, updates } = setup();
    deps.readGc.mockResolvedValueOnce({ data: [{ codigo: "6563", cliente_id: "51584908", situacao_id: "9348312" }] } as any);
    await reconcileBudgetExecutionForecasts(db, deps);
    expect(db.functions.invoke).not.toHaveBeenCalled();
    expect(deps.readGc).toHaveBeenCalledTimes(1);
    expect(updates[0]).toMatchObject({ previsao_tipo: "SALDO_BAIXA_PARCIAL", conversao_status: "SALDO_A_CONFIRMAR" });
    expect(updates[0]).not.toHaveProperty("gc_os_codigo");
    expect(updates[0]).not.toHaveProperty("auvo_task_id");
  });

  it("não usa OS terminal nem escolhe uma de duas OS abertas ambíguas", async () => {
    const terminal = setup(undefined, [{ ...order, gc_os_situacao: "EXECUTADO COM NOTA EMITIDA" }]);
    expect((await reconcileBudgetExecutionForecasts(terminal.db, terminal.deps)).waitingOs).toBe(1);
    expect(terminal.db.functions.invoke).not.toHaveBeenCalled();
    const ambiguous = setup(undefined, [order, { ...order, gc_os_id: "398336241", gc_os_codigo: "10235" }]);
    expect((await reconcileBudgetExecutionForecasts(ambiguous.db, ambiguous.deps)).blocked).toBe(1);
    expect(ambiguous.db.functions.invoke).not.toHaveBeenCalled();
  });

  it("não escolhe entre múltiplas tarefas de execução", async () => {
    const { db, deps } = setup(undefined, [{ ...order, gc_os_tarefa_exec: "79721161/79721162" }]);
    expect((await reconcileBudgetExecutionForecasts(db, deps)).blocked).toBe(1);
    expect(db.functions.invoke).not.toHaveBeenCalled();
  });

  it("consulta as demais páginas do cliente para encontrar a OS", async () => {
    const { db, deps } = setup();
    deps.readGc.mockImplementation(async (path) => {
      if (path.startsWith("/api/orcamentos?")) return { data: [{ codigo: "6563", cliente_id: "51584908" }] } as any;
      if (path.endsWith("pagina=1")) return { data: Array.from({ length: 100 }, (_, i) => ({ ...order, gc_os_id: String(i), gc_os_orcamento_codigo: "1234" })) };
      return { data: [order] };
    });
    expect((await reconcileBudgetExecutionForecasts(db, deps)).promoted).toBe(1);
    expect(deps.readGc.mock.calls.some(([path]) => path.endsWith("pagina=2"))).toBe(true);
  });

  it("preserva o vínculo em HTTP400 ou resposta incompleta, sem inventar ausência da OS", async () => {
    const { db, deps, updates } = setup();
    deps.readGc.mockRejectedValueOnce(new Error("GC HTTP 400"));
    expect((await reconcileBudgetExecutionForecasts(db, deps)).errors).toBe(1);
    expect(updates[0]).toMatchObject({ conversao_status: "ERRO", conversao_erro: "GC HTTP 400" });
    expect(updates[0]).not.toHaveProperty("gc_os_codigo");
    expect(db.functions.invoke).not.toHaveBeenCalled();
  });

  it("falha sem escolher OS se todas as páginas não foram confirmadas", async () => {
    const { db, deps } = setup();
    deps.readGc.mockImplementation(async (path) => ({ data: path.startsWith("/api/orcamentos?")
      ? [{ codigo: "6563", cliente_id: "51584908" }]
      : Array.from({ length: 100 }, () => order) } as any));
    expect((await reconcileBudgetExecutionForecasts(db, deps)).errors).toBe(1);
    expect(db.functions.invoke).not.toHaveBeenCalled();
  });

  it("não sobrescreve a conversão que ocorreu durante a leitura do GC", async () => {
    const { db, deps, rows, updates } = setup();
    deps.readGc.mockImplementationOnce(async () => {
      rows[0].previsao_continuidade = false;
      rows[0].auvo_task_id = "79721161";
      throw new Error("GC indisponível");
    });
    await reconcileBudgetExecutionForecasts(db, deps);
    expect(updates).toHaveLength(0);
  });

  it("não sobrescreve uma reserva reclassificada como saldo durante a consulta", async () => {
    const { db, deps, rows, updates } = setup();
    deps.readGc.mockImplementationOnce(async () => {
      rows[0].previsao_tipo = "SALDO_BAIXA_PARCIAL";
      throw new Error("GC indisponível");
    });
    await reconcileBudgetExecutionForecasts(db, deps);
    expect(updates).toHaveLength(0);
  });
});
