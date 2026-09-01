export const GC_BROKER_DAILY_CAP = 27_000;
export const GC_BROKER_WRITE_RESERVE = 3_000;
export const GC_BROKER_MIN_INTERVAL_MS = 350;
export const GC_BROKER_URL = "https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/gc-proxy";

export type BrokerRequestBody = {
  endpoint?: string;
  path?: string;
  method?: string;
  payload?: unknown;
  params?: Record<string, unknown>;
  source?: string;
  force_refresh?: boolean;
  cache_ttl_seconds?: number;
};

export function normalizeSource(value: unknown): string {
  const normalized = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "unknown";
}

export function normalizeGcEndpoint(
  rawEndpoint: unknown,
  params?: Record<string, unknown>,
): URL {
  const endpoint = String(rawEndpoint || "").trim();
  if (!endpoint) throw new Error("endpoint é obrigatório");

  const url = new URL(endpoint, "https://api.gestaoclick.com");
  if (url.origin !== "https://api.gestaoclick.com") {
    throw new Error("endpoint fora do GestãoClick");
  }
  if (!url.pathname.startsWith("/api/")) {
    throw new Error("endpoint deve começar com /api/");
  }

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  url.searchParams.delete("usuario_id");
  const sorted = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue)
  );
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return url;
}

export function cacheTtlSeconds(url: URL, requested?: number): number {
  if (Number.isFinite(requested)) {
    return Math.max(5, Math.min(3_600, Math.trunc(Number(requested))));
  }

  const path = url.pathname.toLowerCase();
  if (/\/(situacoes|formas_pagamentos|vendedores|usuarios|lojas|categorias|marcas|tabelas)(\/|$)/.test(path)) {
    return 3_600;
  }
  if (/\/produtos(\/|$)/.test(path)) return 300;
  if (/\/clientes(\/|$)/.test(path)) return 300;
  if (/\/(ordens_servicos|vendas|orcamentos|compras|movimentacoes)(\/|$)/.test(path)) return 30;
  return 60;
}

export async function cacheKeyFor(method: string, url: URL): Promise<string> {
  const raw = `${method.toUpperCase()} ${url.pathname}${url.search}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function protectWritePayload(payload: unknown, apiUserId: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), usuario_id: apiUserId };
}
