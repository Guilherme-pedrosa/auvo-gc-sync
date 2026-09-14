import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";
import { reportsSyncPendingSummary, syncReportsInSteps } from "../lib/reportsSync";

beforeAll(() => {
  const native = transferableAbortController();
  vi.stubGlobal("AbortController", native.constructor);
  vi.stubGlobal("AbortSignal", native.signal.constructor);
});
afterAll(() => vi.unstubAllGlobals());

const taskIds = Array.from({ length: 7 }, (_, index) => String(79721161 + index));
const response = (body: any) => ({ data: {
  success: true, report_step: body.report_step, next_page: null, next_after: null,
  os_ids: ["398336240"], budget_codes: [],
  auvo_task_ids: body.report_step === "os_page" ? taskIds.slice(0, 6) : [taskIds[0], taskIds[6]],
  auvo_tarefas: body.task_ids?.length || 0, upserted: body.task_ids?.length || 0,
}, error: null });

describe("Controle OS busca Auvo a partir dos vínculos GC", () => {
  it("deduplica entre situações e conciliação, em lotes cinco, sem nenhuma janela de datas", async () => {
    const invoke = vi.fn(async (_name, { body }) => response(body));
    const result = await syncReportsInSteps(invoke, { situationIds: ["7063705", "7063706"], onProgress: vi.fn() });
    const bodies = invoke.mock.calls.map(([, { body }]) => body);
    const batches = bodies.filter(body => body.report_step === "os_tasks");
    expect(batches.map(body => body.task_ids)).toEqual([taskIds.slice(0, 5), taskIds.slice(5)]);
    expect(bodies.every(body => !body.reports_only && !body.start_date && !body.end_date)).toBe(true);
    expect(result).toMatchObject({ tasks: 7, saved: 7, incomplete: false, warnings: [] });
  });

  it("vínculos antigos, futuros ou sem data seguem a mesma fila por ID", async () => {
    const invoke = vi.fn(async (_name, { body }) => response(body));
    await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: vi.fn(),
      // Even a stale caller carrying the previous UI range cannot limit Controle OS.
      days: [{ start: "2026-09-01", end: "2026-09-30" }],
    } as any);
    expect(invoke.mock.calls.filter(([, { body }]) => body.report_step === "os_tasks").flatMap(([, { body }]) => body.task_ids))
      .toEqual(taskIds);
    expect(invoke.mock.calls.some(([, { body }]) => "start_date" in body || "end_date" in body)).toBe(false);
  });

  it("uma tarefa indisponível preserva a pendência e confirma as demais do lote e seguintes", async () => {
    const warning = { kind: "auvo_task", task_id: taskIds[1], os_ids: ["398336240"], status: 404, message: "Tarefa não confirmada; espelho preservado" };
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_tasks" && body.task_ids.includes(taskIds[1])) return { data: {
        success: true, report_step: "os_tasks", incomplete: true, warnings: [warning], auvo_tarefas: 4, upserted: 4,
      }, error: null };
      return response(body);
    });
    const onWarnings = vi.fn();
    const onProgress = vi.fn();
    const result = await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress, onWarnings });
    expect(result).toMatchObject({ tasks: 6, saved: 6, incomplete: true, warnings: [warning] });
    expect(onWarnings).toHaveBeenLastCalledWith([warning]);
    expect(onProgress.mock.lastCall?.[0]).toContain("1 tarefa Auvo não confirmada");
    expect(onProgress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });

  it("timeout de um lote marca seus IDs e continua o lote seguinte sem repeti-lo", async () => {
    const invoke = vi.fn(async (_name, { body }) => body.report_step === "os_tasks" && body.task_ids[0] === taskIds[0]
      ? { data: null, error: { context: Response.json({ code: "IDLE_TIMEOUT" }, { status: 504 }) } }
      : response(body));
    const result = await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: vi.fn() });
    expect(result).toMatchObject({ tasks: 2, saved: 2, incomplete: true });
    expect(result.warnings).toHaveLength(5);
    expect(result.warnings.map(warning => warning.kind === "auvo_task" ? warning.task_id : "")).toEqual(taskIds.slice(0, 5));
    expect(result.warnings[0].message).toContain("lote não teve conclusão confirmada");
    expect(invoke.mock.calls.filter(([, { body }]) => body.report_step === "os_tasks")).toHaveLength(2);
  });

  it("OS sem tarefa é preservada e não inicia importação por data como fallback", async () => {
    const invoke = vi.fn(async (_name, { body }) => ({ data: { ...response(body).data, auvo_task_ids: [] }, error: null }));
    const result = await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: vi.fn() });
    expect(invoke.mock.calls.map(([, { body }]) => body.report_step)).toEqual(["os_page", "os_reconcile"]);
    expect(result).toMatchObject({ tasks: 0, saved: 0, incomplete: false });
  });

  it("backend antigo sem lista de vínculos não resulta em falso sucesso", async () => {
    const invoke = vi.fn(async (_name, { body }) => ({ data: { success: true, report_step: body.report_step, next_page: null }, error: null }));
    await expect(syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: vi.fn() })).rejects.toThrow(/lista de tarefas vinculadas/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("pendência de OS e da sua tarefa são itens distintos no resumo", async () => {
    const osWarning = { os_id: "398336240", status: 400, message: "OS não conferida" };
    const taskWarning = { kind: "auvo_task" as const, task_id: taskIds[0], os_ids: ["398336240"], status: 404, message: "Tarefa não conferida" };
    expect(reportsSyncPendingSummary([osWarning, taskWarning])).toBe("1 OS pendentes de conferência; 1 tarefa Auvo não confirmada");
  });

  it.each([401, 403])("autenticação %s no lote interrompe os próximos IDs", async status => {
    const invoke = vi.fn(async (_name, { body }) => body.report_step === "os_tasks"
      ? { data: null, error: { context: Response.json({ error: "Autenticação recusada" }, { status }) } }
      : response(body));
    await expect(syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: vi.fn() })).rejects.toThrow(/Autenticação/);
    expect(invoke.mock.calls.filter(([, { body }]) => body.report_step === "os_tasks")).toHaveLength(1);
  });

  it("cancelamento durante a busca de tarefas encerra a fila sem marcar sucesso", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_tasks") controller.abort();
      return response(body);
    });
    const onProgress = vi.fn();
    await expect(syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress, signal: controller.signal })).rejects.toThrow();
    expect(invoke.mock.calls.filter(([, { body }]) => body.report_step === "os_tasks")).toHaveLength(1);
    expect(onProgress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });
});
