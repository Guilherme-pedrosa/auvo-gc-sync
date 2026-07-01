import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── helpers ────────────────────────────────────────────────────────────────
const normalizeKey = (s: any) =>
  String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const PER_TO_STEP: Record<string, number> = {
  MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12,
};
const normalizePer = (raw: any): string => {
  const s = String(raw ?? "").trim().toUpperCase();
  if (PER_TO_STEP[s]) return s;
  if (s.startsWith("MENS")) return "MENSAL";
  if (s.startsWith("BIM")) return "BIMESTRAL";
  if (s.startsWith("TRI")) return "TRIMESTRAL";
  if (s.startsWith("SEM")) return "SEMESTRAL";
  if (s.startsWith("ANU")) return "ANUAL";
  return "BIMESTRAL";
};
const normalizeCrit = (raw: any): "CRITICA" | "ALTA" | "MEDIA" | "BAIXA" => {
  const s = String(raw ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.startsWith("CRIT")) return "CRITICA";
  if (s.startsWith("ALT")) return "ALTA";
  if (s.startsWith("BAI")) return "BAIXA";
  return "MEDIA";
};
const critRank: Record<string, number> = { CRITICA: 4, ALTA: 3, MEDIA: 2, BAIXA: 1 };

function classifyByKeywords(
  equip: { nome: string; descricao?: string | null; categoria?: string | null },
  tipos: Array<{ id: string; nome: string; palavras_chave: string[] | null; prioridade: number | null }>,
) {
  const hay = normalizeKey([equip.nome, equip.descricao, equip.categoria].filter(Boolean).join(" "));
  if (!hay) return null;
  let best: { id: string; nome: string; score: number; priority: number } | null = null;
  for (const t of tipos) {
    const palavras = (t.palavras_chave || []).map(normalizeKey).filter(Boolean);
    if (palavras.length === 0) continue;
    let score = 0;
    for (const p of palavras) if (p && hay.includes(p)) score += p.length;
    if (score === 0) continue;
    const priority = t.prioridade ?? 999;
    if (
      !best ||
      priority < best.priority ||
      (priority === best.priority && score > best.score)
    ) {
      best = { id: t.id, nome: t.nome, score, priority };
    }
  }
  return best;
}

// step ∈ {1,2,3,6,12}; valid starts 1..step; occurrences = months [s, s+step,...] ≤ 12
function monthsForPlan(step: number, start: number): number[] {
  const out: number[] = [];
  for (let m = start; m <= 12; m += step) out.push(m);
  return out;
}
function expectedFreq(step: number) { return Math.floor(12 / step); }

// ── handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json();
    const {
      grupo_id, cliente_nome, ano_referencia, mode = "preview",
      apply_rows,
    } = body as {
      grupo_id?: string;
      cliente_nome?: string | null;
      ano_referencia: number;
      mode?: "preview" | "apply" | "export";
      apply_rows?: Array<{
        codigo_barras_auvo: string;
        periodicidade: string;
        criticidade: string;
        horas_por_tecnico: number;
        qtd_tecnicos: number;
        horas_estimadas_total: number;
        mes_inicio_ciclo: number;
        meses_planejados: number[];
      }>;
    };
    if (!ano_referencia) return json({ ok: false, error: "ano_referencia obrigatório" });
    if (!grupo_id && !cliente_nome) return json({ ok: false, error: "grupo_id ou cliente_nome obrigatório" });

    // ── resolve client list ────────────────────────────────────────────────
    let clientes: string[] = [];
    if (grupo_id) {
      const { data } = await supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", grupo_id);
      clientes = (data || []).map((m: any) => m.cliente_nome);
    } else if (cliente_nome) {
      clientes = [cliente_nome];
    }
    const clientesNorm = new Set(clientes.map(normalizeKey));

    // ── load equipamentos (paginated) ──────────────────────────────────────
    const equips: any[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("equipamentos_auvo")
          .select("id, identificador, auvo_equipment_id, nome, descricao, categoria, cliente, status, tipo_id, override_horas_por_tecnico, override_qtd_tecnicos, override_periodicidade")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        equips.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
        if (from > 200000) break;
      }
    }
    const equipsScope = equips.filter((e: any) =>
      e.status === "Ativo" &&
      e.identificador &&
      (clientesNorm.size === 0 || clientesNorm.has(normalizeKey(e.cliente))),
    );

    // ── tipos catálogo ─────────────────────────────────────────────────────
    const { data: tipos } = await supabase
      .from("tipos_equipamento")
      .select("id, nome, categoria, horas_por_tecnico, qtd_tecnicos, periodicidade, criticidade, palavras_chave, prioridade, ativo")
      .eq("ativo", true);
    const tiposById = new Map<string, any>((tipos || []).map((t: any) => [t.id, t]));
    const tiposCatalog = (tipos || []).slice().sort((a: any, b: any) => (a.prioridade ?? 999) - (b.prioridade ?? 999));

    // ── contratos vigentes ─────────────────────────────────────────────────
    let htContratoMes = 0;
    {
      // Resolve grupos que abrangem o escopo (grupo direto ou grupos do cliente selecionado)
      const grupoIds = new Set<string>();
      if (grupo_id) grupoIds.add(grupo_id);
      if (cliente_nome) {
        const { data: memb } = await supabase
          .from("grupo_cliente_membros")
          .select("grupo_id")
          .eq("cliente_nome", cliente_nome);
        for (const m of (memb || [])) grupoIds.add((m as any).grupo_id);
      }

      const acc: any[] = [];
      if (grupoIds.size > 0) {
        const { data } = await supabase
          .from("contratos")
          .select("horas_mes_contratadas, ativo, cliente_nome, grupo_id")
          .in("grupo_id", Array.from(grupoIds))
          .eq("ativo", true);
        acc.push(...(data || []));
      }
      if (cliente_nome) {
        const { data } = await supabase
          .from("contratos")
          .select("horas_mes_contratadas, ativo, cliente_nome, grupo_id")
          .eq("cliente_nome", cliente_nome)
          .eq("ativo", true);
        acc.push(...(data || []));
      }
      // dedupe (mesmo contrato pode aparecer 2x se bate por grupo e cliente)
      const seen = new Set<string>();
      htContratoMes = acc.reduce((sum: number, c: any) => {
        const key = `${c.grupo_id || ""}|${c.cliente_nome || ""}|${c.horas_mes_contratadas || 0}`;
        if (seen.has(key)) return sum;
        seen.add(key);
        return sum + (Number(c.horas_mes_contratadas) || 0);
      }, 0);
    }

    // ── horas corretivas realizadas (ano) ──────────────────────────────────
    const yearStart = `${ano_referencia}-01-01`;
    const yearEnd = `${ano_referencia}-12-31`;
    const PREV_TYPES = new Set(["180175", "180176"]);
    const corretivasMes: number[] = Array(13).fill(0);
    // Última preventiva por equipamento (auvo_equipment_id → último ISO date)
    const lastPrevByAuvoId = new Map<string, string>();
    {
      const PAGE = 1000;
      let from = 0;
      // janela: últimos 24 meses até o fim do ano de referência (para pegar última prev mesmo antiga)
      const histStart = `${ano_referencia - 2}-01-01`;
      while (true) {
        const { data, error } = await supabase
          .from("equipamento_tarefas_auvo")
          .select("auvo_task_type_id, data_tarefa, data_conclusao, cliente, auvo_equipment_id")
          .gte("data_tarefa", histStart).lte("data_tarefa", yearEnd)
          .order("data_tarefa", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        for (const t of batch) {
          if (clientesNorm.size > 0 && !clientesNorm.has(normalizeKey(t.cliente))) continue;
          const d = t.data_conclusao || t.data_tarefa;
          if (!d) continue;
          const isPrev = PREV_TYPES.has(String(t.auvo_task_type_id ?? ""));
          if (isPrev) {
            const eq = String(t.auvo_equipment_id ?? "");
            if (eq) {
              const cur = lastPrevByAuvoId.get(eq);
              if (!cur || String(d) > cur) lastPrevByAuvoId.set(eq, String(d));
            }
          } else {
            // corretiva: só conta dentro do ano de referência
            if (String(d) >= yearStart && String(d) <= yearEnd) {
              const m = Number(String(d).slice(5, 7));
              if (m >= 1 && m <= 12) corretivasMes[m] += 2; // estimativa: 2h por corretiva
            }
          }
        }
        if (batch.length < PAGE) break;
        from += PAGE;
        if (from > 200000) break;
      }
    }

    // ── classify each equipment → resolved type/per/ht/qtd/crit ────────────
    type RowItem = {
      equip_id: string;
      codigo_barras_auvo: string;
      nome: string;
      cliente: string | null;
      tipo_id_atual: string | null;
      tipo_nome_resolvido: string | null;
      tipo_source: "override_manual" | "tipo_atual" | "ia_keywords" | "fallback_padrao";
      categoria: string;
      periodicidade: string;
      step: number;
      criticidade: string;
      horas_por_tecnico: number;
      qtd_tecnicos: number;
      ht_por_ocorrencia: number;
      freq: number;
      ht_total_ano: number;
      score?: number;
      keyword_match?: string | null;
    };

    const items: RowItem[] = [];
    for (const e of equipsScope) {
      let tipo: any = null;
      let source: RowItem["tipo_source"] = "fallback_padrao";
      let keywordMatch: string | null = null;
      if (e.tipo_id && tiposById.has(e.tipo_id)) {
        tipo = tiposById.get(e.tipo_id);
        source = "tipo_atual";
      } else {
        const hit = classifyByKeywords(e, tiposCatalog);
        if (hit) {
          tipo = tiposById.get(hit.id);
          source = "ia_keywords";
          keywordMatch = hit.nome;
        }
      }

      const periodicidade = normalizePer(e.override_periodicidade ?? tipo?.periodicidade ?? "BIMESTRAL");
      const step = PER_TO_STEP[periodicidade] || 2;
      const ht_por_tec = Number(e.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? 2);
      const qtd = Math.max(1, Number(e.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? 1));
      const ht_ocor = ht_por_tec * qtd;
      const freq = expectedFreq(step);
      const criticidade = normalizeCrit(tipo?.criticidade ?? "MEDIA");

      if (e.override_horas_por_tecnico != null || e.override_qtd_tecnicos != null || e.override_periodicidade) {
        source = "override_manual";
      }

      items.push({
        equip_id: e.id,
        codigo_barras_auvo: String(e.identificador),
        nome: e.nome,
        cliente: e.cliente,
        tipo_id_atual: e.tipo_id,
        tipo_nome_resolvido: tipo?.nome ?? null,
        tipo_source: source,
        categoria: tipo?.categoria ?? tipo?.nome ?? "SEM CATEGORIA",
        periodicidade,
        step,
        criticidade,
        horas_por_tecnico: ht_por_tec,
        qtd_tecnicos: qtd,
        ht_por_ocorrencia: ht_ocor,
        freq,
        ht_total_ano: ht_ocor * freq,
        keyword_match: keywordMatch,
        // @ts-ignore – campos adicionais
        auvo_equipment_id: e.auvo_equipment_id ?? null,
        // @ts-ignore
        ultima_preventiva: lastPrevByAuvoId.get(String(e.auvo_equipment_id ?? "")) ?? null,
      });
    }

    // ── existing plans (preserve start month) ──────────────────────────────
    const { data: planosExistentes } = await supabase
      .from("equipamento_plano_preventivo")
      .select("codigo_barras_auvo, mes_inicio_ciclo, periodicidade")
      .eq("ano_referencia", ano_referencia)
      .eq(grupo_id ? "grupo_id" : "ano_referencia", grupo_id ?? ano_referencia);
    const startByCb = new Map<string, { mes: number; per: string }>();
    for (const p of (planosExistentes || [])) {
      startByCb.set(String(p.codigo_barras_auvo), { mes: Number(p.mes_inicio_ciclo), per: String(p.periodicidade) });
    }

    // ── leveling (greedy bin-packing) ──────────────────────────────────────
    // Sort by criticality desc, then ht_por_ocorrencia desc, then freq desc
    const ordered = items.slice().sort((a, b) =>
      (critRank[b.criticidade] - critRank[a.criticidade]) ||
      (b.ht_por_ocorrencia - a.ht_por_ocorrencia) ||
      (b.freq - a.freq),
    );
    const monthly: number[] = Array(13).fill(0); // 1..12
    const itemsScheduled: Array<RowItem & { mes_inicio: number; meses: number[]; start_source: string; ultima_preventiva: string | null }> = [];
    for (const it of ordered) {
      // 1) preservar plano anterior; 2) calcular a partir da última preventiva; 3) bin-packing
      const prev = startByCb.get(it.codigo_barras_auvo);
      // @ts-ignore
      const ultimaPrev: string | null = (it as any).ultima_preventiva ?? null;
      let bestStart = 1;
      let bestScore = Infinity;
      let startSource = "leveling";
      if (prev && prev.per === it.periodicidade && prev.mes >= 1 && prev.mes <= it.step) {
        bestStart = prev.mes;
        startSource = "plano_anterior";
      } else if (ultimaPrev) {
        // próxima ocorrência = ultima + step meses; alinhar dentro do ano de referência
        const y = Number(ultimaPrev.slice(0, 4));
        const m = Number(ultimaPrev.slice(5, 7));
        // total de meses desde jan/ano_ref até a última preventiva (pode ser negativo se já no ano)
        let nextAbs = y * 12 + (m - 1) + it.step; // 0-based absolute month index for next due
        const refStartAbs = ano_referencia * 12; // janeiro do ano de referência
        const refEndAbs = refStartAbs + 11;
        // avançar/retroceder em múltiplos de step até cair no ano de referência (ou o mais próximo)
        while (nextAbs < refStartAbs) nextAbs += it.step;
        while (nextAbs > refEndAbs) nextAbs -= it.step;
        if (nextAbs < refStartAbs) nextAbs += it.step; // safety
        const firstMonthInYear = (nextAbs % 12) + 1; // 1..12
        // start é o primeiro mês do ciclo dentro de 1..step que gera ocorrência em firstMonthInYear
        bestStart = ((firstMonthInYear - 1) % it.step) + 1;
        startSource = "ultima_preventiva";
      } else {
        for (let s = 1; s <= it.step; s++) {
          const meses = monthsForPlan(it.step, s);
          // sanity: must match expected freq
          if (meses.length !== it.freq) continue;
          let maxLoad = 0;
          let sumSq = 0;
          for (let m = 1; m <= 12; m++) {
            const add = meses.includes(m) ? it.ht_por_ocorrencia : 0;
            const load = monthly[m] + add;
            if (load > maxLoad) maxLoad = load;
            sumSq += load * load;
          }
          const score = maxLoad * 1000 + sumSq * 0.001;
          if (score < bestScore) { bestScore = score; bestStart = s; }
        }
      }
      const meses = monthsForPlan(it.step, bestStart);
      for (const m of meses) monthly[m] += it.ht_por_ocorrencia;
      itemsScheduled.push({ ...it, mes_inicio: bestStart, meses, start_source: startSource, ultima_preventiva: ultimaPrev });
    }

    // ── balances ──────────────────────────────────────────────────────────
    const htContratoAno = htContratoMes * 12;
    const htAgendaAno = monthly.slice(1).reduce((a, b) => a + b, 0);
    const corretivasAno = corretivasMes.slice(1).reduce((a, b) => a + b, 0);

    const tabela_meses = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const prev = monthly[m];
      const corrReal = corretivasMes[m];
      // Regra: contrato = preventiva + corretiva (sempre).
      // O que faltar → tira da preventiva (cap no contrato).
      // O que sobrar → vai pra corretiva.
      const prevEfetiva = Math.min(prev, htContratoMes);
      const corrEfetiva = Math.max(0, htContratoMes - prevEfetiva);
      return {
        mes: m,
        ht_preventiva: Number(prevEfetiva.toFixed(2)),
        ht_corretiva: Number(corrEfetiva.toFixed(2)),
        ht_preventiva_planejada: Number(prev.toFixed(2)),
        ht_preventiva_cortada: Number(Math.max(0, prev - prevEfetiva).toFixed(2)),
        ht_corretiva_realizada: Number(corrReal.toFixed(2)),
        ht_contrato: htContratoMes,
        saldo: 0,
      };
    });

    const preventivaEfetivaAno = tabela_meses.reduce((a, b) => a + b.ht_preventiva, 0);
    const preventivaCortadaAno = tabela_meses.reduce((a, b) => a + b.ht_preventiva_cortada, 0);
    const corretivasEfetivasAno = tabela_meses.reduce((a, b) => a + b.ht_corretiva, 0);

    const resumo = {
      total_equipamentos: items.length,
      por_origem: {
        override_manual: items.filter((i) => i.tipo_source === "override_manual").length,
        tipo_atual: items.filter((i) => i.tipo_source === "tipo_atual").length,
        ia_keywords: items.filter((i) => i.tipo_source === "ia_keywords").length,
        fallback_padrao: items.filter((i) => i.tipo_source === "fallback_padrao").length,
      },
      ht_contrato_mes: htContratoMes,
      ht_contrato_ano: htContratoAno,
      ht_agenda_ano: Number(preventivaEfetivaAno.toFixed(2)),
      ht_agenda_planejada_ano: Number(htAgendaAno.toFixed(2)),
      ht_preventiva_cortada_ano: Number(preventivaCortadaAno.toFixed(2)),
      ht_corretiva_ano: Number(corretivasEfetivasAno.toFixed(2)),
      ht_corretiva_realizada_ano: Number(corretivasAno.toFixed(2)),
      saldo_ano: 0,
      pico_mes: Math.max(...monthly.slice(1)),
      vale_mes: Math.min(...monthly.slice(1)),
    };

    // ── modes ──────────────────────────────────────────────────────────────
    if (mode === "preview" || mode === "export") {
      const itensOut = itemsScheduled.map((it) => ({
        equip_id: it.equip_id,
        codigo_barras_auvo: it.codigo_barras_auvo,
        nome: it.nome,
        cliente: it.cliente,
        categoria: it.categoria,
        tipo_nome: it.tipo_nome_resolvido,
        tipo_source: it.tipo_source,
        keyword_match: it.keyword_match,
        periodicidade: it.periodicidade,
        criticidade: it.criticidade,
        horas_por_tecnico: it.horas_por_tecnico,
        qtd_tecnicos: it.qtd_tecnicos,
        ht_por_ocorrencia: Number(it.ht_por_ocorrencia.toFixed(2)),
        freq: it.freq,
        ht_total_ano: Number(it.ht_total_ano.toFixed(2)),
        mes_inicio_ciclo: it.mes_inicio,
        meses_planejados: it.meses,
        ultima_preventiva: it.ultima_preventiva,
        start_source: it.start_source,
      }));

      if (mode === "export") {
        const wb = XLSX.utils.book_new();
        // Resumo sheet
        const resumoSheet = XLSX.utils.aoa_to_sheet([
          ["RESUMO PLANO DE PREVENTIVAS"],
          ["Ano de referência", ano_referencia],
          ["Grupo / Cliente", grupo_id ? `grupo:${grupo_id}` : (cliente_nome ?? "")],
          [],
          ["Total equipamentos", resumo.total_equipamentos],
          ["HT contrato/mês", resumo.ht_contrato_mes],
          ["HT contrato/ano", resumo.ht_contrato_ano],
          ["HT agenda/ano (preventivas)", resumo.ht_agenda_ano],
          ["HT corretiva/ano (realizadas)", resumo.ht_corretiva_ano],
          ["Saldo/ano", resumo.saldo_ano],
          ["Pico mensal (h)", resumo.pico_mes],
          ["Vale mensal (h)", resumo.vale_mes],
          [],
          ["Origem do tipo", "Qtd"],
          ["Override manual", resumo.por_origem.override_manual],
          ["Tipo já definido", resumo.por_origem.tipo_atual],
          ["IA por palavras-chave", resumo.por_origem.ia_keywords],
          ["Fallback padrão", resumo.por_origem.fallback_padrao],
        ]);
        XLSX.utils.book_append_sheet(wb, resumoSheet, "Resumo");

        // Tabela HT mensal
        const tabelaHtRows = [
          ["Mês", "HT Preventiva", "HT Corretiva", "HT Contrato", "Saldo"],
          ...tabela_meses.map((m) => [m.mes, m.ht_preventiva, m.ht_corretiva, m.ht_contrato, m.saldo]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tabelaHtRows), "Tabela HT");

        // Aba por casa
        const clientesUnicos = Array.from(new Set(itensOut.map((i) => i.cliente || "Sem cliente")));
        for (const cli of clientesUnicos) {
          const linhas = itensOut.filter((i) => (i.cliente || "Sem cliente") === cli);
          const header = [
            "ID", "Equipamento", "Categoria", "Criticidade", "Periodicidade",
            "HT/Téc", "Qtd Téc", "HT/Ocorrência", "Freq/Ano", "HT Total/Ano",
            "Mês início", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez", "Origem", "Match IA",
          ];
          const rows: any[][] = [header];
          for (const l of linhas) {
            const meses = Array(12).fill("");
            for (const m of l.meses_planejados) meses[m - 1] = l.ht_por_ocorrencia;
            rows.push([
              { t: "s", v: l.codigo_barras_auvo },
              l.nome,
              l.categoria,
              l.criticidade,
              l.periodicidade,
              l.horas_por_tecnico,
              l.qtd_tecnicos,
              l.ht_por_ocorrencia,
              l.freq,
              l.ht_total_ano,
              l.mes_inicio_ciclo,
              ...meses,
              l.tipo_source,
              l.keyword_match ?? "",
            ]);
          }
          // totals row
          const totHt = linhas.reduce((a, b) => a + b.ht_total_ano, 0);
          rows.push(["", "TOTAL", "", "", "", "", "", "", "", totHt, "", ...Array(12).fill(""), "", ""]);
          const sheetName = String(cli).slice(0, 28).replace(/[\\/?*[\]:]/g, "_") || "Casa";
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
        }
        const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        const u8 = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        const b64 = btoa(bin);
        return json({ ok: true, xlsx_base64: b64, filename: `plano-preventivas-${ano_referencia}.xlsx`, resumo });
      }

      return json({
        ok: true, ano_referencia, grupo_id: grupo_id ?? null, cliente_nome: cliente_nome ?? null,
        resumo, tabela_meses, itens: itensOut,
      });
    }

    // ── apply: persist into equipamento_plano_preventivo ───────────────────
    if (mode === "apply") {
      if (!Array.isArray(apply_rows) || apply_rows.length === 0) {
        return json({ ok: false, error: "apply_rows obrigatório" });
      }
      // Resolver grupo_id de destino: usa o informado; senão, tenta achar via cliente_nome
      let grupoDestino: string | null = grupo_id ?? null;
      if (!grupoDestino && cliente_nome) {
        const { data: memb } = await supabase
          .from("grupo_cliente_membros")
          .select("grupo_id")
          .eq("cliente_nome", cliente_nome)
          .limit(1);
        grupoDestino = (memb?.[0] as any)?.grupo_id ?? null;
      }
      // Fallback: sem grupo, mas existe contrato pro cliente → cria grupo automático (1 membro)
      if (!grupoDestino && cliente_nome) {
        const { data: contr } = await supabase
          .from("contratos")
          .select("id, cliente_nome")
          .eq("cliente_nome", cliente_nome)
          .eq("ativo", true)
          .limit(1);
        if (contr && contr.length > 0) {
          const nomeGrupo = `[Auto] ${cliente_nome}`;
          const { data: novoGrupo, error: errGrupo } = await supabase
            .from("grupos_clientes")
            .insert({ nome: nomeGrupo })
            .select("id")
            .single();
          if (errGrupo) {
            return json({ ok: false, error: `Falha ao criar grupo automático: ${errGrupo.message}` });
          }
          grupoDestino = (novoGrupo as any).id;
          await supabase
            .from("grupo_cliente_membros")
            .insert({ grupo_id: grupoDestino, cliente_nome });
        }
      }
      if (!grupoDestino) {
        return json({
          ok: false,
          error: "Sem grupo e sem contrato ativo para este cliente. Cadastre um contrato (Contratos) ou adicione o cliente a um grupo.",
        });
      }
      let gravados = 0;
      for (const r of apply_rows) {
        if (!r.codigo_barras_auvo) continue;
        const { error } = await supabase.from("equipamento_plano_preventivo").upsert({
          grupo_id: grupoDestino,
          codigo_barras_auvo: String(r.codigo_barras_auvo),
          ano_referencia,
          horas_estimadas_total: Number(r.horas_estimadas_total) || 0,
          horas_por_tecnico: Number(r.horas_por_tecnico) || 2,
          qtd_tecnicos: Math.max(1, Number(r.qtd_tecnicos) || 1),
          periodicidade: normalizePer(r.periodicidade),
          criticidade: normalizeCrit(r.criticidade),
          mes_inicio_ciclo: Number(r.mes_inicio_ciclo) || 1,
          ativo: true,
          status: "RASCUNHO",
        }, { onConflict: "grupo_id,codigo_barras_auvo,ano_referencia" });
        if (!error) gravados++;
      }
      return json({ ok: true, gravados, grupo_id: grupoDestino });
    }

    return json({ ok: false, error: `mode inválido: ${mode}` });
  } catch (e: any) {
    console.error("plano-preventivo-gerar", e);
    return json({ ok: false, error: e?.message || String(e) });
  }
});