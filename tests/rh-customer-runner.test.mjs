import assert from "node:assert/strict";
import { test } from "node:test";
import { runRhCustomerStep } from "../supabase/functions/_shared/rh-customer-runner.ts";

function harness(payload = { kind: "sync", mode: "full" }, state = { phase: "gc_fetch", page: 1 }) {
  const job = { payload, state: structuredClone(state) };
  const pages = new Map();
  const events = [];
  let finished;
  const ops = {
    fetchGcPage: async (page) => { events.push(["gc_fetch", page]); return { rows: [], hasNext: false }; },
    fetchAuvoPage: async (page, light) => { events.push(["auvo_fetch", page, light]); return { rows: [], hasNext: false }; },
    savePage: async (source, page, rows) => { events.push(["save", source, page]); pages.set(`${source}:${page}`, structuredClone(rows)); },
    readPage: async (source, page) => structuredClone(pages.get(`${source}:${page}`) ?? []),
    loadAuvo: async () => [...pages].filter(([key]) => key.startsWith("auvo:")).flatMap(([, rows]) => structuredClone(rows)),
    beginMutation: async () => { events.push(["begin"]); },
    checkpoint: async (next) => { events.push(["checkpoint"]); job.state = structuredClone(next); },
    complete: async (result) => { events.push(["complete"]); finished = result; },
    applyGc: async (rows) => { events.push(["gc_apply", rows.length]); return { linked: rows.length }; },
    applyAuvoOnly: async (rows) => { events.push(["auvo_only", rows.length]); return { auvoOnly: rows.length }; },
    applyLookup: async (ids) => { events.push(["lookup_apply", ids.length]); return { checked: ids.length, linked: ids.length }; },
  };
  async function step() {
    const first = events.length;
    await runRhCustomerStep(job, ops);
    const emitted = events.slice(first);
    assert.ok(emitted.filter(([type]) => type === "gc_fetch" || type === "auvo_fetch").length <= 1, "one upstream collection page per invocation");
    const mutations = emitted.filter(([type]) => ["gc_apply", "auvo_only", "lookup_apply"].includes(type));
    assert.ok(mutations.length <= 1, "one mutation batch per invocation");
    if (mutations.length) {
      assert.ok(emitted.findIndex(([type]) => type === "begin") < emitted.findIndex(([type]) => type === mutations[0][0]));
      assert.ok(mutations[0][1] <= (mutations[0][0] === "auvo_only" ? 20 : 1));
    }
  }
  async function finish(maximum = 2000) {
    for (let i = 0; i < maximum && !finished; i++) await step();
    assert.ok(finished, "job reached a terminal result");
    return finished;
  }
  return { job, pages, events, ops, step, finish, get result() { return finished; } };
}

test("resumes more than 300 GC pages without truncating or fetching multiple pages per invocation", async () => {
  const h = harness();
  h.ops.fetchGcPage = async (page) => {
    h.events.push(["gc_fetch", page]);
    return { rows: [{ id: page }], hasNext: page < 303 };
  };
  const result = await h.finish();
  assert.equal(h.events.filter(([type]) => type === "gc_fetch").length, 303);
  assert.equal(h.job.state.gcPages, 303);
  assert.equal(result.gcTotal, 303);
  assert.equal(result.linked, 303);
  assert.equal(result.ok, true);
});

test("collects the complete Auvo catalog before matching a GC customer, detecting a duplicate on the last page", async () => {
  const h = harness();
  h.ops.fetchGcPage = async () => ({ rows: [{ id: "gc-1", document: "doc" }], hasNext: false });
  h.ops.fetchAuvoPage = async (page) => {
    h.events.push(["auvo_fetch", page]);
    return { rows: [{ id: page, document: page === 2 ? "other" : "doc" }], hasNext: page < 3 };
  };
  h.ops.applyGc = async (rows, allAuvo, autoCreate) => {
    h.events.push(["gc_apply", rows.length]);
    assert.equal(h.events.filter(([type]) => type === "auvo_fetch").length, 3);
    assert.equal(allAuvo.length, 3);
    assert.equal(autoCreate, true);
    const matches = allAuvo.filter((row) => row.document === rows[0].document);
    return matches.length > 1 ? { ambiguous: 1 } : { createdInAuvo: 1 };
  };
  const result = await h.finish();
  assert.equal(result.auvoTotal, 3);
  assert.equal(result.ambiguous, 1);
  assert.equal(result.createdInAuvo, 0);
});

test("GC mutations process one customer and checkpoint offset before the next invocation", async () => {
  const h = harness({ kind: "sync", autoCreateAuvo: false }, { phase: "gc_apply", gcPages: 2, page: 1, offset: 0, gcTotal: 3 });
  h.pages.set("gc:1", [{ id: 1 }, { id: 2 }]);
  h.pages.set("gc:2", [{ id: 3 }]);
  const processed = [];
  h.ops.applyGc = async (rows, allAuvo, autoCreate) => {
    h.events.push(["gc_apply", rows.length]);
    assert.equal(autoCreate, false);
    processed.push(...rows.map((row) => row.id));
    return { linked: 1, gcTotal: 99, auvoTotal: 99 };
  };
  await h.step();
  assert.deepEqual(processed, [1]);
  assert.equal(h.job.state.page, 1);
  assert.equal(h.job.state.offset, 1);
  await h.step();
  assert.deepEqual(processed, [1, 2]);
  assert.equal(h.job.state.page, 2);
  assert.equal(h.job.state.offset, 0);
  const result = await h.finish();
  assert.deepEqual(processed, [1, 2, 3]);
  assert.equal(result.linked, 3);
  assert.equal(result.gcTotal, 3);
  assert.equal(result.auvoTotal, 0);
});

