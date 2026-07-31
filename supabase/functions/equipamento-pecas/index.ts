import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE = "https://api.gestaoclick.com";

function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/,/.test(s)) {
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function norm(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Peca = {
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  origem: "os" | "orcamento";
  documento_id: string;
  documento_codigo: string;
  situacao: string;
  data: string | null;
  cliente: string;
  auvo_task_id: string | null;
  link: string | null;
  vendida: boolean;
};

const SITUACOES_VENDIDAS = [
  "executad", "finalizad", "concluid", "entregue", "faturad", "aprovad", "pago",
];

async function gcGet(path: string, headers: Record<string, string>) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${GC_BASE}${path}`, { headers, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const auvoEquipmentId = String(body?.auvo_equipment_id || "").trim();
    let identificador = String(body?.identificador || "").trim();
    const auvoTaskId = String(body?.auvo_task_id || "").trim();
    const equipamentoNome = String(body?.nome || "").trim();

    if (!auvoEquipmentId && !identificador && !auvoTaskId) {
      return new Response(JSON.stringify({ ok: false, error: "auvo_equipment_id, identificador ou auvo_task_id é obrigatório" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const gcHeaders = {
      "access-token": Deno.env.get("GC_ACCESS_TOKEN") ?? "",
      "secret-access-token": Deno.env.get("GC_SECRET_TOKEN") ?? "",
      "Content-Type": "application/json",
    };

    // 1) Descoberta ESTRITA: apenas o equipamento exato (auvo_equipment_id / série)
    const taskIds = new Set<string>();
    const equipIds = new Set<string>();
    const series = new Set<string>();
    if (auvoEquipmentId) equipIds.add(auvoEquipmentId);
    if (identificador) series.add(identificador);
    if (auvoTaskId) taskIds.add(auvoTaskId);

    const selectCols =
      "auvo_task_id, cliente, data_tarefa, equipamento_nome, equipamento_id_serie, gc_os_id, gc_os_codigo, gc_os_situacao, gc_os_link, gc_os_data, gc_orcamento_id, gc_orcamento_codigo, gc_orc_situacao, gc_orc_link, gc_orc_data";

    const centralById = new Map<string, any>();
    const addCentral = (rows: any[] | null) => {
      let novos = 0;
      for (const r of rows || []) {
        const k = String(r.auvo_task_id || "");
        if (!k) continue;
        if (!centralById.has(k)) { centralById.set(k, r); novos++; }
        taskIds.add(k);
      }
      return novos;
    };

    // Equipamentos do catálogo que batem com a série informada
    const resolveEquipCatalogo = async () => {
      const seriesArr = Array.from(series).filter(Boolean);
      if (!seriesArr.length) return;
      const { data } = await supabase
        .from("equipamentos_auvo")
        .select("auvo_equipment_id, identificador, nome")
        .in("identificador", seriesArr);
      (data || []).forEach((e: any) => {
        if (e.auvo_equipment_id) equipIds.add(String(e.auvo_equipment_id));
      });
    };

    const expandirTarefasPorEquipamento = async () => {
      if (!equipIds.size) return;
      const { data } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_task_id")
        .in("auvo_equipment_id", Array.from(equipIds));
      (data || []).forEach((r: any) => { if (r.auvo_task_id) taskIds.add(String(r.auvo_task_id)); });
    };

    const carregarCentral = async () => {
      let novos = 0;
      const ids = Array.from(taskIds).filter((id) => !centralById.has(id));
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select(selectCols)
          .in("auvo_task_id", ids.slice(i, i + 200));
        if (error) throw error;
        novos += addCentral(data);
      }
      // Série EXATA do próprio equipamento — inclusive quando o campo traz vários
      // equipamentos separados por / ; , (validamos token a token, sem match parcial)
      const norm = (v: string) => String(v || "").trim().toUpperCase();
      const tokens = (v: string) =>
        norm(v).split(/[\/;,|]+/).map((t) => t.trim()).filter(Boolean);
      for (const s of Array.from(series)) {
        const alvo = norm(s);
        if (!alvo) continue;
        // 1) igualdade direta (varredura completa, paginada)
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .eq("equipamento_id_serie", s)
            .range(from, from + 999);
          novos += addCentral(data);
          if (!data || data.length < 1000) break;
        }
        // 2) campos com múltiplos equipamentos: filtra por token exato
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .ilike("equipamento_id_serie", `%${s}%`)
            .range(from, from + 999);
          const validos = (data || []).filter((r: any) =>
            tokens(r.equipamento_id_serie).includes(alvo)
          );
          novos += addCentral(validos);
          if (!data || data.length < 1000) break;
        }
      }
      return novos;
    };

    // Histórico antigo (antes do vínculo Auvo existir): nome EXATO do equipamento
    // restrito aos clientes já identificados para este equipamento.
    const expandirHistoricoAntigo = async () => {
      const norm = (v: string) => String(v || "").trim().toUpperCase();
      const nomes = new Set<string>();
      if (equipamentoNome) nomes.add(norm(equipamentoNome));
      const clientes = new Set<string>();
      for (const r of centralById.values()) {
        if (r.equipamento_nome) nomes.add(norm(r.equipamento_nome));
        if (r.cliente) clientes.add(norm(r.cliente));
      }
      if (equipIds.size) {
        const { data } = await supabase
          .from("equipamentos_auvo")
          .select("nome")
          .in("auvo_equipment_id", Array.from(equipIds));
        (data || []).forEach((e: any) => { if (e?.nome) nomes.add(norm(e.nome)); });
      }
      if (!nomes.size || !clientes.size) return 0;
      let novos = 0;
      for (const nome of Array.from(nomes)) {
        if (nome.length < 4) continue;
        for (let from = 0; ; from += 1000) {
          const { data } = await supabase
            .from("tarefas_central")
            .select(selectCols)
            .ilike("equipamento_nome", nome)
            .range(from, from + 999);
          const validos = (data || []).filter((r: any) =>
            norm(r.equipamento_nome) === nome && clientes.has(norm(r.cliente))
          );
          novos += addCentral(validos);
          if (!data || data.length < 1000) break;
        }
      }
      return novos;
    };

    // Tarefa base (kanban): descobre a série/equipamento antes de expandir
    if (auvoTaskId) {
      await carregarCentral();
      const base = centralById.get(auvoTaskId);
      const serieBase = String(base?.equipamento_id_serie || "").trim();
      if (serieBase) series.add(serieBase);
      const { data: linkRows } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_equipment_id")
        .eq("auvo_task_id", auvoTaskId);
      (linkRows || []).forEach((r: any) => { if (r.auvo_equipment_id) equipIds.add(String(r.auvo_equipment_id)); });
    }

    // Passe único e fechado: série -> catálogo -> tarefas do MESMO equipamento -> central
    await resolveEquipCatalogo();
    await expandirTarefasPorEquipamento();
    await carregarCentral();
    // varre todo o período disponível, recuperando OS/orçamentos antigos
    await expandirHistoricoAntigo();
    await carregarCentral();

    if (!identificador) identificador = Array.from(series)[0] || "";
    const centralRows: any[] = Array.from(centralById.values());

    // 3) Documentos GC únicos
    const osMap = new Map<string, any>();
    const orcMap = new Map<string, any>();
    for (const r of centralRows) {
      const osId = String(r.gc_os_id || "").trim();
      if (osId && !osMap.has(osId)) osMap.set(osId, r);
      const orcId = String(r.gc_orcamento_id || "").trim();
      if (orcId && !orcMap.has(orcId)) orcMap.set(orcId, r);
    }

    const pecas: Peca[] = [];
    const documentos: any[] = [];

    const extrair = (
      detail: any,
      origem: "os" | "orcamento",
      docId: string,
      ref: any,
    ) => {
      const codigo = String(detail?.codigo || (origem === "os" ? ref?.gc_os_codigo : ref?.gc_orcamento_codigo) || docId);
      const situacao = String(detail?.nome_situacao || (origem === "os" ? ref?.gc_os_situacao : ref?.gc_orc_situacao) || "");
      const data = String(
        detail?.data_saida || detail?.data || (origem === "os" ? ref?.gc_os_data : ref?.gc_orc_data) || ""
      ).split("T")[0] || null;
      const cliente = String(detail?.nome_cliente || ref?.cliente || "");
      const link = origem === "os" ? (ref?.gc_os_link || null) : (ref?.gc_orc_link || null);
      const sitNorm = norm(situacao);
      const vendida = origem === "os" && SITUACOES_VENDIDAS.some((s) => sitNorm.includes(s));

      const produtos: any[] = (Array.isArray(detail?.produtos) ? detail.produtos : [])
        .map((x: any) => x?.produto || x)
        .filter(Boolean);

      let itens = 0;
      for (const p of produtos) {
        const descricao = String(p.nome_produto || p.nome || p.detalhes || "Peça sem descrição").trim();
        const codigo = String(
          p.codigo_interno || p.codigo || p.codigo_produto || p.sku ||
          p.produto_codigo || p.produto_id || ""
        ).trim();
        const quantidade = toNum(p.quantidade) || 1;
        const valor_total = toNum(p.valor_total) || (toNum(p.valor_venda || p.valor_unitario) * quantidade);
        pecas.push({
          codigo,
          descricao,
          quantidade,
          valor_unitario: quantidade > 0 ? valor_total / quantidade : valor_total,
          valor_total,
          origem,
          documento_id: docId,
          documento_codigo: codigo,
          situacao,
          data,
          cliente,
          auvo_task_id: ref?.auvo_task_id ? String(ref.auvo_task_id) : null,
          link,
          vendida,
        });
        itens++;
      }

      documentos.push({
        origem, documento_id: docId, documento_codigo: codigo, situacao, data, cliente,
        auvo_task_id: ref?.auvo_task_id ? String(ref.auvo_task_id) : null,
        link, itens, vendida,
        valor_total: toNum(detail?.valor_total),
      });
    };

    const CONC = 6;
    const osEntries = Array.from(osMap.entries());
    for (let i = 0; i < osEntries.length; i += CONC) {
      const batch = osEntries.slice(i, i + CONC);
      const res = await Promise.all(batch.map(([id]) => gcGet(`/api/ordens_servicos/${encodeURIComponent(id)}`, gcHeaders)));
      res.forEach((j, idx) => {
        const detail = j?.data || j;
        if (detail) extrair(detail, "os", batch[idx][0], batch[idx][1]);
      });
    }

    const orcEntries = Array.from(orcMap.entries());
    for (let i = 0; i < orcEntries.length; i += CONC) {
      const batch = orcEntries.slice(i, i + CONC);
      const res = await Promise.all(batch.map(([id]) => gcGet(`/api/orcamentos/${encodeURIComponent(id)}`, gcHeaders)));
      res.forEach((j, idx) => {
        const detail = j?.data || j;
        if (detail) extrair(detail, "orcamento", batch[idx][0], batch[idx][1]);
      });
    }

    // 4) Consolidado por peça
    const consolidado = new Map<string, any>();
    for (const p of pecas) {
      const key = norm(p.descricao);
      const cur = consolidado.get(key) || {
        descricao: p.descricao,
        qtd_orcada: 0, valor_orcado: 0,
        qtd_vendida: 0, valor_vendido: 0,
        ocorrencias: 0, ultima_data: null as string | null,
      };
      if (p.vendida) {
        cur.qtd_vendida += p.quantidade;
        cur.valor_vendido += p.valor_total;
      } else {
        cur.qtd_orcada += p.quantidade;
        cur.valor_orcado += p.valor_total;
      }
      cur.ocorrencias += 1;
      if (p.data && (!cur.ultima_data || p.data > cur.ultima_data)) cur.ultima_data = p.data;
      consolidado.set(key, cur);
    }

    const lista = Array.from(consolidado.values()).sort(
      (a, b) => (b.valor_vendido + b.valor_orcado) - (a.valor_vendido + a.valor_orcado),
    );

    return new Response(JSON.stringify({
      ok: true,
      equipamento: { auvo_equipment_id: auvoEquipmentId || null, identificador: identificador || null, nome: equipamentoNome || null },
      tarefas: taskIds.size,
      cobertura: {
        tarefas_com_dados: centralRows.length,
        series: Array.from(series),
        equipamentos: Array.from(equipIds),
        data_inicial: documentos.reduce((m: string | null, d: any) => (d.data && (!m || d.data < m) ? d.data : m), null),
        data_final: documentos.reduce((m: string | null, d: any) => (d.data && (!m || d.data > m) ? d.data : m), null),
      },
      documentos: documentos.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
      pecas: pecas.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
      consolidado: lista,
      totais: {
        os: osMap.size,
        orcamentos: orcMap.size,
        itens: pecas.length,
        valor_vendido: pecas.filter((p) => p.vendida).reduce((s, p) => s + p.valor_total, 0),
        valor_orcado: pecas.filter((p) => !p.vendida).reduce((s, p) => s + p.valor_total, 0),
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[equipamento-pecas]", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});