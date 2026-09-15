import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as durationHelpers from "../../supabase/functions/_shared/auvo-duration";
import * as creationHelpers from "../../supabase/functions/_shared/auvo-task-create";
import { taskTypeId, auvoTaskHasStarted } from "../../supabase/functions/_shared/agenda-forecast-promotion";
import { auvoTaskTypeDescription } from "../../supabase/functions/_shared/auvo-task-type";
import {
  isManagedTaskType,
  managedBaseTaskTypeId,
  managedTaskTypeDescription,
  minutesToAuvoTimeSpan,
  normalizeRequestedDurationMinutes,
  parseAuvoDurationMinutes,
  resolveAuvoPlannedDuration,
} from "../../supabase/functions/_shared/auvo-duration";

describe("duração de tarefas Auvo", () => {
  it("confirma o padrão real do tipo quando a duração individual está zerada", () => {
    expect(resolveAuvoPlannedDuration(
      { taskType: 246320, estimatedDuration: "00:00:00" },
      { id: 246320, standardTime: "01:00:00" },
    )).toEqual({ minutes: 60, source: "task_type" });
  });

  it("preserva a duração individual mesmo com outro padrão no tipo", () => {
    expect(resolveAuvoPlannedDuration(
      { taskType: 247026, estimatedDuration: "02:00:00" },
      { id: 247026, standardTime: "04:00:00" },
    )).toEqual({ minutes: 120, source: "task" });
  });

  it("não confirma pelo nome, por outro tipo ou por valores ausentes", () => {
    const task = { taskType: 246320, estimatedDuration: "00:00:00" };
    expect(resolveAuvoPlannedDuration(task, { id: 999, standardTime: "01:00:00" }).minutes).toBe(0);
    expect(resolveAuvoPlannedDuration(task, { id: 246320, description: "[WEDO:180177:60] Execução · 1h" }).minutes).toBe(0);
    expect(resolveAuvoPlannedDuration(task).source).toBe("unconfirmed");
  });
  it("interpreta TimeSpan devolvido pelo Auvo", () => {
    expect(parseAuvoDurationMinutes("02:30:00")).toBe(150);
    expect(parseAuvoDurationMinutes("1.01:15:00")).toBe(1515);
    expect(parseAuvoDurationMinutes("00:00:00")).toBe(0);
  });

  it("serializa minutos no campo oficial tasktypes.standartTime", () => {
    expect(minutesToAuvoTimeSpan(150)).toBe("02:30:00");
    expect(minutesToAuvoTimeSpan(1500)).toBe("1.01:00:00");
    expect(normalizeRequestedDurationMinutes(5)).toBe(15);
  });

  it("gera uma variante determinística e recupera o tipo base", () => {
    const description = managedTaskTypeDescription(180176, 120, "Visita Preventiva Contrato");

    expect(description).toBe("[WEDO:180176:120] Visita Preventiva Contrato · 2h");
    expect(isManagedTaskType(description)).toBe(true);
    expect(managedBaseTaskTypeId(description)).toBe(180176);
  });

  it("não empilha prefixos ao reutilizar uma variante", () => {
    const description = managedTaskTypeDescription(
      180176,
      180,
      "[WEDO:180176:120] Visita Preventiva Contrato · 2h",
    );

    expect(description).toBe("[WEDO:180176:180] Visita Preventiva Contrato · 3h");
  });
});

// Run the actual edge branches and duration resolvers with isolated provider
// responses. The Deno server, login and production database never run here.
const edgeSource = readFileSync(resolve(__dirname, "../../supabase/functions/auvo-task-update/index.ts"), "utf8");
const resolverSource = edgeSource.slice(edgeSource.indexOf("function taskTypeDurationMinutes("), edgeSource.indexOf("function getAdminClient("));
const editStart = edgeSource.indexOf('    if (action === "set-task-duration" || action === "edit-schedule")');
const editSource = edgeSource.slice(editStart, edgeSource.indexOf('    if (action === "list-questionnaires")', editStart));
const createStart = edgeSource.indexOf('    if (action === "create-task")');
const createSource = edgeSource.slice(createStart, edgeSource.indexOf('\n    return new Response(', createStart));
const compiledBranches = ts.transpile(`${resolverSource}
async function run(body) {
  const action = body.action; const headers = {}; const respHeaders = {}; const reqId = "duration-test";
  ${editSource}
  ${createSource}
}`, { target: ts.ScriptTarget.ES2022 });

