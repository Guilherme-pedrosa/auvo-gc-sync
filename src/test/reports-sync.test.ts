import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";
import { describeSyncError, syncReportsInSteps } from "../lib/reportsSync";
import { persistGcShells, persistReportTasks } from "../../supabase/functions/central-sync/report-persistence";
import { runBoundedReportStep } from "../../supabase/functions/central-sync/report-steps";

// jsdom 20 lacks the standard abort APIs supported by the browser and Deno.
beforeAll(() => {
  const native = transferableAbortController();
  vi.stubGlobal("AbortController", native.constructor);
  vi.stubGlobal("AbortSignal", native.signal.constructor);
});
afterAll(() => vi.unstubAllGlobals());

describe("Controle OS — sincronização em lotes", () => {
  it("percorre todas as páginas e separa OS, orçamentos e dias Auvo", async () => {
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_page") return { data: { success: true, report_step: body.report_step,
        os_ids: [String(body.report_page)], budget_codes: ["1", "2", "3", "4"],
        next_page: body.report_page === 1 ? 2 : null, upserted: 25 }, error: null };
      return { data: { success: true, report_step: body.report_step, transitioned: 1, next_after: null,
        auvo_tarefas: 30, upserted: 30 }, error: null };
    });
    const progress = vi.fn();
    const totals = await syncReportsInSteps(invoke, { situationIds: ["7063705"],
      days: [{ start: "2026-09-01", end: "2026-09-01" }, { start: "2026-09-02", end: "2026-09-02" }], onProgress: progress });
    const bodies = invoke.mock.calls.map(([, options]) => options.body);
    expect(bodies.map(body => body.report_step || "auvo")).toEqual(["os_page", "os_page", "os_reconcile", "budgets", "budgets", "auvo", "auvo"]);
    expect(bodies[2].known_os_ids).toEqual(["1", "2"]);
    expect(bodies[3].budget_codes).toHaveLength(3);
    expect(bodies[4].budget_codes).toEqual(["4"]);
    expect(bodies.slice(-2).every(body => body.reconcile_open_os === false && body.wait === true)).toBe(true);
    expect(totals).toEqual({ orders: 50, tasks: 60, saved: 60, transitioned: 1 });
    expect(progress.mock.lastCall).toEqual(["Todos os lotes foram concluídos e gravados.", 7]);
  });

  it("mostra a resposta real IDLE_TIMEOUT sem assumir sucesso ou repetir operações", async () => {
    const error = { message: "Edge Function returned a non-2xx status code", context: Response.json({
      code: "IDLE_TIMEOUT", message: "Request idle timeout limit (150s) reached",
    }, { status: 504 }) };
    const invoke = vi.fn(async () => ({ data: null, error }));
    await expect(syncReportsInSteps(invoke, { days: [], onProgress: vi.fn(), situationIds: ["7063705"] })).rejects.toThrow(/lote não teve conclusão confirmada/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await error.context.json()).toMatchObject({ code: "IDLE_TIMEOUT" });
  });

  it.each([
    { success: true, errors: 1 },
    { success: true, background: true },
    { success: false, error: "Gravação recusada" },
    { success: true, report_step: "serviço antigo" },
  ])("não confirma uma etapa incompleta: %j", async data => {
    const invoke = vi.fn(async () => ({ data, error: null }));
    const progress = vi.fn();
    await expect(syncReportsInSteps(invoke, { days: [], onProgress: progress, situationIds: ["7063705"] })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });

  it("não entra em loop quando o servidor repete a mesma página", async () => {
    const invoke = vi.fn(async () => ({ data: { success: true, report_step: "os_page", next_page: 1 }, error: null }));
    await expect(syncReportsInSteps(invoke, { days: [], onProgress: vi.fn(), situationIds: ["7063705"] })).rejects.toThrow(/Paginação/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("interrompe os próximos lotes ao sair da página", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      return { data: { success: true, report_step: "os_page" }, error: null };
    });
    await expect(syncReportsInSteps(invoke, { days: [], onProgress: vi.fn(), signal: controller.signal })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("extrai falhas JSON e trata gateway sem JSON", async () => {
    expect(await describeSyncError({ context: Response.json({ error: "Sessão expirada" }, { status: 401 }) })).toBe("Sessão expirada");
    expect(await describeSyncError({ context: new Response("indisponível", { status: 503 }) })).toContain("HTTP 503");
  });
});

function database(existing: any[] = [], writeError: any = null) {
  const writes: any[] = [];
  const inserts: any[] = [];
  return { writes, inserts, from: vi.fn(() => ({
    select: () => ({ in: async () => ({ data: existing, error: null }) }),
    update: (patch: any) => ({ eq: async (key: string, id: string) => { writes.push({ patch, key, id }); return { error: writeError }; } }),
    upsert: async (rows: any[], options: any) => { inserts.push({ rows, options }); return { error: writeError }; },
  })) };
}

describe("persistência do Controle OS", () => {
  it("atualiza só os campos GC e preserva um espelho Auvo vinculado a orçamento", async () => {
    const sb = database([{ gc_os_id: "77", mirror_key: "42::os:77::orc:88" }]);
    await persistGcShells(sb, [{ gc_os_id: "77", gc_os_codigo: "1000", mirror_key: "42::os:77::orc:",
      tecnico: "", data_tarefa: "2000-01-01", status_auvo: "Pendente vínculo Auvo", questionario_respostas: [],
      check_in: false, duracao_decimal: 0, gc_os_situacao: "Em execução", atualizado_em: "now" }]);
    expect(sb.inserts).toHaveLength(0);
    expect(sb.writes).toEqual([{ key: "gc_os_id", id: "77", patch: {
      gc_os_id: "77", gc_os_codigo: "1000", gc_os_situacao: "Em execução", atualizado_em: "now",
    } }]);
  });

  it("insere OS novas sem sobrescrever uma inserção concorrente e limita os lotes", async () => {
    const sb = database();
    const rows = Array.from({ length: 12 }, (_, i) => ({ gc_os_id: String(i), mirror_key: String(i) }));
    expect(await persistGcShells(sb, rows)).toBe(12);
    expect(sb.inserts.map(batch => batch.rows.length)).toEqual([5, 5, 2]);
    expect(sb.inserts.every(batch => batch.options.ignoreDuplicates === true)).toBe(true);
  });

  it("limita tarefas a cinco por transação e não ignora erro de gravação", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ mirror_key: String(i) }));
    const sb = database();
    expect(await persistReportTasks(sb, rows)).toBe(12);
    expect(sb.inserts.map(batch => batch.rows.length)).toEqual([5, 5, 2]);
    const failing = database([], { message: "canceling statement due to statement timeout" });
    await expect(persistReportTasks(failing, rows)).rejects.toThrow(/statement timeout/);
    expect(failing.inserts).toHaveLength(1);
  });
});

