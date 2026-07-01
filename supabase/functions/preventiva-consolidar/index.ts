// ═══════════════════════════════════════════════════════════════════
// preventiva-consolidar
// Popula equipamento_preventiva_consolidado (1 linha por equipamento).
// Fonte de verdade única para a tela de Preventivas e para o scheduler v5.
//
// Precedência de ÚLTIMA preventiva:
//   data_conclusao (já normalizada em equipment-sync com precedência
//   checkOut → delivered → finished → taskDate) → fallback data_tarefa
//
// Próxima preventiva:
//   1) equipamento_plano_preventivo (ano vigente ou próximo, primeira data futura)
//   2) senão: ultima + periodicidade
//
// Tipos aceitos: lidos de tipos_tarefa_preventiva (Item 4).
//   - aplica_a_categoria NULL  → conta para todas categorias
//   - aplica_a_categoria='X'   → só conta para equipamentos categoria='X'
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Tipo = { auvo_task_type_id: string; aplica_a_categoria: string | null };
type Tarefa = {
  auvo_equipment_id: string;
  auvo_task_id: string;
  auvo_task_type_id: string | null;
  data_tarefa: string | null;
  data_conclusao: string | null;
  tecnico: string | null;
  auvo_link: string | null;
};
type Equip = {
  id: string;
  auvo_equipment_id: string | null;
  identificador: string | null;
  nome: string;
  cliente: string | null;
  status: string | null;
  categoria: string | null;
  marca: string | null;
  tipo_id: string | null;
  override_horas_por_tecnico: number | null;
  override_qtd_tecnicos: number | null;
  override_periodicidade: string | null;
};
type TipoEquip = {
  id: string;
  nome: string | null;
  periodicidade: string | null;
  criticidade: string | null;
  horas_por_tecnico: number | null;
  qtd_tecnicos: number | null;
};
type Plano = { codigo_barras_auvo: string; cliente_nome: string; datas_meses: any };

