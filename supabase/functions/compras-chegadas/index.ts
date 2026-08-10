// Lê os pedidos de compra e orçamentos do GestãoClick que ainda NÃO chegaram
// Integra lógica de rastreamento inspirada no "WeDo Pick & Pack" para datas de chegada coesas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { installGcUsuarioId, gcHeaders } from "../_shared/gc-user.ts";
import {
  normalizePartialBudgetCode,
  pendingProductsFromPickPack,
  shouldUsePickPackPartialBalance,
  type PickPackPendingItem,
} from "../_shared/partial-writeoff-balance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

installGcUsuarioId();

const GC_BASE = "https://api.gestaoclick.com";
const PICK_PACK_PARTIAL_BALANCE_URL = Deno.env.get("PICK_PACK_PARTIAL_BALANCE_URL")
  || "https://yfqbhyadogytswelopsl.supabase.co/functions/v1/partial-writeoff-balances";

// O calendário considera exclusivamente estas situações de orçamento.
const SITUACOES_ORCAMENTOS = [
  { id: "8743484", nome: "Aprovada - AG COMPRA", grupo: "ag_compra" },
  { id: "8743485", nome: "COMPRADO - AG CHEGADA", grupo: "ag_chegada" },
  { id: "8894381", nome: "SOLICITADO - GARANTIA", grupo: "garantia" },
  { id: "8743482", nome: "Ag. Aprovação Peças", grupo: "ag_aprovacao" },
  { id: "9348312", nome: "BAIXA PARCIAL REALIZADA", grupo: "baixa_parcial" },
];

// Situações de pedidos usadas somente para interpretar os PCs informados nos orçamentos.
const SITUACOES_PEDIDOS = [
  { id: "1670366", nome: "Aprovada - AG COMPRA", grupo: "ag_compra" },
  { id: "1675083", nome: "COMPRADO - AG CHEGADA", grupo: "ag_chegada" },
  { id: "1775065", nome: "SOLICITADO - GARANTIA", grupo: "garantia" },
];

function extra(doc: any, ...descricoes: string[]): string {
  const list = [
    ...(Array.isArray(doc?.campos_extras) ? doc.campos_extras : []),
    ...(Array.isArray(doc?.atributos) ? doc.atributos : []),
  ];
  const alvos = descricoes.map((d) => normalize(d));
  for (const alvo of alvos) {
    for (const item of list) {
      const e = item?.extras ?? item?.atributo ?? item?.campo_extra ?? item;
      const nome = normalize(e?.descricao);
      if (nome === alvo) {
        const v = String(e?.conteudo ?? "").trim();
        if (v) return v;
      }
    }
  }
  return "";
}

// Campos preenchidos no ORÇAMENTO do GC que norteiam o agendamento.
const CAMPO_DATA_CHEGADA = [
  "DATA DA CHEGADA DE PEÇAS",
  "DATA DA CHEGADA DAS PEÇAS",
  "DATA CHEGADA DE PEÇAS",
  "DATA CHEGADA DAS PEÇAS",
  "DATA DE CHEGADA DAS PEÇAS",
];
const CAMPO_PEDIDO_COMPRA = [
  "PEDIDO DE COMPRA GC",
  "PEDIDO DE COMPRA",
  "PEDIDO COMPRA GC",
  "PC GC",
];

const CAMPOS_DATA_PEDIDO = [
  ...CAMPO_DATA_CHEGADA,
  "PREVISÃO DE ENTREGA",
  "PREVISAO DE ENTREGA",
  "DATA PREVISTA DE ENTREGA",
  "DATA DE ENTREGA",
];

type PedidoDetalhe = {
  codigo: string;
  id: string;
  situacao_id: string;
  situacao: string;
  data_chegada: string | null;
  data_chegada_texto: string;
  estado: "pendente" | "chegou" | "cancelado" | "desconhecido";
  gc_link: string;
  quantidade?: number;
};

type ProdutoDocumento = {
  produto_id: string;
  variacao_id: string | null;
  nome: string;
  quantidade: number;
  valor_total: number;
};