const dependencies = () => ({ fetchOs: vi.fn(async () => ({ byCodigo: { "1000": { gc_os_id: "77", gc_os_orcamento_codigo: "123" } }, nextPage: 2 })),
  saveOs: vi.fn(async () => 1), backlink: vi.fn(async () => ({})), fetchBudgets: vi.fn(async () => ({})),
  getOs: vi.fn(async (id = "77") => Response.json({ data: { id } })), mapOs: vi.fn(os => os), mirrorPatch: vi.fn(os => os) });

describe("etapas reais do backend", () => {
  it("confere no máximo cinco OS ausentes e avança sem repetir as já verificadas", async () => {
    const deps = dependencies();
    const updated: string[] = [];
    const rows = Array.from({ length: 8 }, (_, i) => ({ gc_os_id: String(i + 1) }));
    const query: any = { in: () => query, not: () => query, order: () => query,
      range: async () => ({ data: rows, error: null }) };
    const sb = { from: () => ({ select: () => query, update: () => ({ eq: async (_key: string, id: string) => {
      updated.push(id); return { error: null };
    } }) }) };
    const body = { report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: ["1", "2"] };
    const first = await runBoundedReportStep(sb, {}, body, deps);
    expect(first).toMatchObject({ next_after: "7", transitioned: 5 });
    expect(updated).toEqual(["3", "4", "5", "6", "7"]);
    const last = await runBoundedReportStep(sb, {}, { ...body, after_os_id: first.next_after }, deps);
    expect(last).toMatchObject({ next_after: null, transitioned: 1 });
    expect(updated).toEqual(["3", "4", "5", "6", "7", "8"]);
  });

  it("uma página de OS não consulta orçamentos nem importa Auvo", async () => {
    const deps = dependencies();
    const result = await runBoundedReportStep({}, {}, { report_step: "os_page", situacao_ids: ["7063705"], report_page: 1 }, deps);
    expect(deps.fetchOs).toHaveBeenCalledWith({}, { situacaoIds: ["7063705"], reportPage: 1 });
    expect(deps.fetchBudgets).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, next_page: 2, os_ids: ["77"], budget_codes: ["123"] });
  });

  it("não retorna sucesso se falhar a gravação de OS", async () => {
    const deps = dependencies(); deps.saveOs.mockRejectedValue(new Error("statement timeout"));
    await expect(runBoundedReportStep({}, {}, { report_step: "os_page", situacao_ids: ["7063705"] }, deps)).rejects.toThrow("statement timeout");
  });

  it("recusa mais de três orçamentos no mesmo lote", async () => {
    const deps = dependencies();
    await expect(runBoundedReportStep({}, {}, { report_step: "budgets", budget_codes: [1, 2, 3, 4] }, deps)).rejects.toThrow(/três/);
    expect(deps.fetchBudgets).not.toHaveBeenCalled();
  });

  it("preserva a OS quando a consulta individual retorna 400 ou identidade inválida", async () => {
    for (const response of [new Response("erro", { status: 400 }), Response.json({ data: {} })]) {
      const deps = dependencies(); deps.getOs.mockResolvedValue(response);
      const update = vi.fn();
      const query: any = { in: () => query, not: () => query, order: () => query,
        range: async () => ({ data: [{ gc_os_id: "77" }], error: null }) };
      const sb = { from: () => ({ select: () => query, update }) };
      await expect(runBoundedReportStep(sb, {}, { report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: [] }, deps)).rejects.toThrow(/preservado/i);
      expect(update).not.toHaveBeenCalled();
    }
  });
});
