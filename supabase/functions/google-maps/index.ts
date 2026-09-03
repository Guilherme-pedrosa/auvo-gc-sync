import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type GeocodeResult = {
  address: string;
  lat: number | null;
  lng: number | null;
  formatted: string | null;
  status: string;
  error: string | null;
  cached: boolean;
};

function normalizeAddressKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cacheIsFresh(row: any): boolean {
  const timestamp = Date.parse(String(row?.geocoded_at || row?.updated_at || ""));
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = Date.now() - timestamp;
  const ttlMs = row?.status === "ok"
    ? 180 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs < ttlMs;
}

function fromCache(address: string, row: any): GeocodeResult {
  return {
    address,
    lat: row?.status === "ok" ? Number(row.latitude) : null,
    lng: row?.status === "ok" ? Number(row.longitude) : null,
    formatted: row?.formatted_address || null,
    status: row?.provider_status || (row?.status === "ok" ? "OK" : "CACHE_MISS"),
    error: row?.last_error || null,
    cached: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!GOOGLE_MAPS_API_KEY) {
    return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // ACTION: debug - test raw geocode response
    if (action === "debug_geocode") {
      const { address } = body;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address || "Goiânia, GO, Brasil")}&key=${GOOGLE_MAPS_API_KEY}&region=br&language=pt-BR`;
      const res = await fetch(url);
      const data = await res.json();
      return new Response(JSON.stringify({ raw_google_response: data, key_prefix: GOOGLE_MAPS_API_KEY.substring(0, 10) + "..." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: geocode - convert address to lat/lng
    if (action === "geocode") {
      const { addresses, refresh = false } = body; // string[]
      if (!addresses || !Array.isArray(addresses)) {
        return new Response(JSON.stringify({ error: "addresses array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (addresses.length > 50) {
        return new Response(JSON.stringify({ error: "A geocodificação aceita no máximo 50 endereços por lote" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const normalizedAddresses = addresses.map((value: unknown) => String(value || "").trim());
      const addressKeys = [...new Set(normalizedAddresses.map(normalizeAddressKey).filter(Boolean))];
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const supabase = supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
        : null;

      const cachedByKey = new Map<string, any>();
      if (supabase && !refresh && addressKeys.length > 0) {
        const { data: cachedRows, error: cacheReadError } = await supabase
          .from("os_map_geocoding_cache")
          .select("address_key,latitude,longitude,formatted_address,status,provider_status,last_error,geocoded_at,updated_at")
          .in("address_key", addressKeys);
        if (cacheReadError) {
          console.warn(`[google-maps] Cache indisponível, seguindo sem cache: ${cacheReadError.message}`);
        } else {
          for (const row of cachedRows || []) {
            if (cacheIsFresh(row)) cachedByKey.set(row.address_key, row);
          }
        }
      }

      const resultByKey = new Map<string, GeocodeResult>();
      const pending = [...new Map(normalizedAddresses.map((address) => [normalizeAddressKey(address), address])).entries()]
        .filter(([key, address]) => key && address.length >= 5 && !cachedByKey.has(key));

      for (const [key, row] of cachedByKey) {
        const address = normalizedAddresses.find((value) => normalizeAddressKey(value) === key) || row.query_address || "";
        resultByKey.set(key, fromCache(address, row));
      }

      async function geocodeOne(key: string, address: string): Promise<[string, GeocodeResult, any]> {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&region=br&language=pt-BR`;
          const response = await fetch(url);
          const data = await response.json();
          const providerStatus = String(data?.status || `HTTP_${response.status}`);
          if (response.ok && providerStatus === "OK" && data.results?.length > 0) {
            const location = data.results[0].geometry.location;
            const result: GeocodeResult = {
              address,
              lat: Number(location.lat),
              lng: Number(location.lng),
              formatted: data.results[0].formatted_address || address,
              status: providerStatus,
              error: null,
              cached: false,
            };
            return [key, result, {
              address_key: key,
              query_address: address,
              latitude: result.lat,
              longitude: result.lng,
              formatted_address: result.formatted,
              status: "ok",
              provider_status: providerStatus,
              last_error: null,
              attempts: 1,
              geocoded_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }];
          }

          const message = data?.error_message
            || (providerStatus === "ZERO_RESULTS" ? "Endereço não localizado pelo Google" : `Google Maps respondeu ${providerStatus}`);
          return [key, {
            address,
            lat: null,
            lng: null,
            formatted: null,
            status: providerStatus,
            error: message,
            cached: false,
          }, {
            address_key: key,
            query_address: address,
            latitude: null,
            longitude: null,
            formatted_address: null,
            status: providerStatus === "ZERO_RESULTS" ? "not_found" : "error",
            provider_status: providerStatus,
            last_error: message,
            attempts: 1,
            geocoded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha de rede ao geocodificar";
          return [key, {
            address,
            lat: null,
            lng: null,
            formatted: null,
            status: "NETWORK_ERROR",
            error: message,
            cached: false,
          }, {
            address_key: key,
            query_address: address,
            latitude: null,
            longitude: null,
            formatted_address: null,
            status: "error",
            provider_status: "NETWORK_ERROR",
            last_error: message,
            attempts: 1,
            geocoded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }];
        }
      }

      const cacheWrites: any[] = [];
      // Concorrência controlada: muito mais rápido que 1 a 1, sem rajada de 50.
      for (let index = 0; index < pending.length; index += 5) {
        const batch = pending.slice(index, index + 5);
        const settled = await Promise.all(batch.map(([key, address]) => geocodeOne(key, address)));
        for (const [key, result, cacheRow] of settled) {
          resultByKey.set(key, result);
          cacheWrites.push(cacheRow);
        }
      }

      if (supabase && cacheWrites.length > 0) {
        const { error: cacheWriteError } = await supabase
          .from("os_map_geocoding_cache")
          .upsert(cacheWrites, { onConflict: "address_key" });
        if (cacheWriteError) console.warn(`[google-maps] Falha ao gravar cache: ${cacheWriteError.message}`);
      }

      const results: GeocodeResult[] = normalizedAddresses.map((address) => {
        if (address.length < 5) {
          return { address, lat: null, lng: null, formatted: null, status: "INVALID_ADDRESS", error: "Endereço vazio ou incompleto", cached: false };
        }
        return resultByKey.get(normalizeAddressKey(address))
          || { address, lat: null, lng: null, formatted: null, status: "NOT_PROCESSED", error: "Endereço não processado", cached: false };
      });

      return new Response(JSON.stringify({
        results,
        meta: {
          total: results.length,
          cacheHits: results.filter((result) => result.cached).length,
          requestedFromGoogle: pending.length,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: directions - get optimized route (supports >25 waypoints via chunking)
    if (action === "directions") {
      const { origin, destination, waypoints } = body;

      if (!origin || !destination) {
        return new Response(JSON.stringify({ error: "origin and destination required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const MAX_WAYPOINTS = 23; // Google allows 25 waypoints + origin + destination

      // Helper to call Directions API for a single chunk
      async function fetchDirections(orig: string, dest: string, wps: string[]) {
        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(dest)}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;
        if (wps.length > 0) {
          const waypointStr = "optimize:true|" + wps.join("|");
          url += `&waypoints=${encodeURIComponent(waypointStr)}`;
        }
        const res = await fetch(url);
        return await res.json();
      }

      const allWaypoints = waypoints || [];

      if (allWaypoints.length <= MAX_WAYPOINTS) {
        // Simple case: fits in one request
        const data = await fetchDirections(origin, destination, allWaypoints);
        if (data.status !== "OK") {
          return new Response(JSON.stringify({ error: `Directions API error: ${data.status}`, details: data.error_message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const route = data.routes?.[0];
        const legs = route?.legs || [];
        const totalDistance = legs.reduce((sum: number, l: any) => sum + (l.distance?.value || 0), 0);
        const totalDuration = legs.reduce((sum: number, l: any) => sum + (l.duration?.value || 0), 0);
        return new Response(JSON.stringify({
          polyline: route?.overview_polyline?.points || null,
          waypoint_order: route?.waypoint_order || [],
          total_distance_km: Math.round(totalDistance / 100) / 10,
          total_duration_min: Math.round(totalDuration / 60),
          legs: legs.map((l: any) => ({
            distance: l.distance?.text,
            duration: l.duration?.text,
            start_address: l.start_address,
            end_address: l.end_address,
          })),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Chunked case: split waypoints into batches of MAX_WAYPOINTS
      const chunks: string[][] = [];
      for (let i = 0; i < allWaypoints.length; i += MAX_WAYPOINTS) {
        chunks.push(allWaypoints.slice(i, i + MAX_WAYPOINTS));
      }

      console.log(`[google-maps] Splitting ${allWaypoints.length} waypoints into ${chunks.length} chunks`);

      const allLegs: any[] = [];
      const allPolylines: string[] = [];
      let totalDistance = 0;
      let totalDuration = 0;

      for (let c = 0; c < chunks.length; c++) {
        const chunkOrigin = c === 0 ? origin : allWaypoints[c * MAX_WAYPOINTS - 1] || origin;
        const chunkDest = c === chunks.length - 1 ? destination : chunks[c][chunks[c].length - 1];
        const chunkWps = c === chunks.length - 1 ? chunks[c] : chunks[c].slice(0, -1);

        const data = await fetchDirections(chunkOrigin, chunkDest, chunkWps);
        if (data.status !== "OK") {
          console.error(`[google-maps] Chunk ${c + 1} failed: ${data.status} - ${data.error_message}`);
          continue;
        }

        const route = data.routes?.[0];
        const legs = route?.legs || [];
        allLegs.push(...legs.map((l: any) => ({
          distance: l.distance?.text,
          duration: l.duration?.text,
          start_address: l.start_address,
          end_address: l.end_address,
        })));
        if (route?.overview_polyline?.points) {
          allPolylines.push(route.overview_polyline.points);
        }
        totalDistance += legs.reduce((sum: number, l: any) => sum + (l.distance?.value || 0), 0);
        totalDuration += legs.reduce((sum: number, l: any) => sum + (l.duration?.value || 0), 0);
      }

      return new Response(JSON.stringify({
        polyline: allPolylines[0] || null,
        polylines: allPolylines,
        waypoint_order: [],
        total_distance_km: Math.round(totalDistance / 100) / 10,
        total_duration_min: Math.round(totalDuration / 60),
        legs: allLegs,
        chunked: true,
        chunks_count: chunks.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: api_key - return key for Maps JS API (client-side map rendering)
    if (action === "api_key") {
      return new Response(JSON.stringify({ key: GOOGLE_MAPS_API_KEY }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