type EstoqueProduto = {
  estoque: number;
  verificado: boolean;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function produtoDocumento(wrapper: any): ProdutoDocumento {
  const produto = wrapper?.produto ?? wrapper ?? {};
  return {
    produto_id: String(produto?.produto_id ?? produto?.id_produto ?? "").trim(),
    variacao_id: String(produto?.variacao_id ?? produto?.estoque_id ?? "").trim() || null,
    nome: String(produto?.nome_produto ?? produto?.nome ?? produto?.descricao ?? "").trim(),
    quantidade: toNumber(produto?.quantidade),
    valor_total: toNumber(produto?.valor_total),
  };
}

function produtosDocumento(doc: any): ProdutoDocumento[] {
  return (Array.isArray(doc?.produtos) ? doc.produtos : [])
    .map(produtoDocumento)
    .filter((produto) => produto.nome || produto.produto_id);
}

function unwrapGcDocument(value: any): any {
  return value?.Compra
    ?? value?.Orcamento
    ?? value?.Pedido
    ?? value?.Venda
    ?? value?.OrdemServico
    ?? value?.ordem_servico
    ?? value;
}

async function fetchProductStock(produtoId: string, variacaoId?: string | null): Promise<EstoqueProduto> {
  if (!produtoId) return { estoque: 0, verificado: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${GC_BASE}/api/produtos/${produtoId}`, { headers: gcHeaders() });
      if (response.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      if (!response.ok) return { estoque: 0, verificado: false };
      const json = await response.json().catch(() => null);
      const data = json?.data ?? json;
      if (!data) return { estoque: 0, verificado: false };

      let rawStock = data?.estoque ?? 0;
      const variations = Array.isArray(data?.variacoes) ? data.variacoes : [];
      if (variations.length > 0) {
        const wanted = String(variacaoId ?? "");
        const matched = wanted
          ? variations.find((item: any) => String((item?.variacao ?? item)?.id ?? "") === wanted)
          : null;
        const chosen = matched ?? (variations.length === 1 ? variations[0] : null);
        if (chosen) rawStock = (chosen?.variacao ?? chosen)?.estoque ?? rawStock;
      }
      return { estoque: toNumber(rawStock), verificado: true };
    } catch (error) {
      if (attempt === 2) {
        console.warn(`[compras-chegadas] estoque não consultado para produto ${produtoId}`, error);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
  }
  return { estoque: 0, verificado: false };
}

/** O campo aceita vários PCs (ex.: "PC 1234 / 5678, PC-9012"). */
function parsePedidosCompra(raw: string): string[] {
  const codigos = String(raw || "")
    .match(/\d{3,}/g)
    ?.map((codigo) => codigo.replace(/^0+(?=\d)/, ""))
    .filter(Boolean) ?? [];
  return [...new Set(codigos)];
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

function dataPedidoRaw(doc: any): string {
  const campoExtra = extra(doc, ...CAMPOS_DATA_PEDIDO);
  if (campoExtra) return campoExtra;
  // Campos nativos do GC em ordem de prioridade
  const keys = [
    "data_chegada", 
    "data_previsao_entrega", 
    "previsao_entrega", 
    "data_entrega",
    "data_prevista", 
    "previsao", 
    "data_recebimento",
    "data_saida"
  ];
  for (const key of keys) {
    const value = String(doc?.[key] ?? "").trim();
    if (value && value !== "0000-00-00" && value !== "null") return value;
  }
  return "";
}

/** Busca o documento completo (traz campos_extras e datas que a listagem omite). */
async function fetchDocumentoCompleto(endpoint: string, id: string): Promise<any | null> {
  if (!id) return null;
  try {
    const res = await fetch(`${GC_BASE}/api/${endpoint}/${id}`, { headers: gcHeaders() });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const raw = json?.data ?? json;
    return unwrapGcDocument(raw) ?? null;
  } catch {
    return null;
  }
}

type PartialBalanceStatus = "verified" | "not_found" | "unavailable" | "not_applicable";
type PickPackBalance = {
  budget_id: string;
  budget_code: string;
  operation_status: string;
  updated_at: string;
  items: PickPackPendingItem[];
};

async function fetchPickPackPartialBalances(
  budgets: { id: string; code: string }[],
): Promise<{ available: boolean; balances: PickPackBalance[] }> {
  if (budgets.length === 0) return { available: true, balances: [] };
  const token = Deno.env.get("PICK_PACK_PARTIAL_BALANCE_TOKEN")?.trim();
  if (!token) {
    console.warn("[compras-chegadas] PICK_PACK_PARTIAL_BALANCE_TOKEN não configurado");
    return { available: false, balances: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(PICK_PACK_PARTIAL_BALANCE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": token },
      body: JSON.stringify({ budgets }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload?.balances)) {
      console.warn(`[compras-chegadas] saldo do Pick & Pack indisponível: HTTP ${response.status}`);
      return { available: false, balances: [] };
    }
    return { available: true, balances: payload.balances as PickPackBalance[] };
  } catch (error) {
    console.warn("[compras-chegadas] falha ao consultar saldo do Pick & Pack", error);
    return { available: false, balances: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function estadoPedido(doc: any): PedidoDetalhe["estado"] {
  const situacaoId = String(doc?.situacao_id ?? "");
  const situacao = normalize(doc?.nome_situacao);
  if (SITUACOES_PEDIDOS.some((item) => item.id === situacaoId)) return "pendente";
  if (/CANCEL|REPROV|DEVOLVID/.test(situacao)) return "cancelado";
  if (/CHEG|RECEB|ENTREG|CONCLUID|FINALIZ|ESTOQUE/.test(situacao)) return "chegou";
  return "desconhecido";
}

async function fetchPedidoPorCodigo(codigo: string): Promise<PedidoDetalhe | null> {
  // Pedido de Compra vive em /compras. Mantemos /pedidos e /orcamentos como fallback
  // porque o campo extra do orçamento aceita qualquer tipo de referência.
  const endpoints = ["compras", "pedidos", "orcamentos"];
  for (const endpoint of endpoints) {
    const url = new URL(`${GC_BASE}/api/${endpoint}`);
    url.searchParams.set("codigo", codigo);
    url.searchParams.set("limite", "10");
    const res = await fetch(url.toString(), { headers: gcHeaders() });
    if (!res.ok) continue;
    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json?.data) ? json.data : [];
    const docs = rows.map((row: any) => row?.Compra ?? row?.Orcamento ?? row?.Pedido ?? row).filter(Boolean);
    let doc = docs.find(
      (item: any) => String(item?.codigo ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "") === codigo,
    );
    
    if (doc) {
      // A listagem do GC não traz campos_extras nem todas as datas: buscamos o documento completo.
      const detalhe = await fetchDocumentoCompleto(endpoint, String(doc?.id ?? ""));
      if (detalhe) doc = { ...doc, ...detalhe };
      const raw = dataPedidoRaw(doc);
      const referencia = String(doc?.data_emissao ?? doc?.data ?? new Date().toISOString().slice(0, 10));
      return {
        codigo,
        id: String(doc?.id ?? ""),
        situacao_id: String(doc?.situacao_id ?? ""),
        situacao: String(doc?.nome_situacao ?? "Situação não informada"),
        data_chegada: parseChegada(raw, referencia),
        data_chegada_texto: raw,
        estado: estadoPedido(doc),
        gc_link: doc?.id ? `https://app.gestaoclick.com/${endpoint}/visualizar/${doc.id}` : "",
      };
    }
  }
  return null;
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

