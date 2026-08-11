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
// Tipos aceitos: exclusivamente 180175 (Preventiva + OS) e
// 180176 (Preventiva Contrato), desde que ativos na configuração.
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPreventivePlanPatch } from "./plan-reconciliation.ts";

const PREVENTIVA_TASK_TYPE_IDS = ["180175", "180176"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Tipo = { auvo_task_type_id: string; aplica_a_categoria: string | null };
type Tarefa = {
  auvo_equipment_id: string;
  auvo_task_id: string;
  auvo_task_type_id: string | null;
  status_auvo: string | null;
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
type ActivePlanCacheRow = {
  id: string;
  equipamento_auvo_id: string;
  ano_referencia: number;
  meses_planejados: number[] | null;
  ultima_execucao_data: string | null;
  ultima_execucao_task_id: string | null;
  proxima_data: string | null;
};

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
  // Soma meses com clamp no último dia do mês de destino:
  // 31/01 + 3 meses = 30/04 (e não 01/05, como no overflow nativo do JS).
  const [y, m, day] = iso.slice(0, 10).split("-").map(Number);
  const total = (y * 12) + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(day, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
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
      .eq("ativo", true)
      .in("auvo_task_type_id", PREVENTIVA_TASK_TYPE_IDS);
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
            "auvo_equipment_id, auvo_task_id, auvo_task_type_id, status_auvo, data_tarefa, data_conclusao, tecnico, auvo_link",
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
    const [{ data: grupoMemb, error: grupoMembError }, { data: grupos, error: gruposError }] = await Promise.all([
      supa.from("grupo_cliente_membros").select("grupo_id, cliente_nome"),
      supa.from("grupos_clientes").select("id, nome"),
    ]);
    if (grupoMembError) throw grupoMembError;
    if (gruposError) throw gruposError;
    const autoGroupIds = new Set(
      (grupos ?? []).filter((g: any) => /^\s*\[Auto\]/i.test(String(g.nome || ""))).map((g: any) => String(g.id)),
    );
    const grupoPorCliente = new Map<string, { id: string; auto: boolean }>();
    for (const g of (grupoMemb ?? []) as any[]) {
      const key = normalizeClienteName(g.cliente_nome);
      const candidate = { id: String(g.grupo_id), auto: autoGroupIds.has(String(g.grupo_id)) };
      const current = grupoPorCliente.get(key);
      // O grupo real da rede tem precedência sobre o grupo técnico [Auto].
      if (!current || (current.auto && !candidate.auto)) grupoPorCliente.set(key, candidate);
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
    const tarefasPorAuvoEquipmentId = new Map<string, Tarefa[]>();
    for (const tarefa of tarefas) {
      if (!tarefasPorAuvoEquipmentId.has(tarefa.auvo_equipment_id)) {
        tarefasPorAuvoEquipmentId.set(tarefa.auvo_equipment_id, []);
      }
      tarefasPorAuvoEquipmentId.get(tarefa.auvo_equipment_id)!.push(tarefa);
    }
    const execucoesPorEquipId = new Map<string, Tarefa[]>();

    for (const eq of equipamentos) {
      if (!eq.auvo_equipment_id) continue;
      const catKey = String(eq.categoria || "").trim().toUpperCase();
      const tiposValidos = new Set<string>(universais);
      const extras = porCategoria.get(catKey);
      if (extras) for (const x of extras) tiposValidos.add(x);

      let ult: Ult | null = null;
      let total = 0;
      const validExecutions: Tarefa[] = [];
      for (const t of tarefasPorAuvoEquipmentId.get(eq.auvo_equipment_id) ?? []) {
        if (!t.auvo_task_type_id || !tiposValidos.has(String(t.auvo_task_type_id))) continue;
        // Só conta como EXECUTADA quando a tarefa está Finalizada.
        // Agendada/Aberta/Em andamento/Pausada NÃO é preventiva realizada.
        if (String(t.status_auvo || "").trim().toLowerCase() !== "finalizada") continue;
        const d = t.data_conclusao || t.data_tarefa;
        if (!d) continue;
        validExecutions.push(t);
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
      execucoesPorEquipId.set(eq.id, validExecutions);
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
      const grupoId = grupoPorCliente.get(clienteKey)?.id ?? null;

      // Próxima via plano
      let proxima: string | null = null;
      let proximaSource: string | null = null;
      const planoKey = clienteKey + "||" + String(eq.identificador || "");
      const planos = planoIdx.get(planoKey);
      if (planos && planos.length > 0) {
        const todas = planos.flatMap((p) => p.datas).sort();
        const ult = porEquip.get(eq.id)?.data ?? null;
        // próxima > última (a preventiva daquela data já foi feita).
        // Se nunca teve, próxima >= hoje.
        const futura = ult
          ? todas.find((d) => d > ult)
          : todas.find((d) => d >= hoje);
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

    // Mantém o cache dos planos alinhado à execução real. O plano não é fonte
    // de verdade da última preventiva, mas outras telas ainda exibem esses
    // campos e precisam receber a mesma data consolidada.
    const rowByEquipmentId = new Map(rows.map((row) => [row.equip_id, row]));
    const { data: activePlanRows, error: activePlanError } = await supa
      .from("plano_preventivo_item")
      .select("id, equipamento_auvo_id, ano_referencia, meses_planejados, ultima_execucao_data, ultima_execucao_task_id, proxima_data")
      .eq("ativo", true)
      .not("equipamento_auvo_id", "is", null);
    if (activePlanError) throw activePlanError;

    const planUpdates = ((activePlanRows ?? []) as ActivePlanCacheRow[]).flatMap((plan) => {
      const snapshot = rowByEquipmentId.get(plan.equipamento_auvo_id);
      if (!snapshot) return [];
      const patch = buildPreventivePlanPatch(plan, snapshot);
      return patch ? [{ id: plan.id, patch }] : [];
    });

    for (let i = 0; i < planUpdates.length; i += 25) {
      const updateResults = await Promise.all(
        planUpdates.slice(i, i + 25).map(({ id, patch }) =>
          supa.from("plano_preventivo_item").update(patch).eq("id", id)
        ),
      );
      const failedUpdate = updateResults.find((result) => result.error);
      if (failedUpdate?.error) throw failedUpdate.error;
    }

    // Grava o histórico completo de preventivas executadas por item do plano.
    // A chave é o UUID interno do equipamento, o mesmo FK usado pelo plano.
    const executionRows: any[] = [];
    const expectedTasksByItemId = new Map<string, Set<string>>();
    for (const plan of (activePlanRows ?? []) as ActivePlanCacheRow[]) {
      const expected = new Set<string>();
      const plannedMonths = new Set(plan.meses_planejados ?? []);
      for (const task of execucoesPorEquipId.get(plan.equipamento_auvo_id) ?? []) {
        const realizedDate = String(task.data_conclusao || task.data_tarefa || "").slice(0, 10);
        if (!realizedDate || Number(realizedDate.slice(0, 4)) !== Number(plan.ano_referencia)) continue;
        const taskId = String(task.auvo_task_id || "").trim();
        if (!taskId) continue;
        expected.add(taskId);
        const realizedMonth = Number(realizedDate.slice(5, 7));
        const isPlannedMonth = plannedMonths.has(realizedMonth);
        executionRows.push({
          item_id: plan.id,
          mes_planejado: isPlannedMonth ? realizedMonth : null,
          data_planejada: isPlannedMonth
            ? `${plan.ano_referencia}-${String(realizedMonth).padStart(2, "0")}-01`
            : null,
          data_realizada: realizedDate,
          task_id: taskId,
          task_type_id: task.auvo_task_type_id,
          horas_decimal: null,
          origem: "auto",
        });
      }
      expectedTasksByItemId.set(plan.id, expected);
    }

    for (let i = 0; i < executionRows.length; i += BATCH) {
      const { error: executionUpsertError } = await supa
        .from("plano_preventivo_execucao")
        .upsert(executionRows.slice(i, i + BATCH), { onConflict: "item_id,task_id" });
      if (executionUpsertError) throw executionUpsertError;
    }

    // Se uma tarefa foi excluída no Auvo, ela também deixa de aparecer no
    // histórico automático. Registros manuais são preservados.
    let staleExecutionsRemoved = 0;
    const activePlanIds = ((activePlanRows ?? []) as ActivePlanCacheRow[]).map((plan) => plan.id);
    for (let i = 0; i < activePlanIds.length; i += BATCH) {
      const { data: storedExecutions, error: storedExecutionsError } = await supa
        .from("plano_preventivo_execucao")
        .select("id, item_id, task_id, origem")
        .eq("origem", "auto")
        .in("item_id", activePlanIds.slice(i, i + BATCH));
      if (storedExecutionsError) throw storedExecutionsError;
      const staleIds = (storedExecutions ?? [])
        .filter((row: any) => row.task_id && !expectedTasksByItemId.get(String(row.item_id))?.has(String(row.task_id)))
        .map((row: any) => String(row.id));
      if (staleIds.length > 0) {
        const { error: staleDeleteError } = await supa
          .from("plano_preventivo_execucao")
          .delete()
          .in("id", staleIds);
        if (staleDeleteError) throw staleDeleteError;
        staleExecutionsRemoved += staleIds.length;
      }
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
        planos_reconciliados: planUpdates.length,
        execucoes_historicas: executionRows.length,
        execucoes_orfas_removidas: staleExecutionsRemoved,
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
