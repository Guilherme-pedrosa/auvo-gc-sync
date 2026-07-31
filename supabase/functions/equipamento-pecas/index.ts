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
    const identificador = String(body?.identificador || "").trim();
    const equipamentoNome = String(body?.nome || "").trim();

    if (!auvoEquipmentId && !identificador) {
      return new Response(JSON.stringify({ ok: false, error: "auvo_equipment_id ou identificador é obrigatório" }), {
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

    // 1) Tarefas Auvo vinculadas ao equipamento
    const taskIds = new Set<string>();
    if (auvoEquipmentId) {
      const { data, error } = await supabase
        .from("equipamento_tarefas_auvo")
        .select("auvo_task_id")
        .eq("auvo_equipment_id", auvoEquipmentId);
      if (error) throw error;
      (data || []).forEach((r: any) => { if (r.auvo_task_id) taskIds.add(String(r.auvo_task_id)); });
    }

    // 2) Tarefas centrais: por task id vinculada e por identificador/série do equipamento
    const centralRows: any[] = [];
    const selectCols =
      "auvo_task_id, cliente, data_tarefa, equipamento_nome, equipamento_id_serie, gc_os_id, gc_os_codigo, gc_os_situacao, gc_os_link, gc_os_data, gc_orcamento_id, gc_orcamento_codigo, gc_orc_situacao, gc_orc_link, gc_orc_data";

    const ids = Array.from(taskIds);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select(selectCols)
        .in("auvo_task_id", ids.slice(i, i + 200));
      if (error) throw error;
      centralRows.push(...(data || []));
    }

    if (identificador) {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select(selectCols)
        .ilike("equipamento_id_serie", `%${identificador}%`);
      if (error) throw error;
      centralRows.push(...(data || []));
    }

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
        const quantidade = toNum(p.quantidade) || 1;
        const valor_total = toNum(p.valor_total) || (toNum(p.valor_venda || p.valor_unitario) * quantidade);
        pecas.push({
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