async function fetchSituacao(sit: { id: string; nome: string; grupo: string }, endpoint = "orcamentos") {
  const out: any[] = [];
  for (let pagina = 1; pagina <= 12; pagina++) {
    const url = new URL(`${GC_BASE}/api/${endpoint}`);
    url.searchParams.set("situacao_id", sit.id);
    url.searchParams.set("limite", "100");
    url.searchParams.set("pagina", String(pagina));
    let res: Response | null = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      res = await fetch(url.toString(), { headers: gcHeaders() });
      if (res.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (tentativa + 1)));
    }
    if (!res?.ok) {
      const body = await res?.text().catch(() => "");
      throw new Error(
        `Falha ao consultar ${endpoint} na situação ${sit.id} (HTTP ${res?.status ?? "sem resposta"}): ${body?.slice(0, 180) ?? ""}`,
      );
    }
    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const r of rows) {
      const c = r?.Compra ?? r?.Orcamento ?? r;
      if (!c) continue;
      // A API do GC pode ignorar situacao_id e devolver a página padrão. Não aceite
      // documentos de outra situação: isso contaminava o calendário com orçamentos
      // que não pertenciam aos três estados solicitados.
      if (String(c?.situacao_id ?? "") !== sit.id) continue;
      out.push({ doc: c, situacao: sit, tipo: endpoint === "orcamentos" ? "orcamento" : "compra" });
    }
    const totalPaginas = Number(json?.meta?.total_paginas ?? json?.meta?.totalPages ?? 1);
    if (pagina >= totalPaginas || rows.length === 0) break;
  }
  return out;
}

