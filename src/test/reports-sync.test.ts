import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";
import { describeSyncError, syncReportsInSteps, syncWorkedHoursInSteps } from "../lib/reportsSync";
import { assertCompleteAuvoReport, persistGcShells, persistReportTasks } from "../../supabase/functions/central-sync/report-persistence";
import { runBoundedReportStep } from "../../supabase/functions/central-sync/report-steps";

// jsdom 20 lacks the standard abort APIs supported by the browser and Deno.
beforeAll(() => {
  const native = transferableAbortController();
  vi.stubGlobal("AbortController", native.constructor);
  vi.stubGlobal("AbortSignal", native.signal.constructor);
});
afterAll(() => vi.unstubAllGlobals());

describe("Controle OS — sincronização em lotes", () => {
  it("percorre páginas de OS, orçamentos e tarefas vinculadas sem datas", async () => {
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_page") return { data: { success: true, report_step: body.report_step,
        os_ids: [String(body.report_page)], budget_codes: ["1", "2", "3", "4"], auvo_task_ids: ["11", "12", "13", "14", "15", "16", "17"],
        next_page: body.report_page === 1 ? 2 : null, upserted: 25 }, error: null };
      return { data: { success: true, report_step: body.report_step, transitioned: 1, next_after: null, auvo_task_ids: [],
        auvo_tarefas: body.task_ids?.length || 0, upserted: body.task_ids?.length || 0 }, error: null };
    });
    const progress = vi.fn();
    const totals = await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: progress });
    const bodies = invoke.mock.calls.map(([, options]) => options.body);
    expect(bodies.map(body => body.report_step)).toEqual(["os_page", "os_page", "os_reconcile", "os_tasks", "os_tasks", "budgets", "budgets"]);
    expect(bodies[2].known_os_ids).toEqual(["1", "2"]);
    expect(bodies[5].budget_codes).toHaveLength(3);
    expect(bodies[6].budget_codes).toEqual(["4"]);
    expect(bodies.slice(3, 5).map(body => body.task_ids.length)).toEqual([5, 2]);
    expect(bodies.every(body => body.wait === true && !body.start_date && !body.end_date && !body.reports_only)).toBe(true);
    expect(totals).toEqual({ orders: 50, tasks: 7, saved: 7, transitioned: 1, incomplete: false, warnings: [] });
    expect(progress.mock.lastCall).toEqual(["Todos os lotes foram concluídos e gravados.", 7]);
  });

  it("mostra a resposta real IDLE_TIMEOUT sem assumir sucesso ou repetir operações", async () => {
    const error = { message: "Edge Function returned a non-2xx status code", context: Response.json({
      code: "IDLE_TIMEOUT", message: "Request idle timeout limit (150s) reached",
    }, { status: 504 }) };
    const invoke = vi.fn(async () => ({ data: null, error }));
    await expect(syncReportsInSteps(invoke, { onProgress: vi.fn(), situationIds: ["7063705"] })).rejects.toThrow(/lote não teve conclusão confirmada/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await error.context.json()).toMatchObject({ code: "IDLE_TIMEOUT" });
  });

  it("continua orçamentos e Auvo após uma OS sem permissão e informa a pendência ao final", async () => {
    const warning = { os_id: "389831437", status: 400,
      message: "OS 389831437: HTTP 400 — Você não possui permissão para acessar este pedido!. Registro preservado." };
    const invoke = vi.fn(async (_name, { body }) => {
      if (body.report_step === "os_page") return { data: { success: true, report_step: "os_page",
        os_ids: ["77"], budget_codes: ["6686"], auvo_task_ids: ["123456"], upserted: 1, next_page: null }, error: null };
      if (body.report_step === "os_reconcile") return { data: { success: true, report_step: "os_reconcile",
        transitioned: 2, incomplete: true, warnings: [warning], auvo_task_ids: [], next_after: body.after_os_id ? null : "389831437" }, error: null };
      return { data: { success: true, report_step: body.report_step, auvo_tarefas: 12, upserted: 12 }, error: null };
    });
    const progress = vi.fn();
    const onWarnings = vi.fn();
    const totals = await syncReportsInSteps(invoke, { situationIds: ["7063705"], onProgress: progress, onWarnings });
    expect(invoke.mock.calls.map(([, { body }]) => body.report_step || "auvo"))
      .toEqual(["os_page", "os_reconcile", "os_reconcile", "os_tasks", "budgets"]);
    expect(totals).toEqual({ orders: 1, tasks: 12, saved: 12, transitioned: 4, incomplete: true, warnings: [warning] });
    expect(onWarnings).toHaveBeenLastCalledWith([warning]);
    expect(progress.mock.lastCall).toEqual(["Lotes processados; 1 OS ficaram pendentes de conferência. Registros preservados.", 5]);
    expect(progress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });

  it.each([
    { success: true, errors: 1 },
    { success: true, background: true },
    { success: false, error: "Gravação recusada" },
    { success: true, report_step: "serviço antigo" },
    { success: true, report_step: "os_page", incomplete: true },
  ])("não confirma uma etapa incompleta: %j", async data => {
    const invoke = vi.fn(async () => ({ data, error: null }));
    const progress = vi.fn();
    await expect(syncReportsInSteps(invoke, { onProgress: progress, situationIds: ["7063705"] })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });

  it("não entra em loop quando o servidor repete a mesma página", async () => {
    const invoke = vi.fn(async () => ({ data: { success: true, report_step: "os_page", next_page: 1, auvo_task_ids: [] }, error: null }));
    await expect(syncReportsInSteps(invoke, { onProgress: vi.fn(), situationIds: ["7063705"] })).rejects.toThrow(/Paginação/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("interrompe os próximos lotes ao sair da página", async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      return { data: { success: true, report_step: "os_page" }, error: null };
    });
    await expect(syncReportsInSteps(invoke, { onProgress: vi.fn(), signal: controller.signal })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("extrai falhas JSON e trata gateway sem JSON", async () => {
    expect(await describeSyncError({ context: Response.json({ error: "Sessão expirada" }, { status: 401 }) })).toBe("Sessão expirada");
    expect(await describeSyncError({ context: new Response("indisponível", { status: 503 }) })).toContain("HTTP 503");
  });

  it("avança os demais dias sem anunciar sucesso completo após consulta Auvo incompleta", async () => {
    const invoke = vi.fn(async (_name, { body }) => ({ data: body.reports_only
      ? { success: true, auvo_tarefas: 0, upserted: 0, errors: 0, auvo_paginacao_completa: false }
      : { success: true, report_step: body.report_step, next_page: null, next_after: null }, error: null }));
    const progress = vi.fn();
    const totals = await syncWorkedHoursInSteps(invoke, { onProgress: progress,
      days: [{ start: "2026-09-06", end: "2026-09-06" }, { start: "2026-09-07", end: "2026-09-07" }] });
    expect(totals).toMatchObject({ incomplete: true, tasks: 0, saved: 0 });
    expect(totals.warnings).toEqual([
      expect.objectContaining({ kind: "auvo_day", start_date: "2026-09-06", message: expect.stringContaining("Auvo não confirmou") }),
      expect.objectContaining({ kind: "auvo_day", start_date: "2026-09-07", message: expect.stringContaining("Auvo não confirmou") }),
    ]);
    expect(invoke.mock.calls.filter(([, { body }]) => body.reports_only)).toHaveLength(2);
    expect(progress).not.toHaveBeenCalledWith("Todos os lotes foram concluídos e gravados.", expect.anything());
  });
});

function database(existing: any[] = [], writeError: any = null) {
  const writes: any[] = [];
  const inserts: any[] = [];
  return { writes, inserts, from: vi.fn(() => ({
    select: () => ({ in: async () => ({ data: existing, error: null }) }),
    update: (patch: any) => ({
      eq: async (key: string, id: string) => { writes.push({ patch, key, id }); return { error: writeError }; },
      like: async (key: string, pattern: string) => { writes.push({ patch, key, pattern }); return { error: writeError }; },
    }),
    upsert: async (rows: any[], options: any) => { inserts.push({ rows, options }); return { error: writeError }; },
  })) };
}

describe("persistência do Controle OS", () => {
  it("recusa a resposta real de falha 500 do Auvo antes de gravar ou conferir exclusões", () => {
    expect(() => assertCompleteAuvoReport({ complete: false, windows: [{ error: "página 1 respondeu 500" }] }, "2026-09-06", "2026-09-06"))
      .toThrow("Auvo não confirmou as tarefas de 2026-09-06 a 2026-09-06: página 1 respondeu 500. Os registros existentes foram preservados.");
    expect(() => assertCompleteAuvoReport({ complete: true }, "2026-09-05", "2026-09-05")).not.toThrow();
  });
  it("atualiza só os campos GC e preserva um espelho Auvo vinculado a orçamento", async () => {
    const sb = database([{ gc_os_id: "77", mirror_key: "42::os:77::orc:88" }]);
    await persistGcShells(sb, [{ gc_os_id: "77", gc_os_codigo: "1000", mirror_key: "42::os:77::orc:",
      tecnico: "", data_tarefa: "2000-01-01", status_auvo: "Pendente vínculo Auvo", questionario_respostas: [],
      check_in: false, duracao_decimal: 0, gc_os_situacao: "Em execução", atualizado_em: "now" }]);
    expect(sb.inserts).toHaveLength(0);
    expect(sb.writes).toEqual([{ key: "mirror_key", pattern: "%::os:77::orc:%", patch: {
      gc_os_id: "77", gc_os_codigo: "1000", gc_os_situacao: "Em execução", atualizado_em: "now",
    } }, { key: "gc_os_id", id: "77", patch: {
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

  it("restaura a OS 10222 sem copiar o diagnóstico finalizado da 9042 para sua execução", async () => {
    const rows = [
      { mirror_key: "70949049::os:397842014::orc:", gc_os_id: "355449840", gc_os_codigo: "9042",
        auvo_task_id: "70949049", status_auvo: "Finalizada", data_tarefa: "2026-03-24", tecnico: "Diagnóstico", gc_orcamento_codigo: "5332" },
      { mirror_key: "70949049::os:355449840::orc:", gc_os_id: "355449840", gc_os_codigo: "9042",
        auvo_task_id: "70949049", status_auvo: "Finalizada", data_tarefa: "2026-03-24", tecnico: "Diagnóstico" },
    ];
    const original9042 = { ...rows[1] };
    const sb = { from: () => ({
      select: () => ({ in: async (_key: string, ids: string[]) => ({ data: rows.filter(row => ids.includes(row.gc_os_id)), error: null }) }),
      upsert: async (batch: any[]) => {
        for (const row of batch) if (!rows.some(existing => existing.mirror_key === row.mirror_key)) rows.push({ ...row });
        return { error: null };
      },
      update: (patch: any) => ({
        like: async (_key: string, pattern: string) => {
          for (const row of rows) if (row.mirror_key.includes(pattern.slice(1, -1))) Object.assign(row, patch);
          return { error: null };
        },
        eq: async (key: string, id: string) => {
          for (const row of rows) if (row[key] === id) Object.assign(row, patch);
          return { error: null };
        },
      }),
    }) };
    const fresh = { mirror_key: "79667772::os:397842014::orc:", gc_os_id: "397842014", gc_os_codigo: "10222",
      gc_os_tarefa_os: "70949049", gc_os_tarefa_exec: "79667772", gc_os_situacao: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO",
      auvo_task_id: "79667772", status_auvo: "Pendente vínculo Auvo", data_tarefa: null, tecnico: "", atualizado_em: "now" };
    expect(await persistGcShells(sb, [fresh])).toBe(1);
    expect(rows[0]).toMatchObject({ gc_os_id: "397842014", gc_os_codigo: "10222", auvo_task_id: "70949049",
      status_auvo: "Finalizada", data_tarefa: "2026-03-24", tecnico: "Diagnóstico", gc_orcamento_codigo: "5332" });
    expect(rows[1]).toEqual(original9042);
    expect(rows[2]).toMatchObject(fresh);
    // A repeated refresh preserves the execution's independently hydrated data.
    Object.assign(rows[2], { status_auvo: "Aberta", data_tarefa: null, tecnico: "", check_out: false });
    await persistGcShells(sb, [fresh]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ status_auvo: "Aberta", data_tarefa: null, tecnico: "", check_out: false });
    expect(rows[1]).toEqual(original9042);
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

  it("preserva a OS e sinaliza pendência quando a consulta retorna 400 ou identidade inválida", async () => {
    for (const response of [new Response("erro", { status: 400 }), Response.json({ data: {} })]) {
      const deps = dependencies(); deps.getOs.mockResolvedValue(response);
      const update = vi.fn();
      const query: any = { in: () => query, not: () => query, order: () => query,
        range: async () => ({ data: [{ gc_os_id: "77" }], error: null }) };
      const sb = { from: () => ({ select: () => query, update }) };
      const result = await runBoundedReportStep(sb, {}, { report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: [] }, deps);
      expect(result).toMatchObject({ success: true, incomplete: true, transitioned: 0, checked: 1, next_after: null,
        warnings: [{ os_id: "77", message: expect.stringMatching(/preservado/i) }] });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("não deixa a OS 389831437 bloquear as demais OS nem repetir a mesma página", async () => {
    const deps = dependencies();
    const blockedId = "389831437";
    const rows = Array.from({ length: 6 }, (_, index) => ({ gc_os_id: String(Number(blockedId) + index) }));
    deps.getOs.mockImplementation(async id => id === blockedId ? Response.json({ code: 400, status: "error",
      data: { erro: "Bad Request", mensagem: "Você não possui permissão para acessar este pedido!" } }, { status: 400 })
      : Response.json({ data: { id, nome_situacao: "EXECUTADO" } }));
    const writes: any[] = [];
    const query: any = { in: () => query, not: () => query, order: () => query,
      range: async () => ({ data: rows, error: null }) };
    const sb = { from: () => ({ select: () => query, update: patch => ({ eq: async (_key: string, id: string) => {
      writes.push({ id, patch }); return { error: null };
    } }) }) };
    const body = { report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: [] };
    const first = await runBoundedReportStep(sb, {}, body, deps);
    expect(first).toMatchObject({ transitioned: 4, checked: 5, incomplete: true, next_after: "389831441",
      warnings: [{ os_id: blockedId, status: 400, message: expect.stringContaining("não possui permissão") }] });
    const second = await runBoundedReportStep(sb, {}, { ...body, after_os_id: first.next_after }, deps);
    expect(second).toMatchObject({ transitioned: 1, checked: 1, incomplete: false, warnings: [], next_after: null });
    expect(writes.map(write => write.id)).toEqual(rows.slice(1).map(row => row.gc_os_id));
    expect(deps.getOs.mock.calls.filter(([id]) => id === blockedId)).toHaveLength(1);
  });

  it("uma falha de gravação continua interrompendo o lote em vez de virar aviso", async () => {
    const deps = dependencies();
    const query: any = { in: () => query, not: () => query, order: () => query,
      range: async () => ({ data: [{ gc_os_id: "77" }], error: null }) };
    const sb = { from: () => ({ select: () => query,
      update: () => ({ eq: async () => ({ error: { message: "statement timeout" } }) }) }) };
    await expect(runBoundedReportStep(sb, {}, { report_step: "os_reconcile", situacao_ids: ["7063705"] }, deps))
      .rejects.toThrow("Falha ao atualizar situação da OS 77: statement timeout");
  });
});
