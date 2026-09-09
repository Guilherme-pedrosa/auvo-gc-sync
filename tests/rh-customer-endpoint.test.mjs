import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runRhCustomerStep } from "../supabase/functions/_shared/rh-customer-runner.ts";

// Execute the production endpoint and business helpers, replacing only their
// I/O boundaries. No customer data, provider credentials, network, or DB is used.
const source = readFileSync(new URL("../supabase/functions/rh-clientes-sync-gc/index.ts", import.meta.url), "utf8");
const executable = stripTypeScriptTypes(source.replace(/^import\s.+;\s*$/gm, ""));
const build = new Function("deps", `
  const { installGcUsuarioId, startJob, claimJob, getJob, saveJob, beginMutation,
    completeJob, failJob, releaseJob, savePage, readPage, loadPages, runRhCustomerStep,
    AsyncLocalStorage, corsHeaders, createClient, Deno, EdgeRuntime, fetch, crypto, console } = deps;
  ${executable}
  return { upsertCustomerInAuvo, reconcileCustomerBatch, processCustomerJob,
    UncertainAuvoWriteError, requestDeadline, syncFetch };
`);

const fixtureGc = { id: "2", nome: "Cliente Fixture", cnpj: "12345678000199" };
const fixtureAuvo = {
  id: 10, name: "Cliente Fixture", externalId: "GC:1", legalName: null,
  cpfCnpj: "12345678000199", active: true,
  address: null, city: null, state: null, zipCode: null,
};

