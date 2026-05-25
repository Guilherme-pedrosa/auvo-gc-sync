import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE_URL = "https://api.gestaoclick.com";

function normalize(s: string): string {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isDeslocamento(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("deslocamento") || n.includes("desloc.") || n.startsWith("desloc");
}

function isHospedagemAlimentacao(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("hospedag") || n.includes("alimentac") || n.includes("refeic") || n.includes("diaria") || n.includes("hotel");
}

// Serviços com taxa fixa de 5% (regra especial)
// Ex.: "HIGIENIZAÇÃO DE COIFAS COM DESENGORDURANTE BIODEGRADÁVEL + LAUDO TÉCNICO FOTOGRÁFICO (HORA HOMEM)"
function isServicoTaxa5(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("higienizac") && n.includes("coifa");
}

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  if (!isNaN(n) && /,/.test(String(v))) return n;
  const n2 = parseFloat(String(v));
  return isNaN(n2) ? 0 : n2;
}

function calcItemTotal(item: any): number {
  if (item.valor_total !== null && item.valor_total !== undefined && String(item.valor_total).trim() !== "") {
    return Math.max(0, toNum(item.valor_total));
  }

  const quantidade = toNum(item.quantidade) || 1;
  const bruto =
    toNum(item.valor_total_bruto) ||
    toNum(item.valor_bruto) ||
    toNum(item.subtotal) ||
    ((toNum(item.valor_venda) || toNum(item.valor_unitario)) * quantidade);

  const descontoPercentual =
    toNum(item.desconto_porcentagem) ||
    toNum(item.desconto_percentual) ||
    toNum(item.percentual_desconto) ||
    toNum(item.percentualDesconto);

  if (descontoPercentual >= 100) return 0;
  if (descontoPercentual > 0) return Math.max(0, bruto - (bruto * descontoPercentual / 100));

  const descontoValor =
    toNum(item.desconto_valor) ||
    toNum(item.valor_desconto) ||
    toNum(item.valorDesconto);

  if (descontoValor > 0) return Math.max(0, bruto - descontoValor);

  const descontoGenerico = toNum(item.desconto);
  if (descontoGenerico >= 100) return 0;
  if (descontoGenerico > 0) return Math.max(0, bruto - (bruto * descontoGenerico / 100));

  return Math.max(0, bruto);
}

