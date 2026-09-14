import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";
import { reportsSyncPendingSummary, syncWorkedHoursInSteps } from "../lib/reportsSync";

beforeAll(() => {
  const native = transferableAbortController();
  vi.stubGlobal("AbortController", native.constructor);
  vi.stubGlobal("AbortSignal", native.signal.constructor);
});
afterAll(() => vi.unstubAllGlobals());

const days = Array.from({ length: 7 }, (_, index) => {
  const date = `2026-07-${String(index + 1).padStart(2, "0")}`;
  return { start: date, end: date };
});
const success = (body: any) => ({ data: { success: true, report_step: body.report_step,
  next_page: null, next_after: null, os_ids: ["77"], budget_codes: [],
  auvo_tarefas: 2, upserted: body.reports_only ? 2 : 1, auvo_paginacao_completa: true }, error: null });

describe("continuidade por dia das Horas Trabalhadas", () => {
  it("segue após o 404 do quarto dia, mantém pendência e soma somente seis dias confirmados", async () => {
    let active = 0;
    let maximumConcurrent = 0;
    const invoke = vi.fn(async (_name, { body }) => {
      active++;
      maximumConcurrent = Math.max(maximumConcurrent, active);
      await Promise.resolve();
      active--;
      return body.start_date === "2026-07-04" ? { data: {
        success: false, auvo_error: "primeira página respondeu 404 após 3 tentativas", upserted: 999, auvo_tarefas: 999,
      }, error: null } : success(body);
    });
    const onProgress = vi.fn();
    const onWarnings = vi.fn();
    const onSaved = vi.fn();
    const result = await syncWorkedHoursInSteps(invoke, { days, onProgress, onWarnings, onSaved });
    expect(invoke.mock.calls.filter(([, { body }]) => body.reports_only).map(([, { body }]) => body.start_date))
      .toEqual(days.map(day => day.start));
    expect(maximumConcurrent).toBe(1);
    expect(result).toMatchObject({ tasks: 12, saved: 12, orders: 0, incomplete: true });
    expect(result.warnings).toEqual([expect.objectContaining({
      kind: "auvo_day", start_date: "2026-07-04", end_date: "2026-07-04",
      message: expect.stringContaining("404 após 3 tentativas"),
    })]);
    expect(onWarnings).toHaveBeenLastCalledWith(result.warnings);
    expect(onSaved).toHaveBeenCalledTimes(6);
    expect(onProgress.mock.lastCall).toEqual([expect.stringMatching(/Sincronização parcial: 1 dia Auvo não confirmado/), 6]);
    expect(onProgress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });

  it("horas não executa etapas GC e o resumo distingue pendências de OS e dias", async () => {
    const osWarning = { os_id: "389831437", status: 400, message: "OS sem permissão; registro preservado" };
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_reconcile") return { data: { success: true, report_step: "os_reconcile", next_after: null,
        incomplete: true, warnings: [osWarning] }, error: null };
      if (body.start_date === "2026-07-04") throw new Error("Failed to fetch");
      return success(body);
    });
    const onWarnings = vi.fn();
    const result = await syncWorkedHoursInSteps(invoke, { days, onProgress: vi.fn(), onWarnings });
    expect(result.warnings[0]).toMatchObject({ kind: "auvo_day", start_date: "2026-07-04" });
    expect(invoke.mock.calls.every(([, { body }]) => body.reports_only === true && !body.report_step)).toBe(true);
    expect(onWarnings.mock.calls.map(([warnings]) => warnings.length)).toEqual([1]);
    expect(reportsSyncPendingSummary([osWarning, ...result.warnings])).toBe("1 OS pendentes de conferência; 1 dia Auvo não confirmado");
  });

  it("mantém a causa JSON do timeout do dia sem encerrar os próximos dias", async () => {
    const invoke = vi.fn(async (_name, { body }) => body.start_date === "2026-07-04"
      ? { data: null, error: { context: Response.json({ code: "IDLE_TIMEOUT" }, { status: 504 }) } }
      : success(body));
    const result = await syncWorkedHoursInSteps(invoke, { days, onProgress: vi.fn() });
    expect(result.warnings[0].message).toContain("lote não teve conclusão confirmada");
    expect(result.saved).toBe(12);
    expect(invoke.mock.lastCall?.[1].body.start_date).toBe("2026-07-07");
  });

  it("todos os dias incompletos terminam como resultado parcial e zero tarefas confirmadas", async () => {
    const invoke = vi.fn(async (_name, { body }) => body.reports_only
      ? { data: { success: true, auvo_paginacao_completa: false, auvo_tarefas: 999, upserted: 999 }, error: null }
      : success(body));
    const onProgress = vi.fn();
    const result = await syncWorkedHoursInSteps(invoke, { days, onProgress });
    expect(result).toMatchObject({ tasks: 0, saved: 0, incomplete: true });
    expect(result.warnings).toHaveLength(7);
    expect(onProgress.mock.lastCall).toEqual([expect.stringContaining("7 dias Auvo não confirmados"), 0]);
  });

  it("cancelamento durante um dia com falha interrompe a fila em vez de virar pendência", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.start_date === "2026-07-04") {
        controller.abort();
        throw new Error("rede interrompida");
      }
      return success(body);
    });
    const onWarnings = vi.fn();
    await expect(syncWorkedHoursInSteps(invoke, { days, onProgress: vi.fn(), onWarnings,
      signal: controller.signal })).rejects.toThrow();
    expect(invoke.mock.lastCall?.[1].body.start_date).toBe("2026-07-04");
    expect(onWarnings).not.toHaveBeenCalled();
  });

  it("AbortError explícito do provedor também encerra os próximos dias", async () => {
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.start_date === "2026-07-04") throw new DOMException("Cancelado", "AbortError");
      return success(body);
    });
    await expect(syncWorkedHoursInSteps(invoke, { days, onProgress: vi.fn() })).rejects.toThrow("Cancelado");
    expect(invoke.mock.lastCall?.[1].body.start_date).toBe("2026-07-04");
  });

  it.each([
    { data: null, error: { context: Response.json({ error: "Sessão expirada" }, { status: 401 }) } },
    { data: null, error: { context: Response.json({ error: "Sem acesso" }, { status: 403 }) } },
    { data: { success: false, auvo_error: "Invalid JWT" }, error: null },
    { data: { success: false, auvo_error: "Auvo respondeu HTTP 403" }, error: null },
    { data: { success: false, error: "página 1 respondeu 403" }, error: null },
    { data: { success: false, error: "Auvo login failed (401)" }, error: null },
  ])("falha global de autenticação interrompe a fila de dias: %j", async (response) => {
    const invoke = vi.fn(async (_name, { body }) => body.start_date === "2026-07-04" ? response : success(body));
    const onWarnings = vi.fn();
    await expect(syncWorkedHoursInSteps(invoke, { days, onProgress: vi.fn(), onWarnings })).rejects.toThrow();
    expect(invoke.mock.lastCall?.[1].body.start_date).toBe("2026-07-04");
    expect(onWarnings).not.toHaveBeenCalled();
  });
});
