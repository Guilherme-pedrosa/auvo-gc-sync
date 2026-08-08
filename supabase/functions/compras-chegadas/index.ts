// Lê os pedidos de compra e orçamentos do GestãoClick que ainda NÃO chegaram/foram aprovados
// e devolve a agenda de chegada de peças (campo extra "DATA DA CHEGADA DAS PEÇAS"),
// vinculada à OS / orçamento informados no campo extra "OS GC".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { installGcUsuarioId, gcHeaders } from "../_shared/gc-user.ts";

installGcUsuarioId();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE = "https://api.gestaoclick.com";

// Situações de compra que ainda estão pendentes (peça não chegou).
const SITUACOES_PEDIDOS = [
  { id: "1670366", nome: "Aprovada - AG COMPRA", grupo: "ag_compra" },
  { id: "1675083", nome: "COMPRADO - AG CHEGADA", grupo: "ag_chegada" },
  { id: "2072608", nome: "COMPRADO - AG CHEGADA PARA ESTOQUE", grupo: "ag_chegada" },
  { id: "1775065", nome: "SOLICITADO - GARANTIA", grupo: "garantia" },
  { id: "2120816", nome: "AGUARDANDO PEDIDO MINIMO", grupo: "ag_compra" },
];

const SITUACOES_ORCAMENTOS = [
  { id: "7063588", nome: "Aguardando Aprovação", grupo: "ag_aprovacao" },
  { id: "2039849", nome: "Aguardando Correção / informações solicitadas", grupo: "ag_aprovacao" },
  { id: "7084340", nome: "Aguardando Resposta Cliente", grupo: "ag_aprovacao" },
  { id: "7063587", nome: "Aguardando Chegada de Peças", grupo: "ag_chegada" },
  { id: "7063589", nome: "Aguardando Fabricação", grupo: "ag_fabricacao" },
  { id: "7219959", nome: "Pedido Conferido - Aguardando Execução", grupo: "ag_execucao" },
  { id: "2138148", nome: "Pedido em Conferência", grupo: "conferencia" },
  { id: "7106316", nome: "Retirada pelo Técnico", grupo: "retirada" },
  { id: "7253507", nome: "Serviço Aguardando Execução", grupo: "ag_execucao" },
];

function extra(doc: any, descricao: string): string {
  const list = Array.isArray(doc?.campos_extras) ? doc.campos_extras : [];
  for (const item of list) {
    const e = item?.extras ?? item;
    if (String(e?.descricao ?? "").trim().toUpperCase() === descricao) {
      return String(e?.conteudo ?? "").trim();
    }
  }
  return "";
}

/** Aceita 10/08, 10/08/2026, 10-08-2026, 2026-08-10. Retorna YYYY-MM-DD. */
function parseChegada(raw: string, referencia: string): string | null {
  const txt = String(raw || "").trim();
  if (!txt) return null;
  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = txt.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/);
  if (!br) return null;
  const dia = Number(br[1]);
  const mes = Number(br[2]);
  if (!dia || !mes || dia > 31 || mes > 12) return null;
  let ano: number;
  if (br[3]) {
    ano = Number(br[3]);
    if (ano < 100) ano += 2000;
  } else {
    const base = new Date(`${referencia || new Date().toISOString().slice(0, 10)}T00:00:00`);
    ano = base.getFullYear();
    if (mes < base.getMonth() + 1 - 6) ano += 1;
  }
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function parseVinculo(raw: string): { tipo: "os" | "orcamento" | "texto"; codigo: string; original: string } {
  const txt = String(raw || "").trim();
  if (!txt) return { tipo: "texto", codigo: "", original: "" };
  const orc = txt.match(/^(?:OR|OR[ÇC]|OR[ÇC]AMENTO)\s*[:.\-]?\s*(\d{3,8})/i);
  if (orc) return { tipo: "orcamento", codigo: orc[1], original: txt };
  const os = txt.match(/^(?:OS\s*)?(\d{3,8})$/i);
  if (os) return { tipo: "os", codigo: os[1], original: txt };
  return { tipo: "texto", codigo: "", original: txt };
}

async function fetchSituacao(sit: { id: string; nome: string; grupo: string }, endpoint = "compras") {
  const out: any[] = [];
  for (let pagina = 1; pagina <= 12; pagina++) {
    const url = new URL(`${GC_BASE}/${endpoint}`);
    url.searchParams.set("situacao_id", sit.id);
    url.searchParams.set("limite", "100");
    url.searchParams.set("pagina", String(pagina));
    const res = await fetch(url.toString(), { headers: gcHeaders() });
    if (!res.ok) break;
    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const r of rows) {
      const c = r?.Compra ?? r?.Orcamento ?? r;
      if (!c) continue;
      out.push({ doc: c, situacao: sit, tipo: endpoint === "orcamentos" ? "orcamento" : "compra" });
    }
    if (!json?.meta?.proxima_pagina) break;
  }
  return out;
}

