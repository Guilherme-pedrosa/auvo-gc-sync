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

          if (data.status === "OK" && data.results?.length > 0) {
            const loc = data.results[0].geometry.location;
            results.push({
              address: addr,
              lat: loc.lat,
              lng: loc.lng,
              formatted: data.results[0].formatted_address,
            });
          } else {
            results.push({ address: addr, lat: null, lng: null, formatted: null });
          }
        } catch {
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

    // ACTION: directions - get optimized route
    if (action === "directions") {
      const { origin, destination, waypoints } = body;
      // origin/destination: "lat,lng" strings
      // waypoints: array of "lat,lng" strings

      if (!origin || !destination) {
        return new Response(JSON.stringify({ error: "origin and destination required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}&language=pt-BR&region=br`;

      if (waypoints && waypoints.length > 0) {
        // optimize:true tells Google to reorder waypoints for shortest route
        const waypointStr = "optimize:true|" + waypoints.join("|");
        url += `&waypoints=${encodeURIComponent(waypointStr)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== "OK") {
        return new Response(JSON.stringify({ error: `Directions API error: ${data.status}`, details: data.error_message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const route = data.routes?.[0];
      const legs = route?.legs || [];
      const waypointOrder = route?.waypoint_order || [];

      const totalDistance = legs.reduce((sum: number, l: any) => sum + (l.distance?.value || 0), 0);
      const totalDuration = legs.reduce((sum: number, l: any) => sum + (l.duration?.value || 0), 0);

      return new Response(JSON.stringify({
        polyline: route?.overview_polyline?.points || null,
        waypoint_order: waypointOrder,
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