function scheduleHarness(options: { individual?: string; failTypeCreation?: boolean } = {}) {
  let task: any = { taskID: 79667772, taskType: 180177, taskDate: "2026-09-17T09:00:00", idUserTo: 204602,
    estimatedDuration: options.individual ?? "00:00:00", taskStatus: 1 };
  const types: Record<number, any> = { 180177: { id: 180177, description: "Execução", standardTime: "01:00:00" } };
  const response = (result: any, status = 200) => new Response(JSON.stringify({ result }), { status });
  const fetchProvider = vi.fn(async (url: string, init: any = {}) => {
    const path = new URL(url).pathname.replace(/^\/v2/, "");
    if (path.startsWith("/customers/")) return response({ id: 10, active: true, address: "Rua Teste, 10" });
    if (path === "/tasks/" && init.method === "POST") {
      task = { ...task, ...JSON.parse(init.body), estimatedDuration: "00:00:00" };
      return response({ taskID: task.taskID, estimatedDuration: "09:00:00" }, 201);
    }
    if (path === "/tasks/79667772") return response(task);
    if (path === "/tasktypes/" && init.method === "POST") {
      if (options.failTypeCreation) return response({ error: "tipo indisponível" }, 500);
      const payload = JSON.parse(init.body);
      types[246320] = { id: 246320, ...payload };
      return response(types[246320], 201);
    }
    if (path === "/tasktypes/") return response({ entityList: [] });
    const id = Number(path.split("/").pop());
    if (path.startsWith("/tasktypes/") && types[id]) return response(types[id]);
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${path}`);
  });
  const patchWithRetry = vi.fn(async (_url: string, init: any) => {
    for (const patch of JSON.parse(init.body)) task[patch.path.slice(1)] = patch.value;
    return response({});
  });
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
  const dependencies = {
    ...durationHelpers, ...creationHelpers, taskTypeId, auvoTaskHasStarted, auvoTaskTypeDescription,
    fetch: fetchProvider, patchWithRetry, getAdminClient: () => ({ from: () => query }), AUVO_BASE_URL: "https://auvo.test/v2",
  };
  const run = new Function(...Object.keys(dependencies), `${compiledBranches}; return run;`)(...Object.values(dependencies));
  return { run: async (body: any) => (await run(body)).json(), fetchProvider, patchWithRetry };
}

describe("duração no handler Auvo com respostas do provedor simuladas", () => {
  it("confirma 1h pelo tipo relido quando GET da tarefa retorna duração individual zero", async () => {
    const test = scheduleHarness();
    const result = await test.run({ action: "edit-schedule", taskId: 79667772, durationMinutes: 60 });
    expect(result).toMatchObject({ success: true, duration: { requestedMinutes: 60, actualMinutes: 60, verified: true, source: "task_type" } });
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.fetchProvider.mock.calls.filter(([url]) => url.endsWith("/tasktypes/180177"))).toHaveLength(2);
  });

  it("aplica um novo tipo e confirma sua duração efetiva sem escrever duração individual", async () => {
    const test = scheduleHarness();
    expect(await test.run({ action: "edit-schedule", taskId: 79667772, durationMinutes: 90 })).toMatchObject({
      success: true, duration: { requestedMinutes: 90, actualMinutes: 90, verified: true, source: "task_type" },
    });
    expect(JSON.parse(test.patchWithRetry.mock.calls[0][1].body)).toEqual([{ op: "replace", path: "/taskType", value: 246320 }]);
  });

  it("rejeita duração individual 2h versus pedido 4h antes de alterar tipo, data ou responsável", async () => {
    const test = scheduleHarness({ individual: "02:00:00" });
    expect(await test.run({ action: "edit-schedule", taskId: 79667772, durationMinutes: 240,
      taskDate: "2026-09-18T10:00:00", idUserTo: 184612 })).toMatchObject({
      success: false, status: 409, duration: { requestedMinutes: 240, actualMinutes: 120, verified: false },
    });
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.fetchProvider).toHaveBeenCalledTimes(1);
  });

  it("confirma duração individual de 2h já igual ao pedido sem trocar o tipo cujo padrão é 1h", async () => {
    const test = scheduleHarness({ individual: "02:00:00" });
    expect(await test.run({ action: "edit-schedule", taskId: 79667772, durationMinutes: 120 })).toMatchObject({
      success: true, duration: { requestedMinutes: 120, actualMinutes: 120, verified: true, source: "task", taskTypeId: 180177 },
    });
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.fetchProvider.mock.calls.every(([url]) => url.endsWith("/tasks/79667772"))).toBe(true);
  });

  it("edição apenas de data/responsável não consulta tipos nem modifica a duração", async () => {
    const test = scheduleHarness();
    expect(await test.run({ action: "edit-schedule", taskId: 79667772,
      taskDate: "2026-09-18T10:00:00", idUserTo: 184612 })).toMatchObject({ success: true, duration: null });
    expect(JSON.parse(test.patchWithRetry.mock.calls[0][1].body)).toEqual([
      { op: "replace", path: "/taskDate", value: "2026-09-18T10:00:00" },
      { op: "replace", path: "/idUserTo", value: 184612 },
    ]);
    expect(test.fetchProvider.mock.calls.every(([url]) => url.endsWith("/tasks/79667772"))).toBe(true);
  });

  it("na criação com fallback preserva os 150 minutos pedidos e não confirma os 60 do tipo base", async () => {
    const test = scheduleHarness({ failTypeCreation: true });
    const result = await test.run({ action: "create-task", customerId: 10, idUserTo: 204602, idUserFrom: 184612,
      taskTypeId: 180177, dateISO: "2026-09-17", startTime: "09:00", durationMinutes: 150 });
    expect(result).toMatchObject({ success: true, taskId: "79667772", duration: {
      requestedMinutes: 150, actualMinutes: 60, verified: false, source: "task_type",
    }, warning: expect.stringContaining("150") });
    expect(test.fetchProvider.mock.calls.filter(([url, init]) => url.endsWith("/tasks/") && init?.method === "POST")).toHaveLength(1);
  });
});