async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const orcamentosResults = await Promise.all(
      SITUACOES_ORCAMENTOS.map((s) => fetchSituacao(s, "orcamentos")),
    );
    const brutos = Array.from(
      new Map(
        orcamentosResults.flat().map((item) => [String(item.doc?.id ?? item.doc?.codigo ?? ""), item]),
      ).values(),
    );
    console.log(
      `[compras-chegadas] encontrados ${brutos.length} orçamentos nas 3 situações solicitadas`,
    );

    // A listagem do GC não devolve campos_extras (é lá que ficam "PEDIDO DE COMPRA GC",
    // "DATA DA CHEGADA DE PEÇAS" e "OS GC"). Buscamos o documento completo de cada orçamento.
    for (let inicio = 0; inicio < brutos.length; inicio += 6) {
      const lote = brutos.slice(inicio, inicio + 6);
      const completos = await Promise.all(
        lote.map((item) =>
          fetchDocumentoCompleto(item.tipo === "compra" ? "compras" : "orcamentos", String(item.doc?.id ?? "")),
        ),
      );
      completos.forEach((completo, idx) => {
        if (completo) lote[idx].doc = { ...lote[idx].doc, ...completo };
      });
    }

    const partialBudgets = brutos
      .filter(({ situacao }) => shouldUsePickPackPartialBalance(situacao.grupo))
      .map(({ doc }) => ({
        id: String(doc?.id ?? "").trim(),
        code: String(doc?.codigo ?? "").trim(),
      }))
      .filter((budget) => budget.id || budget.code);
    const pickPackResult = await fetchPickPackPartialBalances(partialBudgets);
    const balancesById = new Map(
      pickPackResult.balances
        .filter((balance) => balance.budget_id)
        .map((balance) => [String(balance.budget_id).trim(), balance]),
    );
    const balancesByCode = new Map(
      pickPackResult.balances
        .filter((balance) => balance.budget_code)
        .map((balance) => [normalizePartialBudgetCode(balance.budget_code), balance]),
    );
    const pendingProductsByDocument = new Map<string, ProdutoDocumento[]>();
    const partialBalanceStatusByDocument = new Map<string, PartialBalanceStatus>();
    for (const { doc, situacao } of brutos) {
      const documentKey = String(doc?.id ?? doc?.codigo ?? "");
      if (!shouldUsePickPackPartialBalance(situacao.grupo)) {
        pendingProductsByDocument.set(documentKey, produtosDocumento(doc));
        partialBalanceStatusByDocument.set(documentKey, "not_applicable");
        continue;
      }

      const balance = balancesById.get(String(doc?.id ?? "").trim())
        ?? balancesByCode.get(normalizePartialBudgetCode(doc?.codigo));
      if (balance) {
        pendingProductsByDocument.set(
          documentKey,
          pendingProductsFromPickPack(produtosDocumento(doc), balance.items),
        );
        partialBalanceStatusByDocument.set(documentKey, "verified");
      } else {
        // Não volte aos itens originais: isso faria reaparecer uma peça já baixada.
        pendingProductsByDocument.set(documentKey, []);
        partialBalanceStatusByDocument.set(
          documentKey,
          pickPackResult.available ? "not_found" : "unavailable",
        );
      }
    }
    console.log(
      `[compras-chegadas] saldos Pick & Pack: ${pickPackResult.balances.length}/${partialBudgets.length} orçamento(s) localizado(s)`,
    );

    const productReferences = new Map<string, { produto_id: string; variacao_id: string | null }>();
    const openDemandByProduct = new Map<string, { quantidade: number; documentos: Set<string> }>();
    for (const { doc } of brutos) {
      const documentKey = String(doc?.id ?? doc?.codigo ?? "");
      for (const produto of pendingProductsByDocument.get(documentKey) ?? produtosDocumento(doc)) {
        if (!produto.produto_id) continue;
        const key = `${produto.produto_id}::${produto.variacao_id ?? ""}`;
        productReferences.set(key, { produto_id: produto.produto_id, variacao_id: produto.variacao_id });
        const demand = openDemandByProduct.get(key) ?? { quantidade: 0, documentos: new Set<string>() };
        demand.quantidade += produto.quantidade;
        demand.documentos.add(String(doc?.id ?? doc?.codigo ?? ""));
        openDemandByProduct.set(key, demand);
      }
    }

    const stockByProduct = new Map<string, EstoqueProduto>();
    const productKeys = [...productReferences.keys()];
    for (let start = 0; start < productKeys.length; start += 3) {
      const batch = productKeys.slice(start, start + 3);
      const stocks = await Promise.all(batch.map((key) => {
        const reference = productReferences.get(key)!;
        return fetchProductStock(reference.produto_id, reference.variacao_id);
      }));
      batch.forEach((key, index) => stockByProduct.set(key, stocks[index]));
      if (start + 3 < productKeys.length) await new Promise((resolve) => setTimeout(resolve, 1050));
    }

    // Procura pedidos de compra abertos pelas próprias peças, em vez de depender apenas
    // do campo manual "PEDIDO DE COMPRA GC" preenchido no orçamento.
    const openPurchaseResults = await Promise.all(
      SITUACOES_PEDIDOS.map((situation) => fetchSituacao(situation, "compras")),
    );
    const openPurchases = Array.from(
      new Map(
        openPurchaseResults.flat().map((item) => [String(item.doc?.id ?? item.doc?.codigo ?? ""), item]),
      ).values(),
    );
    const budgetProductIds = new Set([...productReferences.values()].map((item) => item.produto_id));
    const relatedOpenPurchases = openPurchases.filter(({ doc }) =>
      produtosDocumento(doc).some((produto) => budgetProductIds.has(produto.produto_id)),
    );

    // A listagem normalmente já contém os itens. O detalhe é consultado somente para PCs
    // relacionados, para obter campos extras/data sem tornar a tela desnecessariamente lenta.
    for (let start = 0; start < relatedOpenPurchases.length; start += 5) {
      const batch = relatedOpenPurchases.slice(start, start + 5);
      const details = await Promise.all(
        batch.map((item) => fetchDocumentoCompleto("compras", String(item.doc?.id ?? ""))),
      );
      details.forEach((detail, index) => {
        if (detail) batch[index].doc = { ...batch[index].doc, ...detail };
      });
    }

    const purchasesByProduct = new Map<string, PedidoDetalhe[]>();
    for (const { doc } of relatedOpenPurchases) {
      const rawDate = dataPedidoRaw(doc);
      const referenceDate = String(doc?.data_emissao ?? doc?.data ?? new Date().toISOString().slice(0, 10));
      for (const product of produtosDocumento(doc)) {
        if (!product.produto_id || !budgetProductIds.has(product.produto_id)) continue;
        const detail: PedidoDetalhe = {
          codigo: String(doc?.codigo ?? ""),
          id: String(doc?.id ?? ""),
          situacao_id: String(doc?.situacao_id ?? ""),
          situacao: String(doc?.nome_situacao ?? "Situação não informada"),
          data_chegada: parseChegada(rawDate, referenceDate),
          data_chegada_texto: rawDate,
          estado: estadoPedido(doc),
          gc_link: doc?.id ? `https://app.gestaoclick.com/compras/visualizar/${doc.id}` : "",
          quantidade: product.quantidade,
        };
        const current = purchasesByProduct.get(product.produto_id) ?? [];
        if (!current.some((item) => item.codigo === detail.codigo)) current.push(detail);
        purchasesByProduct.set(product.produto_id, current);
      }
    }

    const pedidosReferenciados = [...new Set(
      brutos
        .filter(({ tipo }) => tipo === "orcamento")
        .flatMap(({ doc }) => parsePedidosCompra(extra(doc, ...CAMPO_PEDIDO_COMPRA))),
    )];
    const pedidoDetalhes = new Map<string, PedidoDetalhe>();
    for (let inicio = 0; inicio < pedidosReferenciados.length; inicio += 5) {
      const lote = pedidosReferenciados.slice(inicio, inicio + 5);
      const encontrados = await Promise.all(lote.map(fetchPedidoPorCodigo));
      for (const pedido of encontrados) if (pedido) pedidoDetalhes.set(pedido.codigo, pedido);
    }

    const today = new Date().toISOString().slice(0, 10);
    const itens = brutos.map(({ doc, situacao, tipo }) => {
      const vinculoRaw = extra(doc, "OS GC");
      const vinculo = parseVinculo(vinculoRaw);
      const dataChegadaRaw = extra(doc, ...CAMPO_DATA_CHEGADA);
      const dataChegadaOrcamento = parseChegada(dataChegadaRaw, doc?.data_emissao || doc?.data);
      // No orçamento, o campo "PEDIDO DE COMPRA GC" diz quais PCs abastecem aquela OS.
      const pedidosCompra = parsePedidosCompra(extra(doc, ...CAMPO_PEDIDO_COMPRA));
      const explicitDetails = pedidosCompra.map((codigo) => pedidoDetalhes.get(codigo) ?? {
        codigo,
        id: "",
        situacao_id: "",
        situacao: "Pedido não localizado",
        data_chegada: null,
        data_chegada_texto: "",
        estado: "desconhecido" as const,
        gc_link: "",
      });
      const documentKey = String(doc?.id ?? doc?.codigo ?? "");
      const produtosPendentes = pendingProductsByDocument.get(documentKey) ?? produtosDocumento(doc);
      const partialBalanceStatus = partialBalanceStatusByDocument.get(documentKey) ?? "not_applicable";
      const produtos = produtosPendentes.map((product) => {
        const key = `${product.produto_id}::${product.variacao_id ?? ""}`;
        const stock = stockByProduct.get(key) ?? { estoque: 0, verificado: false };
        const openDemand = openDemandByProduct.get(key) ?? { quantidade: product.quantidade, documentos: new Set<string>() };
        const stockConflict = stock.verificado
          && openDemand.documentos.size > 1
          && openDemand.quantidade > stock.estoque;
        const purchaseOrders = product.produto_id ? (purchasesByProduct.get(product.produto_id) ?? []) : [];
        return {
          ...product,
          estoque_atual: stock.estoque,
          estoque_verificado: stock.verificado,
          deficit: stock.verificado
            ? Math.max(0, product.quantidade - stock.estoque, stockConflict ? openDemand.quantidade - stock.estoque : 0)
            : product.quantidade,
          demanda_total_aberta: openDemand.quantidade,
          conflito_estoque: stockConflict,
          critico: /PLACA|MOTOR|COMPRESSOR|BOMBA|INVERSOR/i.test(product.nome),
          pedidos_compra: purchaseOrders,
        };
      });

      const saldoParcialVerificado = partialBalanceStatus === "verified";
      const semSaldoParcialConfiavel = shouldUsePickPackPartialBalance(situacao.grupo) && !saldoParcialVerificado;
      const estoqueVerificado = !semSaldoParcialConfiavel
        && (produtos.length === 0 ? saldoParcialVerificado : produtos.every((product) => product.estoque_verificado));
      const todosEmEstoque = estoqueVerificado
        && produtos.every((product) => product.deficit <= 0 && !product.conflito_estoque);
      const pecasEmFalta = produtos.filter((product) => !product.estoque_verificado || product.deficit > 0 || product.conflito_estoque);

      // O calendário deve refletir o prazo mais distante entre todos os lotes abertos
      // das peças em falta. As datas individuais continuam disponíveis em cada peça.
      const datasReposicao = [...new Set(
        pecasEmFalta
          .flatMap((product) => product.pedidos_compra)
          .filter((order) => order.estado !== "cancelado" && order.estado !== "chegou" && order.data_chegada)
          .map((order) => String(order.data_chegada).slice(0, 10)),
      )].sort();
      const proximaReposicao = datasReposicao.at(-1) ?? null;

      const relatedDetails = pecasEmFalta.flatMap((product) => product.pedidos_compra);
      const detalhes = [...new Map(
        [...explicitDetails, ...relatedDetails].map((detail) => [detail.codigo, detail]),
      ).values()];
      const validos = detalhes.filter((pedido) => pedido.estado !== "cancelado");
      const todosChegaram = validos.length > 0 && validos.every((pedido) => pedido.estado === "chegou");
      const algumSemPrevisao = validos.some(
        (pedido) => pedido.estado !== "chegou" && !pedido.data_chegada,
      );
      const datasPedidos = validos.map((pedido) => pedido.data_chegada).filter((data): data is string => Boolean(data));
      const maiorDataPedido = datasPedidos.sort().at(-1) ?? null;
      const dataChegada = todosEmEstoque
        ? today
        : (proximaReposicao ?? maiorDataPedido ?? dataChegadaOrcamento);
      const semPrevisaoConfiavel = !todosEmEstoque && !dataChegada;
      const motivoBloqueio = semSaldoParcialConfiavel
        ? partialBalanceStatus === "not_found"
          ? "O saldo desta baixa parcial não foi localizado no Pick & Pack."
          : "Não foi possível consultar agora o saldo da baixa parcial no Pick & Pack."
        : todosEmEstoque
        ? null
        : !estoqueVerificado
          ? "Não foi possível confirmar o saldo de todas as peças no GestãoClick."
          : `Sem estoque: ${pecasEmFalta.map((product) => `${product.nome} (faltam ${product.deficit})`).join(", ")}`;


      const orcCodigo = tipo === "orcamento" ? String(doc?.codigo ?? "") : (vinculo.tipo === "orcamento" ? vinculo.codigo : "");

      return {
        doc_tipo: tipo === "orcamento" ? "orcamento" : "compra",
        compra_id: tipo === "compra" ? String(doc?.id ?? "") : "",
        orcamento_id: tipo === "orcamento" ? String(doc?.id ?? "") : "",
        compra_codigo: tipo === "compra" ? String(doc?.codigo ?? "") : (pedidosCompra[0] ?? ""),
        pedidos_compra: pedidosCompra,
        pedidos_detalhes: detalhes,
        pedidos_todos_chegaram: todosChegaram,
        pedidos_sem_previsao: semPrevisaoConfiavel,
        saldo_baixa_parcial_status: partialBalanceStatus,
        estoque_verificado: estoqueVerificado,
        todos_em_estoque: todosEmEstoque,
        pode_agendar: todosEmEstoque,
        motivo_bloqueio: motivoBloqueio,
        proxima_reposicao: proximaReposicao,
        pecas_em_falta: pecasEmFalta,
        data_chegada_orcamento: dataChegadaOrcamento,
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

    const totais = {
      ok: true,
      total: itens.length,
      total_orcamentos: itens.filter((item) => item.doc_tipo === "orcamento").length,
      total_pedidos: itens.filter((item) => item.doc_tipo === "compra").length,
      por_situacao: Object.fromEntries(
        SITUACOES_ORCAMENTOS.map((situacao) => [
          situacao.id,
          itens.filter((item) => item.situacao_id === situacao.id).length,
        ]),
      ),
      gerado_em: new Date().toISOString(),
    };
    const apenasResumo = new URL(req.url).searchParams.get("resumo") === "1";
    return new Response(
      JSON.stringify(apenasResumo ? totais : { ...totais, itens }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[compras-chegadas] fatal error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, itens: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(handleRequest);
