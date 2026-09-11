import { describe, expect, it, vi } from "vitest";
import { fetchAuvoTaskWindows } from "../../supabase/functions/central-sync/auvo-task-pagination";
import { selectAuvoReportTasks, persistReportTasks } from "../../supabase/functions/central-sync/report-persistence";
import { findMissingAuvoTaskIds } from "../../supabase/functions/_shared/auvo-deleted-task-reconciliation";

const day = "2026-09-06";
const next = "2026-09-07";
const page = (tasks: unknown[]) => Response.json({ result: { entityList: tasks } });
const options = () => ({ sleep: vi.fn(async () => {}), log: vi.fn() });

describe("central-sync: Auvo 404 e importação automática por dia", () => {
  it("recupera primeira página 404 transitória e importa a resposta confirmada", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(page([{ taskID: 42 }]));
    const deps = options();
    const result = await fetchAuvoTaskWindows(fetch, day, day, deps);
    expect(result.complete).toBe(true);
    expect(selectAuvoReportTasks(result, day, day).tasks).toEqual([{ taskID: 42 }]);
    expect(fetch.mock.calls).toEqual([[day, 1], [day, 1]]);
    expect(deps.sleep).toHaveBeenCalledExactlyOnceWith(500);
  });

  it("preserva o dia 404 e grava dias válidos antes e depois, sem autorizar exclusão no dia falho", async () => {
    const end = "2026-09-08";
    const fetch = vi.fn(async (date: string) => date === next
      ? new Response(null, { status: 404 }) : page([{ taskID: date === day ? 41 : 43 }]));
    const result = await fetchAuvoTaskWindows(fetch, day, end, options());
    const selected = selectAuvoReportTasks(result, day, end, true);
    expect(result.complete).toBe(false);
    expect(fetch.mock.calls.filter(([date]) => date === next)).toHaveLength(3);
    expect(selected.incompleteWindows).toEqual([{ startDate: next, endDate: next, complete: false,
      error: "primeira página respondeu 404 após 3 tentativas" }]);
    const upsert = vi.fn(async (_rows: unknown[]) => ({ error: null }));
    expect(await persistReportTasks({ from: () => ({ upsert }) }, selected.tasks)).toBe(2);
    expect(upsert.mock.calls[0][0]).toEqual([{ taskID: 41 }, { taskID: 43 }]);
    expect(findMissingAuvoTaskIds([{ auvo_task_id: "42", task_date: next }], [], result.windows)).toEqual([]);
    expect(() => selectAuvoReportTasks(result, day, end)).toThrow(/registros existentes foram preservados/);
  });

  it("nunca confirma sucesso ou inventa lista vazia quando todos os dias retornam 404", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const deps = options();
    const result = await fetchAuvoTaskWindows(fetch, day, next, deps);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(deps.sleep).toHaveBeenCalledTimes(4); // no wait after the final attempt
    expect(result.completeTasks).toEqual([]);
    expect(() => selectAuvoReportTasks(result, day, next, true)).toThrow(/404/);
  });

  it("descarta páginas parciais de um dia falho, mantendo dados completos do dia seguinte", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ taskID: i + 1 }));
    const fetch = vi.fn(async (date: string, n: number) => date === next ? page([{ taskID: 200 }])
      : n === 1 ? page(firstPage) : new Response(null, { status: 500 }));
    const result = await fetchAuvoTaskWindows(fetch, day, next, options());
    expect(result.tasks).toHaveLength(101);
    expect(selectAuvoReportTasks(result, day, next, true).tasks).toEqual([{ taskID: 200 }]);
    expect(result.windows[0]).toMatchObject({ complete: false, error: "página 2 respondeu 500" });
  });

  it.each([401, 403])("mantém falha de autenticação HTTP %i como erro, sem retry cego", async status => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    const result = await fetchAuvoTaskWindows(fetch, day, day, options());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => selectAuvoReportTasks(result, day, day, true)).toThrow(String(status));
  });

  it.each([429, 500, 502, 503, 504])("recupera falha HTTP %i com tentativa limitada", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(page([{ taskID: 42 }]));
    const result = await fetchAuvoTaskWindows(fetch, day, day, options());
    expect(result.complete).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recupera erro de rede/timeout e continua outros dias após esgotar tentativas", async () => {
    const fetch = vi.fn(async (date: string) => {
      if (date === day) throw new Error("network unavailable");
      return page([{ taskID: 42 }]);
    });
    const result = await fetchAuvoTaskWindows(fetch, day, next, options());
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.windows[0].error).toBe("sem resposta na página 1");
    expect(selectAuvoReportTasks(result, day, next, true).tasks).toEqual([{ taskID: 42 }]);
  });

  it("aceita dia vazio confirmado por HTTP 200 e bloqueia JSON/payload inválidos", async () => {
    expect((await fetchAuvoTaskWindows(async () => page([]), day, day, options())).complete).toBe(true);
    for (const payload of ["<html>gateway</html>", "{}", '{"result":null}', '{"result":{"error":"upstream failure"}}']) {
      const result = await fetchAuvoTaskWindows(async () => new Response(payload), day, day, options());
      expect(result.complete).toBe(false);
      expect(() => selectAuvoReportTasks(result, day, day, true)).toThrow();
    }
  });

  it("pagina e deduplica, recuperando também 404 transitório na segunda página", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ taskID: i + 1 }));
    const fetch = vi.fn().mockResolvedValueOnce(page(full)).mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(page([{ taskID: 100 }, { taskID: 101 }]));
    const result = await fetchAuvoTaskWindows(fetch, day, day, options());
    expect(result.complete).toBe(true);
    expect(result.tasks).toHaveLength(101);
    expect(result.completeTasks).toEqual(result.tasks);
    expect(fetch.mock.calls.map(([, n]) => n)).toEqual([1, 2, 2]);
  });

  it("mantém o fim de paginação 404 posterior e recusa truncamento no limite", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ taskID: i + 1 }));
    const result = await fetchAuvoTaskWindows(async (_date, n) => n === 1 ? page(full)
      : new Response(null, { status: 404 }), day, day, options());
    expect(result.complete).toBe(true);
    const fetch = vi.fn(async () => page(full));
    const truncated = await fetchAuvoTaskWindows(fetch, day, day, options());
    expect(fetch).toHaveBeenCalledTimes(30);
    expect(truncated.complete).toBe(false);
    expect(truncated.completeTasks).toEqual([]);
  });
});
