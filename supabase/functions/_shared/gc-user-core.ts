export const GC_API_HOST = "api.gestaoclick.com";

function requireApiUserId(apiUserId: string): string {
  const normalized = String(apiUserId || "").trim();
  if (!normalized) {
    throw new Error("GC_API_USER_ID não está configurado");
  }
  return normalized;
}

export function isGestaoClickApiUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.toLowerCase() === GC_API_HOST;
  } catch {
    return false;
  }
}

export function forceGcApiUserInUrl(rawUrl: string, apiUserId: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("usuario_id", requireApiUserId(apiUserId));
  return url.toString();
}

export function forceGcApiUserInHeaders(headersInit: HeadersInit | undefined, apiUserId: string): Headers {
  const headers = new Headers(headersInit ?? {});
  headers.set("usuario-id", requireApiUserId(apiUserId));
  return headers;
}

export function forceGcApiUserInBody(body: unknown, apiUserId: string): unknown {
  if (typeof body !== "string") return body;
  const requiredApiUserId = requireApiUserId(apiUserId);

  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed.usuario_id = requiredApiUserId;
      return JSON.stringify(parsed);
    }
  } catch {
    // Corpos não JSON continuam protegidos pelo query param e pelo cabeçalho.
  }

  return body;
}

export function isGestaoClickMcpUrl(rawUrl: string): boolean {
  return isGestaoClickApiUrl(rawUrl) && new URL(rawUrl).pathname.replace(/\/$/, "") === "/mcp";
}

/** Mantém o envelope JSON-RPC; o campo REST pertence aos dados de chamar_api. */
export function forceGcApiUserInMcpBody(body: string, apiUserId: string): string {
  const requiredApiUserId = requireApiUserId(apiUserId);
  const protectMessage = (message: unknown): unknown => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const rpc = message as Record<string, unknown>;
    if (rpc.method !== "tools/call") return message;
    const params = rpc.params as Record<string, unknown> | undefined;
    if (params?.name !== "chamar_api") return message;
    const args = params.arguments as Record<string, unknown> | undefined;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Argumentos inválidos para chamar_api");
    }
    const data = args.dados;
    if (data != null && (typeof data !== "object" || Array.isArray(data))) {
      throw new Error("Dados inválidos para chamar_api");
    }
    return {
      ...rpc,
      params: {
        ...params,
        arguments: { ...args, dados: { ...(data as Record<string, unknown> ?? {}), usuario_id: requiredApiUserId } },
      },
    };
  };
  const parsed = JSON.parse(body);
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(protectMessage) : protectMessage(parsed));
}

export async function forceGcApiUserInRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  apiUserId: string,
): Promise<Request> {
  // Combina primeiro Request + init para que nenhum override posterior consiga
  // recolocar o usuário humano depois da proteção.
  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  let body: BodyInit | undefined;

  if (method !== "GET" && method !== "HEAD") {
    const text = await request.clone().text();
    body = isGestaoClickMcpUrl(request.url)
      ? forceGcApiUserInMcpBody(text, apiUserId)
      : forceGcApiUserInBody(text, apiUserId) as BodyInit;
  }

  const headers = forceGcApiUserInHeaders(request.headers, apiUserId);
  headers.delete("content-length");

  return new Request(forceGcApiUserInUrl(request.url, apiUserId), {
    method: request.method,
    headers,
    body,
    redirect: request.redirect,
  });
}