async function fetchOsDetail(osId: string, gcHeaders: Record<string, string>): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${GC_BASE_URL}/api/ordens_servicos/${osId}`, { headers: gcHeaders });
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      return data?.data || data;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { month } = await req.json().catch(() => ({ month: null }));
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Parâmetro 'month' (YYYY-MM) obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [year, mon] = month.split("-").map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const gcHeaders = {
      "access-token": Deno.env.get("GC_ACCESS_TOKEN")!,
      "secret-access-token": Deno.env.get("GC_SECRET_TOKEN")!,
      "Content-Type": "application/json",
    };

    // Carrega contratos ativos e mapeia cliente_normalizado -> contrato
    const { data: contratosData } = await supabase
      .from("contratos")
      .select("id, nome, grupo_id, valor_hora, taxa_comissao_servico, vigencia_inicio, vigencia_fim, ativo")
      .eq("ativo", true);
    const grupoIds = (contratosData || []).map((c: any) => c.grupo_id);
    const { data: membrosData } = grupoIds.length > 0
      ? await supabase.from("grupo_cliente_membros").select("grupo_id, cliente_nome").in("grupo_id", grupoIds)
      : { data: [] as any[] };
    const contratoByCliente = new Map<string, any>();
    for (const c of contratosData || []) {
      const ini = c.vigencia_inicio || null;
      const fim = c.vigencia_fim || null;
      if (ini && ini > endDate) continue;
      if (fim && fim < startDate) continue;
      for (const m of (membrosData || []).filter((x: any) => x.grupo_id === c.grupo_id)) {
        contratoByCliente.set(normalize(m.cliente_nome), c);
      }
    }
    console.log(`[premiacao] ${contratosData?.length || 0} contratos ativos, ${contratoByCliente.size} clientes mapeados`);

    // Candidatos: OS com data_saida cacheada no mês OU sem data_saida cacheada mas com conclusão Auvo no mês
    // (re-filtramos abaixo pelo data_saida real do GC detail)
    const { data: rowsA, error: errA } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, tecnico, tecnico_id, data_tarefa, status_auvo, data_conclusao, duracao_decimal")
      .not("gc_os_id", "is", null)
      .gte("gc_os_data_saida", startDate)
      .lte("gc_os_data_saida", endDate);
    const { data: rowsB, error: errB } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, tecnico, tecnico_id, data_tarefa, status_auvo, data_conclusao, duracao_decimal")
      .not("gc_os_id", "is", null)
      .is("gc_os_data_saida", null);
    const error = errA || errB;
    const rows = [...(rowsA || []), ...(rowsB || [])];

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Soma horas (duracao_decimal) por gc_os_id — pode haver várias tarefas Auvo por OS
    const horasByOs = new Map<string, number>();
    for (const r of rows || []) {
      const k = String(r.gc_os_id);
      horasByOs.set(k, (horasByOs.get(k) || 0) + toNum(r.duracao_decimal));
    }

    // Dedupe by gc_os_id — prefer row with execution technician set
    const byOs = new Map<string, any>();
    for (const r of rows || []) {
      const k = String(r.gc_os_id);
      const existing = byOs.get(k);
      if (!existing) { byOs.set(k, r); continue; }
      const existingTec = (existing.tecnico || "").trim();
      const newTec = (r.tecnico || "").trim();
      if (!existingTec && newTec) byOs.set(k, r);
    }

    const osIds = Array.from(byOs.keys());
    console.log(`[premiacao] ${osIds.length} OS únicas no mês ${month}`);

    // Fetch GC OS details in parallel
    const PAR = 6;
    const osDetails = new Map<string, any>();
    for (let i = 0; i < osIds.length; i += PAR) {
      const batch = osIds.slice(i, i + PAR);
      const results = await Promise.all(batch.map((id) => fetchOsDetail(id, gcHeaders)));
      batch.forEach((id, idx) => { if (results[idx]) osDetails.set(id, results[idx]); });
    }

    // Aggregate per technician
    type OsRow = {
      gc_os_id: string;
      gc_os_codigo: string;
      cliente: string;
      data_saida: string;
      valor_pecas: number;
      valor_servicos: number;
      comissao_pecas: number;
      comissao_servicos: number;
      comissao_total: number;
      pecas_count: number;
      servicos_count: number;
    };
    type TechAgg = {
      tecnico: string;
      tecnico_id: string;
      os_count: number;
      valor_pecas: number;
      valor_servicos: number;
      comissao_pecas: number;
      comissao_servicos: number;
      comissao_total: number;
      ordens: OsRow[];
    };
    const techMap = new Map<string, TechAgg>();

    for (const [osId, row] of byOs.entries()) {
      const detail = osDetails.get(osId);
      if (!detail) continue;

      // Data de saída: prioriza GC detail (fonte da verdade), fallback para cache
      const dataSaidaRaw = detail.data_saida || detail.dataSaida || row.gc_os_data_saida || "";
      const dataSaidaStr = String(dataSaidaRaw).split("T")[0];

      // Re-filtra pelo data_saida real (mês solicitado)
      if (!dataSaidaStr || dataSaidaStr < startDate || dataSaidaStr > endDate) continue;

      // Skip OS executadas em sábado/domingo (técnicos já recebem extra)
      {
        const [y, m, d] = dataSaidaStr.split("-").map(Number);
        const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
        if (dow === 0 || dow === 6) continue;
      }

      // GC nests items: produtos[].produto, servicos[].servico
      const produtos: any[] = (Array.isArray(detail.produtos) ? detail.produtos : [])
        .map((x: any) => x?.produto || x)
        .filter(Boolean);
      const servicos: any[] = (Array.isArray(detail.servicos) ? detail.servicos : [])
        .map((x: any) => x?.servico || x)
        .filter(Boolean);
      const totalRecebidoOS = toNum(detail.valor_total);
      const totalRecebidoPecasOS = toNum(detail.valor_produtos);
      const totalRecebidoServicosOS = toNum(detail.valor_servicos);

      let valor_pecas = 0;
      let pecas_count = 0;
      const itens_pecas: any[] = [];
      for (const p of produtos) {
        const descProd = String(p.nome_produto || p.detalhes || "");
        const total = calcItemTotal(p);
        const hospAlim = isHospedagemAlimentacao(descProd);
        const semValorRecebido = total <= 0 || totalRecebidoOS <= 0 || totalRecebidoPecasOS <= 0;
        if (!hospAlim && !semValorRecebido) {
          valor_pecas += total;
          pecas_count += 1;
        }
        itens_pecas.push({
          descricao: String(p.nome_produto || p.detalhes || "Produto"),
          quantidade: toNum(p.quantidade),
          valor_unitario: toNum(p.valor_venda) || toNum(p.valor_unitario),
          valor_total: total,
          nao_comissionado: hospAlim || semValorRecebido,
        });
      }

      let valor_servicos = 0;
      let servicos_count = 0;
      const itens_servicos: any[] = [];
      for (const s of servicos) {
        const desc = s.nome_servico || s.nome || s.descricao || s.detalhes || "";
        const total = calcItemTotal(s);
        const desloc = isDeslocamento(desc);
        const hospAlim = isHospedagemAlimentacao(desc);
        const semValorRecebido = total <= 0 || totalRecebidoOS <= 0 || totalRecebidoServicosOS <= 0;
        const naoComissionado = desloc || hospAlim || semValorRecebido;
        if (!naoComissionado && total > 0) {
          valor_servicos += total;
          servicos_count += 1;
        }
        itens_servicos.push({
          descricao: String(desc || "Serviço"),
          quantidade: toNum(s.quantidade),
          valor_unitario: toNum(s.valor_venda) || toNum(s.valor_unitario),
          valor_total: total,
          deslocamento: desloc,
          nao_comissionado: naoComissionado,
        });
      }

      // Desconto geral da OS — rateia proporcional entre peças e serviços (comissionáveis)
      // GC usa os campos `desconto_valor` (R$) e `desconto_porcentagem` (%)
      const descValorOS = toNum(detail.desconto_valor) || toNum(detail.desconto) || toNum(detail.valor_desconto);
      const descPctOS = toNum(detail.desconto_porcentagem);
      const subtotalOS = valor_pecas + valor_servicos;
      const descontoGeral = descValorOS > 0
        ? descValorOS
        : (descPctOS > 0 ? subtotalOS * (descPctOS / 100) : 0);
      if (descontoGeral > 0) {
        const baseTotal = valor_pecas + valor_servicos;
        if (baseTotal > 0) {
          const rateioPecas = descontoGeral * (valor_pecas / baseTotal);
          const rateioServ = descontoGeral * (valor_servicos / baseTotal);
          valor_pecas = Math.max(0, valor_pecas - rateioPecas);
          valor_servicos = Math.max(0, valor_servicos - rateioServ);
        }
      }

      // Regra de premiação: só comissiona sobre o valor líquido recebido na GC.
      // Os totais consolidados da OS são o teto final, cobrindo desconto de 100%
      // em produtos, serviços ou na OS inteira mesmo que algum item venha divergente.
      if (totalRecebidoOS <= 0) {
        valor_pecas = 0;
        valor_servicos = 0;
      } else {
        valor_pecas = Math.min(valor_pecas, totalRecebidoPecasOS);
        valor_servicos = Math.min(valor_servicos, totalRecebidoServicosOS);
      }

      // Verifica contrato pelo cliente da OS
      const clienteNome = String(row.gc_os_cliente || detail.nome_cliente || "");
      const contrato = contratoByCliente.get(normalize(clienteNome));
      const horas = horasByOs.get(osId) || 0;

      let comissao_pecas = valor_pecas * 0.01;
      let comissao_servicos: number;
      let base_servico_contrato = 0;
      if (valor_servicos <= 0 || servicos_count <= 0) {
        comissao_servicos = 0;
      } else if (contrato) {
        base_servico_contrato = horas * toNum(contrato.valor_hora);
        comissao_servicos = base_servico_contrato * toNum(contrato.taxa_comissao_servico);
      } else {
        comissao_servicos = valor_servicos * 0.15;
      }
      const comissao_total = comissao_pecas + comissao_servicos;

      // Técnico: prioriza VENDEDOR DA OS GC (responsável comercial/técnico),
      // fallback para execução Auvo
      const tecnico =
        String(detail.nome_vendedor || "").trim() ||
        (row.gc_os_vendedor || "").trim() ||
        String(detail.nome_tecnico || "").trim() ||
        (row.tecnico || "").trim() ||
        "Sem técnico";
      const tecnico_id = String(detail.vendedor_id || row.tecnico_id || "");
      const key = (tecnico_id ? `${tecnico_id}|` : "") + tecnico.toLowerCase();

      let agg = techMap.get(key);
      if (!agg) {
        agg = {
          tecnico, tecnico_id, os_count: 0,
          valor_pecas: 0, valor_servicos: 0,
          comissao_pecas: 0, comissao_servicos: 0, comissao_total: 0,
          ordens: [],
        };
        techMap.set(key, agg);
      }
      agg.os_count += 1;
      agg.valor_pecas += valor_pecas;
      agg.valor_servicos += valor_servicos;
      agg.comissao_pecas += comissao_pecas;
      agg.comissao_servicos += comissao_servicos;
      agg.comissao_total += comissao_total;
      agg.ordens.push({
        gc_os_id: osId,
        gc_os_codigo: String(row.gc_os_codigo || detail.codigo || ""),
        cliente: String(row.gc_os_cliente || detail.nome_cliente || ""),
        data_saida: dataSaidaStr,
        valor_pecas, valor_servicos,
        comissao_pecas, comissao_servicos, comissao_total,
        pecas_count, servicos_count,
        situacao: String(detail.nome_situacao || ""),
        cor_situacao: String(detail.cor_situacao || ""),
        gc_link: `https://gestaoclick.com/ordens_servicos/editar/${osId}?retorno=%2Fordens_servicos`,
        itens_pecas,
        itens_servicos,
        contrato: contrato ? { nome: contrato.nome, valor_hora: toNum(contrato.valor_hora), taxa: toNum(contrato.taxa_comissao_servico), horas, base_servico: base_servico_contrato } : null,
      });
    }

    const tecnicos = Array.from(techMap.values()).sort((a, b) => b.comissao_total - a.comissao_total);
    for (const t of tecnicos) t.ordens.sort((a, b) => b.comissao_total - a.comissao_total);

    const totais = tecnicos.reduce((acc, t) => ({
      os_count: acc.os_count + t.os_count,
      valor_pecas: acc.valor_pecas + t.valor_pecas,
      valor_servicos: acc.valor_servicos + t.valor_servicos,
      comissao_pecas: acc.comissao_pecas + t.comissao_pecas,
      comissao_servicos: acc.comissao_servicos + t.comissao_servicos,
      comissao_total: acc.comissao_total + t.comissao_total,
    }), { os_count: 0, valor_pecas: 0, valor_servicos: 0, comissao_pecas: 0, comissao_servicos: 0, comissao_total: 0 });

    return new Response(
      JSON.stringify({
        ok: true,
        month, startDate, endDate,
        os_total: osIds.length,
        os_detalhadas: osDetails.size,
        tecnicos,
        totais,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[premiacao] erro:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});