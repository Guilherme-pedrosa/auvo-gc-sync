import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "Não autenticado" }, 200);
    }

    const localAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await localAuth.auth.getUser();
    if (userError || !userData.user) {
      return json({ ok: false, error: "Não autenticado" }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const startDate = body.start_date;
    const endDate = body.end_date;
    if (!isDate(startDate) || !isDate(endDate)) {
      return json({ ok: false, error: "start_date e end_date são obrigatórios no formato YYYY-MM-DD" }, 200);
    }

    const tvhUrl = Deno.env.get("TVH_SUPABASE_URL");
    const tvhKey = Deno.env.get("TVH_SERVICE_ROLE_KEY");
    if (!tvhUrl || !tvhKey) {
      return json({ ok: false, error: "Credenciais do Technician & Vehicle Hub não configuradas" }, 200);
    }

    const endpoint = `${tvhUrl.replace(/\/$/, "")}/functions/v1/sync-daily-km`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tvhKey}`,
        apikey: tvhKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        mode: "resilient",
      }),
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!response.ok && response.status !== 207) {
      return json({
        ok: false,
        error: String(data.error || data.message || `Falha no Hub (${response.status})`),
        status: response.status,
        details: data,
      }, 200);
    }

    return json({ ok: true, ...data }, 200);
  } catch (err) {
    console.error("[sync-tvh-telemetrias] erro:", err);
    return json({ ok: false, error: (err as Error).message }, 200);
  }
});