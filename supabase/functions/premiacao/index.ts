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

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  if (!isNaN(n) && /,/.test(String(v))) return n;
  const n2 = parseFloat(String(v));
  return isNaN(n2) ? 0 : n2;
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

    // Fetch tarefas with OS data_saida in month
    const { data: rows, error } = await supabase
      .from("tarefas_central")
      .select("auvo_task_id, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_data_saida, gc_os_valor_total, tecnico, tecnico_id, data_tarefa, status_auvo")
      .not("gc_os_id", "is", null)
      .gte("gc_os_data_saida", startDate)
      .lte("gc_os_data_saida", endDate);

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dedupe by gc_os_id — pick row with technician set, prefer most recent data_tarefa
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

      const produtos: any[] = Array.isArray(detail.produtos) ? detail.produtos : [];
      const servicos: any[] = Array.isArray(detail.servicos) ? detail.servicos : [];

      let valor_pecas = 0;
      let pecas_count = 0;
      for (const p of produtos) {
        const total = toNum(p.valor_total ?? (toNum(p.valor_unitario) * toNum(p.quantidade)));
        valor_pecas += total;
        pecas_count += 1;
      }

      let valor_servicos = 0;
      let servicos_count = 0;
      for (const s of servicos) {
        const desc = s.nome || s.descricao || "";
        if (isDeslocamento(desc)) continue;
        const total = toNum(s.valor_total ?? (toNum(s.valor_unitario) * toNum(s.quantidade)));
        valor_servicos += total;
        servicos_count += 1;
      }

      const comissao_pecas = valor_pecas * 0.02;
      const comissao_servicos = valor_servicos * 0.15;
      const comissao_total = comissao_pecas + comissao_servicos;

      const tecnico = (row.tecnico || "Sem técnico").trim() || "Sem técnico";
      const tecnico_id = String(row.tecnico_id || "");
      const key = tecnico_id || tecnico;

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
        data_saida: String(row.gc_os_data_saida || "").split("T")[0],
        valor_pecas, valor_servicos,
        comissao_pecas, comissao_servicos, comissao_total,
        pecas_count, servicos_count,
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