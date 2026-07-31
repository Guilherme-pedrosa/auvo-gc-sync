// Garante que TODA requisição à API do GestãoClick leve o usuário da API (usuario_id).
// Sem isso o GC atribui a ação ao usuário errado, rejeita a chamada e consome
// o limite de requisições da conta.
export const GC_API_USER_ID = Deno.env.get("GC_API_USER_ID") || "1320473";

const GC_HOST = "api.gestaoclick.com";

/** Headers padrão para qualquer chamada ao GC (inclui o usuário da API). */
export function gcHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "access-token": Deno.env.get("GC_ACCESS_TOKEN") ?? "",
    "secret-access-token": Deno.env.get("GC_SECRET_TOKEN") ?? "",
    "Content-Type": "application/json",
    "usuario-id": GC_API_USER_ID,
    ...(extra ?? {}),
  };
}

function withUsuarioId(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.searchParams.get("usuario_id")) {
    url.searchParams.set("usuario_id", GC_API_USER_ID);
  }
  return url.toString();
}

function injectBodyUsuarioId(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.usuario_id === undefined || parsed.usuario_id === null || parsed.usuario_id === "") {
        parsed.usuario_id = GC_API_USER_ID;
        return JSON.stringify(parsed);
      }
    }
  } catch (_) {
    // corpo não-JSON: mantém como está
  }
  return body;
}

let installed = false;

export function installGcUsuarioId() {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    try {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input?.url;

      if (typeof rawUrl === "string" && rawUrl.includes(GC_HOST)) {
        const finalUrl = withUsuarioId(rawUrl);

        if (typeof input === "string" || input instanceof URL) {
          const nextInit: RequestInit = { ...(init ?? {}) };
          const headers = new Headers(nextInit.headers ?? {});
          if (!headers.has("usuario-id")) headers.set("usuario-id", GC_API_USER_ID);
          nextInit.headers = headers;
          if (nextInit.body !== undefined && nextInit.body !== null) {
            nextInit.body = injectBodyUsuarioId(nextInit.body) as BodyInit;
          }
          return originalFetch(finalUrl, nextInit);
        }

        // input é um Request
        const req = input as Request;
        const headers = new Headers(req.headers);
        if (!headers.has("usuario-id")) headers.set("usuario-id", GC_API_USER_ID);
        let body: BodyInit | undefined = undefined;
        if (req.method !== "GET" && req.method !== "HEAD") {
          const text = await req.clone().text();
          body = (text ? injectBodyUsuarioId(text) : text) as BodyInit;
        }
        return originalFetch(new Request(finalUrl, {
          method: req.method,
          headers,
          body,
          redirect: req.redirect,
          signal: req.signal,
        }), init);
      }
    } catch (_) {
      // se falhar o parse, segue o fluxo normal
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
