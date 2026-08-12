export const REALTIME_GC_CACHE_TTL_MS = 15 * 60 * 1000;
export const REALTIME_GC_REFRESH_LOCK_MS = 15 * 60 * 1000;
export const REALTIME_GC_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

export type RealtimeGcRefreshMode = "read_only" | "cache" | "manual";

export type RealtimeGcRefreshState = {
  refreshedAt?: string | null;
  refreshStartedAt?: string | null;
  blockedUntil?: string | null;
};

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shouldClaimRealtimeGcRefresh(
  state: RealtimeGcRefreshState | null | undefined,
  mode: RealtimeGcRefreshMode,
  nowMs = Date.now(),
): boolean {
  if (mode === "read_only") return false;

  const blockedUntil = timestamp(state?.blockedUntil);
  if (blockedUntil !== null && blockedUntil > nowMs) return false;

  const refreshStartedAt = timestamp(state?.refreshStartedAt);
  if (
    refreshStartedAt !== null &&
    refreshStartedAt > nowMs - REALTIME_GC_REFRESH_LOCK_MS
  ) {
    return false;
  }

  if (mode === "manual") return true;

  const refreshedAt = timestamp(state?.refreshedAt);
  return refreshedAt === null || refreshedAt <= nowMs - REALTIME_GC_CACHE_TTL_MS;
}

export function isRealtimeGcCacheStale(
  refreshedAt?: string | null,
  nowMs = Date.now(),
): boolean {
  const parsed = timestamp(refreshedAt);
  return parsed === null || parsed <= nowMs - REALTIME_GC_CACHE_TTL_MS;
}

export function getGcRateLimitBlockedUntil(
  retryAfter: string | null,
  nowMs = Date.now(),
): string {
  let retryAt = nowMs + REALTIME_GC_RATE_LIMIT_COOLDOWN_MS;

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAt = Math.max(retryAt, nowMs + seconds * 1000);
    } else {
      const parsedDate = Date.parse(retryAfter);
      if (Number.isFinite(parsedDate)) retryAt = Math.max(retryAt, parsedDate);
    }
  }

  return new Date(retryAt).toISOString();
}

export class GcRateLimitedError extends Error {
  readonly blockedUntil: string;

  constructor(retryAfter: string | null, nowMs = Date.now()) {
    super("GestaoClick respondeu 429; circuito temporariamente aberto");
    this.name = "GcRateLimitedError";
    this.blockedUntil = getGcRateLimitBlockedUntil(retryAfter, nowMs);
  }
}

export async function fetchGcWithoutRetry(
  input: string | URL | Request,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetchImpl(input, init);
  if (response.status === 429) {
    throw new GcRateLimitedError(response.headers.get("retry-after"));
  }
  return response;
}