function fakeDatabase(locals = []) {
  const writes = [];
  return {
    writes,
    from(table) {
      assert.equal(table, "rh_clientes", "only the expected local-customer table is needed by these fixtures");
      const query = {
        select() { return query; },
        order() { return query; },
        async range(from, to) { return { data: structuredClone(locals.slice(from, to + 1)), error: null }; },
        async upsert(rows, options) {
          writes.push({ table, rows: structuredClone(Array.isArray(rows) ? rows : [rows]), options });
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
}

function harness({ fetcher, database = fakeDatabase() } = {}) {
  const requests = [], events = [], jobs = new Map(), logs = [];
  let handler;
  const forbidden = (name) => async () => { throw new Error(`Unexpected job-store operation: ${name}`); };
  const deps = {
    installGcUsuarioId() {},
    async startJob(_sb, key, payload, state) {
      events.push(["start", key]);
      const existing = [...jobs.values()].find((job) => job.request_key === key && ["queued", "running"].includes(job.status));
      if (existing) return existing;
      const job = {
        id: `00000000-0000-4000-8000-${String(jobs.size + 1).padStart(12, "0")}`,
        request_key: key, payload: structuredClone(payload), state: structuredClone(state),
        status: "queued", result: null, error: null, mutation_in_flight: false,
        lease_token: null, lease_until: null,
      };
      jobs.set(job.id, job);
      return job;
    },
    claimJob: forbidden("claim"),
    getJob: forbidden("get"),
    async saveJob(_sb, job, state) {
      events.push(["checkpoint"]);
      Object.assign(job, { state: structuredClone(state), mutation_in_flight: false });
      return job;
    },
    async beginMutation(_sb, job) { events.push(["begin"]); job.mutation_in_flight = true; return job; },
    async completeJob(_sb, job, result) { events.push(["complete"]); Object.assign(job, { status: "succeeded", result }); return job; },
    async failJob(_sb, job, error) { events.push(["fail", error]); Object.assign(job, { status: "failed", error: error.message }); return job; },
    async releaseJob(_sb, job) { events.push(["release"]); job.status = "queued"; return job; },
    savePage: forbidden("savePage"),
    async readPage() { return [structuredClone(fixtureGc)]; },
    async loadPages() { return []; },
    runRhCustomerStep,
    AsyncLocalStorage,
    corsHeaders: { "Access-Control-Allow-Origin": "*" },
    createClient() { events.push(["client"]); return database; },
    Deno: {
      env: { get(name) { return name === "SUPABASE_URL" ? "https://fixture.invalid" : `fixture-${name}`; } },
      serve(callback) { handler = callback; },
    },
    EdgeRuntime: undefined,
    async fetch(input, init) {
      requests.push({ url: String(input), ...init });
      if (!fetcher) throw new Error("Unexpected external request");
      return await fetcher(input, init);
    },
    crypto: webcrypto,
    console: { error(...args) { logs.push(args); }, log(...args) { logs.push(args); }, warn(...args) { logs.push(args); } },
  };
  const api = build(deps);
  return {
    ...api, database, requests, events, jobs, logs,
    async invoke(body) {
      const response = await handler(new Request("https://fixture.invalid/functions/v1/rh-clientes-sync-gc", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("initial full sync responds 202 with a persisted job and no provider enumeration", async () => {
  const h = harness();
  const response = await h.invoke({ mode: "full", autoCreateAuvo: true });
  assert.equal(response.status, 202);
  assert.equal(response.body.done, false);
  assert.equal(response.body.status, "queued");
  assert.equal(response.body.runtimeVersion, "rh-customer-jobs-v1");
  const job = h.jobs.get(response.body.jobId);
  assert.deepEqual(job.payload, { kind: "sync", mode: "full", autoCreateAuvo: true });
  assert.equal(job.state.phase, "gc_fetch");
  assert.match(job.request_key, /^[a-f0-9]{64}$/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.events.some(([event]) => event === "begin"), false);
});

test("lookup with 200 UUIDs fits the request-key limit and ordering shares the active job", async () => {
  const h = harness();
  const ids = Array.from({ length: 200 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const first = await h.invoke({ action: "lookup_document", rhClientIds: ids });
  const reordered = await h.invoke({ action: "lookup_document", rhClientIds: [...ids].reverse() });
  assert.equal(first.status, 202);
  assert.equal(first.body.done, false);
  assert.equal(reordered.body.jobId, first.body.jobId);
  assert.equal(h.jobs.size, 1);
  const job = h.jobs.get(first.body.jobId);
  assert.equal(job.payload.rhClientIds.length, 200);
  assert.ok(job.request_key.length <= 300);
  assert.match(job.request_key, /^[a-f0-9]{64}$/);
  assert.equal(job.state.phase, "auvo_fetch");
  assert.equal(h.requests.length, 0);
});

test("unknown actions fail explicitly instead of starting a full synchronization", async () => {
  const h = harness();
  const response = await h.invoke({ action: "unexpected_worker_action" });
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /Ação de sincronização desconhecida/);
  assert.equal(h.jobs.size, 0);
  assert.equal(h.requests.length, 0);
});

test("version verification does not create a job or call the database or providers", async () => {
  const h = harness();
  const response = await h.invoke({ action: "version" });
  assert.equal(response.body.runtimeVersion, "rh-customer-jobs-v1");
  assert.equal(response.body.ok, true);
  assert.equal(h.events.length, 0);
  assert.equal(h.requests.length, 0);
});

test("Auvo writes with transport failure, 5xx, invalid JSON, or missing IDs are uncertain", async (t) => {
  const cases = {
    "transport failure": async () => { throw new TypeError("fetch failed"); },
    "server failure": async () => new Response("unavailable", { status: 503 }),
    "invalid successful JSON": async () => new Response("invalid JSON", { status: 200 }),
    "successful body without ID": async () => Response.json({ result: { name: "Cliente Fixture" } }),
  };
  for (const [name, fetcher] of Object.entries(cases)) {
    await t.test(name, async () => {
      const h = harness({ fetcher });
      await assert.rejects(h.upsertCustomerInAuvo(fixtureGc, "fixture-token"), h.UncertainAuvoWriteError);
      assert.equal(h.requests.length, 1, "an uncertain write is never automatically retried");
      assert.equal(h.requests[0].method, "PUT");
    });
  }
});

test("an explicit Auvo 4xx rejection is a normal client error, not an uncertain write", async () => {
  const h = harness({ fetcher: async () => new Response("fixture validation rejection", { status: 422 }) });
  await assert.rejects(h.upsertCustomerInAuvo(fixtureGc, "fixture-token"), (error) => {
    assert.ok(!(error instanceof h.UncertainAuvoWriteError));
    assert.match(error.message, /recusou cliente GC 2 \(422\)/);
    return true;
  });
  assert.equal(h.requests.length, 1);
});

test("reconciliation propagates an uncertain Auvo PUT before writing a misleading local result", async () => {
  const h = harness({ fetcher: async () => { throw new TypeError("fixture transport interruption"); } });
  await assert.rejects(h.reconcileCustomerBatch(h.database, [fixtureGc], [], true, false, "fixture-token"), h.UncertainAuvoWriteError);
  assert.equal(h.requests.length, 1);
  assert.equal(h.database.writes.length, 0);
});

test("the real runner and endpoint preserve the mutation marker and fail without checkpoint after uncertain PUT", async () => {
  const h = harness({ fetcher: async (input) => {
    if (String(input).includes("/login/")) return Response.json({ result: { accessToken: "fixture-token" } });
    throw new TypeError("fixture lost write response");
  } });
  const job = {
    id: "10000000-0000-4000-8000-000000000001", status: "running",
    payload: { kind: "sync", mode: "full", autoCreateAuvo: true },
    state: { phase: "gc_apply", page: 1, offset: 0, gcPages: 1, auvoPages: 1, metrics: {} },
    mutation_in_flight: false,
  };
  await h.processCustomerJob(h.database, job);
  assert.equal(job.status, "failed");
  assert.equal(job.mutation_in_flight, true);
  assert.equal(job.state.offset, 0);
  assert.deepEqual(h.events.map(([event]) => event), ["begin", "fail"]);
  assert.ok(h.events[1][1] instanceof h.UncertainAuvoWriteError);
  assert.equal(h.requests.filter((request) => request.method === "PUT").length, 1);
  assert.equal(h.database.writes.length, 0);
});

test("a CPF/name match already held by another GC customer is not reassigned or auto-created", async () => {
  const holder = {
    id: "holder-fixture", nome: "Cliente Fixture", nome_auvo: "Cliente Fixture",
    nome_normalizado: "cliente fixture", gc_cliente_id: "1", auvo_cliente_id: 10, origem: "gc_auvo",
  };
  const h = harness({ database: fakeDatabase([holder]) });
  const result = await h.reconcileCustomerBatch(h.database, [fixtureGc], [fixtureAuvo], true, false, "fixture-token");
  assert.equal(result.ambiguous, 1);
  assert.equal(result.linked, 0);
  assert.equal(result.createdInAuvo, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.database.writes.length, 1);
  const pending = h.database.writes[0].rows[0];
  assert.equal(pending.gc_cliente_id, "2");
  assert.equal(pending.auvo_cliente_id, null);
  assert.equal(pending.id, undefined, "do not overwrite the existing holder row by ID");
  assert.equal(pending.vinculo_status, "ambiguo");
  assert.equal(pending.vinculo_metodo, "id_auvo_vinculado_a_outro_gc");
  assert.equal(holder.gc_cliente_id, "1");
  assert.equal(holder.auvo_cliente_id, 10);
});

test("concurrent request abort signals remain isolated and an expired context cannot send another request", async () => {
  const h = harness({ fetcher: async () => Response.json({ ok: true }) });
  const first = new AbortController(), second = new AbortController();
  await Promise.all([
    h.requestDeadline.run(first.signal, () => h.syncFetch("https://fixture.invalid/first")),
    h.requestDeadline.run(second.signal, () => h.syncFetch("https://fixture.invalid/second")),
  ]);
  first.abort(new Error("fixture first invocation expired"));
  assert.equal(h.requests.find((request) => request.url.endsWith("/first")).signal.aborted, true);
  assert.equal(h.requests.find((request) => request.url.endsWith("/second")).signal.aborted, false);
  await assert.rejects(h.requestDeadline.run(first.signal, () => h.syncFetch("https://fixture.invalid/blocked")), /fixture first invocation expired/);
  assert.equal(h.requests.length, 2);
});
