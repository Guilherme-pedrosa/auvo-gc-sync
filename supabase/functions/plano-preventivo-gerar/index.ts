import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, QUADRIMESTRAL: 4, SEMESTRAL: 6, ANUAL: 12,
};
const normalizePer = (raw: any): string => {
  const s = String(raw ?? "").trim().toUpperCase();
  if (PER_TO_STEP[s]) return s;
  if (s.startsWith("MENS")) return "MENSAL";
  if (s.startsWith("BIM")) return "BIMESTRAL";
  if (s.startsWith("TRI")) return "TRIMESTRAL";
  if (s.startsWith("QUAD")) return "QUADRIMESTRAL";
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
      cliente_nome, ano_referencia, mode = "preview",
      apply_rows,
    } = body as {
      cliente_nome?: string | null;
      ano_referencia: number;
      mode?: "preview" | "apply";
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
    if (!cliente_nome) return json({ ok: false, error: "cliente_nome obrigatório" });

    const clientes: string[] = [cliente_nome];
    const clientesNorm = new Set(clientes.map(normalizeKey));

    // ── contrato — precedência: cliente direto > grupo ─────────────────────
    let htContratoMes = 0;
    let vigenciaInicio: string | null = null;
    let contratoFonte: "cliente" | "grupo" | null = null;
    {
      const { data: cli } = await supabase
        .from("contratos")
        .select("horas_mes_contratadas, vigencia_inicio, ativo")
        .eq("cliente_nome", cliente_nome)
        .eq("ativo", true);
      const cliValid = (cli || []).filter((c: any) => Number(c.horas_mes_contratadas) > 0);
      if (cliValid.length > 0) {
        htContratoMes = cliValid.reduce((s: number, c: any) => s + Number(c.horas_mes_contratadas || 0), 0);
        vigenciaInicio = cliValid[0].vigencia_inicio ?? null;
        contratoFonte = "cliente";
      } else {
        const { data: memb } = await supabase
          .from("grupo_cliente_membros")
          .select("grupo_id")
          .eq("cliente_nome", cliente_nome);
        const grupoIds = Array.from(new Set((memb || []).map((m: any) => m.grupo_id).filter(Boolean)));
        if (grupoIds.length > 0) {
          const { data: gc } = await supabase
            .from("contratos")
            .select("horas_mes_contratadas, vigencia_inicio, ativo")
            .in("grupo_id", grupoIds)
            .eq("ativo", true);
          const gcValid = (gc || []).filter((c: any) => Number(c.horas_mes_contratadas) > 0);
          if (gcValid.length > 0) {
            htContratoMes = gcValid.reduce((s: number, c: any) => s + Number(c.horas_mes_contratadas || 0), 0);
            vigenciaInicio = gcValid[0].vigencia_inicio ?? null;
            contratoFonte = "grupo";
          }
        }
      }
      if (!htContratoMes || htContratoMes <= 0) {
        return json({
          ok: false,
          code: "SEM_CONTRATO",
          error: "Sem contrato ativo com horas contratadas para este cliente (nem no grupo).",
        });
      }
    }

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

    // ── horas corretivas realizadas (ano) ──────────────────────────────────
    const yearStart = `${ano_referencia}-01-01`;
    const yearEnd = `${ano_referencia}-12-31`;
    // Tipos de tarefa considerados como preventiva
    // 180175 Visita Preventiva + OS
    // 180176 Visita Preventiva Contrato
    // 202616 MANUTENÇÃO PREVENTIVA IVARIO
    // 235724 MANUTENÇÃO PREVENTIVA - FROTA
    const PREV_TYPES = new Set(["180175", "180176", "202616", "235724"]);
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
      auvo_equipment_id: string | null;
      nome: string;
      cliente: string | null;
      tipo_id_atual: string | null;
      tipo_nome_resolvido: string | null;
      tipo_source: "override_manual" | "tipo_atual" | "ia_keywords";
      categoria: string;
      periodicidade: string;
      step: number;
      criticidade: "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
      horas_por_tecnico: number;
      qtd_tecnicos: number;
      ht_por_ocorrencia: number;
      freq: number;
      ht_total_ano: number;
      keyword_match: string | null;
      ultima_preventiva: string | null;
    };

    const items: RowItem[] = [];
    const semTipo: Array<{ equip_id: string; nome: string; cliente: string | null }> = [];
    for (const e of equipsScope) {
      let tipo: any = null;
      let source: RowItem["tipo_source"] | null = null;
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
      const hasOverride =
        e.override_horas_por_tecnico != null ||
        e.override_qtd_tecnicos != null ||
        e.override_periodicidade;

      if (!tipo && !hasOverride) {
        // Não descartar: incluir com defaults conservadores para que
        // TODOS os equipamentos ativos da unidade apareçam no plano.
        // O usuário pode ajustar HT / mover meses / remover manualmente.
        semTipo.push({ equip_id: e.id, nome: e.nome, cliente: e.cliente });
        const periodicidadeDef = "ANUAL";
        const stepDef = PER_TO_STEP[periodicidadeDef] || 12;
        const htDef = 1;
        const qtdDef = 1;
        items.push({
          equip_id: e.id,
          codigo_barras_auvo: String(e.identificador),
          auvo_equipment_id: e.auvo_equipment_id ?? null,
          nome: e.nome,
          cliente: e.cliente,
          tipo_id_atual: e.tipo_id,
          tipo_nome_resolvido: null,
          tipo_source: "ia_keywords",
          categoria: "SEM TIPO",
          periodicidade: periodicidadeDef,
          step: stepDef,
          criticidade: "MEDIA",
          horas_por_tecnico: htDef,
          qtd_tecnicos: qtdDef,
          ht_por_ocorrencia: htDef * qtdDef,
          freq: expectedFreq(stepDef),
          ht_total_ano: htDef * qtdDef * expectedFreq(stepDef),
          keyword_match: null,
          ultima_preventiva: lastPrevByAuvoId.get(String(e.auvo_equipment_id ?? "")) ?? null,
        });
        continue;
      }
      if (hasOverride) source = "override_manual";

      const periodicidade = normalizePer(e.override_periodicidade ?? tipo?.periodicidade ?? "BIMESTRAL");
      const step = PER_TO_STEP[periodicidade] || 2;
      const ht_por_tec = Number(e.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? 2);
      const qtd = Math.max(1, Number(e.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? 1));
      const ht_ocor = ht_por_tec * qtd;
      const freq = expectedFreq(step);
      const criticidade = normalizeCrit(tipo?.criticidade ?? "MEDIA");

      items.push({
        equip_id: e.id,
        codigo_barras_auvo: String(e.identificador),
        auvo_equipment_id: e.auvo_equipment_id ?? null,
        nome: e.nome,
        cliente: e.cliente,
        tipo_id_atual: e.tipo_id,
        tipo_nome_resolvido: tipo?.nome ?? null,
        tipo_source: source!,
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
        ultima_preventiva: lastPrevByAuvoId.get(String(e.auvo_equipment_id ?? "")) ?? null,
      });
    }

    // ── scheduler v5: fila única por atraso, sem trava de exclusão ─────────
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth() + 1;
    const mesInicio = ano_referencia === anoAtual ? mesAtual : 1;

    // origem inicial
    type SchedItem = RowItem & {
      origem: "nunca" | "vencido" | "em_dia";
      proxima_original_abs: number | null; // ano*12 + (mes-1)
      proxima_original_mes: number | null; // 1..12 dentro do ano_ref (pode ser <1 se antes)
      atraso_base: number; // meses no mesInicio
      status_final?: "nunca" | "vencido" | "em_dia";
      atraso_meses?: number;
      meses_planejados?: number[];
      mes_inicio_ciclo?: number;
    };

    const vigenciaInicioDate = vigenciaInicio ? new Date(vigenciaInicio + "T00:00:00") : null;
    const idadeContratoMeses = vigenciaInicioDate
      ? Math.max(0, Math.floor((hoje.getTime() - vigenciaInicioDate.getTime()) / (30 * 86400 * 1000)))
      : 0;

    const refStartAbs = ano_referencia * 12; // 0-based
    const mesInicioAbs = ano_referencia * 12 + (mesInicio - 1);

    const sched: SchedItem[] = items.map((it) => {
      let origem: "nunca" | "vencido" | "em_dia";
      let proxAbs: number | null = null;
      let proxMes: number | null = null;
      let atrasoBase = 0;
      if (!it.ultima_preventiva) {
        origem = "nunca";
        atrasoBase = idadeContratoMeses;
      } else {
        const y = Number(it.ultima_preventiva.slice(0, 4));
        const m = Number(it.ultima_preventiva.slice(5, 7));
        proxAbs = y * 12 + (m - 1) + it.step;
        proxMes = (proxAbs % 12) + 1;
        // status: vencido se proxAbs < mesInicioAbs; em_dia caso contrário
        if (proxAbs < mesInicioAbs) {
          origem = "vencido";
          atrasoBase = mesInicioAbs - proxAbs;
        } else {
          origem = "em_dia";
          atrasoBase = -(proxAbs - mesInicioAbs);
        }
      }
      return {
        ...it,
        origem,
        proxima_original_abs: proxAbs,
        proxima_original_mes: proxMes,
        atraso_base: atrasoBase,
      };
    });

    // reservado por mês (agenda de preventiva)
    const reservado: number[] = Array(13).fill(0);
    const primeiraVisita = new Map<string, number>();

    // agenda subsequentes de um item a partir de m
    const agendaCiclo = (it: SchedItem, m: number) => {
      const meses: number[] = [m];
      reservado[m] += it.ht_por_ocorrencia;
      let m2 = m + it.step;
      while (m2 <= 12) {
        meses.push(m2);
        reservado[m2] += it.ht_por_ocorrencia;
        m2 += it.step;
      }
      it.meses_planejados = meses;
      it.mes_inicio_ciclo = m;
      primeiraVisita.set(it.equip_id, m);
    };

    for (let m = mesInicio; m <= 12; m++) {
      const mAbs = ano_referencia * 12 + (m - 1);
      // elegíveis neste mês: sem primeira visita e "chegaram a vez"
      const fila = sched.filter((it) => {
        if (primeiraVisita.has(it.equip_id)) return false;
        if (it.origem === "em_dia") {
          // em-dia entra desde seu proximaOriginal (mesmo se agora já virou vencido)
          return (it.proxima_original_abs ?? Infinity) <= mAbs || mAbs >= mesInicioAbs;
        }
        return true;
      }).map((it) => {
        // status vivo + atraso vivo
        let statusVivo: "nunca" | "vencido" | "em_dia";
        let atrasoVivo: number;
        if (it.origem === "em_dia") {
          const po = it.proxima_original_abs!;
          if (mAbs > po) {
            statusVivo = "vencido";
            atrasoVivo = mAbs - po;
          } else {
            statusVivo = "em_dia";
            atrasoVivo = -(po - mAbs);
          }
        } else {
          statusVivo = it.origem;
          atrasoVivo = it.atraso_base + (m - mesInicio);
        }
        return { it, statusVivo, atrasoVivo };
      });

      // só entram em disputa neste mês quem "chegou a vez"
      const disputantes = fila.filter(({ it, statusVivo }) => {
        if (it.origem === "em_dia") {
          // só entra se mAbs >= proximaOriginal_abs
          return (it.proxima_original_abs ?? Infinity) <= mAbs;
        }
        // nunca/vencido: entra desde mesInicio (sempre)
        return true;
      });

      disputantes.sort((a, b) => {
        if (b.atrasoVivo !== a.atrasoVivo) return b.atrasoVivo - a.atrasoVivo;
        return critRank[b.it.criticidade] - critRank[a.it.criticidade];
      });

      for (const { it, statusVivo, atrasoVivo } of disputantes) {
        const cabe = reservado[m] + it.ht_por_ocorrencia <= htContratoMes;
        const vencidoVivo = (statusVivo === "vencido" || statusVivo === "nunca") && atrasoVivo > 0;
        if (cabe) {
          it.status_final = statusVivo;
          it.atraso_meses = Math.max(0, atrasoVivo);
          agendaCiclo(it, m);
        } else if (vencidoVivo) {
          // força encaixe, saldo estoura visivelmente
          it.status_final = statusVivo;
          it.atraso_meses = atrasoVivo;
          agendaCiclo(it, m);
        }
        // senão: escorrega pro próximo mês
      }
    }

    // itens que sobraram sem visita (em-dia cuja próxima cai depois de dez do ano ref)
    for (const it of sched) {
      if (!primeiraVisita.has(it.equip_id)) {
        it.status_final = it.origem === "em_dia" ? "em_dia" : it.origem;
        it.atraso_meses = Math.max(0, it.atraso_base);
        it.meses_planejados = [];
        it.mes_inicio_ciclo = 0;
      }
    }

    // ── tabela mensal ──────────────────────────────────────────────────────
    const tabela_meses = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const agendada = reservado[m];
      return {
        mes: m,
        ht_agendada: Number(agendada.toFixed(2)),
        teto: htContratoMes,
        saldo: Number((htContratoMes - agendada).toFixed(2)),
      };
    });

    const htAno = tabela_meses.reduce((a, b) => a + b.ht_agendada, 0);
    const contadores = {
      total: items.length,
      nunca: sched.filter((s) => s.status_final === "nunca").length,
      vencidos: sched.filter((s) => s.status_final === "vencido").length,
      em_dia: sched.filter((s) => s.status_final === "em_dia").length,
      sem_tipo_count: semTipo.length,
      ht_ano: Number(htAno.toFixed(2)),
      ht_contrato_ano: htContratoMes * 12,
      saldo_ano: Number((htContratoMes * 12 - htAno).toFixed(2)),
      meses_negativos: tabela_meses.filter((m) => m.saldo < 0).length,
    };

    if (mode === "preview") {
      const itensOut = sched
        .slice()
        .sort((a, b) => {
          const da = b.atraso_meses ?? 0;
          const dc = a.atraso_meses ?? 0;
          if (da !== dc) return da - dc;
          return critRank[b.criticidade] - critRank[a.criticidade];
        })
        .map((it) => ({
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
          ht_total_ano: Number(((it.meses_planejados?.length ?? 0) * it.ht_por_ocorrencia).toFixed(2)),
          mes_inicio_ciclo: it.mes_inicio_ciclo ?? 0,
          meses_planejados: it.meses_planejados ?? [],
          ultima_preventiva: it.ultima_preventiva,
          proxima_original_mes: it.proxima_original_mes,
          status: it.status_final ?? it.origem,
          atraso_meses: it.atraso_meses ?? 0,
        }));

      return json({
        ok: true,
        ano_referencia,
        cliente_nome,
        contrato: {
          horas_mes_contratadas: htContratoMes,
          vigencia_inicio: vigenciaInicio,
          fonte: contratoFonte,
        },
        resumo: contadores,
        sem_tipo: semTipo,
        tabela_meses,
        itens: itensOut,
      });
    }

    // ── apply ──────────────────────────────────────────────────────────────
    if (mode === "apply") {
      if (!Array.isArray(apply_rows) || apply_rows.length === 0) {
        return json({ ok: false, error: "apply_rows obrigatório" });
      }
      // resolve grupo destino (via cliente_nome)
      let grupoDestino: string | null = null;
      const { data: memb } = await supabase
        .from("grupo_cliente_membros")
        .select("grupo_id")
        .eq("cliente_nome", cliente_nome)
        .limit(1);
      grupoDestino = (memb?.[0] as any)?.grupo_id ?? null;
      if (!grupoDestino) {
        const nomeGrupo = `[Auto] ${cliente_nome}`;
        const { data: novoGrupo, error: errGrupo } = await supabase
          .from("grupos_clientes")
          .insert({ nome: nomeGrupo })
          .select("id")
          .single();
        if (errGrupo) return json({ ok: false, error: `Falha ao criar grupo automático: ${errGrupo.message}` });
        grupoDestino = (novoGrupo as any).id;
        await supabase.from("grupo_cliente_membros").insert({ grupo_id: grupoDestino, cliente_nome });
      }

      const perMeses = (p: string) => {
        const n = normalizePer(p);
        return n === "MENSAL" ? 1 : n === "BIMESTRAL" ? 2 : n === "TRIMESTRAL" ? 3 : n === "SEMESTRAL" ? 6 : 12;
      };
      const codigos = apply_rows.map((r) => String(r.codigo_barras_auvo)).filter(Boolean);
      const { data: eqRows, error: eqErr } = await supabase
        .from("equipamentos_auvo")
        .select("id, nome, identificador")
        .in("identificador", codigos);
      if (eqErr) return json({ ok: false, code: "EQUIPAMENTOS_LOOKUP_FALHOU", error: eqErr.message });

      const eqByCod = new Map<string, { id: string; nome: string }>();
      for (const e of eqRows || []) {
        eqByCod.set(String((e as any).identificador), { id: (e as any).id, nome: (e as any).nome });
      }

      if (eqByCod.size === 0) {
        return json({
          ok: false,
          code: "NENHUM_EQUIPAMENTO_ENCONTRADO",
          error: "Nenhum equipamento do plano foi encontrado pelo identificador. O plano não foi gravado.",
          codigos_recebidos: codigos.length,
        });
      }

      const codigosNaoEncontrados = codigos.filter((codigo) => !eqByCod.has(codigo));
      if (codigosNaoEncontrados.length > 0) {
        return json({
          ok: false,
          code: "EQUIPAMENTOS_NAO_ENCONTRADOS",
          error: `${codigosNaoEncontrados.length} equipamento(s) do plano não foram encontrados pelo identificador. Nada foi gravado para evitar plano incompleto.`,
          gravados: 0,
          grupo_id: grupoDestino,
          erros: codigosNaoEncontrados.slice(0, 50).map((codigo) => ({
            codigo_barras_auvo: codigo,
            erro: "Equipamento não encontrado no cadastro ativo pelo identificador.",
          })),
        });
      }

      let gravados = 0;
      const erros: Array<{ codigo_barras_auvo: string; equipamento_nome?: string; erro: string }> = [];
      for (const r of apply_rows) {
        if (!r.codigo_barras_auvo) continue;
        const eq = eqByCod.get(String(r.codigo_barras_auvo));
        if (!eq) continue;
        const mesInicioR = Math.min(12, Math.max(1, Number(r.mes_inicio_ciclo) || 1));
        const meses = Array.isArray(r.meses_planejados) && r.meses_planejados.length
          ? r.meses_planejados
          : [mesInicioR];
        // "próxima" = primeiro mês planejado >= mês atual (se o ano é o atual); senão, o primeiro planejado do ano.
        const hoje = new Date();
        const anoRefN = Number(ano_referencia);
        const mesAtual = hoje.getMonth() + 1;
        const mesesOrdenados = [...meses].map((m: any) => Math.min(12, Math.max(1, Number(m) || 1))).sort((a, b) => a - b);
        let mesProx: number;
        if (anoRefN > hoje.getFullYear()) mesProx = mesesOrdenados[0];
        else if (anoRefN < hoje.getFullYear()) mesProx = mesesOrdenados[mesesOrdenados.length - 1];
        else mesProx = mesesOrdenados.find((m) => m >= mesAtual) ?? mesesOrdenados[0];
        const proxima = `${ano_referencia}-${String(mesProx).padStart(2, "0")}-01`;
        const periodNorm = normalizePer(r.periodicidade);
        const { error: e1 } = await supabase.from("plano_preventivo_item").upsert({
          grupo_id: grupoDestino,
          ano_referencia,
          equipamento_nome: eq.nome,
          equipamento_auvo_id: eq.id,
          match_confianca: "identificador",
          criticidade: normalizeCrit(r.criticidade),
          periodicidade: periodNorm,
          periodicidade_meses: perMeses(r.periodicidade),
          horas_total: Number(r.horas_estimadas_total) || 0,
          meses_planejados: meses,
          proxima_data: proxima,
          ativo: true,
        }, { onConflict: "grupo_id,ano_referencia,equipamento_auvo_id" });
        const { error: e2 } = await supabase.from("equipamento_plano_preventivo").upsert({
          grupo_id: grupoDestino,
          codigo_barras_auvo: String(r.codigo_barras_auvo),
          ano_referencia,
          horas_estimadas_total: Number(r.horas_estimadas_total) || 0,
          horas_por_tecnico: Number(r.horas_por_tecnico) || 2,
          qtd_tecnicos: Math.max(1, Number(r.qtd_tecnicos) || 1),
          periodicidade: periodNorm,
          criticidade: normalizeCrit(r.criticidade),
          mes_inicio_ciclo: mesInicioR,
          ativo: true,
          status: "RASCUNHO",
        }, { onConflict: "grupo_id,codigo_barras_auvo,ano_referencia" });
        if (!e1 && !e2) gravados++;
        else {
          const erro = [e1?.message, e2?.message].filter(Boolean).join(" | ");
          erros.push({ codigo_barras_auvo: String(r.codigo_barras_auvo), equipamento_nome: eq.nome, erro });
          console.error("[apply] upsert error", { codigo: r.codigo_barras_auvo, equipamento: eq.nome, e1: e1?.message, e2: e2?.message });
        }
      }

      if (gravados === 0 || erros.length > 0) {
        return json({
          ok: false,
          code: "PLANO_APPLY_INCOMPLETO",
          error: `Plano não foi gravado completamente: ${gravados}/${apply_rows.length} itens salvos.`,
          gravados,
          grupo_id: grupoDestino,
          erros: erros.slice(0, 50),
        });
      }

      return json({ ok: true, gravados, grupo_id: grupoDestino });
    }

    return json({ ok: false, error: `mode inválido: ${mode}` });
  } catch (e: any) {
    console.error("plano-preventivo-gerar", e);
    return json({ ok: false, error: e?.message || String(e) });
  }
});
