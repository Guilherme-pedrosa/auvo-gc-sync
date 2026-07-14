import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GC_ACCESS_TOKEN = Deno.env.get("GC_ACCESS_TOKEN") ?? "";
const GC_SECRET_TOKEN = Deno.env.get("GC_SECRET_TOKEN") ?? "";
const GC_BASE = "https://api.gestaoclick.com/v2";

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(ltda|me|s\.?a\.?|eireli|epp)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function gcSearch(term: string) {
  const url = `${GC_BASE}/clientes?nome=${encodeURIComponent(term)}`;
  const res = await fetch(url, {
    headers: {
      "access-token": GC_ACCESS_TOKEN,
      "secret-access-token": GC_SECRET_TOKEN,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const onlyIds: string[] | undefined = body?.ids;

    let query = supabase.from("rh_clientes").select("id, nome, gc_cliente_id, origem");
    if (onlyIds?.length) query = query.in("id", onlyIds);
    else query = query.is("gc_cliente_id", null).neq("origem", "manual");

    const { data: alvo, error } = await query.limit(500);
    if (error) throw error;

    let updated = 0, errors = 0;
    for (const c of alvo ?? []) {
      try {
        const results = await gcSearch(c.nome);
        const target = normalize(c.nome);
        const found = results.find((r: any) => normalize(r?.nome ?? r?.razao_social ?? "") === target)
          ?? results[0];
        if (!found) continue;

        const endereco = [
          found.endereco, found.numero, found.bairro,
        ].filter(Boolean).join(", ");

        const patch: Record<string, unknown> = {
          gc_cliente_id: String(found.id ?? found.codigo ?? ""),
          nome_fantasia: found.nome_fantasia ?? null,
          cpf_cnpj: found.cpf_cnpj ?? found.cnpj ?? found.cpf ?? null,
          email: found.email ?? null,
          telefone: found.telefone ?? found.celular ?? null,
          endereco: endereco || null,
          cidade: found.cidade ?? null,
          uf: found.estado ?? null,
          cep: found.cep ?? null,
          origem: "gc",
          sync_em: new Date().toISOString(),
        };
        const { error: upErr } = await supabase.from("rh_clientes").update(patch).eq("id", c.id);
        if (upErr) throw upErr;
        updated++;
      } catch (err) {
        console.error("sync-gc failed for", c.id, err);
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, updated, errors, total: alvo?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("rh-clientes-sync-gc error", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});