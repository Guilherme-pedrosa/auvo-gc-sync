import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GcRateLimitedError,
  REALTIME_GC_CACHE_TTL_MS,
  fetchGcWithoutRetry,
  getGcRateLimitBlockedUntil,
  isRealtimeGcCacheStale,
  shouldClaimRealtimeGcRefresh,
} from "../../supabase/functions/_shared/realtime-gc-refresh";

describe("realtime GC refresh policy", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");

  it("reuses a cache younger than 15 minutes", () => {
    const refreshedAt = new Date(now - REALTIME_GC_CACHE_TTL_MS + 1).toISOString();
    expect(isRealtimeGcCacheStale(refreshedAt, now)).toBe(false);
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt }, "cache", now)).toBe(false);
  });

  it("allows an automatic refresh only after the cache expires", () => {
    const refreshedAt = new Date(now - REALTIME_GC_CACHE_TTL_MS).toISOString();
    expect(isRealtimeGcCacheStale(refreshedAt, now)).toBe(true);
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt }, "cache", now)).toBe(true);
  });

  it("lets a manual refresh bypass TTL but not a lock or open circuit", () => {
    const refreshedAt = new Date(now - 60_000).toISOString();
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt }, "manual", now)).toBe(true);

    const refreshStartedAt = new Date(now - 60_000).toISOString();
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt, refreshStartedAt }, "manual", now)).toBe(false);

    const blockedUntil = new Date(now + 60_000).toISOString();
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt, blockedUntil }, "manual", now)).toBe(false);
  });

  it("opens the circuit for at least 15 minutes", () => {
    expect(getGcRateLimitBlockedUntil("30", now)).toBe(
      new Date(now + REALTIME_GC_CACHE_TTL_MS).toISOString(),
    );
    expect(getGcRateLimitBlockedUntil("1800", now)).toBe(
      new Date(now + 30 * 60 * 1000).toISOString(),
    );
  });

  it("does not retry a 429 response", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "60" },
    })) as unknown as typeof fetch;

    await expect(fetchGcWithoutRetry("https://api.gestaoclick.com/api/orcamentos", {}, fetchImpl))
      .rejects.toBeInstanceOf(GcRateLimitedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never lets the Auvo-only path claim a GC refresh", () => {
    expect(shouldClaimRealtimeGcRefresh(null, "read_only", now)).toBe(false);
    expect(shouldClaimRealtimeGcRefresh({ refreshedAt: null }, "read_only", now)).toBe(false);
  });

  it("keeps the 60-second poll in cache mode and reserves GC scans for the refresh path", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/pages/financeiro/RealtimeTrackingPage.tsx"),
      "utf8",
    );
    const edgeSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/realtime-tracking/index.ts"),
      "utf8",
    );

    expect(pageSource).toContain('body: { date: dateStr, gc_mode: "cache" }');
    expect(pageSource).toContain("refetchInterval: 15 * 60 * 1000");
    expect(pageSource).toContain("refetchIntervalInBackground: false");
    expect(pageSource).toContain('body: { date: dateStr, gc_mode: "read_only" }');
    expect(pageSource).toContain("window.setInterval(() => void refreshAuvoOnly(), 60_000)");
    expect(pageSource).toContain('body: { date: dateStr, gc_mode: "manual" }');
    expect(edgeSource).not.toMatch(/Promise\.all\(\[\s*fetchAllTasks[\s\S]*fetchGcOsMap/);
    expect(edgeSource).toContain("runInBackground(refreshRealtimeGcCache(");
    expect(edgeSource).toContain("const osMap = await fetchGcOsMap");
  });
});
