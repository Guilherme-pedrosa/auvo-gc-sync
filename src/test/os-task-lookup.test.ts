import { describe, expect, it } from "vitest";
import { buildAuvoTaskLookup, buildOsDiagnosticLookup, buildOsExecutionLookup, extractLiveTaskResolution, parseGcAuvoTaskIds, resolveOsExecution } from "../components/relatorios/osTaskLookup";

describe("Controle OS — diagnóstico e execução no espelho", () => {
  it.each([null, "0001-01-01T00:00:00"])("execução live confirma técnico 0 e data %j sem herdar campos antigos", taskDate => {
    const confirmed = extractLiveTaskResolution({ data: { taskID: 79667772, idUserTo: 0,
      userToName: "Técnico antigo", userTo: { userID: 17, name: "Outro técnico antigo" },
      taskDate, date: "2026-09-15", taskStatus: 1 } }, "79667772");
    expect(confirmed).toEqual({ taskId: "79667772", tecnico: "", tecnicoId: "", dataTarefa: "", status: "Aberta" });
    const old = { auvo_task_id: "79667772", tecnico: "Anterior", data_tarefa: "2026-09-15", status_auvo: "Finalizada" };
    expect(resolveOsExecution({ gc_os_tarefa_exec: "79667772" }, [old], {
      execTaskId: "79667772", resolvedTaskId: confirmed!.taskId, tecnico: confirmed!.tecnico,
      dataTarefa: confirmed!.dataTarefa, status: confirmed!.status,
    })).toEqual({ auvo_task_id: "79667772", tecnico: "", data_tarefa: null, status_auvo: "Aberta" });
  });

  it.each([70949049, undefined])("ignora resposta live de diagnóstico ou sem identidade: %j", taskID => {
    expect(extractLiveTaskResolution({ data: { taskID, taskStatus: 4, idUserTo: 17, taskDate: "2026-06-01" } }, "79667772")).toBeNull();
  });

  it("não aplica um cache live que corresponde a outra execução ou diagnóstico", () => {
    const execution = { auvo_task_id: "79667772", tecnico: "", data_tarefa: null, status_auvo: "Aberta" };
    expect(resolveOsExecution({ gc_os_tarefa_exec: "79667772" }, [execution], {
      execTaskId: "70949049", resolvedTaskId: "70949049", tecnico: "Diagnóstico", dataTarefa: "2026-06-01", status: "Finalizada",
    })).toBe(execution);
  });

  it("OS 10222 usa 79667772 para execução e não herda técnico, data ou conclusão de70949049", () => {
    const order = { gc_os_id: "397842014", gc_os_tarefa_os: "70949049", gc_os_tarefa_exec: "79667772" };
    const diagnosis = { auvo_task_id: "70949049", gc_os_id: "397842014", tecnico: "Diagnóstico",
      data_tarefa: "2026-06-01", status_auvo: "Finalizada" };
    const execution = { auvo_task_id: "79667772", gc_os_id: null, tecnico: "", data_tarefa: null, status_auvo: "Aberta" };
    expect(buildOsExecutionLookup([order], [diagnosis, execution]).get(order.gc_os_id)).toEqual([execution]);
    expect(buildOsDiagnosticLookup([order], [diagnosis, execution]).get(order.gc_os_id)).toBe(diagnosis);
    expect(execution.gc_os_id).toBeNull();
  });

  it.each([undefined, null, "", "0"])("sem73344 explícito não apresenta diagnóstico como execução: %j", gc_os_tarefa_exec => {
    const order = { gc_os_id: "77", gc_os_tarefa_os: "11", gc_os_tarefa_exec, auvo_task_id: "11" };
    const diagnosis = { auvo_task_id: "11", gc_os_id: "77", tecnico: "Diagnóstico", data_tarefa: "2026-09-15", status_auvo: "Em andamento" };
    expect(buildOsExecutionLookup([order], [diagnosis]).get("77")).toEqual([]);
  });

  it("execução não confirmada não usa espelho pendente com dados herdados", () => {
    const order = { gc_os_id: "77", gc_os_tarefa_exec: "21" };
    const pending = { auvo_task_id: "21", tecnico: "Técnico anterior", data_tarefa: "2026-09-01", status_auvo: "Pendente vínculo Auvo" };
    expect(buildOsExecutionLookup([order], [pending]).get("77")).toEqual([]);
  });

  it("múltiplas execuções preservam snapshots e a ordem do GC sem combinar campos", () => {
    const order = { gc_os_id: "77", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "22/21;22" };
    const first = { auvo_task_id: "22", tecnico: "Executor A", data_tarefa: null, status_auvo: "Aberta" };
    const second = { auvo_task_id: "21", tecnico: "Executor B", data_tarefa: "2026-09-17", status_auvo: "Agendada" };
    const rows = buildOsExecutionLookup([order], [second, first]).get("77");
    expect(rows).toEqual([first, second]);
    expect(rows?.[0]).toBe(first);
    expect(rows?.[1]).toBe(second);
  });

  it("o mesmo ID pode ter ambos papéis se o GC confirmou73343 e73344", () => {
    const order = { gc_os_id: "77", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "11" };
    const task = { auvo_task_id: "11", tecnico: "Executor", status_auvo: "Em andamento" };
    expect(buildOsExecutionLookup([order], [task]).get("77")).toEqual([task]);
    expect(buildOsDiagnosticLookup([order], [task]).get("77")).toBe(task);
  });

  it("usa o 73343 atual mesmo quando o espelho antigo ainda carrega a OS", () => {
    const order = { gc_os_id: "77", auvo_task_id: "10", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "21/22", tecnico: "Antigo" };
    const current = { auvo_task_id: "11", gc_os_id: null, tecnico: "Diagnóstico atual", status_auvo: "Finalizada" };
    const tasks = [order, current, { gc_os_id: "77", auvo_task_id: "21", tecnico: "Execução" }];
    expect(buildOsDiagnosticLookup([order], tasks).get("77")).toBe(current);
    expect(order.auvo_task_id).toBe("10");
    expect(current.gc_os_id).toBeNull();
  });

  it("não apresenta diagnóstico antigo ou execução quando o 73343 explícito está ausente", () => {
    const order = { gc_os_id: "77", auvo_task_id: "10", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "21/22" };
    const tasks = [order, { gc_os_id: "77", auvo_task_id: "21" }, { gc_os_id: "77", auvo_task_id: "22" }];
    expect(buildOsDiagnosticLookup([order], tasks).has("77")).toBe(false);
  });

  it("não confunde nenhuma das múltiplas execuções com um diagnóstico legado", () => {
    const order = { gc_os_id: "77", auvo_task_id: "21", gc_os_tarefa_exec: "21/22" };
    expect(buildOsDiagnosticLookup([order], [order, { gc_os_id: "77", auvo_task_id: "22" }]).has("77")).toBe(false);
    const diagnosis = { gc_os_id: "77", auvo_task_id: "10", tecnico: "Diagnóstico legado" };
    expect(buildOsDiagnosticLookup([order], [order, diagnosis]).get("77")).toBe(diagnosis);
  });

  it.each([null, ""])("não restaura um diagnóstico removido explicitamente no GC: %j", gc_os_tarefa_os => {
    const order = { gc_os_id: "77", auvo_task_id: "10", gc_os_tarefa_os, gc_os_tarefa_exec: "21/22" };
    expect(buildOsDiagnosticLookup([order], [order]).has("77")).toBe(false);
  });

  it("resolve a mesma tarefa explícita em duas OS sem alterar suas associações", () => {
    const orders = [
      { gc_os_id: "77", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "21" },
      { gc_os_id: "88", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "22" },
    ];
    const task = { auvo_task_id: "11", gc_os_id: "77", tecnico: "Compartilhado" };
    const lookup = buildOsDiagnosticLookup(orders, [task]);
    expect(lookup.get("77")).toBe(task);
    expect(lookup.get("88")).toBe(task);
    expect(task.gc_os_id).toBe("77");
  });

  it("usa o espelho confirmado mais recente e não deixa um placeholder posterior substituí-lo", () => {
    const old = { auvo_task_id: "11", status_auvo: "Aberta", tecnico: "Antigo", atualizado_em: "2026-09-13" };
    const fresh = { ...old, tecnico: "Atual", status_auvo: "Finalizada", atualizado_em: "2026-09-14" };
    const shell = { ...old, status_auvo: "Pendente vínculo Auvo", tecnico: "", atualizado_em: "2026-09-15" };
    expect(buildAuvoTaskLookup([fresh, shell, old]).get("11")).toBe(fresh);
  });

  it("resolve listas explícitas de diagnóstico e normaliza todos os delimitadores usados no GC", () => {
    expect(parseGcAuvoTaskIds("11/12;21,22 21\n23/0/sem tarefa")).toEqual(["11", "12", "21", "22", "23"]);
    const task = { auvo_task_id: "12", status_auvo: "Finalizada" };
    expect(buildOsDiagnosticLookup([{ gc_os_id: "77", gc_os_tarefa_os: "11/12" }], [task]).get("77")).toBe(task);
  });
});
