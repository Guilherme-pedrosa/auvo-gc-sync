import { describe, expect, it, vi } from "vitest";
import { runBoundedReportStep } from "../../supabase/functions/central-sync/report-steps";

const dependencies = () => ({
  fetchOs: vi.fn(async () => ({ byCodigo: {} as Record<string, any>, nextPage: null })),
  saveOs: vi.fn(async () => 1),
  backlink: vi.fn(async () => ({})),
  fetchBudgets: vi.fn(async () => ({})),
  getOs: vi.fn(async (id: string) => Response.json({ data: { id } })),
  mapOs: vi.fn((os: any) => os),
  mirrorPatch: vi.fn((os: any) => os),
  syncOsTasks: vi.fn(async (_ids: string[]) => ({ auvo_tarefas: 1, upserted: 1 })),
});

function database(orderIds: string[]) {
  const query: any = {
    in: () => query, not: () => query, order: () => query,
    range: async () => ({ data: orderIds.map(gc_os_id => ({ gc_os_id })), error: null }),
  };
  const update = vi.fn((_patch: any) => ({ eq: vi.fn(async () => ({ error: null })) }));
  return { update, from: () => ({ select: () => query, update }) };
}

describe("Controle OS — tarefas derivadas das OS do GestãoClick", () => {
  it("prioriza todas as execuções antes do diagnóstico, deduplicando apenas a busca Auvo", async () => {
    const deps = dependencies();
    const first = { gc_os_id: "77", gc_os_tarefa_os: "11/12", gc_os_tarefa_exec: "21;22 21" };
    const second = { gc_os_id: "88", gc_os_tarefa_os: "11,13", gc_os_tarefa_exec: "22/23" };
    deps.fetchOs.mockResolvedValue({ byCodigo: { "1000": first, "1001": second }, nextPage: null });
    const result = await runBoundedReportStep({}, {}, {
      report_step: "os_page", situacao_ids: ["7063705"], report_page: 1,
    }, deps);
    expect(result).toMatchObject({ os_ids: ["77", "88"], auvo_task_ids: ["21", "22", "23", "11", "12", "13"] });
    expect(first.gc_os_tarefa_os).toBe("11/12");
    expect(second.gc_os_tarefa_os).toBe("11,13");
    expect(deps.syncOsTasks).not.toHaveBeenCalled();
    expect(deps.fetchBudgets).not.toHaveBeenCalled();
  });

  it("OS sem vínculo continua sendo salva e retorna uma lista vazia de tarefas", async () => {
    const deps = dependencies();
    deps.fetchOs.mockResolvedValue({ byCodigo: {
      "1000": { gc_os_id: "77", gc_os_tarefa_os: "0/sem tarefa", gc_os_tarefa_exec: null },
    }, nextPage: null });
    const result = await runBoundedReportStep({}, {}, {
      report_step: "os_page", situacao_ids: ["7063705"],
    }, deps);
    expect(result.auvo_task_ids).toEqual([]);
    expect(deps.saveOs).toHaveBeenCalledOnce();
    expect(deps.syncOsTasks).not.toHaveBeenCalled();
  });

  it("inclui tarefas frescas de uma OS que mudou de situação e preserva a OS não confirmada", async () => {
    const deps = dependencies();
    deps.getOs.mockImplementation(async id => id === "88"
      ? Response.json({ error: "indisponível" }, { status: 400 })
      : Response.json({ data: { id, gc_os_situacao: "EXECUTADO", gc_os_tarefa_os: "11/12", gc_os_tarefa_exec: "21/22/11" } }));
    const sb = database(["77", "88"]);
    const result = await runBoundedReportStep(sb, {}, {
      report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: [],
    }, deps);
    expect(result).toMatchObject({ checked: 2, transitioned: 1, incomplete: true,
      auvo_task_ids: ["21", "22", "11", "12"], warnings: [{ os_id: "88", status: 400 }] });
    expect(sb.update).toHaveBeenCalledOnce();
    expect(sb.update.mock.calls[0][0].gc_os_situacao).toBe("EXECUTADO");
    expect(deps.syncOsTasks).not.toHaveBeenCalled();
  });

  it("uma OS confirmada sem IDs não inventa tarefa na conferência", async () => {
    const result = await runBoundedReportStep(database(["77"]), {}, {
      report_step: "os_reconcile", situacao_ids: ["7063705"], known_os_ids: [],
    }, dependencies());
    expect(result).toMatchObject({ transitioned: 1, auvo_task_ids: [], incomplete: false });
  });

  it("o lote Auvo usa só os IDs explícitos e não consulta calendário, OS ou orçamentos", async () => {
    const deps = dependencies();
    const result = await runBoundedReportStep({}, {}, {
      report_step: "os_tasks", task_ids: [11, "12", "11", " 12 "],
      start_date: "2026-07-01", end_date: "2026-07-31",
    }, deps);
    expect(deps.syncOsTasks).toHaveBeenCalledExactlyOnceWith(["11", "12"]);
    expect(result).toEqual({ success: true, report_step: "os_tasks", auvo_tarefas: 1, upserted: 1,
      incomplete: false, warnings: [] });
    expect(deps.fetchOs).not.toHaveBeenCalled();
    expect(deps.fetchBudgets).not.toHaveBeenCalled();
    expect(deps.backlink).not.toHaveBeenCalled();
  });

  it.each([undefined, [], ["0"], ["11", "inválido"], ["-11"], ["1.5"], ["1", "2", "3", "4", "5", "6"]])(
    "rejeita lote inválido antes de chamar Auvo: %j", async task_ids => {
      const deps = dependencies();
      await expect(runBoundedReportStep({}, {}, { report_step: "os_tasks", task_ids }, deps))
        .rejects.toThrow(/uma a cinco tarefas Auvo válidas/);
      expect(deps.syncOsTasks).not.toHaveBeenCalled();
    },
  );

  it("aceita cinco IDs únicos e repassa pendências individuais sem anunciar conclusão completa", async () => {
    const deps = dependencies();
    const warning = { kind: "auvo_task" as const, task_id: "5", status: 404, message: "Tarefa não confirmada. Registro preservado." };
    deps.syncOsTasks.mockResolvedValue({ auvo_tarefas: 4, upserted: 4, warnings: [warning] } as any);
    const result = await runBoundedReportStep({}, {}, {
      report_step: "os_tasks", task_ids: ["1", "2", "3", "4", "5"],
    }, deps);
    expect(deps.syncOsTasks).toHaveBeenCalledExactlyOnceWith(["1", "2", "3", "4", "5"]);
    expect(result).toEqual({ success: true, report_step: "os_tasks", auvo_tarefas: 4, upserted: 4,
      incomplete: true, warnings: [warning] });
  });

  it("não converte falha de gravação em sucesso parcial", async () => {
    const deps = dependencies();
    deps.syncOsTasks.mockRejectedValue(new Error("Falha ao salvar tarefa: statement timeout"));
    await expect(runBoundedReportStep({}, {}, { report_step: "os_tasks", task_ids: ["11"] }, deps))
      .rejects.toThrow(/statement timeout/);
  });

  it("recusa a nova etapa quando o backend ainda não configurou a sincronização individual", async () => {
    const { syncOsTasks: _unused, ...deps } = dependencies();
    await expect(runBoundedReportStep({}, {}, { report_step: "os_tasks", task_ids: ["11"] }, deps))
      .rejects.toThrow(/Sincronização das tarefas vinculadas às OS indisponível/);
  });
});
