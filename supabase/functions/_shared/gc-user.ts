// Garante que TODA requisição à API do GestãoClick leve o usuário da API (usuario_id).
// Sem isso o GC atribui a ação ao usuário logado errado / rejeita a chamada.
export const GC_API_USER_ID = Deno.env.get("GC_API_USER_ID") || "1320473";

const GC_HOST = "api.gestaoclick.com";

let installed = false;

export function installGcUsuarioId() {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = ((input: any, init?: RequestInit) => {
    try {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input?.url;

      if (typeof rawUrl === "string" && rawUrl.includes(GC_HOST)) {
        const url = new URL(rawUrl);
        if (!url.searchParams.has("usuario_id")) {
          url.searchParams.set("usuario_id", GC_API_USER_ID);
        }
        if (typeof input === "string" || input instanceof URL) {
          return originalFetch(url.toString(), init);
        }
        return originalFetch(new Request(url.toString(), input as Request), init);
      }
    } catch (_) {
      // se falhar o parse, segue o fluxo normal
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