async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const [pedidosResults, orcamentosResults] = await Promise.all([
      Promise.all(SITUACOES_PEDIDOS.map((s) => fetchSituacao(s, "compras"))),
      Promise.all(SITUACOES_ORCAMENTOS.map((s) => fetchSituacao(s, "orcamentos"))),
    ]);
    const brutos = [...pedidosResults.flat(), ...orcamentosResults.flat()];

    const itens = brutos.map(({ doc, situacao, tipo }) => {
      const vinculoRaw = extra(doc, "OS GC");
      const vinculo = parseVinculo(vinculoRaw);
      const dataChegadaRaw = extra(doc, "DATA DA CHEGADA DAS PEÇAS");
      const dataChegada = parseChegada(dataChegadaRaw, doc?.data_emissao || doc?.data);
      
      const produtos = (Array.isArray(doc?.produtos) ? doc.produtos : []).map((p: any) => {
        const prod = p?.produto ?? p;
        return {
          nome: String(prod?.nome_produto ?? prod?.nome ?? "").trim(),
          quantidade: Number(prod?.quantidade ?? 0) || 0,
          valor_total: Number(prod?.valor_total ?? 0) || 0,
        };
      });

      const orcCodigo = tipo === "orcamento" ? String(doc?.codigo ?? "") : (vinculo.tipo === "orcamento" ? vinculo.codigo : "");

      return {
        compra_id: tipo === "compra" ? String(doc?.id ?? "") : "",
        compra_codigo: tipo === "compra" ? String(doc?.codigo ?? "") : "",
        fornecedor: String(doc?.nome_fornecedor || doc?.nome_vendedor || ""),
        situacao_id: situacao.id,
        situacao: String(doc?.nome_situacao ?? situacao.nome),
        grupo: situacao.grupo,
        data_emissao: doc?.data_emissao || doc?.data || null,
        data_chegada: dataChegada,
        data_chegada_texto: dataChegadaRaw,
        vinculo_tipo: tipo === "orcamento" ? "orcamento" : vinculo.tipo,
        vinculo_codigo: orcCodigo,
        vinculo_texto: tipo === "orcamento" ? `Orçamento ${doc.codigo}` : vinculo.original,
        auvo_task_id: extra(doc, "OS TAREFA") || extra(doc, "TAREFA OS"),
        observacao_extra: extra(doc, "PRODUTO"),
        valor_total: Number(doc?.valor_total ?? 0) || 0,
        produtos,
        gc_link: tipo === "compra" 
          ? (doc?.id ? `https://app.gestaoclick.com/compras/visualizar/${doc.id}` : "")
          : (doc?.id ? `https://app.gestaoclick.com/orcamentos_servicos/visualizar/${doc.id}` : ""),
        cliente: String(doc?.nome_cliente || ""),
        equipamento: "",
        os_codigo: "",
        orcamento_codigo: orcCodigo,
        documento_valor: Number(doc?.valor_total ?? 0) || 0,
        documento_situacao: String(doc?.nome_situacao ?? ""),
        documento_link: tipo === "orcamento" ? `https://app.gestaoclick.com/orcamentos_servicos/visualizar/${doc.id}` : "",
        auvo_link: "",
      };
    });

    const osCods = [...new Set(itens.filter((i) => i.vinculo_tipo === "os").map((i) => i.vinculo_codigo))];
    const orcCods = [...new Set(itens.filter((i) => i.vinculo_tipo === "orcamento").map((i) => i.vinculo_codigo))];

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const cols =
      "auvo_task_id, cliente, tecnico, equipamento_nome, equipamento_id_serie, auvo_link," +
      " gc_os_codigo, gc_os_cliente, gc_os_situacao, gc_os_valor_total, gc_os_link," +
      " gc_orcamento_codigo, gc_orc_cliente, gc_orc_situacao, gc_orc_valor_total, gc_orc_link";

    const [osRes, orcRes] = await Promise.all([
      osCods.length
        ? sb.from("tarefas_central").select(cols).in("gc_os_codigo", osCods)
        : Promise.resolve({ data: [] as any[] }),
      orcCods.length
        ? sb.from("tarefas_central").select(cols).in("gc_orcamento_codigo", orcCods)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const osMap = new Map<string, any>();
    for (const r of (osRes as any).data ?? []) {
      const k = String(r.gc_os_codigo ?? "");
      if (k && !osMap.has(k)) osMap.set(k, r);
    }
    const orcMap = new Map<string, any>();
    for (const r of (orcRes as any).data ?? []) {
      const k = String(r.gc_orcamento_codigo ?? "");
      if (k && !orcMap.has(k)) orcMap.set(k, r);
    }

    const getEquip = (r: any) =>
      [r?.equipamento_nome, r?.equipamento_id_serie].filter(Boolean).join(" · ");

    for (const item of itens) {
      const r = item.vinculo_tipo === "os" ? osMap.get(item.vinculo_codigo) : orcMap.get(item.vinculo_codigo);
      if (!r) continue;
      if (!item.cliente) item.cliente = String(r.gc_os_cliente || r.gc_orc_cliente || r.cliente || "");
      item.equipamento = getEquip(r);
      item.os_codigo = String(r.gc_os_codigo ?? "");
      item.orcamento_codigo = String(r.gc_orcamento_codigo ?? "");
      item.documento_valor =
        item.vinculo_tipo === "os"
          ? Number(r.gc_os_valor_total ?? 0) || 0
          : Number(r.gc_orc_valor_total ?? 0) || 0;
      item.documento_situacao = String(
        item.vinculo_tipo === "os" ? r.gc_os_situacao ?? "" : r.gc_orc_situacao ?? "",
      );
      item.documento_link = String(item.vinculo_tipo === "os" ? r.gc_os_link ?? "" : r.gc_orc_link ?? "");
      item.auvo_link = String(r.auvo_link ?? "");
      if (!item.auvo_task_id) item.auvo_task_id = String(r.auvo_task_id ?? "");
    }

    return new Response(
      JSON.stringify({ ok: true, total: itens.length, itens, gerado_em: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, itens: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(handleRequest);
