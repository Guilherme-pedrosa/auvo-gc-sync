type SyncBody = Record<string, unknown>;
type SyncReply = Record<string, unknown>;
type InvokeSync = (body: SyncBody) => Promise<{ data: SyncReply | null; error: unknown }>;

type ContinuationOptions = {
  signal?: AbortSignal;
  onProgress?: (reply: SyncReply) => void;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Acompanhamento da sincronização cancelado", "AbortError");
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  checkCancellation(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new DOMException("Acompanhamento da sincronização cancelado", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** Acompanha o mesmo job persistido; nunca reinicia uma operação após falha. */
export async function runRhClientesSync(
  invoke: InvokeSync,
  initialBody: SyncBody,
  options: ContinuationOptions = {},
): Promise<SyncReply> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const deadline = now() + (options.timeoutMs ?? 15 * 60_000);
  let body = initialBody;
  let jobId: string | undefined;

  for (;;) {
    checkCancellation(options.signal);
    const { data, error } = await invoke(body);
    checkCancellation(options.signal);
    if (error) throw error;
    if (!data || typeof data !== "object") throw new Error("Resposta inválida da sincronização de clientes");
    if (data.apiVersion !== "gc-auvo-v2") {
      throw new Error("A Edge Function rh-clientes-sync-gc publicada está desatualizada. Atualize a função antes de sincronizar.");
    }
    if (!data.ok) {
      throw new Error(String(data.error || `A sincronização terminou com ${data.errors ?? 1} falha(s)`));
    }
    // A versão anterior finalizava na própria resposta e não enviava done.
    if (data.done !== false) return data;
    if (typeof data.jobId !== "string" || !data.jobId.trim()) {
      throw new Error("Resposta inválida da sincronização: identificador do job ausente");
    }
    if (jobId && jobId !== data.jobId) {
      throw new Error("Resposta inválida da sincronização: o job foi alterado durante a execução");
    }
    jobId = data.jobId;
    options.onProgress?.(data);

    const timeout = () => new Error(
      `A sincronização continua em segundo plano (job ${jobId}). O acompanhamento atingiu 15 minutos; atualize a lista para verificar o resultado.`,
    );
    if (now() >= deadline) throw timeout();
    const requestedDelay = Number(data.retryAfterMs);
    const delay = Number.isFinite(requestedDelay) ? Math.min(2000, Math.max(500, requestedDelay)) : 1000;
    await sleep(Math.min(delay, deadline - now()), options.signal);
    checkCancellation(options.signal);
    if (now() >= deadline) throw timeout();
    // A versão antiga trata ações desconhecidas como sync completo. Este
    // envelope falha na validação de IDs vazios se houver rollback do backend.
    body = { action: "lookup_document", rhClientIds: [], continueJob: true, requestVersion: "gc-auvo-v2", jobId };
  }
}

/** Pendentes devem ser um subconjunto menor para não repetir atualizações indefinidamente. */
export function validateRhPendingBatch(current: string[], pending: unknown): string[] {
  if (pending === undefined || pending === null) return [];
  if (!Array.isArray(pending) || pending.some((id) => typeof id !== "string")) {
    throw new Error("Resposta inválida ao atualizar nomes: lista de pendentes inválida");
  }
  const remaining = [...new Set(pending as string[])];
  const previous = new Set(current);
  if (remaining.length !== pending.length || remaining.some((id) => !previous.has(id))) {
    throw new Error("Resposta inválida ao atualizar nomes: pendentes fora do lote enviado");
  }
  if (remaining.length >= previous.size && remaining.length > 0) {
    throw new Error("A atualização de nomes não avançou. Os pendentes foram preservados; tente novamente mais tarde.");
  }
  return remaining;
}
