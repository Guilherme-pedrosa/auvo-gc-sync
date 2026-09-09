// Garante que TODA requisição à API do GestãoClick seja atribuída ao usuário
// técnico da API. O chamador nunca pode substituir esse usuário pelo perfil
// humano que está usando a interface.
import {
  forceGcApiUserInHeaders,
  forceGcApiUserInRequest,
  forceGcApiUserInUrl,
  isGestaoClickApiUrl,
  isGestaoClickMcpUrl,
} from "./gc-user-core.ts";
import { GC_BROKER_URL, normalizeSource } from "./gc-broker-core.ts";

// ID confirmado do usuário "API GC" no GestãoClick. Ele é deliberadamente
// fixo para que um secret ou payload mal configurado não atribua ações ao Guilherme.
export const GC_API_USER_ID = "1320473";

/** Headers padrão para qualquer chamada ao GC (inclui o usuário da API). */
export function gcHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(extra ?? {}),
    "access-token": Deno.env.get("GC_ACCESS_TOKEN") ?? "",
    "secret-access-token": Deno.env.get("GC_SECRET_TOKEN") ?? "",
    "Content-Type": "application/json",
    "usuario-id": GC_API_USER_ID,
  };
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["AbortError", "TimeoutError"].includes(error.name)) return false;
  if (/header|invalid url|parse url/i.test(error.message)) return false;
  if (["NetworkError", "ConnectionReset", "ConnectionRefused", "NotConnected", "BrokenPipe", "UnexpectedEof"].includes(error.name)) return true;
  return error instanceof TypeError &&
    /fetch failed|failed to fetch|network.?error|network request failed|error sending request|connection (?:reset|refused|closed)/i.test(error.message);
}

// Limite de saída da plataforma: a requisição nem chega a ser enviada,
// portanto é seguro repetir mesmo em gravações.
function rateLimitDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  if (!/rate.?limit/i.test(message)) return null;
  const match = message.match(/retry after (\d+)\s*ms/i);
  const suggested = match ? Number(match[1]) : 1_000;
  return Math.min(Math.max(suggested + 250, 500), 45_000);
}

async function fetchBroker(
  originalFetch: typeof fetch,
  init: RequestInit,
  method: string,
): Promise<Response> {
  // The broker uses POST even for reads. Retry based on the logical GC method,
  // never on the broker's HTTP method, to avoid repeating business writes.
  const isSafe = ["GET", "HEAD"].includes(method.toUpperCase());
  const maxAttempts = isSafe ? 4 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    init.signal?.throwIfAborted();
    try {
      return await originalFetch(GC_BROKER_URL, init);
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
        throw error;
      }
      const rateWait = rateLimitDelayMs(error);
      if (rateWait !== null && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, rateWait));
        continue;
      }
      if (!isSafe || !isNetworkFailure(error) || attempt === maxAttempts - 1) {
        throw new Error("Falha no transporte do broker GestãoClick", { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error("Falha no transporte do broker GestãoClick");
}


async function unpackBrokerResponse(response: Response, method: string): Promise<Response> {
  if (!response.ok) return response;

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new Error("Resposta inválida do broker GestãoClick: JSON inválido ou incompleto", { cause: error });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Resposta inválida do broker GestãoClick: envelope ausente");
  }
  const envelope = raw as { data?: unknown; status?: unknown; error?: unknown };
  const status = typeof envelope.status === "number" || (
      typeof envelope.status === "string" && /^[2-5]\d{2}$/.test(envelope.status)
    ) ? Number(envelope.status) : NaN;
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error("Resposta inválida do broker GestãoClick: status HTTP inválido");
  }
  if (method.toUpperCase() === "HEAD" || [204, 205, 304].includes(status)) {
    return new Response(null, { status });
  }
  const hasData = Object.hasOwn(envelope, "data");
  if (!hasData && !(status >= 400 && typeof envelope.error === "string")) {
    throw new Error("Resposta inválida do broker GestãoClick: dados ausentes");
  }
  return new Response(JSON.stringify(hasData ? envelope.data : { message: envelope.error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createGcFetch(originalFetch: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!isGestaoClickApiUrl(rawUrl)) {
      return originalFetch(input, init);
    }

    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    requestSignal?.throwIfAborted();
    let protectedRequest: Request;
    try {
      protectedRequest = await forceGcApiUserInRequest(input, init, GC_API_USER_ID);
    } catch (error) {
      if (requestSignal?.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
        throw error;
      }
      // Plano B: garante o usuário técnico ao menos na URL e no cabeçalho.
      // O corpo de gravações ainda é protegido pelo broker (protectWritePayload).
      console.error(
        `[gc-user] proteção completa falhou, aplicando fallback URL+header: ${(error as Error)?.message ?? error}`,
      );
      try {
        const base = new Request(input as RequestInfo, init);
        const headers = forceGcApiUserInHeaders(base.headers, GC_API_USER_ID);
        headers.delete("content-length");
        const method = base.method.toUpperCase();
        const body = ["GET", "HEAD"].includes(method) ? undefined : await base.clone().text();
        protectedRequest = new Request(forceGcApiUserInUrl(base.url, GC_API_USER_ID), {
          method: base.method,
          headers,
          body,
          redirect: base.redirect,
        });
      } catch (fallbackError) {
        throw new Error(
          `Chamada ao GestãoClick bloqueada: não foi possível garantir o usuário da API GC (${
            (fallbackError as Error)?.message ?? fallbackError
          })`,
          { cause: error },
        );
      }
    }


    // MCP usa JSON-RPC/SSE e não pode atravessar o broker de endpoints /api/.
    // A identificação técnica já foi aplicada à URL e aos dados de chamar_api.
    if (isGestaoClickMcpUrl(protectedRequest.url)) {
      return originalFetch(protectedRequest, requestSignal ? { signal: requestSignal } : undefined);
    }

    // Somente o broker pode atravessar esta fronteira diretamente. Todas as
    // demais funções deste projeto entram no mesmo orçamento/cache global.
    if (protectedRequest.headers.get("x-gc-broker-direct") === "1") {
      const directHeaders = new Headers(protectedRequest.headers);
      directHeaders.delete("x-gc-broker-direct");
      const directRequest = new Request(protectedRequest, { headers: directHeaders });
      return originalFetch(directRequest, requestSignal ? { signal: requestSignal } : undefined);
    }

    const target = new URL(protectedRequest.url);
    let payload: unknown;
    if (!["GET", "HEAD"].includes(protectedRequest.method.toUpperCase())) {
      const rawBody = await protectedRequest.clone().text();
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = rawBody;
        }
      }
    }

    const brokerResponse = await fetchBroker(originalFetch, {
      method: "POST",
      signal: requestSignal,
      headers: {
        "Content-Type": "application/json",
        "x-gc-source": normalizeSource(Deno.env.get("GC_CALLER_APP") || "auvo-gc-sync"),
      },
      body: JSON.stringify({
        endpoint: `${target.pathname}${target.search}`,
        method: protectedRequest.method,
        payload,
        source: normalizeSource(Deno.env.get("GC_CALLER_APP") || "auvo-gc-sync"),
      }),
    }, protectedRequest.method);
    return unpackBrokerResponse(brokerResponse, protectedRequest.method);
  }) as typeof fetch;
}

let installed = false;
export function installGcUsuarioId() {
  if (installed) return;
  installed = true;
  globalThis.fetch = createGcFetch(globalThis.fetch.bind(globalThis));
}
