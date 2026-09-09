import assert from "node:assert/strict";
import { test } from "node:test";
import { runRhClientesSync, validateRhPendingBatch } from "../src/lib/rhClientesSync.ts";

const apiVersion = "gc-auvo-v2";
const queued = { ok: true, apiVersion, done: false, jobId: "job-1", status: "queued" };
const complete = { ok: true, apiVersion, done: true, linked: 24, createdInAuvo: 2, ambiguous: 0 };

test("continues the same persisted job until final metrics, preserving the initial lookup request", async () => {
  const initial = { action: "lookup_document", requestVersion: apiVersion, rhClientIds: ["client-1"] };
  const replies = [queued, { ...queued, status: "running", retryAfterMs: 8000 }, complete];
  const bodies = [];
  const delays = [];
  const progress = [];
  const result = await runRhClientesSync(async (body) => {
    bodies.push(body);
    return { data: replies.shift(), error: null };
  }, initial, { sleep: async (ms) => { delays.push(ms); }, onProgress: (reply) => progress.push(reply.status) });
  assert.equal(result, complete);
  assert.deepEqual(bodies, [initial, ...Array.from({ length: 2 }, () => ({ action: "lookup_document", rhClientIds: [], continueJob: true, requestVersion: apiVersion, jobId: "job-1" }))]);
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(progress, ["queued", "running"]);
});

test("accepts a final response from the previous gc-auvo-v2 backend without restarting it", async () => {
  let calls = 0;
  const legacy = { ok: true, apiVersion, linked: 3 };
  assert.equal(await runRhClientesSync(async () => {
    calls++;
    return { data: legacy, error: null };
  }, { mode: "full" }), legacy);
  assert.equal(calls, 1);
});

test("a continuation reaching an old deployment fails the empty lookup guard instead of starting a full sync", async () => {
  let calls = 0;
  let unintendedFullSyncs = 0;
  await assert.rejects(runRhClientesSync(async (body) => {
    calls++;
    if (calls === 1) return { data: queued, error: null };
    // The old deployment rejects an empty lookup; unknown actions fall through to full sync.
    if (body.action === "lookup_document" && body.rhClientIds.length === 0) {
      return { data: { apiVersion, ok: false, error: "Nenhum cliente selecionado" }, error: null };
    }
    unintendedFullSyncs++;
    return { data: complete, error: null };
  }, { mode: "full" }, { sleep: async () => {} }), /Nenhum cliente selecionado/);
  assert.equal(calls, 2);
  assert.equal(unintendedFullSyncs, 0);
});

test("surfaces a failed terminal job instead of displaying success", async () => {
  let calls = 0;
  await assert.rejects(runRhClientesSync(async () => {
    calls++;
    return { data: calls === 1 ? queued : { ok: false, apiVersion, done: true, error: "Auvo indisponível" }, error: null };
  }, { mode: "full" }, { sleep: async () => {} }), /Auvo indisponível/);
  assert.equal(calls, 2);
});

test("never retries a transport failure or creates a second job", async () => {
  const networkError = new Error("Failed to fetch");
  let calls = 0;
  await assert.rejects(runRhClientesSync(async () => {
    calls++;
    return calls === 1 ? { data: queued, error: null } : { data: null, error: networkError };
  }, { mode: "full" }, { sleep: async () => {} }), (error) => error === networkError);
  assert.equal(calls, 2);
});

test("stops tracking at the client deadline without restarting the persisted job", async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(runRhClientesSync(async () => {
    calls++;
    return { data: queued, error: null };
  }, { mode: "full" }, { now: () => time, timeoutMs: 1500, sleep: async (ms) => { time += ms; } }), /continua em segundo plano \(job job-1\)/);
  assert.equal(time, 1500);
  assert.equal(calls, 2);
});

test("cancellation prevents another continuation and does not cancel or restart the server job", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runRhClientesSync(async () => {
    calls++;
    return { data: queued, error: null };
  }, { mode: "full" }, { signal: controller.signal, sleep: async () => controller.abort() }), { name: "AbortError" });
  assert.equal(calls, 1);
  await assert.rejects(runRhClientesSync(async () => {
    calls++;
    return { data: complete, error: null };
  }, { mode: "full" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("rejects pending envelopes without a stable job ID and outdated response contracts", async () => {
  await assert.rejects(runRhClientesSync(async () => ({ data: { ...queued, jobId: null }, error: null }), {}), /identificador do job ausente/);
  await assert.rejects(runRhClientesSync(async () => ({ data: { ok: true }, error: null }), {}), /publicada está desatualizada/);
  let calls = 0;
  await assert.rejects(runRhClientesSync(async () => ({ data: calls++ === 0 ? queued : { ...queued, jobId: "other-job" }, error: null }), {}, { sleep: async () => {} }), /job foi alterado/);
});

test("only resends a strictly smaller subset of pending name updates", () => {
  assert.deepEqual(validateRhPendingBatch(["a", "b", "c"], ["b", "c"]), ["b", "c"]);
  assert.deepEqual(validateRhPendingBatch(["a"], []), []);
  assert.deepEqual(validateRhPendingBatch(["a"], undefined), []);
  assert.throws(() => validateRhPendingBatch(["a", "b"], ["b", "a"]), /não avançou/);
  assert.throws(() => validateRhPendingBatch(["a", "b"], ["c"]), /fora do lote/);
  assert.throws(() => validateRhPendingBatch(["a", "b"], ["a", "a"]), /fora do lote/);
  assert.throws(() => validateRhPendingBatch(["a"], "a"), /lista de pendentes inválida/);
});