function periodicidadeToMeses(p: string | null | undefined): number | null {
  if (!p) return null;
  const k = String(p).toLowerCase();
  if (k.includes("mensal") || k === "1m") return 1;
  if (k.includes("bimestr")) return 2;
  if (k.includes("trimestr")) return 3;
  if (k.includes("quadrimestr")) return 4;
  if (k.includes("semestr")) return 6;
  if (k.includes("anual") || k.includes("12m")) return 12;
  const m = k.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function normalizeClienteName(name: string | null | undefined): string {
  return (name || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
    .replace(/[.\-\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const t0 = Date.now();
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) tipos ativos
    const { data: tiposRaw, error: tErr } = await supa
      .from("tipos_tarefa_preventiva")
      .select("auvo_task_type_id, aplica_a_categoria")
      .eq("ativo", true);
    if (tErr) throw tErr;
    const tipos = (tiposRaw ?? []) as Tipo[];
    if (tipos.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "sem tipos ativos" }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const universais = new Set(
      tipos.filter((t) => !t.aplica_a_categoria).map((t) => String(t.auvo_task_type_id)),
    );
    const porCategoria = new Map<string, Set<string>>();
    for (const t of tipos) {
      if (!t.aplica_a_categoria) continue;
      const key = String(t.aplica_a_categoria).trim().toUpperCase();
      if (!porCategoria.has(key)) porCategoria.set(key, new Set());
      porCategoria.get(key)!.add(String(t.auvo_task_type_id));
    }

    // 2) equipamentos (todos)
    const equipamentos: Equip[] = [];
    {
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supa
          .from("equipamentos_auvo")
          .select(
            "id, auvo_equipment_id, identificador, nome, cliente, status, categoria, marca, tipo_id, override_horas_por_tecnico, override_qtd_tecnicos, override_periodicidade",
          )
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        equipamentos.push(...(data as Equip[]));
        if (data.length < step) break;
        from += step;
      }
    }

    // 3) tipos_equipamento (para HT + periodicidade)
    const { data: tiposEq } = await supa
      .from("tipos_equipamento")
      .select("id, nome, periodicidade, criticidade, horas_por_tecnico, qtd_tecnicos");
    const tipoMap = new Map<string, TipoEquip>();
    for (const t of (tiposEq ?? []) as TipoEquip[]) tipoMap.set(t.id, t);

    // 4) tarefas (todas)
    const tarefas: Tarefa[] = [];
    {
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supa
          .from("equipamento_tarefas_auvo")
          .select(
            "auvo_equipment_id, auvo_task_id, auvo_task_type_id, data_tarefa, data_conclusao, tecnico, auvo_link",
          )
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        tarefas.push(...(data as Tarefa[]));
        if (data.length < step) break;
        from += step;
      }
    }

    // 5) grupos + membros
    const { data: grupoMemb } = await supa
      .from("grupo_cliente_membros")
      .select("grupo_id, cliente_nome");
    const grupoPorCliente = new Map<string, string>();
    for (const g of (grupoMemb ?? []) as any[]) {
      grupoPorCliente.set(normalizeClienteName(g.cliente_nome), g.grupo_id);
    }

    // 6) planos preventivos (para próxima data via plano)
    const { data: planoRows } = await supa
      .from("equipamento_plano_preventivo")
      .select("codigo_barras_auvo, cliente_nome, datas_meses, ano_referencia")
      .order("ano_referencia", { ascending: true });
    // idx: cliente_normalizado + codigo → lista de {ano, datas}
    const planoIdx = new Map<string, { ano: number; datas: string[] }[]>();
    for (const p of (planoRows ?? []) as any[]) {
      const key = normalizeClienteName(p.cliente_nome) + "||" + String(p.codigo_barras_auvo || "");
      const datas: string[] = [];
      const dm = p.datas_meses || {};
      for (let m = 1; m <= 12; m++) {
        const arr = dm[String(m)] || dm[m] || [];
        if (Array.isArray(arr)) for (const d of arr) if (d) datas.push(String(d));
      }
      if (!planoIdx.has(key)) planoIdx.set(key, []);
      planoIdx.get(key)!.push({ ano: p.ano_referencia, datas });
    }

    // 7) index tarefas por equip
    type Ult = {
      data: string;
      task_id: string;
      tecnico: string | null;
      link: string | null;
      total: number;
    };
    const porEquip = new Map<string, Ult>();
    const totalPorEquip = new Map<string, number>();

    for (const eq of equipamentos) {
      if (!eq.auvo_equipment_id) continue;
      const catKey = String(eq.categoria || "").trim().toUpperCase();
      const tiposValidos = new Set<string>(universais);
      const extras = porCategoria.get(catKey);
      if (extras) for (const x of extras) tiposValidos.add(x);

      let ult: Ult | null = null;
      let total = 0;
      for (const t of tarefas) {
        if (t.auvo_equipment_id !== eq.auvo_equipment_id) continue;
        if (!t.auvo_task_type_id || !tiposValidos.has(String(t.auvo_task_type_id))) continue;
        const d = t.data_conclusao || t.data_tarefa;
        if (!d) continue;
        total += 1;
        if (!ult || d > ult.data) {
          ult = {
            data: d,
            task_id: t.auvo_task_id,
            tecnico: t.tecnico,
            link: t.auvo_link,
            total: 0,
          };
        }
      }
      if (ult) {
        porEquip.set(eq.id, { ...ult, total });
      }
      totalPorEquip.set(eq.id, total);
    }

    // 8) monta linhas
    const hoje = new Date().toISOString().slice(0, 10);
    const rows: any[] = [];
    for (const eq of equipamentos) {
      const tipo = eq.tipo_id ? tipoMap.get(eq.tipo_id) : null;
      const periodicidadeStr = eq.override_periodicidade || tipo?.periodicidade || null;
      const periodicidadeMeses = periodicidadeToMeses(periodicidadeStr);
      const hpt = eq.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? null;
      const qtd = eq.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? null;
      const htPorOcorrencia = hpt != null && qtd != null ? Number(hpt) * Number(qtd) : null;

      const clienteKey = normalizeClienteName(eq.cliente);
      const grupoId = grupoPorCliente.get(clienteKey) ?? null;

      // Próxima via plano
      let proxima: string | null = null;
      let proximaSource: string | null = null;
      const planoKey = clienteKey + "||" + String(eq.identificador || "");
      const planos = planoIdx.get(planoKey);
      if (planos && planos.length > 0) {
        const todas = planos.flatMap((p) => p.datas).sort();
        const ult = porEquip.get(eq.id)?.data ?? null;
        // próxima > última (ou > hoje se nunca)
        const referencia = ult || hoje;
        const futura = todas.find((d) => d > referencia);
        if (futura) {
          proxima = futura;
          proximaSource = "plano";
        }
      }

      // Próxima calculada por periodicidade
      const ult = porEquip.get(eq.id) ?? null;
      if (!proxima && ult && periodicidadeMeses) {
        proxima = addMonthsISO(ult.data, periodicidadeMeses);
        proximaSource = "calculada";
      }

      // Status
      let status: string;
      if (!ult) status = "nunca";
      else if (proxima && proxima < hoje) status = "vencido";
      else status = "em_dia";

      rows.push({
        equip_id: eq.id,
        auvo_equipment_id: eq.auvo_equipment_id,
        identificador: eq.identificador,
        nome: eq.nome,
        cliente: eq.cliente,
        grupo_id: grupoId,
        categoria: eq.categoria,
        marca: eq.marca,
        tipo_id: eq.tipo_id,
        tipo_nome: tipo?.nome ?? null,
        criticidade: tipo?.criticidade ?? null,
        periodicidade: periodicidadeStr,
        periodicidade_meses: periodicidadeMeses,
        horas_por_tecnico: hpt,
        qtd_tecnicos: qtd,
        ht_por_ocorrencia: htPorOcorrencia,
        equip_status: eq.status,
        ultima_preventiva: ult?.data ?? null,
        ultima_preventiva_task_id: ult?.task_id ?? null,
        ultima_preventiva_tecnico: ult?.tecnico ?? null,
        ultima_preventiva_link: ult?.link ?? null,
        proxima_preventiva: proxima,
        proxima_source: proximaSource,
        status_preventiva: status,
        total_tarefas: totalPorEquip.get(eq.id) ?? 0,
        atualizado_em: new Date().toISOString(),
      });
    }

    // 9) upsert em lotes de 500 + delete de órfãos
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supa
        .from("equipamento_preventiva_consolidado")
        .upsert(slice, { onConflict: "equip_id" });
      if (error) throw error;
    }

    // remove linhas de equipamentos que não existem mais
    const idsAtuais = new Set(equipamentos.map((e) => e.id));
    const { data: existentes } = await supa
      .from("equipamento_preventiva_consolidado")
      .select("equip_id");
    const orfaos = (existentes ?? [])
      .map((r: any) => r.equip_id)
      .filter((id: string) => !idsAtuais.has(id));
    if (orfaos.length > 0) {
      await supa
        .from("equipamento_preventiva_consolidado")
        .delete()
        .in("equip_id", orfaos);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        equipamentos: equipamentos.length,
        linhas_gravadas: rows.length,
        orfaos_removidos: orfaos.length,
        tipos_ativos: tipos.length,
        elapsed_ms: Date.now() - t0,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[preventiva-consolidar]", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { headers: { ...cors, "Content-Type": "application/json" }, status: 200 },
    );
  }
});