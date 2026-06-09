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
    .replace(/[.,/\\-]/g, " ")
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa)\b\.?/g, " ")
    .replace(/\s+/g, " ")
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

// Serviços com taxa fixa de 10% (regra especial)
// Ex.: "REOPERAÇÃO COMPLETA EM SISTEMA DE REFRIGERAÇÃO COM DESCONTAMINAÇÃO E CARGA DE GÁS"
function isServicoTaxa10(desc: string): boolean {
  const n = normalize(desc);
  return n.includes("reoperac");
}

// Aliases de técnicos — consolida variações de nome (mesma pessoa) em um único registro
const TECNICO_ALIASES: Array<{ canonical: string; match: (n: string) => boolean }> = [
  {
    canonical: "Elton Jhonny de Oliveira Vargas",
    match: (n) => n.startsWith("elton") || n.includes("elton jhonny"),
  },
  {
    canonical: "Romário Gonçalves Vieira",
    match: (n) => n.includes("romario") && n.includes("goncalves"),
  },
];

function canonicalTecnico(name: string): string {
  const n = normalize(name);
  if (!n) return name;
  for (const a of TECNICO_ALIASES) {
    if (a.match(n)) return a.canonical;
  }
  return name;
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

function parseTaskIds(value: any): string[] {
  return Array.from(new Set(
    String(value || "")
      .split("/")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
  ));
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
      .select("id, nome, grupo_id, cliente_nome, valor_hora, taxa_comissao_servico, taxa_comissao_peca, premiacao_preventiva_hora, vigencia_inicio, vigencia_fim, ativo")
      .eq("ativo", true);
    const grupoIds = (contratosData || []).map((c: any) => c.grupo_id).filter(Boolean);
    const { data: membrosData } = grupoIds.length > 0
      ? await supabase.from("grupo_cliente_membros").select("grupo_id, cliente_nome").in("grupo_id", grupoIds)
      : { data: [] as any[] };
    const contratoByCliente = new Map<string, any>();
    for (const c of contratosData || []) {
      const ini = c.vigencia_inicio || null;
      const fim = c.vigencia_fim || null;
      if (ini && ini > endDate) continue;
      if (fim && fim < startDate) continue;
      if (c.grupo_id) {
        for (const m of (membrosData || []).filter((x: any) => x.grupo_id === c.grupo_id)) {
          contratoByCliente.set(normalize(m.cliente_nome), c);
        }
      }
      if (c.cliente_nome) {
        contratoByCliente.set(normalize(c.cliente_nome), c);
      }
    }
    console.log(`[premiacao] ${contratosData?.length || 0} contratos ativos, ${contratoByCliente.size} clientes mapeados`);

    // Retornos de OS: quando uma OS recebe retorno, o técnico que atendeu o retorno
    // passa a receber o faturamento/premiação no lugar do técnico original.
    const { data: retornosData } = await supabase
      .from("os_retornos")
      .select("gc_os_codigo, tecnico_retorno");
    const retornoByCodigo = new Map<string, string>();
    for (const r of retornosData || []) {
      const cod = String(r.gc_os_codigo || "").trim();
      const tec = String(r.tecnico_retorno || "").trim();
      if (cod && tec) retornoByCodigo.set(cod, tec);
    }

    // Candidatos: OS com data_saida cacheada no mês OU sem data_saida cacheada mas com conclusão Auvo no mês
    // (re-filtramos abaixo pelo data_saida real do GC detail)
    const { data: rowsA, error: errA } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, auvo_task_url, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_tarefa_exec, tecnico, tecnico_id, data_tarefa, status_auvo, data_conclusao, duracao_decimal")
      .not("gc_os_id", "is", null)
      .gte("gc_os_data_saida", startDate)
      .lte("gc_os_data_saida", endDate);
    const { data: rowsB, error: errB } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, auvo_task_url, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_tarefa_exec, tecnico, tecnico_id, data_tarefa, status_auvo, data_conclusao, duracao_decimal")
      .not("gc_os_id", "is", null)
      .is("gc_os_data_saida", null);
    // rowsC: OS cuja data_saida cacheada está FORA do mês, mas que foram
    // concluídas no Auvo dentro do mês. A data_saida pode ter sido alterada
    // no GC depois da última sincronização — re-validamos abaixo pelo
    // detail real do GC.
    const { data: rowsC, error: errC } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, auvo_task_url, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_tarefa_exec, tecnico, tecnico_id, data_tarefa, status_auvo, data_conclusao, duracao_decimal")
      .not("gc_os_id", "is", null)
      .not("gc_os_data_saida", "is", null)
      .or(`gc_os_data_saida.lt.${startDate},gc_os_data_saida.gt.${endDate}`)
      .gte("data_conclusao", startDate)
      .lte("data_conclusao", endDate);
    const error = errA || errB || errC;
    const rows = [...(rowsA || []), ...(rowsB || []), ...(rowsC || [])];

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Index duracao por auvo_task_id — usar MAX por task_id (linhas duplicadas em
    // tarefas_central representam a mesma tarefa Auvo e NÃO devem ser somadas).
    const duracaoByAuvoTask = new Map<string, number>();
    const tecnicoByExecTask = new Map<string, { tecnico: string; tecnico_id: string }>();
    const urlByAuvoTask = new Map<string, string>();
    for (const r of rows || []) {
      const k = String(r.auvo_task_id || "");
      if (!k) continue;
      const v = toNum(r.duracao_decimal);
      const prev = duracaoByAuvoTask.get(k) ?? -1;
      if (v > prev) duracaoByAuvoTask.set(k, v);
      const u = String((r as any).auvo_task_url || "").trim();
      if (u && !urlByAuvoTask.has(k)) urlByAuvoTask.set(k, u);
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

    // Reforça o mapa de duração usando apenas as tarefas de execução já
    // resolvidas e salvas localmente em `gc_os_tarefa_exec`.
    const execTaskIds = new Set<string>();
    for (const row of byOs.values()) {
      for (const execTaskId of parseTaskIds(row.gc_os_tarefa_exec)) {
        execTaskIds.add(execTaskId);
      }
    }

    if (execTaskIds.size > 0) {
      const execRowsAll: any[] = [];
      const execIds = Array.from(execTaskIds);
      const EXEC_PAR = 200;
      for (let i = 0; i < execIds.length; i += EXEC_PAR) {
        const chunk = execIds.slice(i, i + EXEC_PAR);
        const { data: execRows, error: execError } = await supabase
          .from("tarefas_central")
          .select("auvo_task_id, auvo_task_url, duracao_decimal, tecnico, tecnico_id")
          .in("auvo_task_id", chunk);

        if (execError) {
          return new Response(
            JSON.stringify({ ok: false, error: execError.message }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        execRowsAll.push(...(execRows || []));
      }

      for (const r of execRowsAll) {
        const k = String(r.auvo_task_id || "");
        if (!k) continue;
        const v = toNum(r.duracao_decimal);
        const prev = duracaoByAuvoTask.get(k) ?? -1;
        if (v > prev) duracaoByAuvoTask.set(k, v);
        const execTec = String(r.tecnico || "").trim();
        if (execTec && !tecnicoByExecTask.has(k)) {
          tecnicoByExecTask.set(k, { tecnico: execTec, tecnico_id: String(r.tecnico_id || "") });
        }
        const u = String((r as any).auvo_task_url || "").trim();
        if (u && !urlByAuvoTask.has(k)) urlByAuvoTask.set(k, u);
      }
    }

    // Aggregate per technician
    type OsRow = {
      gc_os_id: string;
      gc_os_codigo: string;
      cliente: string;
      data_saida: string;
      valor_pecas: number;
      valor_servicos: number;
      faturamento: number;
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

      // Apenas OS com situação iniciando por "EXECUTADO" geram comissão.
      // (ex.: EXECUTADO - AGUARDANDO PAGAMENTO, EXECUTADO COM NOTA EMITIDA,
      //  EXECUTADO EM GARANTIA, EXECUTADO - CIGAM, EXECUTADO POR CONTRATO, etc.)
      {
        const sit = normalize(String(detail.nome_situacao || "")).trim();
        if (!sit.startsWith("executado")) continue;
      }

      // Tarefa Execução — usa apenas o vínculo já salvo localmente na base.
      const execTaskIds = parseTaskIds(row.gc_os_tarefa_exec);
      const execTaskId = execTaskIds[0] || (row.auvo_task_id ? String(row.auvo_task_id) : "");
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
      // Faturamento por OS: soma apenas itens voltados ao serviço.
      // Exclui deslocamento, hospedagem/alimentação e quaisquer itens não comissionáveis.
      let faturamento_os = 0;
      const itens_pecas: any[] = [];
      for (const p of produtos) {
        const descProd = String(p.nome_produto || p.detalhes || "");
        const total = calcItemTotal(p);
        const hospAlim = isHospedagemAlimentacao(descProd);
        const semValorRecebido = total <= 0 || totalRecebidoOS <= 0 || totalRecebidoPecasOS <= 0;
        if (!hospAlim && !semValorRecebido) {
          valor_pecas += total;
          pecas_count += 1;
          faturamento_os += total;
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
      let valor_servicos_taxa5 = 0;
      let valor_servicos_taxa10 = 0;
      // Horas reais trabalhadas (Auvo) — APENAS das tarefas de execução já salvas na base.
      const horas = execTaskIds.length > 0
        ? execTaskIds.reduce((acc, id) => acc + (duracaoByAuvoTask.get(id) || 0), 0)
        : (execTaskId ? (duracaoByAuvoTask.get(execTaskId) || 0) : 0);
      let valor_servicos_recuperado = 0;
      const itens_servicos: any[] = [];
      for (const s of servicos) {
        const desc = s.nome_servico || s.nome || s.descricao || s.detalhes || "";
        let total = calcItemTotal(s);
        const desloc = isDeslocamento(desc);
        const hospAlim = isHospedagemAlimentacao(desc);
        const taxa5 = isServicoTaxa5(desc);
        const taxa10 = !taxa5 && isServicoTaxa10(desc);
        // Recuperação: se o item de serviço foi lançado com total=0 mas
        // tem qtd × valor_unitário > 0 e há horas Auvo finalizadas,
        // assume que houve erro de lançamento e recupera a base
        // (qtd × valor_unitário) — ignora a checagem de totalRecebidoServicosOS.
        const qtd = toNum(s.quantidade);
        const vu = toNum(s.valor_venda) || toNum(s.valor_unitario);
        const baseUnitaria = qtd * vu;
        let recuperado = false;
        // Só recupera se o GC NÃO declarou explicitamente valor_servicos = 0.
        // Quando totalRecebidoServicosOS = 0, o serviço foi zerado por desconto
        // no GC e NÃO deve gerar premiação.
        if (
          total <= 0 &&
          baseUnitaria > 0 &&
          horas > 0 &&
          totalRecebidoOS > 0 &&
          totalRecebidoServicosOS > 0 &&
          !desloc &&
          !hospAlim
        ) {
          total = baseUnitaria;
          recuperado = true;
        }
        const semValorRecebido = recuperado
          ? false
          : (total <= 0 || totalRecebidoOS <= 0 || totalRecebidoServicosOS <= 0);
        const naoComissionado = desloc || hospAlim || semValorRecebido;
        if (!naoComissionado && total > 0) {
          if (taxa5) {
            valor_servicos_taxa5 += total;
          } else if (taxa10) {
            valor_servicos_taxa10 += total;
          } else if (recuperado) {
            valor_servicos_recuperado += total;
            servicos_count += 1;
          } else {
            valor_servicos += total;
            servicos_count += 1;
          }
          if (!desloc && !hospAlim) {
            faturamento_os += total;
          }
        }
        itens_servicos.push({
          descricao: String(desc || "Serviço"),
          quantidade: qtd,
          valor_unitario: vu,
          valor_total: total,
          deslocamento: desloc,
          nao_comissionado: naoComissionado,
          taxa_especial: !naoComissionado
            ? (taxa5 ? 0.05 : (taxa10 ? 0.10 : undefined))
            : undefined,
          recuperado: recuperado || undefined,
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
        const baseTotal = valor_pecas + valor_servicos + valor_servicos_taxa5 + valor_servicos_taxa10;
        if (baseTotal > 0) {
          const rateioPecas = descontoGeral * (valor_pecas / baseTotal);
          const rateioServ = descontoGeral * (valor_servicos / baseTotal);
          const rateioServ5 = descontoGeral * (valor_servicos_taxa5 / baseTotal);
          const rateioServ10 = descontoGeral * (valor_servicos_taxa10 / baseTotal);
          valor_pecas = Math.max(0, valor_pecas - rateioPecas);
          valor_servicos = Math.max(0, valor_servicos - rateioServ);
          valor_servicos_taxa5 = Math.max(0, valor_servicos_taxa5 - rateioServ5);
          valor_servicos_taxa10 = Math.max(0, valor_servicos_taxa10 - rateioServ10);
          // Faturamento exibido também reflete o desconto geral da OS (rateado
          // sobre os itens comissionáveis) — mantém paridade com o relatório do GC.
          faturamento_os = Math.max(0, faturamento_os - (rateioPecas + rateioServ + rateioServ5 + rateioServ10));
        }
      }

      // Regra de premiação: só comissiona sobre o valor líquido recebido na GC.
      // Os totais consolidados da OS são o teto final, cobrindo desconto de 100%
      // em produtos, serviços ou na OS inteira mesmo que algum item venha divergente.
      if (totalRecebidoOS <= 0) {
        valor_pecas = 0;
        valor_servicos = 0;
        valor_servicos_taxa5 = 0;
        valor_servicos_taxa10 = 0;
      } else {
        valor_pecas = Math.min(valor_pecas, totalRecebidoPecasOS);
        // Aplica teto consolidado de serviços recebidos respeitando ambas as faixas
        const totServ = valor_servicos + valor_servicos_taxa5 + valor_servicos_taxa10;
        if (totServ > totalRecebidoServicosOS && totServ > 0) {
          const ratio = totalRecebidoServicosOS / totServ;
          valor_servicos = valor_servicos * ratio;
          valor_servicos_taxa5 = valor_servicos_taxa5 * ratio;
          valor_servicos_taxa10 = valor_servicos_taxa10 * ratio;
        }
      }

      // Verifica contrato pelo cliente da OS
      const clienteNome = String(row.gc_os_cliente || detail.nome_cliente || "");
      const contrato = contratoByCliente.get(normalize(clienteNome));

      const taxaPecas = contrato ? toNum(contrato.taxa_comissao_peca ?? 0.02) : 0.01;
      let comissao_pecas = valor_pecas * taxaPecas;
      let comissao_servicos = 0;
      let base_servico_contrato = 0;
      const possuiServicoRecebido = (valor_servicos + valor_servicos_taxa5 + valor_servicos_taxa10 + valor_servicos_recuperado) > 0;
      if (valor_servicos > 0 && servicos_count > 0) {
        // Serviço com valor recebido na GC paga a taxa normal de serviço.
        // Regra de contrato só entra quando o serviço ficou 100% descontado/zerado.
        comissao_servicos = valor_servicos * 0.15;
      } else if (!possuiServicoRecebido && contrato && totalRecebidoOS > 0 && horas > 0) {
        // Serviço 100% descontado/zerado na GC mas há contrato + horas trabalhadas: paga por hora-homem.
        base_servico_contrato = horas * toNum(contrato.valor_hora);
        comissao_servicos = base_servico_contrato * toNum(contrato.taxa_comissao_servico);
      }
      // Serviço RECUPERADO (item GC zerado mas qtd × valor_unit > 0 + horas Auvo):
      // segue a taxa normal de serviço. As taxas especiais 5%/10% são tratadas abaixo.
      if (valor_servicos_recuperado > 0) {
        comissao_servicos += valor_servicos_recuperado * 0.15;
        valor_servicos += valor_servicos_recuperado;
      }
      // Serviços com taxa especial de 5% (ex.: higienização de coifas)
      const comissao_servicos_taxa5 = valor_servicos_taxa5 * 0.05;
      comissao_servicos += comissao_servicos_taxa5;
      // Soma o valor especial ao valor_servicos exibido (para totais)
      valor_servicos += valor_servicos_taxa5;
      // Serviços com taxa especial de 10% (ex.: reoperação completa de refrigeração)
      const comissao_servicos_taxa10 = valor_servicos_taxa10 * 0.10;
      comissao_servicos += comissao_servicos_taxa10;
      valor_servicos += valor_servicos_taxa10;
      const comissao_total = comissao_pecas + comissao_servicos;

      // Técnico: prioriza VENDEDOR DA OS GC (responsável comercial/técnico),
      // mas se o GC estiver sem vendedor, NÃO reaproveita vendedor antigo cacheado:
      // cai para o técnico da OS no GC e depois para execução Auvo.
      // Se houver retorno registrado, o técnico do retorno assume a OS.
      const gcCodigo = String(row.gc_os_codigo || detail.codigo || "").trim();
      const tecnicoRetorno = gcCodigo ? retornoByCodigo.get(gcCodigo) : undefined;
      // Técnico que executou (tarefa 73344) — usado pra detectar divergência com o vendedor do GC.
      const execTecInfo = execTaskIds
        .map((id) => tecnicoByExecTask.get(id))
        .find((x) => x && x.tecnico);
      // Vendedor do GC é a fonte da verdade. Se não tiver, NÃO usa execução nem cache:
      // vai pro bucket "Sem vendedor" para revisão manual.
      const vendedorGc = String(detail.nome_vendedor || "").trim();
      let tecnico: string;
      let tecnico_id: string;
      let key: string;
      let displayNome: string;
      if (tecnicoRetorno) {
        tecnico = canonicalTecnico(tecnicoRetorno);
        tecnico_id = "";
        const pn = normalize(tecnico).split(/\s+/)[0] || normalize(tecnico);
        key = pn;
        displayNome = pn ? pn.charAt(0).toUpperCase() + pn.slice(1) : tecnico;
      } else if (vendedorGc) {
        tecnico = canonicalTecnico(vendedorGc);
        tecnico_id = String(detail.vendedor_id || "");
        const pn = normalize(tecnico).split(/\s+/)[0] || normalize(tecnico);
        key = pn;
        displayNome = pn ? pn.charAt(0).toUpperCase() + pn.slice(1) : tecnico;
      } else {
        tecnico = "Sem vendedor";
        tecnico_id = "";
        key = "__sem_vendedor__";
        displayNome = "Sem vendedor";
      }

      let agg = techMap.get(key);
      if (!agg) {
        agg = {
          tecnico: displayNome, tecnico_id, os_count: 0,
          valor_pecas: 0, valor_servicos: 0,
          faturamento: 0,
          comissao_pecas: 0, comissao_servicos: 0, comissao_total: 0,
          ordens: [],
        };
        techMap.set(key, agg);
      }
      agg.os_count += 1;
      agg.valor_pecas += valor_pecas;
      agg.valor_servicos += valor_servicos;
      agg.faturamento += faturamento_os;
      agg.comissao_pecas += comissao_pecas;
      agg.comissao_servicos += comissao_servicos;
      agg.comissao_total += comissao_total;
      agg.ordens.push({
        gc_os_id: osId,
        gc_os_codigo: String(row.gc_os_codigo || detail.codigo || ""),
        cliente: String(row.gc_os_cliente || detail.nome_cliente || ""),
        data_saida: dataSaidaStr,
        valor_pecas, valor_servicos,
        faturamento: faturamento_os,
        comissao_pecas, comissao_servicos, comissao_total,
        pecas_count, servicos_count,
        situacao: String(detail.nome_situacao || ""),
        cor_situacao: String(detail.cor_situacao || ""),
        gc_link: `https://gestaoclick.com/ordens_servicos/editar/${osId}?retorno=%2Fordens_servicos`,
        auvo_link: execTaskId
          ? (urlByAuvoTask.get(execTaskId) || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${execTaskId}`)
          : null,
        itens_pecas,
        itens_servicos,
        contrato: contrato ? { nome: contrato.nome, valor_hora: toNum(contrato.valor_hora), taxa: toNum(contrato.taxa_comissao_servico), taxa_peca: toNum(contrato.taxa_comissao_peca ?? 0.02), horas, base_servico: base_servico_contrato } : null,
        retorno: tecnicoRetorno ? { tecnico: tecnicoRetorno } : null,
        tecnico_execucao: execTecInfo?.tecnico || null,
        divergente_execucao: (() => {
          const exec = normalize(execTecInfo?.tecnico || "").split(/\s+/)[0];
          const vend = normalize(tecnico).split(/\s+/)[0];
          return !!exec && !!vend && exec !== vend;
        })(),
      });
    }

    const tecnicos = Array.from(techMap.values()).sort((a, b) => b.comissao_total - a.comissao_total);
    for (const t of tecnicos) t.ordens.sort((a, b) => b.comissao_total - a.comissao_total);

    // ============================================================
    // OS COMPARTILHADAS (higienização de coifa feita por 2 técnicos)
    // Divide 50/50 todos os valores e a contagem da OS entre o
    // técnico principal (vendedor/retorno) e um técnico secundário
    // escolhido manualmente na tela de Premiação.
    // ============================================================
    try {
      const { data: compartilhadas } = await sb
        .from("premiacao_os_compartilhada")
        .select("gc_os_codigo, tecnico_secundario");
      const sharedMap = new Map<string, string>();
      for (const r of (compartilhadas || [])) {
        const cod = String((r as any).gc_os_codigo || "").trim();
        const sec = String((r as any).tecnico_secundario || "").trim();
        if (cod && sec) sharedMap.set(cod, sec);
      }

      if (sharedMap.size > 0) {
        const halveOrdem = (o: any) => {
          o.valor_pecas = (o.valor_pecas || 0) / 2;
          o.valor_servicos = (o.valor_servicos || 0) / 2;
          if (o.faturamento !== undefined) o.faturamento = (o.faturamento || 0) / 2;
          o.comissao_pecas = (o.comissao_pecas || 0) / 2;
          o.comissao_servicos = (o.comissao_servicos || 0) / 2;
          o.comissao_total = (o.comissao_total || 0) / 2;
        };

        for (const t of tecnicos) {
          for (let i = 0; i < t.ordens.length; i++) {
            const o: any = t.ordens[i];
            const secNome = sharedMap.get(String(o.gc_os_codigo || ""));
            if (!secNome) continue;

            // Se o secundário é o próprio principal, ignora (não duplica)
            const mainKey = normalize(t.tecnico).split(/\s+/)[0];
            const secKey = normalize(secNome).split(/\s+/)[0];
            if (!secKey || secKey === mainKey) continue;

            // Halve no principal
            const beforeServ = o.comissao_servicos || 0;
            const beforePec = o.comissao_pecas || 0;
            const beforeTot = o.comissao_total || 0;
            const beforeFat = o.faturamento ?? (o.valor_pecas + o.valor_servicos);
            const beforeValPec = o.valor_pecas || 0;
            const beforeValServ = o.valor_servicos || 0;

            halveOrdem(o);
            o.compartilhada_com = secNome;
            t.os_count -= 0.5;
            t.valor_pecas -= beforeValPec / 2;
            t.valor_servicos -= beforeValServ / 2;
            (t as any).faturamento = ((t as any).faturamento || 0) - beforeFat / 2;
            t.comissao_pecas -= beforePec / 2;
            t.comissao_servicos -= beforeServ / 2;
            t.comissao_total -= beforeTot / 2;

            // Localiza/cria agg secundário
            let secAgg: any = tecnicos.find(
              (x: any) => normalize(x.tecnico).split(/\s+/)[0] === secKey
            );
            if (!secAgg) {
              secAgg = {
                tecnico: secNome,
                tecnico_id: "",
                os_count: 0,
                valor_pecas: 0,
                valor_servicos: 0,
                faturamento: 0,
                comissao_pecas: 0,
                comissao_servicos: 0,
                comissao_total: 0,
                ordens: [],
              };
              tecnicos.push(secAgg);
            }
            secAgg.os_count += 0.5;
            secAgg.valor_pecas += beforeValPec / 2;
            secAgg.valor_servicos += beforeValServ / 2;
            secAgg.faturamento = (secAgg.faturamento || 0) + beforeFat / 2;
            secAgg.comissao_pecas += beforePec / 2;
            secAgg.comissao_servicos += beforeServ / 2;
            secAgg.comissao_total += beforeTot / 2;
            secAgg.ordens.push({ ...o, compartilhada_com: t.tecnico });
          }
        }

        tecnicos.sort((a: any, b: any) => b.comissao_total - a.comissao_total);
        for (const t of tecnicos) t.ordens.sort((a: any, b: any) => b.comissao_total - a.comissao_total);
      }
    } catch (err) {
      console.error("[premiacao] shared OS error:", (err as Error).message);
    }

    // ============================================================
    // VISITAS PREVENTIVAS DE CONTRATO (task types Auvo 180176 e 180175)
    // Soma horas trabalhadas × valor/hora do contrato do cliente.
    // O valor entra na comissao_total e sofre redu\u00e7\u00f5es/b\u00f4nus normalmente.
    // ============================================================
    try {
      const PREVENTIVA_TASK_TYPES = ["180176", "180175"];
      const { data: prevRows, error: prevErr } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, auvo_task_url, tecnico, tecnico_id, cliente, data_tarefa, data_conclusao, duracao_decimal, status_auvo, pendencia")
        .in("task_type_id", PREVENTIVA_TASK_TYPES)
        .gte("data_tarefa", startDate)
        .lte("data_tarefa", endDate);
      console.log(`[premiacao] preventivas query: rows=${(prevRows||[]).length} err=${prevErr?.message || 'none'}`);

      // Dedupe por auvo_task_id (linhas duplicadas em tarefas_central representam a mesma tarefa)
      const prevByTask = new Map<string, any>();
      for (const r of prevRows || []) {
        const tid = String((r as any).auvo_task_id || "");
        if (!tid) continue;
        const status = normalize(String((r as any).status_auvo || ""));
        if (!status.startsWith("finalizada")) continue;
        const existing = prevByTask.get(tid);
        if (!existing) { prevByTask.set(tid, r); continue; }
        if (!(existing.tecnico || "").trim() && (r.tecnico || "").trim()) prevByTask.set(tid, r);
      }

      for (const r of prevByTask.values()) {
        const tecRaw = canonicalTecnico(String(r.tecnico || "").trim());
        if (!tecRaw) continue;
        const horas = Math.max(0, toNum(r.duracao_decimal));
        if (horas <= 0) continue;
        const cliente = String(r.cliente || "");
        const clienteNorm = normalize(cliente);
        let contrato = contratoByCliente.get(clienteNorm);
        // Fallback para preventivas: o nome do cliente no Auvo (ex: "COCO BAMBU ANAPOLIS")
        // pode diferir do cliente_nome do contrato no GC (ex: "CB ANAPOLIS COMERCIO..."),
        // então tentamos casar pelo nome curto do contrato (ex: "COCO BAMBU") como prefixo/substring.
        if (!contrato) {
          for (const c of (contratosData || [])) {
            const nomeNorm = normalize(String((c as any).nome || ""));
            if (!nomeNorm) continue;
            if (clienteNorm === nomeNorm || clienteNorm.startsWith(nomeNorm + " ") || clienteNorm.includes(" " + nomeNorm) || clienteNorm.startsWith(nomeNorm)) {
              contrato = c;
              break;
            }
          }
        }
        // Apenas clientes com contrato geram preventiva na premiação.
        if (!contrato) continue;
        // Pendência: se houver checklist/formulário pendente, não paga preventiva.
        const pendRaw = String((r as any).pendencia || "").trim();
        const pendNorm = normalize(pendRaw);
        const temPendencia = !!pendRaw && pendNorm !== "nenhuma" && pendRaw !== "0";
        // Usa o valor R$/hora específico para preventiva configurado no contrato.
        const valorHora = toNum((contrato as any).premiacao_preventiva_hora);
        const valor = temPendencia ? 0 : horas * valorHora;

        const pn = normalize(tecRaw).split(/\s+/)[0] || normalize(tecRaw);
        const key = pn;
        const displayNome = pn ? pn.charAt(0).toUpperCase() + pn.slice(1) : tecRaw;

        let agg = techMap.get(key);
        if (!agg) {
          agg = {
            tecnico: displayNome,
            tecnico_id: String(r.tecnico_id || ""),
            os_count: 0,
            valor_pecas: 0,
            valor_servicos: 0,
            faturamento: 0,
            comissao_pecas: 0,
            comissao_servicos: 0,
            comissao_total: 0,
            ordens: [],
          };
          techMap.set(key, agg);
          tecnicos.push(agg);
        }
        const aggAny = agg as any;
        if (!aggAny.preventivas) {
          aggAny.preventivas = { count: 0, horas: 0, valor: 0, atividades: [] as any[] };
        }
        aggAny.preventivas.count += 1;
        aggAny.preventivas.horas += horas;
        aggAny.preventivas.valor += valor;
        aggAny.preventivas.atividades.push({
          auvo_task_id: String(r.auvo_task_id || ""),
          data: String(r.data_conclusao || r.data_tarefa || "").split("T")[0],
          cliente,
          contrato: contrato ? String(contrato.nome) : null,
          horas,
          valor_hora: valorHora,
          pendencia: temPendencia ? pendRaw : null,
          valor,
          auvo_link: String(r.auvo_task_url || "").trim() || (r.auvo_task_id ? `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${r.auvo_task_id}` : null),
        });
        // Soma na premia\u00e7\u00e3o total — sofre redu\u00e7\u00f5es/b\u00f4nus naturalmente abaixo.
        agg.comissao_total += valor;
      }

      // Reordena e ordena atividades por data
      for (const t of tecnicos) {
        const p = (t as any).preventivas;
        if (p?.atividades) p.atividades.sort((a: any, b: any) => String(a.data).localeCompare(String(b.data)));
      }
      tecnicos.sort((a, b) => b.comissao_total - a.comissao_total);
    } catch (e) {
      console.error("[premiacao] preventivas falhou:", (e as Error).message);
    }

    // ============================================================
    // FATOR DE REDUÇÃO: KM por telemetria (fonte: Technician & Vehicle Hub)
    // Se km/telemetria < 120 no mês, reduz 15% da premiação total do técnico.
    // ============================================================
    // Fallback hardcoded — anon key do TVH é JWT público (publishable), sem risco.
    const TVH_URL_FALLBACK = "https://qfmpyrekjbbqekxrjgov.supabase.co";
    const TVH_KEY_FALLBACK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbXB5cmVramJicWVreHJqZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Njc5NzMsImV4cCI6MjA4OTQ0Mzk3M30.ac7r6m5dLzMrEQxMQr74Bo38bgeupr5-bs0Ja4CCo2s";
    const envTvhUrl = Deno.env.get("TVH_SUPABASE_URL");
    const envTvhKey = Deno.env.get("TVH_SERVICE_ROLE_KEY");
    // Usa env só se for um JWT válido (começa com eyJ). Senão usa fallback.
    const tvhUrl = (envTvhUrl && envTvhUrl.startsWith("https://")) ? envTvhUrl : TVH_URL_FALLBACK;
    const tvhKey = (envTvhKey && envTvhKey.startsWith("eyJ") && envTvhKey.length > 100) ? envTvhKey : TVH_KEY_FALLBACK;
    const kmByTec = new Map<string, { km: number; tel: number; motorista: string }>();
    console.log(`[premiacao] TVH config: url=${tvhUrl ? tvhUrl.slice(0, 40) : "MISSING"} key=${tvhKey ? `${tvhKey.slice(0, 20)}...(len=${tvhKey.length})` : "MISSING"}`);
    if (tvhUrl && tvhKey) {
      try {
        const tvh = createClient(tvhUrl, tvhKey);
        const pageSize = 1000;
        let from = 0;
        for (let i = 0; i < 50; i++) {
          const { data: kmRows, error: kmErr } = await tvh
            .from("daily_vehicle_km")
            .select("motorista_nome, km_percorrido, telemetrias, data")
            .gte("data", startDate)
            .lte("data", endDate)
            .range(from, from + pageSize - 1);
          if (kmErr) { console.error("[premiacao] TVH km erro:", kmErr.message); break; }
          const batch = kmRows || [];
          for (const r of batch) {
            const nome = String((r as any).motorista_nome || "").trim();
            if (!nome) continue;
            const first = normalize(nome).split(/\s+/)[0];
            if (!first) continue;
            const cur = kmByTec.get(first) || { km: 0, tel: 0, motorista: nome };
            cur.km += toNum((r as any).km_percorrido);
            cur.tel += toNum((r as any).telemetrias);
            kmByTec.set(first, cur);
          }
          if (batch.length < pageSize) break;
          from += pageSize;
        }
        // Telemetrias reais: 1 linha por evento na tabela vehicle_telemetry_events
        // (a coluna daily_vehicle_km.telemetrias foi descontinuada e fica 0)
        let tFrom = 0;
        for (let i = 0; i < 100; i++) {
          const { data: telRows, error: telErr } = await tvh
            .from("vehicle_telemetry_events")
            .select("motorista_nome, data")
            .gte("data", startDate)
            .lte("data", endDate)
            .range(tFrom, tFrom + pageSize - 1);
          if (telErr) { console.error("[premiacao] TVH telemetria erro:", telErr.message); break; }
          const batch = telRows || [];
          for (const r of batch) {
            const nome = String((r as any).motorista_nome || "").trim();
            if (!nome) continue;
            const first = normalize(nome).split(/\s+/)[0];
            if (!first) continue;
            const cur = kmByTec.get(first) || { km: 0, tel: 0, motorista: nome };
            cur.tel += 1;
            kmByTec.set(first, cur);
          }
          if (batch.length < pageSize) break;
          tFrom += pageSize;
        }
        console.log(`[premiacao] TVH: ${kmByTec.size} motoristas (km + telemetrias)`);
      } catch (e) {
        console.error("[premiacao] TVH fetch falhou:", (e as Error).message);
      }
    } else {
      console.warn("[premiacao] TVH_SUPABASE_URL/TVH_SERVICE_ROLE_KEY não configurados — reduções de KM não aplicadas");
    }

    for (const t of tecnicos) {
      const first = normalize(t.tecnico).split(/\s+/)[0];
      const km = kmByTec.get(first);
      const km_total = km?.km || 0;
      const telemetrias = km?.tel || 0;
      const km_por_telemetria = telemetrias > 0 ? km_total / telemetrias : null;
      let reducao_pct = 0;
      const reducoes: Array<{ motivo: string; pct: number; valor: number }> = [];
      if (km && km_por_telemetria !== null) {
        if (km_por_telemetria < 40) {
          reducao_pct += 0.30;
          reducoes.push({
            motivo: `KM/telemetria abaixo de 40 (${km_por_telemetria.toFixed(1)} km)`,
            pct: 0.30,
            valor: t.comissao_total * 0.30,
          });
        } else if (km_por_telemetria < 70) {
          reducao_pct += 0.25;
          reducoes.push({
            motivo: `KM/telemetria de 40 a 70 (${km_por_telemetria.toFixed(1)} km)`,
            pct: 0.25,
            valor: t.comissao_total * 0.25,
          });
        } else if (km_por_telemetria < 100) {
          reducao_pct += 0.20;
          reducoes.push({
            motivo: `KM/telemetria de 70 a 100 (${km_por_telemetria.toFixed(1)} km)`,
            pct: 0.20,
            valor: t.comissao_total * 0.20,
          });
        } else if (km_por_telemetria < 120) {
          reducao_pct += 0.15;
          reducoes.push({
            motivo: `KM/telemetria de 100 a 120 (${km_por_telemetria.toFixed(1)} km)`,
            pct: 0.15,
            valor: t.comissao_total * 0.15,
          });
        }
      }
      const reducao_valor = t.comissao_total * reducao_pct;
      const comissao_final = Math.max(0, t.comissao_total - reducao_valor);
      (t as any).km_total = km_total;
      (t as any).telemetrias = telemetrias;
      (t as any).km_por_telemetria = km_por_telemetria;
      (t as any).km_motorista_match = km?.motorista || null;
      (t as any).reducao_pct = reducao_pct;
      (t as any).reducao_valor = reducao_valor;
      (t as any).reducoes = reducoes;
      (t as any).comissao_final = comissao_final;

      // BÔNUS DE TELEMETRIA — só vale se rodou > 2000 km no mês
      // > 200 km/telemetria → +5% sobre comissão bruta
      // > 150 km/telemetria → +3% sobre comissão bruta
      let bonus_telemetria_pct = 0;
      if (km_total > 2000 && km_por_telemetria !== null) {
        if (km_por_telemetria > 200) bonus_telemetria_pct = 0.05;
        else if (km_por_telemetria > 150) bonus_telemetria_pct = 0.03;
      }
      const bonus_telemetria_valor = t.comissao_total * bonus_telemetria_pct;
      (t as any).bonus_telemetria_pct = bonus_telemetria_pct;
      (t as any).bonus_telemetria_valor = bonus_telemetria_valor;
      if (bonus_telemetria_valor > 0) {
        (t as any).comissao_final = ((t as any).comissao_final ?? t.comissao_total) + bonus_telemetria_valor;
      }
    }

    // ============================================================
    // DEMÉRITOS lançados manualmente (tabela demerito_lancamentos)
    // Cada lançamento reduz X% adicional sobre a premiação bruta.
    // ============================================================
    try {
      const { data: demRows } = await supabase
        .from("demerito_lancamentos")
        .select("tecnico_nome, motivo_nome, percentual, observacao")
        .eq("mes", month);
      const byTec = new Map<string, Array<{ motivo: string; pct: number; obs?: string }>>();
      for (const r of (demRows || [])) {
        const first = normalize(String((r as any).tecnico_nome || "")).split(/\s+/)[0];
        if (!first) continue;
        const arr = byTec.get(first) || [];
        arr.push({
          motivo: String((r as any).motivo_nome || ""),
          pct: toNum((r as any).percentual) / 100,
          obs: (r as any).observacao || undefined,
        });
        byTec.set(first, arr);
      }
      for (const t of tecnicos) {
        const first = normalize(t.tecnico).split(/\s+/)[0];
        const dems = byTec.get(first);
        if (!dems || dems.length === 0) continue;
        for (const d of dems) {
          (t as any).reducao_pct = ((t as any).reducao_pct || 0) + d.pct;
          (t as any).reducoes = [
            ...((t as any).reducoes || []),
            { motivo: `Demérito: ${d.motivo}${d.obs ? ` — ${d.obs}` : ""}`, pct: d.pct, valor: t.comissao_total * d.pct },
          ];
        }
        const pctTotal = Math.min(1, (t as any).reducao_pct || 0);
        (t as any).reducao_valor = t.comissao_total * pctTotal;
        (t as any).comissao_final = Math.max(0, t.comissao_total - (t as any).reducao_valor);
      }
    } catch (e) {
      console.error("[premiacao] deméritos falhou:", (e as Error).message);
    }

    // ============================================================
    // METAS de faturamento — bônus escalonado sobre a comissão BRUTA
    // 75% a 99%  → +7,5%
    // 100% a 110% → +10%
    // 111% ou mais → +13,5%
    // ============================================================
    try {
      const { data: metasRows } = await supabase
        .from("metas_tecnicos")
        .select("nome_tecnico, meta_faturamento, ativo")
        .eq("ativo", true);
      const metaByTec = new Map<string, { nome: string; meta: number }>();
      for (const r of (metasRows || [])) {
        const nome = String((r as any).nome_tecnico || "").trim();
        if (!nome) continue;
        const first = normalize(nome).split(/\s+/)[0];
        if (!first) continue;
        metaByTec.set(first, { nome, meta: toNum((r as any).meta_faturamento) });
      }
      for (const t of tecnicos) {
        const first = normalize(t.tecnico).split(/\s+/)[0];
        const m = metaByTec.get(first);
        if (!m) {
          (t as any).meta = null;
          (t as any).meta_atingida = false;
          (t as any).bonus_meta_pct = 0;
          (t as any).bonus_meta_valor = 0;
          continue;
        }
        const fat = t.faturamento || 0;
        const ratio = m.meta > 0 ? fat / m.meta : 0;
        let bonusPct = 0;
        if (ratio >= 1.11) bonusPct = 0.135;
        else if (ratio >= 1.00) bonusPct = 0.10;
        else if (ratio >= 0.75) bonusPct = 0.075;
        const atingiu = m.meta > 0 && fat >= m.meta;
        const bonusValor = t.comissao_total * bonusPct;
        (t as any).meta = m.meta;
        (t as any).meta_atingida = atingiu;
        (t as any).bonus_meta_pct = bonusPct;
        (t as any).bonus_meta_valor = bonusValor;
        if (bonusValor > 0) {
          const baseFinal = (t as any).comissao_final ?? t.comissao_total;
          (t as any).comissao_final = baseFinal + bonusValor;
        }
      }
    } catch (e) {
      console.error("[premiacao] metas falhou:", (e as Error).message);
    }

    const totais = tecnicos.reduce((acc, t) => ({
      os_count: acc.os_count + t.os_count,
      valor_pecas: acc.valor_pecas + t.valor_pecas,
      valor_servicos: acc.valor_servicos + t.valor_servicos,
      faturamento: acc.faturamento + t.faturamento,
      comissao_pecas: acc.comissao_pecas + t.comissao_pecas,
      comissao_servicos: acc.comissao_servicos + t.comissao_servicos,
      comissao_total: acc.comissao_total + t.comissao_total,
      reducao_valor: acc.reducao_valor + ((t as any).reducao_valor || 0),
      bonus_meta_valor: acc.bonus_meta_valor + ((t as any).bonus_meta_valor || 0),
      bonus_telemetria_valor: acc.bonus_telemetria_valor + ((t as any).bonus_telemetria_valor || 0),
      comissao_final: acc.comissao_final + ((t as any).comissao_final ?? t.comissao_total),
    }), { os_count: 0, valor_pecas: 0, valor_servicos: 0, faturamento: 0, comissao_pecas: 0, comissao_servicos: 0, comissao_total: 0, reducao_valor: 0, bonus_meta_valor: 0, bonus_telemetria_valor: 0, comissao_final: 0 });

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