test("marks mutation before applying and never advances caller state after a crash before checkpoint", async () => {
  const initial = { phase: "gc_apply", gcPages: 1, page: 1, offset: 0, metrics: { linked: 7, errorSamples: ["existing"] } };
  const h = harness({ kind: "sync" }, initial);
  h.pages.set("gc:1", [{ id: 1 }, { id: 2 }]);
  h.ops.checkpoint = async () => { throw new Error("checkpoint unavailable"); };
  await assert.rejects(h.step(), /checkpoint unavailable/);
  assert.deepEqual(h.job.state, initial);
  assert.deepEqual(h.events, [["begin"], ["gc_apply", 1]]);
});

test("a business operation failure propagates without checkpointing or replaying it", async () => {
  const h = harness({ kind: "sync" }, { phase: "gc_apply", gcPages: 1, page: 1, offset: 0 });
  h.pages.set("gc:1", [{ id: 1 }]);
  let attempts = 0;
  h.ops.applyGc = async () => { attempts++; throw new Error("write outcome uncertain"); };
  await assert.rejects(h.step(), /write outcome uncertain/);
  assert.equal(attempts, 1);
  assert.equal(h.events.filter(([type]) => type === "checkpoint").length, 0);
  assert.equal(h.job.state.offset, 0);
});

test("incremental runs with no new GC customer finish without login, Auvo collection, or mutation", async () => {
  const h = harness({ kind: "sync", mode: "incremental" });
  h.ops.fetchAuvoPage = async () => { throw new Error("must not query Auvo"); };
  await h.step();
  assert.equal(h.result.ok, true);
  assert.equal(h.result.gcTotal, 0);
  assert.equal(h.result.auvoTotal, 0);
  assert.equal(h.result.linked, 0);
  assert.equal(h.result.createdInAuvo, 0);
  assert.equal(h.result.errors, 0);
  assert.equal(h.events.filter(([type]) => type === "begin").length, 0);
});

test("Auvo-only persistence is limited to 20 rows with page and offset resumed exactly", async () => {
  const h = harness({ kind: "sync" }, { phase: "auvo_only", auvoPages: 2, auvoTotal: 46, page: 1, offset: 0 });
  h.pages.set("auvo:1", Array.from({ length: 45 }, (_, id) => ({ id })));
  h.pages.set("auvo:2", [{ id: 45 }]);
  const ids = [];
  h.ops.applyAuvoOnly = async (rows) => {
    h.events.push(["auvo_only", rows.length]);
    ids.push(...rows.map((row) => row.id));
    return { auvoOnly: rows.length, inserted: rows.length };
  };
  await h.step();
  assert.equal(h.job.state.offset, 20);
  assert.equal(h.job.state.page, 1);
  const result = await h.finish();
  assert.deepEqual(h.events.filter(([type]) => type === "auvo_only").map(([, count]) => count), [20, 20, 5, 1]);
  assert.deepEqual(ids, Array.from({ length: 46 }, (_, id) => id));
  assert.equal(result.auvoOnly, 46);
  assert.equal(result.inserted, 46);
});

test("lookup collects all pages first, tracks unfiltered counts, and applies one requested ID at a time", async () => {
  const h = harness({ kind: "lookup_document", rhClientIds: ["a", "b"] }, { phase: "auvo_fetch", page: 1 });
  h.ops.fetchAuvoPage = async (page, light) => {
    assert.equal(light, true);
    h.events.push(["auvo_fetch", page, light]);
    return { rows: [{ id: page }], hasNext: page < 2, totalRows: 500 };
  };
  h.ops.applyLookup = async (ids, allAuvo) => {
    h.events.push(["lookup_apply", ids.length]);
    assert.equal(allAuvo.length, 2);
    return { checked: 1, linked: 1, details: [{ id: ids[0], result: "linked" }] };
  };
  const result = await h.finish();
  assert.equal(result.auvoTotal, 1000);
  assert.equal(result.checked, 2);
  assert.equal(result.linked, 2);
  assert.deepEqual(result.details.map((row) => row.id), ["a", "b"]);
  assert.equal("gcTotal" in result, false);
});

test("caps diagnostics while accumulating errors and preserves counters across collection transitions", async () => {
  const h = harness({ kind: "sync" }, { phase: "gc_apply", gcPages: 1, page: 1, metrics: { errors: 2, errorSamples: Array.from({ length: 9 }, (_, i) => `old-${i}`) } });
  h.pages.set("gc:1", [{ id: 1 }, { id: 2 }]);
  h.ops.applyGc = async () => ({ errors: 1, errorSamples: ["new-1", "new-2"] });
  const result = await h.finish();
  assert.equal(result.errors, 4);
  assert.equal(result.errorSamples.length, 10);
  assert.equal(result.errorSamples[9], "new-1");
  assert.equal(result.ok, false);

  const lookup = harness({ kind: "lookup_document", rhClientIds: ["a"] }, { phase: "lookup_apply", metrics: { details: Array.from({ length: 200 }, (_, id) => ({ id })) } });
  lookup.ops.applyLookup = async () => ({ checked: 1, details: [{ id: "overflow" }] });
  const lookupResult = await lookup.finish();
  assert.equal(lookupResult.details.length, 200);
  assert.equal(lookupResult.checked, 1);
});

test("empty collection pages and EOF transitions consume separate invocations without hidden work", async () => {
  const h = harness();
  await h.step();
  assert.equal(h.job.state.phase, "auvo_fetch");
  assert.equal(h.result, undefined);
  await h.step();
  assert.equal(h.job.state.phase, "gc_apply");
  assert.equal(h.events.filter(([type]) => type === "begin").length, 0);
  const result = await h.finish();
  assert.equal(result.gcTotal, 0);
  assert.equal(result.auvoTotal, 0);
  assert.equal(result.ok, true);
});
