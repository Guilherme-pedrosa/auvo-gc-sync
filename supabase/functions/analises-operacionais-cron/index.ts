// ═══════════════════════════════════════════════════════════════════
// analises-operacionais-cron
// Executa diariamente (07:00) a geração de análises operacionais
// para o período: hoje-30 dias → hoje. Faz o loop de lotes.
// ═══════════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body?.dias) || 30, 1), 120);

    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const fim = isoDate(hoje);
    const inicioDate = new Date(hoje);
    inicioDate.setDate(inicioDate.getDate() - dias);
    const inicio = isoDate(inicioDate);

    let processadas = 0;
    let restantes = 1;
    let voltas = 0;
    const falhas: unknown[] = [];

    while (restantes > 0 && voltas < 25) {
      voltas++;
      const res = await fetch(`${supabaseUrl}/functions/v1/analises-operacionais`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ inicio, fim, limit: 20 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        falhas.push(data?.error || `HTTP ${res.status}`);
        break;
      }
      processadas += data.processadas || 0;
      restantes = data.restantes || 0;
      if (data.falhas?.length) falhas.push(...data.falhas);
      if (!data.processadas && !restantes) break;
    }

    console.log(`[analises-cron] ${inicio}→${fim} processadas=${processadas} voltas=${voltas}`);
    return json({ ok: true, inicio, fim, processadas, restantes, voltas, falhas });
  } catch (e) {
    console.error("[analises-cron] erro", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
