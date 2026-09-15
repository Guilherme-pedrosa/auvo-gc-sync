import { describe, expect, it, vi } from "vitest";
import { confirmAgendaTaskMove, createAgendaWriteQueue, refreshMovedAgendaTask } from "@/lib/agendaTaskMove";

const input = { taskId: "79667772", auvoUserId: "184766", date: "2026-09-17", startTime: "08:30:00" };
const confirmed = { data: { status: 200, data: { result: {
  taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00",
} } }, error: null };
const setup = () => vi.fn().mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null }).mockResolvedValueOnce(confirmed);

describe("confirmação de arraste no Auvo", () => {
  it("altera data e responsável da própria tarefa com IDs numéricos e confirma ambos antes de concluir", async () => {
    const invoke = setup();
    await expect(confirmAgendaTaskMove(invoke, input)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      ["auvo-task-update", { body: { action: "edit-schedule", taskId: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" } }],
      ["auvo-task-update", { body: { action: "get", taskId: 79667772 } }],
    ]);
  });

  it.each([null, "", "0", "-1", "abc", "1.5"])("não manda apenas data quando o destino não tem vínculo válido: %j", auvoUserId => {
    const invoke = setup();
    return expect(confirmAgendaTaskMove(invoke, { ...input, auvoUserId })).rejects.toThrow("técnico de destino")
      .then(() => expect(invoke).not.toHaveBeenCalled());
  });

  it("não considera success false com status 200 como confirmação", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: false, status: 200, error: "Responsável recusado" }, error: null });
    await expect(confirmAgendaTaskMove(invoke, input)).rejects.toThrow("Responsável recusado");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { taskID: 70949049, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" },
    { taskID: 79667772, idUserTo: 207034, taskDate: "2026-09-17T08:30:00" },
    { taskID: 79667772, idUserTo: 0, taskDate: "2026-09-17T08:30:00" },
    { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-15T08:30:00" },
    { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T09:30:00" },
  ])("rejeita confirmação de outra tarefa, responsável ou horário: %j", async task => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null })
      .mockResolvedValueOnce({ data: { status: 200, data: { result: task } }, error: null });
    await expect(confirmAgendaTaskMove(invoke, input)).rejects.toThrow(/confirmar|confirmou/);
  });

  it("um 404 na leitura posterior não conclui a movimentação", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null })
      .mockResolvedValueOnce({ data: { status: 404, data: {} }, error: null });
    await expect(confirmAgendaTaskMove(invoke, input)).rejects.toThrow("O Auvo pode ter atualizado");
  });

  it("não inicia uma edição enquanto a sincronização anterior ainda vai aplicar seu snapshot", async () => {
    const enqueue = createAgendaWriteQueue();
    const steps: string[] = [];
    let finishRead: () => void;
    const sync = enqueue(async () => { steps.push("read-old"); await new Promise<void>(resolve => { finishRead = resolve; }); steps.push("save-old"); });
    const move = enqueue(async () => { steps.push("patch-new"); steps.push("save-new"); });
    await Promise.resolve();
    expect(steps).toEqual(["read-old"]);
    finishRead!();
    await Promise.all([sync, move]);
    expect(steps).toEqual(["read-old", "save-old", "patch-new", "save-new"]);
  });

  it("a fila preserva dois arrastes consecutivos e continua após uma falha", async () => {
    const enqueue = createAgendaWriteQueue();
    const steps: string[] = [];
    const first = enqueue(async () => { steps.push("first"); throw new Error("read failed"); });
    const second = enqueue(async () => { steps.push("second"); });
    const third = enqueue(async () => { steps.push("third"); });
    await expect(first).rejects.toThrow("read failed");
    await Promise.all([second, third]);
    expect(steps).toEqual(["first", "second", "third"]);
  });

  it("reconcilia somente o ID arrastado em todos os espelhos", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true, report_step: "os_tasks", auvo_tarefas: 1, upserted: 3, incomplete: false, warnings: [] }, error: null });
    await refreshMovedAgendaTask(invoke, "79667772");
    expect(invoke).toHaveBeenCalledWith("central-sync", { body: { report_step: "os_tasks", task_ids: ["79667772"], wait: true } });
  });

  it.each([{ upserted: 0 }, { incomplete: true }, { warnings: [{ message: "failed" }] }, { success: false }])("não considera espelhos atualizados com retorno parcial %j", async changes => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true, report_step: "os_tasks", auvo_tarefas: 1, upserted: 1, ...changes }, error: null });
    await expect(refreshMovedAgendaTask(invoke, "79667772")).rejects.toThrow("não foi confirmada");
  });
});
