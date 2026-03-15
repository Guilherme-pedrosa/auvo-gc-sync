import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
      const { addresses } = body; // string[]
      if (!addresses || !Array.isArray(addresses)) {
        return new Response(JSON.stringify({ error: "addresses array required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: { address: string; lat: number | null; lng: number | null; formatted: string | null }[] = [];

      // Process in batches of 10 to avoid rate limits
      for (let i = 0; i < addresses.length; i++) {
        const addr = addresses[i];
        if (!addr || addr.length < 5) {
          results.push({ address: addr, lat: null, lng: null, formatted: null });
          continue;
        }

        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${GOOGLE_MAPS_API_KEY}&region=br&language=pt-BR`;
          const res = await fetch(url);
          const data = await res.json();

          // Debug: log Google's response status for first few addresses
          if (i < 3) {
            console.log(`[google-maps] Geocode "${addr.substring(0, 50)}..." → status=${data.status}, error=${data.error_message || "none"}, results=${data.results?.length || 0}`);
          }

          if (data.status === "OK" && data.results?.length > 0) {
            const loc = data.results[0].geometry.location;
            results.push({
              address: addr,
              lat: loc.lat,
              lng: loc.lng,
              formatted: data.results[0].formatted_address,
            });
          } else {
            if (data.error_message) {
              console.error(`[google-maps] Geocode error: ${data.status} - ${data.error_message}`);
            }
            results.push({ address: addr, lat: null, lng: null, formatted: null });
          }
        } catch (e) {
          console.error(`[google-maps] Geocode fetch error:`, e);
          results.push({ address: addr, lat: null, lng: null, formatted: null });
        }

        // Small delay to avoid hitting rate limits
        if (i < addresses.length - 1) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      return new Response(JSON.stringify({ results }), {
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
