import { createClient } from "npm:@supabase/supabase-js@2";
import { gcHeaders, installGcUsuarioId } from "../_shared/gc-user.ts";

// Todas as chamadas ao GestãoClick precisam ser contabilizadas no usuário
// técnico da API, inclusive se uma chamada futura esquecer gcHeaders().
installGcUsuarioId();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const GC_BASE = "https://api.gestaoclick.com/api";

async function fetchAllPages(endpoint: string, params: Record<string, string> = {}): Promise<any[]> {
  const all: any[] = [];
  for (let pagina = 1; pagina <= 12; pagina++) {
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
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Orçamentos nas situações de agendamento
    const situacoesOrc = ["8743484", "8743485", "8894381"];
    const orcamentosLists = await Promise.all(situacoesOrc.map(s => fetchAllPages("orcamentos", { situacao_id: s })));
    const orcamentos = orcamentosLists.flat();

    // 2. Extrair códigos de Pedido de Compra citados nos orçamentos (campos extras)
    const pcRegex = /(?:PC|PEDIDO COMPRA|COMPRA)\s*[:.\-]?\s*(\d{3,})/gi;
    const pcCodigos = new Set<string>();
    
    orcamentos.forEach(orc => {
      const extras = Array.isArray(orc.campos_extras) ? orc.campos_extras : [];
      extras.forEach((e: any) => {
        const conteudo = String(e.conteudo || "");
        let match;
        while ((match = pcRegex.exec(conteudo)) !== null) {
          pcCodigos.add(match[1]);
        }
      });
    });

    // 3. Buscar Pedidos de Compra vinculados para ver data de chegada
    const comprasMap = new Map();
    if (pcCodigos.size > 0) {
      const codigosArr = Array.from(pcCodigos);
      // Busca em lotes para evitar timeouts se forem muitos
      for (let i = 0; i < codigosArr.length; i += 10) {
        const lote = codigosArr.slice(i, i + 10);
        await Promise.all(lote.map(async (cod) => {
          const res = await fetch(`${GC_BASE}/compras?codigo=${cod}`, { headers: gcHeaders() });
          if (res.ok) {
            const json = await res.json();
            const docs = Array.isArray(json.data) ? json.data : [];
            const doc = docs.find((d: any) => String((d.Compra || d).codigo) === cod);
            if (doc) {
              const data = doc.Compra || doc;
              comprasMap.set(cod, {
                id: data.id,
                situacao: data.nome_situacao,
                data_chegada: data.data_saida || data.data_previsao_entrega || data.previsao_entrega || null
              });
            }
          }
        }));
      }
    }

    // 4. Mapear disponibilidade
    const itens = orcamentos.map(orc => {
      const orcExtras = Array.isArray(orc.campos_extras) ? orc.campos_extras : [];
      const pcVinc = [];
      let maxData: string | null = null;
      let temPendente = false;

      // Procura PCs citados
      orcExtras.forEach((e: any) => {
        const conteudo = String(e.conteudo || "");
        let match;
        while ((match = pcRegex.exec(conteudo)) !== null) {
          const cod = match[1];
          const compra = comprasMap.get(cod);
          if (compra) {
            pcVinc.push({ codigo: cod, ...compra });
            if (compra.data_chegada) {
              if (!maxData || compra.data_chegada > maxData) maxData = compra.data_chegada;
            } else {
              temPendente = true; // PC sem data trava o orçamento
            }
          }
        }
      });

      return {
        id: orc.id,
        codigo: orc.codigo,
        cliente: orc.nome_cliente,
        valor: orc.valor_total,
        situacao: orc.nome_situacao,
        data_disponivel: temPendente ? null : maxData,
        pcs: pcVinc
      };
    });

    return new Response(JSON.stringify({ ok: true, itens }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
