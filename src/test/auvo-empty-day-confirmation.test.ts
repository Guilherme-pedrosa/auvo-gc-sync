import { describe, expect, it, vi } from "vitest";
import { fetchAuvoTaskWindows } from "../../supabase/functions/central-sync/auvo-task-pagination";
import { selectAuvoReportTasks } from "../../supabase/functions/central-sync/report-persistence";

const day = "2026-07-04";
const page = (tasks: unknown[]) => Response.json({ result: { entityList: tasks } });
const neighbors = [{ taskID: 3, taskDate: "2026-07-03T14:00:00" }, { taskID: 5, taskDate: "2026-07-05T08:00:00" }];
const missing = () => new Response(null, { status: 404 });
const options = (fetchRange: any) => ({ fetchRange, sleep: vi.fn(async () => {}), log: vi.fn() });

describe("confirmação de dia Auvo vazio sem confiar apenas no 404", () => {
  it("confirma 04/07 vazio através da consulta completa 03–05/07", async () => {
    const daily = vi.fn(async () => missing());
    const range = vi.fn(async () => page(neighbors));
    const result = await fetchAuvoTaskWindows(daily, day, day, options(range));
    expect(daily).toHaveBeenCalledTimes(3);
    expect(range).toHaveBeenCalledExactlyOnceWith("2026-07-03", "2026-07-05", 1);
    expect(result.complete).toBe(true);
    expect(selectAuvoReportTasks(result, day, day).tasks).toEqual([]);
  });

  it("recupera tarefas do dia quando a janela ampliada devolve a lista completa", async () => {
    const current = { taskID: 4, taskDate: "2026-07-04T23:30:00-03:00" };
    const result = await fetchAuvoTaskWindows(async () => missing(), day, day, options(async () => page([...neighbors, current])));
    expect(result.completeTasks).toEqual([current]);
    expect(result.tasks).toEqual([current]);
  });

  it("não faz consulta adicional se a consulta diária está confirmada", async () => {
    const range = vi.fn();
    expect((await fetchAuvoTaskWindows(async () => page([]), day, day, options(range))).complete).toBe(true);
    expect(range).not.toHaveBeenCalled();
  });

  it.each([404, 500, 401, 403, 429])("não transforma a falha HTTP %i na confirmação em dia vazio", async status => {
    const result = await fetchAuvoTaskWindows(async () => missing(), day, day, options(async () => new Response(null, { status })));
    expect(result.complete).toBe(false);
    expect(() => selectAuvoReportTasks(result, day, day)).toThrow(/preservados/);
  });

  it.each([404, 500])("exige o fim confirmado da paginação, inclusive se a segunda página responde %i", async status => {
    const full = Array.from({ length: 100 }, (_, i) => ({ taskID: i + 1, taskDate: "2026-07-03T08:00:00" }));
    const range = vi.fn(async (_start, _end, n) => n === 1 ? page(full) : new Response(null, { status }));
    const result = await fetchAuvoTaskWindows(async () => missing(), day, day, options(range));
    expect(result.complete).toBe(false);
    expect(result.completeTasks).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.windows[0].error).toContain("conferência");
  });

  it("confirma a janela somente depois de receber todas as páginas", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ taskID: i + 1, taskDate: "2026-07-03T08:00:00" }));
    const current = { taskID: 101, taskDate: "2026-07-04T08:00:00" };
    const range = vi.fn(async (_start, _end, n) => n === 1 ? page(full) : page([current]));
    const result = await fetchAuvoTaskWindows(async () => missing(), day, day, options(range));
    expect(result.completeTasks).toEqual([current]);
    expect(range).toHaveBeenCalledTimes(2);
  });

  it.each([{ taskID: 4 }, { taskID: 4, taskDate: "0001-01-01T00:00:00" }, { taskID: 4, taskDate: "2026-07-02T23:59:59" }])("recusa tarefa sem data coerente: %j", async task => {
    const result = await fetchAuvoTaskWindows(async () => missing(), day, day, options(async () => page([task])));
    expect(result.complete).toBe(false);
    expect(result.completeTasks).toEqual([]);
  });

  it("não aplica confirmação de vazio a falhas de autenticação da consulta original", async () => {
    const range = vi.fn();
    const result = await fetchAuvoTaskWindows(async () => new Response(null, { status: 401 }), day, day, options(range));
    expect(result.complete).toBe(false);
    expect(range).not.toHaveBeenCalled();
  });
});
