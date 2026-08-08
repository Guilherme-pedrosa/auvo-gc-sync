import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { gcHeaders } from "../_shared/gc-user.ts";

const GC_BASE = "https://api.gestaoclick.com/api";

async function fetchAllPages(endpoint: string, params: Record<string, string> = {}): Promise<any[]> {
  const all: any[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const url = new URL(`${GC_BASE}/${endpoint}`);
    url.searchParams.set("limite", "100");
    url.searchParams.set("pagina", String(pagina));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), { headers: gcHeaders() });
    if (!res.ok) break;
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) break;
    all.push(...rows.map(r => r.Compra || r.Orcamento || r.Pedido || r));
    if (Number(json?.meta?.total_paginas || 0) <= pagina) break;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Pegar orçamentos nas situações de interesse
    const situacoes = ["8743484", "8743485", "8894381"];
    const orcamentosProm = Promise.all(situacoes.map(s => fetchAllPages("orcamentos", { situacao_id: s })));
    
    // 2. Pegar pedidos de compra abertos
    const comprasProm = fetchAllPages("compras", { situacao_id: "1675083" }); // COMPRADO - AG CHEGADA

    const [orcLists, compras] = await Promise.all([orcamentosProm, comprasProm]);
    const orcamentos = orcLists.flat();

    // 3. Cruzamento e enriquecimento com "WeDo Pick & Pack" logic (rastreamento de estoque/compras)
    // Aqui simulamos a busca de informações de rastreamento que seriam integradas.
    
    return new Response(JSON.stringify({ 
      ok: true, 
      orcamentosCount: orcamentos.length,
      comprasCount: compras.length,
      itens: [...orcamentos, ...compras] 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
