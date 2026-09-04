import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GC_API_USER_ID } from "../_shared/gc-user.ts";
import {
  type BrokerRequestBody,
  cacheKeyFor,
  cacheTtlSeconds,
  GC_BROKER_DAILY_CAP,
  GC_BROKER_MIN_INTERVAL_MS,
  GC_BROKER_WRITE_RESERVE,
  normalizeGcEndpoint,
  normalizeSource,
  protectWritePayload,
} from "../_shared/gc-broker-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gc-source, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

type CacheRow = {
  response_body: unknown;
  response_status: number | null;
  expires_at: string | null;
  stale_until: string | null;
  refresh_started_at: string | null;
};

function responseEnvelope(
  data: unknown,
  status: number,
  metadata: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ data, status, ...metadata }), {
    status: 200,
    headers: jsonHeaders,
  });
}

function isFresh(row: CacheRow | null): boolean {
  return Boolean(row?.response_body !== null && row?.expires_at && Date.parse(row.expires_at) > Date.now());
}

function isStaleUsable(row: CacheRow | null): boolean {
  return Boolean(row?.response_body !== null && row?.stale_until && Date.parse(row.stale_until) > Date.now());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: jsonHeaders });
  }

  let claimedCacheKey: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const accessToken = Deno.env.get("GC_ACCESS_TOKEN") ?? "";
  const secretToken = Deno.env.get("GC_SECRET_TOKEN") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !accessToken || !secretToken) {
    return new Response(JSON.stringify({ error: "Broker GC não configurado" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json() as BrokerRequestBody;
    const method = String(body.method || "GET").toUpperCase();
    const isWrite = !["GET", "HEAD"].includes(method);
    const source = normalizeSource(body.source || req.headers.get("x-gc-source"));
    const normalizedUrl = normalizeGcEndpoint(body.endpoint || body.path, body.params);
    const endpointForCache = `${normalizedUrl.pathname}${normalizedUrl.search}`;
    const upstreamUrl = new URL(normalizedUrl);
    upstreamUrl.searchParams.set("usuario_id", GC_API_USER_ID);

    let cacheKey: string | null = null;
    let cached: CacheRow | null = null;
    if (!isWrite) {
      cacheKey = await cacheKeyFor(method, normalizedUrl);
      const { data } = await admin
        .from("gc_broker_cache")
        .select("response_body,response_status,expires_at,stale_until,refresh_started_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      cached = data as CacheRow | null;

      if (!body.force_refresh && isFresh(cached)) {
        await admin.rpc("gc_broker_record_cache_metric", { _source: source, _stale: false });
        return responseEnvelope(cached!.response_body, cached!.response_status ?? 200, {
          cached: true,
          stale: false,
          source,
        });
      }

      const { data: claimed, error: claimError } = await admin.rpc("gc_broker_claim_refresh", {
        _cache_key: cacheKey,
        _endpoint: endpointForCache,
        _lock_seconds: 20,
      });
      if (claimError) throw new Error(`Falha ao travar cache GC: ${claimError.message}`);

      if (!claimed) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await sleep(100);
          const { data } = await admin
            .from("gc_broker_cache")
            .select("response_body,response_status,expires_at,stale_until,refresh_started_at")
            .eq("cache_key", cacheKey)
            .maybeSingle();
          const refreshed = data as CacheRow | null;
          if (isFresh(refreshed)) {
            await admin.rpc("gc_broker_record_cache_metric", { _source: source, _stale: false });
            return responseEnvelope(refreshed!.response_body, refreshed!.response_status ?? 200, {
              cached: true,
              stale: false,
              deduplicated: true,
              source,
            });
          }
        }

        if (isStaleUsable(cached)) {
          await admin.rpc("gc_broker_record_cache_metric", { _source: source, _stale: true });
          return responseEnvelope(cached!.response_body, cached!.response_status ?? 200, {
            cached: true,
            stale: true,
            deduplicated: true,
            source,
          });
        }
        return responseEnvelope({ message: "Consulta GC já está em andamento" }, 429, {
          error: "GC_BROKER_BUSY",
          source,
        });
      }
      claimedCacheKey = cacheKey;
    }

    const configuredCap = Number(Deno.env.get("GC_BROKER_DAILY_CAP") || GC_BROKER_DAILY_CAP);
    const configuredReserve = Number(Deno.env.get("GC_BROKER_WRITE_RESERVE") || GC_BROKER_WRITE_RESERVE);
    const { data: slots, error: slotError } = await admin.rpc("gc_broker_acquire_slot", {
      _is_write: isWrite,
      _source: source,
      _daily_cap: configuredCap,
      _write_reserve: configuredReserve,
      _min_interval_ms: GC_BROKER_MIN_INTERVAL_MS,
    });
    if (slotError) {
      // Contenção/timeout no controlador de cota não deve virar 500: degradamos
      // para cache (mesmo velho) ou 429 para o chamador tentar de novo.
      console.error(`[gc-proxy] slot indisponível: ${slotError.message}`);
    }
    const slot = slotError ? null : (Array.isArray(slots) ? slots[0] : slots);

    if (!slot?.allowed) {

      if (cacheKey) {
        await admin.from("gc_broker_cache").update({ refresh_started_at: null }).eq("cache_key", cacheKey);
        if (isStaleUsable(cached)) {
          await admin.rpc("gc_broker_record_cache_metric", { _source: source, _stale: true });
          return responseEnvelope(cached!.response_body, cached!.response_status ?? 200, {
            cached: true,
            stale: true,
            quota_reason: slot?.reason,
            source,
          });
        }
      }
      return responseEnvelope({
        message: "Orçamento compartilhado de requisições do GestãoClick protegido",
        reason: slot?.reason || (slotError ? "broker_busy" : "quota"),
      }, 429, {
        error: slotError ? "GC_BROKER_BUSY" : "GC_BROKER_QUOTA",

        usage: {
          total: slot?.total_requests,
          reads: slot?.read_requests,
          writes: slot?.write_requests,
          cap: configuredCap,
        },
        source,
      });
    }

    const waitMs = Math.max(0, Number(slot.wait_ms || 0));
    if (waitMs > 0) await sleep(waitMs);

    const headers: Record<string, string> = {
      "access-token": accessToken,
      "secret-access-token": secretToken,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "usuario-id": GC_API_USER_ID,
      "x-gc-broker-direct": "1",
    };
    const init: RequestInit = { method, headers };
    if (isWrite && body.payload !== undefined) {
      init.body = JSON.stringify(protectWritePayload(body.payload, GC_API_USER_ID));
    }

    const upstream = await fetch(upstreamUrl.toString(), init);
    const rawText = await upstream.text();
    let data: unknown = rawText;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      // Endpoints antigos podem devolver texto; o envelope preserva-o.
    }

    if (upstream.status === 429) {
      await admin.rpc("gc_broker_mark_rate_limited", {
        _daily: /limite de requisi/i.test(rawText),
        _status: upstream.status,
        _error: rawText.slice(0, 500),
      });
    }

    if (cacheKey) {
      if (upstream.ok) {
        const ttl = cacheTtlSeconds(normalizedUrl, body.cache_ttl_seconds);
        const now = Date.now();
        await admin.from("gc_broker_cache").upsert({
          cache_key: cacheKey,
          endpoint: endpointForCache,
          response_body: data,
          response_status: upstream.status,
          expires_at: new Date(now + ttl * 1000).toISOString(),
          stale_until: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          refresh_started_at: null,
          updated_at: new Date(now).toISOString(),
        });
      } else {
        await admin.from("gc_broker_cache").update({ refresh_started_at: null }).eq("cache_key", cacheKey);
        if (isStaleUsable(cached)) {
          await admin.rpc("gc_broker_record_cache_metric", { _source: source, _stale: true });
          return responseEnvelope(cached!.response_body, cached!.response_status ?? 200, {
            cached: true,
            stale: true,
            provider_status: upstream.status,
            source,
          });
        }
      }
    } else if (upstream.ok && isWrite) {
      const collection = upstreamUrl.pathname.split("/").slice(0, 3).join("/");
      await admin.from("gc_broker_cache").delete().like("endpoint", `${collection}%`);
    }

    return responseEnvelope(data, upstream.status, {
      cached: false,
      stale: false,
      source,
      usage: {
        total: slot.total_requests,
        reads: slot.read_requests,
        writes: slot.write_requests,
        cap: configuredCap,
      },
    });
  } catch (error) {
    if (claimedCacheKey) {
      await admin.from("gc_broker_cache").update({ refresh_started_at: null }).eq("cache_key", claimedCacheKey);
    }
    console.error("[gc-proxy]", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
