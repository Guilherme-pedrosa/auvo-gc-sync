/** Persisted checkpoints for bounded customer-sync invocations. No API credentials belong in jobs. */
export type RhCustomerJob = {
  id: string;
  request_key: string;
  payload: Record<string, any>;
  state: Record<string, any>;
  status: "queued" | "running" | "succeeded" | "failed";
  result: Record<string, any> | null;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  mutation_in_flight: boolean;
  created_at: string;
  updated_at: string;
};

export type Job = RhCustomerJob;
type DatabaseClient = { rpc: (...args: any[]) => any; from: (...args: any[]) => any };
export type CustomerSyncPage = { page: number; data: any[] };

async function callRpc(sb: DatabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(`Persistência da sincronização de clientes: ${error.message || error.code || "falha no banco"}`);
  return data;
}

function owned(job: Job) {
  if (!job.lease_token || job.status !== "running") {
    throw new Error("Sincronização de clientes sem uma concessão de execução válida.");
  }
  return { p_job_id: job.id, p_lease_token: job.lease_token };
}

async function updateJob(sb: DatabaseClient, job: Job, operation: string, value: unknown = null): Promise<Job> {
  const data = await callRpc(sb, "rh_customer_sync_update_job", {
    ...owned(job), p_operation: operation, p_value: value,
  });
  if (!data?.id) throw new Error("O banco não confirmou o checkpoint da sincronização de clientes.");
  // Keep callers that retain the claimed object in step with its current lease/status.
  Object.assign(job, data);
  return job;
}

export async function startJob(
  sb: DatabaseClient,
  requestKey: string,
  payload: Record<string, any>,
  initialState: Record<string, any> = {},
): Promise<Job> {
  const job = await callRpc(sb, "rh_customer_sync_start_job", {
    p_request_key: requestKey, p_payload: payload, p_initial_state: initialState,
  });
  if (!job?.id) throw new Error("O banco não confirmou a criação da sincronização de clientes.");
  return job;
}

export async function claimJob(sb: DatabaseClient, id?: string): Promise<Job | null> {
  return await callRpc(sb, "rh_customer_sync_claim_job", { p_job_id: id ?? null });
}

export async function getJob(sb: DatabaseClient, id: string): Promise<Job | null> {
  const { data, error } = await sb.from("rh_customer_sync_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Não foi possível consultar a sincronização de clientes: ${error.message}`);
  return data;
}

/** Call only after the current external mutation is confirmed and included in state. */
export function saveJob(sb: DatabaseClient, job: Job, state: Record<string, any>): Promise<Job> {
  return updateJob(sb, job, "checkpoint", state);
}

/** Persist before starting any non-idempotent external request; failure means do not send it. */
export function beginMutation(sb: DatabaseClient, job: Job): Promise<Job> {
  return updateJob(sb, job, "begin_mutation");
}

export function completeJob(sb: DatabaseClient, job: Job, result: Record<string, any>): Promise<Job> {
  return updateJob(sb, job, "complete", result);
}

export function failJob(sb: DatabaseClient, job: Job, error: unknown): Promise<Job> {
  const message = error instanceof Error ? error.message : String(error);
  return updateJob(sb, job, "fail", message.slice(0, 1500));
}

export function releaseJob(sb: DatabaseClient, job: Job): Promise<Job> {
  return updateJob(sb, job, "release");
}

export async function savePage(sb: DatabaseClient, job: Job, source: string, page: number, rows: any[]): Promise<void> {
  await callRpc(sb, "rh_customer_sync_save_page", {
    ...owned(job), p_source: source, p_page: page, p_data: rows,
  });
}

export async function readPage(sb: DatabaseClient, job: Job, source: string, page: number): Promise<any[] | null> {
  const { data, error } = await sb.from("rh_customer_sync_pages").select("data")
    .eq("job_id", job.id).eq("source", source).eq("page", page).maybeSingle();
  if (error) throw new Error(`Não foi possível ler a página da sincronização de clientes: ${error.message}`);
  return data?.data ?? null;
}

export async function loadPages(sb: DatabaseClient, job: Job, source: string): Promise<CustomerSyncPage[]> {
  const pages: CustomerSyncPage[] = [];
  // PostgREST caps a response at 1,000 records by default; never silently truncate staging.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from("rh_customer_sync_pages").select("page,data")
      .eq("job_id", job.id).eq("source", source).order("page", { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error(`Não foi possível ler as páginas da sincronização de clientes: ${error.message}`);
    pages.push(...(data ?? []));
    if (!data || data.length < 1000) return pages;
  }
}
