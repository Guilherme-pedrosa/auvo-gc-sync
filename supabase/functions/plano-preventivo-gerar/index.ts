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

// normaliza p/ comparação de razão social: remove sufixos, pontuação e sufixo de filial após " - "
const normalizeCliente = (s: any) => {
  let x = normalizeKey(s).replace(/[.\-\/]/g, " ").replace(/\s+/g, " ").trim();
  // corta sufixo de filial: "cliente x - goiania" → "cliente x"
  const dash = x.indexOf(" - ");
  if (dash > 0) x = x.slice(0, dash);
  x = " " + x + " ";
  const suf = [" ltda ", " me ", " mei ", " sa ", " s a ", " epp ", " eireli "];
  for (const s2 of suf) while (x.includes(s2)) x = x.replace(s2, " ");
  return x.replace(/\s+/g, " ").trim();
};

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

function monthOfDateInYear(raw: string | null | undefined, year: number): number | null {
  if (!raw) return null;
  const s = String(raw).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return y === year && mo >= 1 && mo <= 12 ? mo : null;
}

function monthsAround(anchor: number, step: number): number[] {
  const set = new Set<number>();
  for (let m = anchor; m >= 1; m -= step) set.add(m);
  for (let m = anchor; m <= 12; m += step) set.add(m);
  return Array.from(set).sort((a, b) => a - b);
}

function rebuildReservado(sched: any[], reservado: number[]) {
  reservado.fill(0);
  for (const it of sched) {
    for (const m of it.meses_planejados ?? []) {
      if (m >= 1 && m <= 12) reservado[m] += Number(it.ht_por_ocorrencia || 0);
    }
  }
}

function scoreSchedule(arr: number[], mesInicio: number, teto: number) {
  const slice = arr.slice(mesInicio, 13);
  const n = slice.length || 1;
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const max = Math.max(...slice, 0);
  const min = Math.min(...slice, 0);
  const maxOver = Math.max(0, max - teto);
  const totalOver = slice.reduce((a, b) => a + Math.max(0, b - teto), 0);
  return { maxOver, totalOver, variance, spread: max - min };
}

function isBetterScore(a: ReturnType<typeof scoreSchedule>, b: ReturnType<typeof scoreSchedule>) {
  if (a.maxOver < b.maxOver - 1e-6) return true;
  if (a.maxOver > b.maxOver + 1e-6) return false;
  if (a.totalOver < b.totalOver - 1e-6) return true;
  if (a.totalOver > b.totalOver + 1e-6) return false;
  if (a.variance < b.variance - 1e-6) return true;
  if (a.variance > b.variance + 1e-6) return false;
  return a.spread < b.spread - 1e-6;
}

