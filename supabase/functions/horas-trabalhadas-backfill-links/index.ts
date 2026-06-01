import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE = "https://api.gestaoclick.com";

function isPublicOs(v: unknown) {
  return typeof v === "string" && v.includes("gestaoclick.com/cobranca/");
}
function isPublicOrc(v: unknown) {
  return typeof v === "string" && v.includes("gestaoclick.com/prop/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const gcAccess = Deno.env.get("GC_ACCESS_TOKEN");
  const gcSecret = Deno.env.get("GC_SECRET_TOKEN");
  if (!gcAccess || !gcSecret) {
    return new Response(JSON.stringify({ ok: false, error: "GC tokens ausentes" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const gcH = {
    "access-token": gcAccess,
    "secret-access-token": gcSecret,
    "Content-Type": "application/json",
  };

  const body = await req.json().catch(() => ({}));
  const maxOs = Number(body?.maxOs ?? 800);
  const maxOrc = Number(body?.maxOrc ?? 800);

  // 1) Coleta IDs únicos faltando link
  const osIds = new Set<string>();
  const orcIds = new Set<string>();

  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tarefas_central")
      .select("gc_os_id, gc_os_link, gc_os_link_cobranca, gc_orcamento_id, gc_orc_link")
      .or("gc_os_id.not.is.null,gc_orcamento_id.not.is.null")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const osId = String(r.gc_os_id || "").trim();
      if (osId && !isPublicOs(r.gc_os_link_cobranca) && !isPublicOs(r.gc_os_link)) osIds.add(osId);
      const orcId = String(r.gc_orcamento_id || "").trim();
      if (orcId && !isPublicOrc(r.gc_orc_link)) orcIds.add(orcId);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const osList = Array.from(osIds).slice(0, maxOs);
  const orcList = Array.from(orcIds).slice(0, maxOrc);

  const fetchHash = async (resource: "ordens_servicos" | "orcamentos", id: string) => {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${GC_BASE}/api/${resource}/${encodeURIComponent(id)}`, {
        headers: gcH, signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      const hash = String((j?.data || j)?.hash || "").trim();
      return hash || null;
    } catch { return null; }
  };

  const CONC = 8;
  const osHash = new Map<string, string>();
  const orcHash = new Map<string, string>();

  for (let i = 0; i < osList.length; i += CONC) {
    const batch = osList.slice(i, i + CONC);
    const res = await Promise.all(batch.map((id) => fetchHash("ordens_servicos", id)));
    res.forEach((h, idx) => { if (h) osHash.set(batch[idx], h); });
  }
  for (let i = 0; i < orcList.length; i += CONC) {
    const batch = orcList.slice(i, i + CONC);
    const res = await Promise.all(batch.map((id) => fetchHash("orcamentos", id)));
    res.forEach((h, idx) => { if (h) orcHash.set(batch[idx], h); });
  }

  // 2) Persiste no banco
  let osUpdated = 0;
  let orcUpdated = 0;

  const persistOs = async (id: string, hash: string) => {
    const link = `https://gestaoclick.com/cobranca/${hash}`;
    const { error } = await supabase
      .from("tarefas_central")
      .update({ gc_os_link: link, gc_os_link_cobranca: link })
      .eq("gc_os_id", id);
    if (!error) osUpdated++;
  };
  const persistOrc = async (id: string, hash: string) => {
    const link = `https://gestaoclick.com/prop/${hash}`;
    const { error } = await supabase
      .from("tarefas_central")
      .update({ gc_orc_link: link })
      .eq("gc_orcamento_id", id);
    if (!error) orcUpdated++;
  };

  const osEntries = Array.from(osHash.entries());
  for (let i = 0; i < osEntries.length; i += 10) {
    await Promise.all(osEntries.slice(i, i + 10).map(([id, h]) => persistOs(id, h)));
  }
  const orcEntries = Array.from(orcHash.entries());
  for (let i = 0; i < orcEntries.length; i += 10) {
    await Promise.all(orcEntries.slice(i, i + 10).map(([id, h]) => persistOrc(id, h)));
  }

  return new Response(JSON.stringify({
    ok: true,
    osMissing: osIds.size,
    orcMissing: orcIds.size,
    osResolved: osHash.size,
    orcResolved: orcHash.size,
    osUpdated,
    orcUpdated,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});