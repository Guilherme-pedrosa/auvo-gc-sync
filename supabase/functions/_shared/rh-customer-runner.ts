export type RhCustomerPhase = "gc_fetch" | "auvo_fetch" | "gc_apply" | "auvo_only" | "lookup_apply";
export type RhCustomerMetrics = Record<string, unknown>;
export type RhCustomerState = {
  phase: RhCustomerPhase;
  page?: number;
  offset?: number;
  gcPages?: number;
  auvoPages?: number;
  gcTotal?: number;
  auvoTotal?: number;
  metrics?: RhCustomerMetrics;
};
export type RhCustomerJob = {
  payload: {
    kind: "sync" | "lookup_document";
    mode?: string;
    autoCreateAuvo?: boolean;
    rhClientIds?: string[];
  };
  state: RhCustomerState;
};
type Page = { rows: unknown[]; hasNext: boolean; totalRows?: number };
export type RhCustomerStepOps = {
  fetchGcPage(page: number, mode: string): Promise<Page>;
  fetchAuvoPage(page: number, light: boolean): Promise<Page>;
  savePage(source: "gc" | "auvo", page: number, rows: unknown[]): Promise<unknown>;
  readPage(source: "gc" | "auvo", page: number): Promise<unknown[]>;
  loadAuvo(): Promise<unknown[]>;
  beginMutation(): Promise<unknown>;
  checkpoint(state: RhCustomerState): Promise<unknown>;
  complete(result: Record<string, unknown>): Promise<unknown>;
  applyGc(rows: unknown[], allAuvo: unknown[], autoCreate: boolean): Promise<RhCustomerMetrics>;
  applyAuvoOnly(rows: unknown[]): Promise<RhCustomerMetrics>;
  applyLookup(ids: string[], allAuvo: unknown[]): Promise<RhCustomerMetrics>;
};

const SYNC_COUNTERS = ["linked", "createdInAuvo", "ambiguous", "auvoOnly", "inserted", "updated", "mergedDuplicates", "errors"] as const;
const LOOKUP_COUNTERS = ["checked", "linked", "alreadyLinked", "ambiguous", "notFound", "invalidDocument", "errors"] as const;

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function mergeMetrics(kind: RhCustomerJob["payload"]["kind"], previous: RhCustomerMetrics = {}, added: RhCustomerMetrics = {}): RhCustomerMetrics {
  const metrics: RhCustomerMetrics = {};
  const fields = kind === "sync" ? SYNC_COUNTERS : LOOKUP_COUNTERS;
  for (const field of fields) metrics[field] = count(previous[field]) + count(added[field]);
  const arrayField = kind === "sync" ? "errorSamples" : "details";
  metrics[arrayField] = [
    ...(Array.isArray(previous[arrayField]) ? previous[arrayField] as unknown[] : []),
    ...(Array.isArray(added[arrayField]) ? added[arrayField] as unknown[] : []),
  ].slice(0, kind === "sync" ? 10 : 200);
  return metrics;
}

function result(job: RhCustomerJob, state: RhCustomerState): Record<string, unknown> {
  const metrics = mergeMetrics(job.payload.kind, state.metrics);
  return {
    ...metrics,
    ok: metrics.errors === 0,
    auvoTotal: count(state.auvoTotal),
    ...(job.payload.kind === "sync" ? { gcTotal: count(state.gcTotal), mode: job.payload.mode ?? "full" } : {}),
  };
}

/** Runs one bounded collection page or one bounded mutation batch per invocation. */
export async function runRhCustomerStep(job: RhCustomerJob, ops: RhCustomerStepOps): Promise<void> {
  const kind = job.payload.kind;
  const mode = job.payload.mode ?? "full";
  // Never mutate the caller's cursor: a failed operation must not advance it.
  const state: RhCustomerState = { ...job.state, metrics: mergeMetrics(kind, job.state.metrics) };
  const page = Math.max(1, Math.trunc(count(state.page) || 1));
  const offset = Math.trunc(count(state.offset));

  if (state.phase === "gc_fetch") {
    if (kind === "lookup_document") {
      await ops.checkpoint({ ...state, phase: "auvo_fetch", page: 1, offset: 0 });
      return;
    }
    const fetched = await ops.fetchGcPage(page, mode);
    await ops.savePage("gc", page, fetched.rows);
    const next: RhCustomerState = {
      ...state,
      gcPages: page,
      gcTotal: count(state.gcTotal) + fetched.rows.length,
      page: fetched.hasNext ? page + 1 : 1,
      offset: 0,
      phase: fetched.hasNext ? "gc_fetch" : "auvo_fetch",
    };
    if (!fetched.hasNext && mode === "incremental" && next.gcTotal === 0) {
      await ops.complete(result(job, next));
      return;
    }
    await ops.checkpoint(next);
    return;
  }

  if (state.phase === "auvo_fetch") {
    const fetched = await ops.fetchAuvoPage(page, kind === "lookup_document");
    await ops.savePage("auvo", page, fetched.rows);
    await ops.checkpoint({
      ...state,
      auvoPages: page,
      auvoTotal: count(state.auvoTotal) + count(fetched.totalRows ?? fetched.rows.length),
      phase: fetched.hasNext ? "auvo_fetch" : kind === "lookup_document" ? "lookup_apply" : "gc_apply",
      page: fetched.hasNext ? page + 1 : 1,
      offset: 0,
    });
    return;
  }

  if (state.phase === "gc_apply") {
    if (page > count(state.gcPages)) {
      await ops.checkpoint({ ...state, phase: "auvo_only", page: 1, offset: 0 });
      return;
    }
    const rows = await ops.readPage("gc", page);
    if (offset >= rows.length) {
      await ops.checkpoint({ ...state, page: page + 1, offset: 0 });
      return;
    }
    // Matching must see the complete Auvo collection, including later pages.
    const allAuvo = await ops.loadAuvo();
    await ops.beginMutation();
    const added = await ops.applyGc(rows.slice(offset, offset + 1), allAuvo, job.payload.autoCreateAuvo !== false);
    await ops.checkpoint({
      ...state,
      metrics: mergeMetrics(kind, state.metrics, added),
      page: offset + 1 >= rows.length ? page + 1 : page,
      offset: offset + 1 >= rows.length ? 0 : offset + 1,
    });
    return;
  }

  if (state.phase === "auvo_only") {
    if (page > count(state.auvoPages)) {
      await ops.complete(result(job, state));
      return;
    }
    const rows = await ops.readPage("auvo", page);
    if (offset >= rows.length) {
      await ops.checkpoint({ ...state, page: page + 1, offset: 0 });
      return;
    }
    const batch = rows.slice(offset, offset + 20);
    await ops.beginMutation();
    const added = await ops.applyAuvoOnly(batch);
    await ops.checkpoint({
      ...state,
      metrics: mergeMetrics(kind, state.metrics, added),
      page: offset + batch.length >= rows.length ? page + 1 : page,
      offset: offset + batch.length >= rows.length ? 0 : offset + batch.length,
    });
    return;
  }

  if (state.phase === "lookup_apply") {
    const ids = job.payload.rhClientIds ?? [];
    if (offset >= ids.length) {
      await ops.complete(result(job, state));
      return;
    }
    const allAuvo = await ops.loadAuvo();
    await ops.beginMutation();
    const added = await ops.applyLookup(ids.slice(offset, offset + 1), allAuvo);
    await ops.checkpoint({
      ...state,
      offset: offset + 1,
      metrics: mergeMetrics(kind, state.metrics, added),
    });
    return;
  }

  throw new Error(`Fase inválida da sincronização de clientes: ${String(state.phase)}`);
}
