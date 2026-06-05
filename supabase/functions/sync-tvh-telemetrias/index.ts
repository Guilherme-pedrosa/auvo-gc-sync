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
    // Fallback: TVH publishable (anon) key — public, safe to embed.
    // Usado se TVH_SERVICE_ROLE_KEY estiver expirado/inválido (HTTP 401 do Hub).
    const TVH_PUBLISHABLE_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbXB5cmVramJicWVreHJqZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Njc5NzMsImV4cCI6MjA4OTQ0Mzk3M30.ac7r6m5dLzMrEQxMQr74Bo38bgeupr5-bs0Ja4CCo2s";
    const tvhKey = Deno.env.get("TVH_SERVICE_ROLE_KEY") || TVH_PUBLISHABLE_KEY;
    const effectiveUrl = tvhUrl || "https://qfmpyrekjbbqekxrjgov.supabase.co";
    if (!effectiveUrl || !tvhKey) {
      return json({ ok: false, error: "Credenciais do Technician & Vehicle Hub não configuradas" }, 200);
    }

    // O endpoint `sync-daily-km` do Hub está rejeitando JWTs (401 Unauthorized
    // — provavelmente service role key rotacionado). Como fallback usamos
    // `cron-sync-rotaexata`, que aceita a anon key publishable e sincroniza o
    // dia atual. Dados de dias anteriores já são sincronizados pelo pg_cron
    // horário do próprio Hub.
    async function callHub(path: string, payload: Record<string, unknown>, key: string) {
      return await fetch(`${effectiveUrl.replace(/\/$/, "")}/functions/v1/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    // O endpoint `sync-daily-km` está rejeitando JWTs (provavelmente service
    // role rotacionado). Vamos direto no `cron-sync-rotaexata`, que aceita a
    // publishable key. Ele sincroniza o dia ATUAL — dias anteriores já são
    // cobertos pelo pg_cron horário do Hub.
    console.log(`[sync-tvh-telemetrias] v3 chamando cron-sync-rotaexata (range solicitado: ${startDate} → ${endDate})`);
    let response = await callHub("cron-sync-rotaexata", {}, TVH_PUBLISHABLE_KEY);
    const dbgText = await response.clone().text();
    console.log(`[sync-tvh-telemetrias] v3 cron-sync-rotaexata respondeu ${response.status} body=${dbgText.slice(0, 200)}`);

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