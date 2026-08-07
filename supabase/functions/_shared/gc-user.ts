// Garante que TODA requisição à API do GestãoClick seja atribuída ao usuário
// técnico da API. O chamador nunca pode substituir esse usuário pelo perfil
// humano que está usando a interface.
import {
  forceGcApiUserInRequest,
  isGestaoClickApiUrl,
} from "./gc-user-core.ts";

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

let installed = false;

export function installGcUsuarioId() {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!isGestaoClickApiUrl(rawUrl)) {
      return originalFetch(input, init);
    }

    try {
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const protectedRequest = await forceGcApiUserInRequest(input, init, GC_API_USER_ID);
      return originalFetch(protectedRequest, requestSignal ? { signal: requestSignal } : undefined);
    } catch (error) {
      // Fail closed: uma chamada ao GC nunca segue sem a identificação técnica.
      throw new Error("Chamada ao GestãoClick bloqueada: não foi possível garantir o usuário da API GC", {
        cause: error,
      });
    }
  }) as typeof fetch;
}