async function optimizeScheduleWithAi(params: {
  sched: any[];
  reservado: number[];
  mesInicio: number;
  htContratoMes: number;
  anoReferencia: number;
}) {
  const { sched, reservado, mesInicio, htContratoMes, anoReferencia } = params;
  const key = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!key) return { usada: false, aplicada: false, alteracoes: 0, mensagem: "LOVABLE_API_KEY ausente" };

  const fixedEquipIds = new Set<string>();
  for (const it of sched) {
    const executedMonth = monthOfDateInYear(it.ultima_preventiva, anoReferencia);
    if (executedMonth != null && (it.meses_planejados?.length ?? 0) > 0) {
      const meses = monthsAround(executedMonth, it.step);
      it.meses_planejados = meses;
      it.mes_inicio_ciclo = meses[0] ?? executedMonth;
      fixedEquipIds.add(String(it.equip_id));
    }
  }
  rebuildReservado(sched, reservado);

  const candidates = sched
    .filter((it) => {
      const cur = it.meses_planejados ?? [];
      if (cur.length === 0) return false;
      if (fixedEquipIds.has(String(it.equip_id))) return false;
      if (Number(it.step) <= 1) return false;
      return true;
    })
    .map((it) => {
      const cur = it.meses_planejados ?? [];
      const allowed: number[] = [];
      for (let s = Math.max(1, mesInicio); s <= Math.min(12, Number(it.step)); s++) {
        const meses = monthsForPlan(Number(it.step), s);
        if (meses.length === cur.length) allowed.push(s);
      }
      return { it, allowed };
    })
    .filter((c) => c.allowed.length > 1)
    .sort((a, b) => Number(b.it.ht_por_ocorrencia || 0) - Number(a.it.ht_por_ocorrencia || 0))
    .slice(0, 180);

  if (candidates.length === 0) {
    return { usada: true, aplicada: false, alteracoes: 0, mensagem: "Sem itens móveis para IA" };
  }

  const idToCandidate = new Map<string, { it: any; allowed: number[] }>();
  const itens = candidates.map((c, idx) => {
    const id = String(idx + 1);
    idToCandidate.set(id, c);
    return {
      id,
      h: Number(Number(c.it.ht_por_ocorrencia || 0).toFixed(2)),
      step: Number(c.it.step),
      cur: c.it.meses_planejados ?? [],
      a: c.allowed,
    };
  });

  const meses = Array.from({ length: 12 }, (_, i) => ({
    m: i + 1,
    h: Number(Number(reservado[i + 1] || 0).toFixed(2)),
    saldo: Number((htContratoMes - Number(reservado[i + 1] || 0)).toFixed(2)),
  }));

  const system = [
    "Você é uma IA especialista em planejamento anual de manutenção preventiva.",
    "Sua tarefa é REORGANIZAR os meses para nivelar horas mensais sem alterar quantidade anual.",
    "Regras duras: use somente um start permitido em 'a'; não altere h, step, nem quantidade de ocorrências; não crie nem remova preventivas.",
    "Objetivo em ordem: 1) reduzir maior estouro acima do teto; 2) reduzir horas totais estouradas; 3) reduzir variância/amplitude entre meses.",
    "Responda apenas JSON válido no formato {\"alteracoes\":[{\"id\":\"1\",\"start\":2}]} e inclua só itens alterados.",
  ].join("\n");
  const user = JSON.stringify({
    teto_mensal: htContratoMes,
    ano: anoReferencia,
    meses_atuais: meses,
    itens_moveis: itens,
    legenda: "m=mes, h=horas do item, cur=meses atuais, a=starts permitidos. Meses gerados por start: start,start+step...<=12.",
  });

  try {
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return { usada: true, aplicada: false, alteracoes: 0, mensagem: `IA falhou (${aiRes.status}): ${txt.slice(0, 180)}` };
    }
    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const rawMoves = Array.isArray(parsed?.alteracoes) ? parsed.alteracoes : [];
    const seen = new Set<string>();
    const moves: Array<{ it: any; start: number; meses: number[] }> = [];
    for (const mv of rawMoves) {
      const id = String(mv?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const c = idToCandidate.get(id);
      if (!c) continue;
      const start = Math.min(12, Math.max(1, Number(mv?.start) || 0));
      if (!c.allowed.includes(start)) continue;
      if (start === c.it.mes_inicio_ciclo) continue;
      const mesesNovo = monthsForPlan(Number(c.it.step), start);
      if (mesesNovo.length !== (c.it.meses_planejados?.length ?? 0)) continue;
      moves.push({ it: c.it, start, meses: mesesNovo });
    }
    if (moves.length === 0) {
      return { usada: true, aplicada: false, alteracoes: 0, mensagem: "IA não retornou movimentos válidos" };
    }

    const currentScore = scoreSchedule(reservado, mesInicio, htContratoMes);
    const trial = reservado.slice();
    for (const mv of moves) {
      const ht = Number(mv.it.ht_por_ocorrencia || 0);
      for (const m of mv.it.meses_planejados ?? []) trial[m] -= ht;
      for (const m of mv.meses) trial[m] += ht;
    }
    if (isBetterScore(scoreSchedule(trial, mesInicio, htContratoMes), currentScore)) {
      for (const mv of moves) {
        mv.it.meses_planejados = mv.meses;
        mv.it.mes_inicio_ciclo = mv.start;
      }
      rebuildReservado(sched, reservado);
      return { usada: true, aplicada: true, alteracoes: moves.length, mensagem: "IA aplicada em lote" };
    }

    let applied = 0;
    for (const mv of moves) {
      const before = scoreSchedule(reservado, mesInicio, htContratoMes);
      const trialOne = reservado.slice();
      const ht = Number(mv.it.ht_por_ocorrencia || 0);
      for (const m of mv.it.meses_planejados ?? []) trialOne[m] -= ht;
      for (const m of mv.meses) trialOne[m] += ht;
      if (!isBetterScore(scoreSchedule(trialOne, mesInicio, htContratoMes), before)) continue;
      mv.it.meses_planejados = mv.meses;
      mv.it.mes_inicio_ciclo = mv.start;
      rebuildReservado(sched, reservado);
      applied++;
    }
    return {
      usada: true,
      aplicada: applied > 0,
      alteracoes: applied,
      mensagem: applied > 0 ? "IA aplicada parcialmente" : "IA não melhorou o score do plano",
    };
  } catch (e: any) {
    return { usada: true, aplicada: false, alteracoes: 0, mensagem: `IA indisponível: ${e?.message || String(e)}` };
  }
}

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
      apply_rows, excluir_equip_ids, usar_ia = false, manual_overrides,
    } = body as {
      cliente_nome?: string | null;
      ano_referencia: number;
      mode?: "preview" | "apply";
      excluir_equip_ids?: string[];
      usar_ia?: boolean;
      manual_overrides?: Array<{
        equip_id?: string;
        codigo_barras_auvo?: string;
        periodicidade?: string;
        ht_por_ocorrencia?: number;
        horas_por_tecnico?: number;
      }>;
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
        // Fallback: match por razão social normalizada (ignora " - FILIAL", LTDA, S.A., pontuação)
        const alvo = normalizeCliente(cliente_nome);
        if (alvo) {
          const { data: todos } = await supabase
            .from("contratos")
            .select("cliente_nome, horas_mes_contratadas, vigencia_inicio, ativo")
            .eq("ativo", true)
            .not("cliente_nome", "is", null);
          const fuzzy = (todos || []).filter((c: any) => {
            if (!c.cliente_nome || !(Number(c.horas_mes_contratadas) > 0)) return false;
            const n = normalizeCliente(c.cliente_nome);
            return n === alvo || n.startsWith(alvo) || alvo.startsWith(n);
          });
          if (fuzzy.length > 0) {
            htContratoMes = fuzzy.reduce((s: number, c: any) => s + Number(c.horas_mes_contratadas || 0), 0);
            vigenciaInicio = fuzzy[0].vigencia_inicio ?? null;
            contratoFonte = "cliente";
          }
        }
      }
      if (!htContratoMes || htContratoMes <= 0) {
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
          // Fallback: contrato de um cliente-irmão do mesmo grupo
          // (contratos legados amarrados por cliente_nome, sem grupo_id preenchido)
          if (!htContratoMes || htContratoMes <= 0) {
            const { data: irmaos } = await supabase
              .from("grupo_cliente_membros")
              .select("cliente_nome")
              .in("grupo_id", grupoIds);
            const irmaosNomes = Array.from(new Set((irmaos || []).map((m: any) => m.cliente_nome).filter(Boolean)))
              .filter((n: string) => n !== cliente_nome);
            if (irmaosNomes.length > 0) {
              const { data: irmContratos } = await supabase
                .from("contratos")
                .select("horas_mes_contratadas, vigencia_inicio, ativo, cliente_nome")
                .in("cliente_nome", irmaosNomes)
                .eq("ativo", true);
              const irmValid = (irmContratos || []).filter((c: any) => Number(c.horas_mes_contratadas) > 0);
              if (irmValid.length > 0) {
                htContratoMes = irmValid.reduce((s: number, c: any) => s + Number(c.horas_mes_contratadas || 0), 0);
                vigenciaInicio = irmValid[0].vigencia_inicio ?? null;
                contratoFonte = "grupo";
              }
            }
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
    const excluirSet = new Set((excluir_equip_ids || []).map((x) => String(x)));
    const equipsScopeFiltered = excluirSet.size > 0
      ? equipsScope.filter((e: any) => !excluirSet.has(String(e.id)))
      : equipsScope;

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
    // Tipos de tarefa considerados como preventiva — lidos de tipos_tarefa_preventiva (Item 4).
    // Fallback para os 4 IDs históricos se a tabela estiver vazia (ex.: pré-seed).
    const { data: prevTiposRows } = await supabase
      .from("tipos_tarefa_preventiva")
      .select("auvo_task_type_id")
      .eq("ativo", true)
      .is("aplica_a_categoria", null);
    const PREV_TYPES = new Set<string>(
      (prevTiposRows ?? []).map((r: any) => String(r.auvo_task_type_id)),
    );
    if (PREV_TYPES.size === 0) {
      ["180175", "180176", "202616", "235724"].forEach((t) => PREV_TYPES.add(t));
    }
    const corretivasMes: number[] = Array(13).fill(0);
    // Última preventiva por equipamento (auvo_equipment_id → último ISO date)
    const lastPrevByAuvoId = new Map<string, string>();
    // ── Item 3: fonte única — lê ultima_preventiva do consolidado ─────────
    // Fallback: se consolidado vazio, cai no scan histórico antigo.
    let usouConsolidado = false;
    try {
      const equipUuidsScope = equipsScope.map((e: any) => e.id);
      if (equipUuidsScope.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < equipUuidsScope.length; i += CHUNK) {
          const slice = equipUuidsScope.slice(i, i + CHUNK);
          const { data: consRows, error: consErr } = await supabase
            .from("equipamento_preventiva_consolidado")
            .select("auvo_equipment_id, ultima_preventiva")
            .in("equip_id", slice);
          if (consErr) throw consErr;
          for (const r of (consRows ?? []) as any[]) {
            if (r.auvo_equipment_id && r.ultima_preventiva) {
              lastPrevByAuvoId.set(String(r.auvo_equipment_id), String(r.ultima_preventiva));
              usouConsolidado = true;
            }
          }
        }
      }
    } catch (e) {
      console.warn("[plano-preventivo-gerar] consolidado indisponível, fallback:", e);
    }
    // Corretivas ainda precisam do scan (consolidado só armazena preventiva)
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
            // Só popula se consolidado NÃO tiver esse equip (Item 3: consolidado é fonte única).
            const eq = String(t.auvo_equipment_id ?? "");
            if (eq && !usouConsolidado) {
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
    const manualByEquip = new Map<string, NonNullable<typeof manual_overrides>[number]>();
    const manualByCodigo = new Map<string, NonNullable<typeof manual_overrides>[number]>();
    for (const ov of manual_overrides ?? []) {
      if (ov.equip_id) manualByEquip.set(String(ov.equip_id), ov);
      if (ov.codigo_barras_auvo) manualByCodigo.set(String(ov.codigo_barras_auvo), ov);
    }
    // Item 5b: warnings de periodicidade inválida
    const warnings: Array<{ equip_id: string; nome: string; motivo: string }> = [];
    for (const e of equipsScopeFiltered) {
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

      // Item 5b: se periodicidade for inválida/nula → ANUAL (não bimestral silencioso) + warning
      const perRaw = e.override_periodicidade ?? tipo?.periodicidade ?? null;
      let periodicidade = normalizePer(perRaw ?? "ANUAL");
      let step = PER_TO_STEP[periodicidade];
      if (!perRaw || !step) {
        periodicidade = "ANUAL";
        step = 12;
        warnings.push({
          equip_id: e.id,
          nome: e.nome,
          motivo: "periodicidade inválida ou ausente, tratada como ANUAL",
        });
      } else if (12 % step !== 0) {
        warnings.push({
          equip_id: e.id,
          nome: e.nome,
          motivo: `periodicidade '${periodicidade}' (step=${step}) não divide 12 exato — tratada como ANUAL`,
        });
        periodicidade = "ANUAL";
        step = 12;
      }
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

    // Overrides vindos do editor/refazer: preserva alterações manuais de
    // periodicidade e HT antes do scheduler/IA calcular a distribuição.
    for (const it of items) {
      const ov = manualByEquip.get(it.equip_id) ?? manualByCodigo.get(it.codigo_barras_auvo);
      if (!ov) continue;
      if (ov.periodicidade) {
        it.periodicidade = normalizePer(ov.periodicidade);
        it.step = PER_TO_STEP[it.periodicidade] || it.step;
        it.freq = expectedFreq(it.step);
      }
      if (ov.ht_por_ocorrencia != null || ov.horas_por_tecnico != null) {
        const ht = Math.max(0, Number(ov.ht_por_ocorrencia ?? (Number(ov.horas_por_tecnico) * it.qtd_tecnicos)) || 0);
        it.ht_por_ocorrencia = ht;
        it.horas_por_tecnico = it.qtd_tecnicos > 0 ? ht / it.qtd_tecnicos : ht;
      }
      it.ht_total_ano = it.ht_por_ocorrencia * it.freq;
    }

    // ── scheduler v5: fila única por atraso, sem trava de exclusão ─────────
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth() + 1;
    // Sempre começa em janeiro — permite visualizar o encaixe do contrato
    // no ano inteiro, mesmo quando gerando o plano no meio do ano vigente.
    const mesInicio = 1;

    // origem inicial
    type SchedItem = RowItem & {
      origem: "nunca" | "vencido" | "em_dia";
      proxima_original_abs: number | null; // ano*12 + (mes-1)
      proxima_original_mes: number | null; // 1..12 dentro do ano_ref (pode ser <1 se antes)
      atraso_base: number; // meses no mesInicio
      status_final?: "nunca" | "vencido" | "em_dia";
      atraso_meses?: number;
      meses_planejados?: number[];
      meses_forcados?: number[];
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
    const agendaCiclo = (it: SchedItem, m: number, forcedFirst: boolean = false) => {
      const meses: number[] = [m];
      reservado[m] += it.ht_por_ocorrencia;
      if (forcedFirst) {
        if (!it.meses_forcados) it.meses_forcados = [];
        it.meses_forcados.push(m);
      }
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
          agendaCiclo(it, m, /* forcedFirst */ true);
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

    // ── rebalanceamento: reduz variância entre meses ───────────────────────
    // Move itens já agendados deslocando a cadeia inteira. REGRA DURA:
    // o número de ocorrências no ano NÃO pode mudar — a quantidade é
    // ditada pela periodicidade. Por isso newStart é restrito a [1..step],
    // o único intervalo que preserva expectedFreq(step) ocorrências ≤ 12.
    // Isso evita perder preventiva ao longo do rebalanceio (bug que deixava
    // um mês -19h e outro +9h porque itens caíam da conta).
    {
      const variance = (arr: number[]) => {
        const slice = arr.slice(mesInicio, 13);
        const n = slice.length || 1;
        const mean = slice.reduce((a, b) => a + b, 0) / n;
        return slice.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
      };
      const scheduledItems = sched.filter(
        (it) => (it.meses_planejados?.length ?? 0) > 0 && (it.mes_inicio_ciclo ?? 0) >= mesInicio,
      );
      const MAX_PASSES = 60;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        let improved = false;
        const curPeak = Math.max(...reservado.slice(mesInicio, 13));
        // ordena por HT desc: movimentar os pesados primeiro ajuda mais
        const ordered = scheduledItems
          .slice()
          .sort((a, b) => b.ht_por_ocorrencia - a.ht_por_ocorrencia);
        for (const it of ordered) {
          const curStart = it.mes_inicio_ciclo!;
          const step = it.step;
          const ht = it.ht_por_ocorrencia;
          // starts válidos que PRESERVAM nº de ocorrências: [1..step]
          const validStarts: number[] = [];
          for (let s = Math.max(1, mesInicio); s <= Math.min(12, step); s++) {
            if (s !== curStart) validStarts.push(s);
          }
          if (validStarts.length === 0) continue;
          const expectedOcc = it.meses_planejados!.length;
          let bestDelta = 0;
          let bestVar = variance(reservado);
          for (const newStart of validStarts) {
            // gera nova cadeia
            const newMeses: number[] = [];
            for (let m = newStart; m <= 12; m += step) newMeses.push(m);
            // TRAVA: só aceita se o nº de ocorrências for exatamente o mesmo
            if (newMeses.length !== expectedOcc) continue;
            // simula
            const trial = reservado.slice();
            for (const m of it.meses_planejados!) trial[m] -= ht;
            for (const m of newMeses) trial[m] += ht;
            // Rejeita se elevar o pico acima do atual (só piora saldo).
            let trialPeak = 0;
            for (let m = mesInicio; m <= 12; m++) {
              if (trial[m] > trialPeak) trialPeak = trial[m];
            }
            if (trialPeak > curPeak + 1e-6) continue;
            const v = variance(trial);
            if (v < bestVar - 1e-6) {
              bestVar = v;
              bestDelta = newStart - curStart;
            }
          }
          if (bestDelta !== 0) {
            const newStart = curStart + bestDelta;
            const newMeses: number[] = [];
            for (let m = newStart; m <= 12; m += step) newMeses.push(m);
            for (const m of it.meses_planejados!) reservado[m] -= ht;
            for (const m of newMeses) reservado[m] += ht;
            it.meses_planejados = newMeses;
            it.mes_inicio_ciclo = newStart;
            improved = true;
          }
        }
        if (!improved) break;
      }
    }

    let otimizacaoIa: { usada: boolean; aplicada: boolean; alteracoes: number; mensagem: string } | null = null;
    if (mode === "preview" && usar_ia) {
      otimizacaoIa = await optimizeScheduleWithAi({
        sched,
        reservado,
        mesInicio,
        htContratoMes,
        anoReferencia: ano_referencia,
      });
    } else {
      // Mesmo sem IA, respeita execução real no ano como âncora do ciclo.
      let touched = false;
      for (const it of sched) {
        const executedMonth = monthOfDateInYear(it.ultima_preventiva, ano_referencia);
        if (executedMonth == null || (it.meses_planejados?.length ?? 0) === 0) continue;
        const meses = monthsAround(executedMonth, it.step);
        it.meses_planejados = meses;
        it.mes_inicio_ciclo = meses[0] ?? executedMonth;
        touched = true;
      }
      if (touched) rebuildReservado(sched, reservado);
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
          meses_forcados: it.meses_forcados ?? [],
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
        warnings,
        fonte_ultima_preventiva: usouConsolidado ? "consolidado" : "scan",
        otimizacao_ia: otimizacaoIa,
        tabela_meses,
        itens: itensOut,
      });
    }

    // ── apply ──────────────────────────────────────────────────────────────
    if (mode === "apply") {
      if (!Array.isArray(apply_rows) || apply_rows.length === 0) {
        return json({ ok: false, error: "apply_rows obrigatório" });
      }
      // Cada plano é ISOLADO por cliente. Sempre usa (ou cria) um grupo
      // "[Auto] {cliente_nome}" — nunca reaproveita um grupo real que agrupa
      // vários clientes distintos (ex.: "Grupo IZ", "SODEXO"), senão os planos
      // de horas de clientes diferentes ficariam misturados no mesmo agregado.
      let grupoDestino: string | null = null;
      const nomeGrupoAuto = `[Auto] ${cliente_nome}`;
      const { data: existente } = await supabase
        .from("grupos_clientes")
        .select("id")
        .eq("nome", nomeGrupoAuto)
        .limit(1);
      grupoDestino = (existente?.[0] as any)?.id ?? null;
      if (!grupoDestino) {
        const { data: novoGrupo, error: errGrupo } = await supabase
          .from("grupos_clientes")
          .insert({ nome: nomeGrupoAuto })
          .select("id")
          .single();
        if (errGrupo) return json({ ok: false, error: `Falha ao criar grupo automático: ${errGrupo.message}` });
        grupoDestino = (novoGrupo as any).id;
      }
      // garante membership do cliente no [Auto] (idempotente)
      await supabase
        .from("grupo_cliente_membros")
        .upsert({ grupo_id: grupoDestino, cliente_nome }, { onConflict: "grupo_id,cliente_nome" });

      const perMeses = (p: string) => {
        const n = normalizePer(p);
        return n === "MENSAL" ? 1 : n === "BIMESTRAL" ? 2 : n === "TRIMESTRAL" ? 3 : n === "QUADRIMESTRAL" ? 4 : n === "SEMESTRAL" ? 6 : 12;
      };
      const codigos = apply_rows.map((r) => String(r.codigo_barras_auvo)).filter(Boolean);
      // Restringe a busca aos equipamentos DO cliente — evita colisão de
      // identificador entre clientes diferentes.
      const { data: eqRows, error: eqErr } = await supabase
        .from("equipamentos_auvo")
        .select("id, nome, identificador, cliente")
        .eq("cliente", cliente_nome)
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
          cliente_nome,
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
        }, { onConflict: "cliente_nome,codigo_barras_auvo,ano_referencia" });
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
