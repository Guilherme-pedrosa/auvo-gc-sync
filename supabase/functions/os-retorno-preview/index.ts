import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE_URL = "https://api.gestaoclick.com";

function normalize(s: string): string {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isDeslocamento(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("deslocamento") || n.includes("desloc.") || n.startsWith("desloc");
}

function isHospedagemAlimentacao(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("hospedag") || n.includes("alimentac") || n.includes("refeic") || n.includes("diaria") || n.includes("hotel");
}

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  if (!isNaN(n) && /,/.test(String(v))) return n;
  const n2 = parseFloat(String(v));
  return isNaN(n2) ? 0 : n2;
}

function calcItemTotal(item: any): number {
  if (item.valor_total !== null && item.valor_total !== undefined && String(item.valor_total).trim() !== "") {
    return Math.max(0, toNum(item.valor_total));
  }
  const q = toNum(item.quantidade) || 1;
  const bruto = toNum(item.valor_total_bruto) || toNum(item.subtotal) ||
    ((toNum(item.valor_venda) || toNum(item.valor_unitario)) * q);
  const descPct = toNum(item.desconto_porcentagem) || toNum(item.desconto_percentual);
  if (descPct >= 100) return 0;
  if (descPct > 0) return Math.max(0, bruto - bruto * descPct / 100);
  const descVal = toNum(item.desconto_valor) || toNum(item.valor_desconto);
  if (descVal > 0) return Math.max(0, bruto - descVal);
  return Math.max(0, bruto);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const codigo = String(body?.gc_os_codigo || "").trim();
    if (!codigo) {
      return new Response(JSON.stringify({ ok: false, error: "gc_os_codigo é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const gcHeaders = {
      "access-token": Deno.env.get("GC_ACCESS_TOKEN")!,
      "secret-access-token": Deno.env.get("GC_SECRET_TOKEN")!,
      "Content-Type": "application/json",
    };

    // Busca OS pelo código (v2 retorna lista)
    const listResp = await fetch(`${GC_BASE_URL}/api/ordens_servicos?codigo=${encodeURIComponent(codigo)}&limite=1`, { headers: gcHeaders });
    if (!listResp.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Falha GC busca (${listResp.status})` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const listJson = await listResp.json().catch(() => ({}));
    const list: any[] = Array.isArray(listJson?.data) ? listJson.data : (Array.isArray(listJson) ? listJson : []);
    const found = list.find((o) => String(o?.codigo) === codigo) || list[0];
    if (!found?.id) {
      return new Response(JSON.stringify({ ok: false, error: `OS ${codigo} não encontrada no GestãoClick` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const osId = String(found.id);

    // Detalhe completo
    const detResp = await fetch(`${GC_BASE_URL}/api/ordens_servicos/${osId}`, { headers: gcHeaders });
    if (!detResp.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Falha GC detalhe (${detResp.status})` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const detJson = await detResp.json().catch(() => ({}));
    const detail = detJson?.data || detJson;

    const produtos: any[] = (Array.isArray(detail.produtos) ? detail.produtos : []).map((x: any) => x?.produto || x).filter(Boolean);
    const servicos: any[] = (Array.isArray(detail.servicos) ? detail.servicos : []).map((x: any) => x?.servico || x).filter(Boolean);
    const totalRecebidoOS = toNum(detail.valor_total);
    const totalRecebidoPecasOS = toNum(detail.valor_produtos);
    const totalRecebidoServicosOS = toNum(detail.valor_servicos);

    let valor_pecas = 0;
    for (const p of produtos) {
      const t = calcItemTotal(p);
      const hosp = isHospedagemAlimentacao(String(p.nome_produto || p.detalhes || ""));
      if (!hosp && t > 0 && totalRecebidoOS > 0 && totalRecebidoPecasOS > 0) valor_pecas += t;
    }
    let valor_servicos = 0;
    for (const s of servicos) {
      const desc = String(s.nome_servico || s.nome || s.descricao || s.detalhes || "");
      const t = calcItemTotal(s);
      if (isDeslocamento(desc) || isHospedagemAlimentacao(desc)) continue;
      if (t > 0 && totalRecebidoOS > 0 && totalRecebidoServicosOS > 0) valor_servicos += t;
    }

    // Aplica teto consolidado
    if (totalRecebidoOS > 0) {
      valor_pecas = Math.min(valor_pecas, totalRecebidoPecasOS);
      valor_servicos = Math.min(valor_servicos, totalRecebidoServicosOS);
    } else {
      valor_pecas = 0;
      valor_servicos = 0;
    }

    const comissao_pecas = valor_pecas * 0.01;
    const comissao_servicos = valor_servicos * 0.15;
    const comissao_total = comissao_pecas + comissao_servicos;

    const dataSaidaRaw = String(detail.data_saida || detail.dataSaida || "").split("T")[0];
    const sit = String(detail.nome_situacao || "");
    const isExecutada = normalize(sit).startsWith("executado");

    return new Response(JSON.stringify({
      ok: true,
      gc_os_id: osId,
      gc_os_codigo: codigo,
      cliente: String(detail.nome_cliente || ""),
      data_saida: dataSaidaRaw || null,
      situacao: sit,
      executada: isExecutada,
      tecnico_original: String(detail.nome_vendedor || "").trim() || null,
      valor_pecas,
      valor_servicos,
      comissao_pecas,
      comissao_servicos,
      comissao_total,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});