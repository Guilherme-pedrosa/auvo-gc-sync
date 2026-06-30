import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SeedRow = { match: RegExp; htTotal: number; htTec: number; qtd: number; crit: "CRITICA" | "ALTA" | "MEDIA" | "BAIXA" };

// Ordem importa: regras mais específicas primeiro.
const SEED: SeedRow[] = [
  // Câmara de fermentação ANTES de câmara fria (desambiguação obrigatória)
  { match: /(c[âa]mara.*fermenta|fermenta|cfk)/i, htTotal: 4, htTec: 4, qtd: 1, crit: "MEDIA" },
  // Refrigeração crítica
  { match: /(c[âa]mara.*(fria|congelad|refrigerad)|adega)/i, htTotal: 12, htTec: 6, qtd: 2, crit: "CRITICA" },
  { match: /(ultracongel|blast.*chill)/i, htTotal: 6, htTec: 6, qtd: 1, crit: "CRITICA" },
  { match: /ivario/i, htTotal: 6, htTec: 6, qtd: 1, crit: "ALTA" },
  // Fornos
  { match: /(forno.*combinad|rational|unox|pr[áa]ctica.*combi|convector.*combi|selfcooking|combimaster|cheftop|forno.*flex)/i, htTotal: 4, htTec: 4, qtd: 1, crit: "ALTA" },
  { match: /(forno.*pr[áa]ctica|lastro|miniconv)/i, htTotal: 3, htTec: 3, qtd: 1, crit: "MEDIA" },
  { match: /(forno|josper|ramalhos|convector)/i, htTotal: 2.5, htTec: 2.5, qtd: 1, crit: "MEDIA" },
  // Cocção
  { match: /(fog[ãa]o|cooktop|chapa|char.*broiler|churrasqueira|grelha|banho.*maria|cozedor)/i, htTotal: 3, htTec: 3, qtd: 1, crit: "ALTA" },
  { match: /coifa/i, htTotal: 4, htTec: 4, qtd: 1, crit: "MEDIA" },
  { match: /fritadeira/i, htTotal: 3, htTec: 3, qtd: 1, crit: "ALTA" },
  // Preparação
  { match: /(masseira|amassadeira|cilindro|batedeira|m[áa]quina.*massa|m[áa]quina.*prato)/i, htTotal: 4, htTec: 4, qtd: 1, crit: "MEDIA" },
  { match: /(lavadora|lava.*lou[çc]a|lava.*copo)/i, htTotal: 3, htTec: 3, qtd: 1, crit: "ALTA" },
  // Gelo/sorvete
  { match: /(m[áa]quina.*gelo)/i, htTotal: 4, htTec: 4, qtd: 1, crit: "ALTA" },
  { match: /pozzeto/i, htTotal: 4, htTec: 4, qtd: 1, crit: "MEDIA" },
  { match: /(m[áa]quina.*sorvete|casquinha)/i, htTotal: 4, htTec: 4, qtd: 1, crit: "MEDIA" },
  // Refrigeração leve
  { match: /(refrigerad|freezer|geladeira|frigobar|balc[ãa]o.*refrig|maturadora)/i, htTotal: 2.5, htTec: 2.5, qtd: 1, crit: "ALTA" },
  // Bancada
  { match: /(seladora.*v[áa]cuo|desidratador|cortador.*frio|m[óo]dulo.*aquec)/i, htTotal: 2.5, htTec: 2.5, qtd: 1, crit: "MEDIA" },
  { match: /(mixer|liquidificador|processador|espremedor|centr[íi]fuga|moinho|cafeteira|microondas)/i, htTotal: 2, htTec: 2, qtd: 1, crit: "BAIXA" },
  { match: /bebedouro/i, htTotal: 2, htTec: 2, qtd: 1, crit: "BAIXA" },
];

function applySeed(nome: string): { htTotal: number; htTec: number; qtd: number; crit: string } {
  for (const s of SEED) if (s.match.test(nome)) return { htTotal: s.htTotal, htTec: s.htTec, qtd: s.qtd, crit: s.crit };
  return { htTotal: 2.5, htTec: 2.5, qtd: 1, crit: "MEDIA" };
}

const VALID_PER = new Set(["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"]);

function normalizePeriodicidade(raw: any): string {
  const s = String(raw || "").trim().toUpperCase();
  if (VALID_PER.has(s)) return s;
  if (s.startsWith("MENS")) return "MENSAL";
  if (s.startsWith("BIM")) return "BIMESTRAL";
  if (s.startsWith("TRI")) return "TRIMESTRAL";
  if (s.startsWith("SEM")) return "SEMESTRAL";
  if (s.startsWith("ANU")) return "ANUAL";
  return "BIMESTRAL";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { grupo_id, ano_referencia, mode, xlsx_base64, rows, columns } = body as {
      grupo_id: string;
      ano_referencia: number;
      mode: "preview" | "commit";
      xlsx_base64?: string;
      rows?: any[]; // para commit após edição do usuário
      columns?: { nome?: string; identificador?: string; periodicidade?: string; horas?: string };
    };
    if (!grupo_id || !ano_referencia || !mode) {
      return new Response(JSON.stringify({ ok: false, error: "grupo_id, ano_referencia, mode obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Carrega catálogo Auvo do grupo (todos equipamentos ativos)
    const { data: membros } = await supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", grupo_id);
    const clientesGrupo = new Set((membros || []).map((m: any) => String(m.cliente_nome || "").toLowerCase().trim()));
    const { data: equipsAll } = await supabase.from("equipamentos_auvo").select("identificador, nome, cliente, status").eq("status", "Ativo").not("identificador", "is", null);
    const equips = (equipsAll || []).filter((e: any) => clientesGrupo.size === 0 || clientesGrupo.has(String(e.cliente || "").toLowerCase().trim()));
    const byId = new Map<string, any>(equips.map((e: any) => [String(e.identificador), e]));

    if (mode === "preview") {
      if (!xlsx_base64) return new Response(JSON.stringify({ ok: false, error: "xlsx_base64 obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const bin = Uint8Array.from(atob(xlsx_base64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(bin, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

      // Detecta linha de header procurando colunas conhecidas
      let headerIdx = -1;
      for (let i = 0; i < Math.min(json.length, 10); i++) {
        const r = (json[i] || []).map((v: any) => String(v || "").toLowerCase());
        if (r.some((c) => c.includes("equipamento")) && r.some((c) => c.includes("periodicidade") || c.includes("periodic"))) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) {
        return new Response(JSON.stringify({ ok: false, error: "Não foi possível identificar a linha de cabeçalho (precisa ter 'Equipamento' e 'Periodicidade')" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const headers = (json[headerIdx] || []).map((h: any) => String(h || "").trim().toLowerCase());
      const colNome = headers.findIndex((h) => h.includes("equipamento"));
      const colId = headers.findIndex((h) => h.includes("patrim") || h.includes("identific") || h.includes("c[óo]digo") || h.includes("barras"));
      const colPer = headers.findIndex((h) => h.includes("periodic"));
      const colHoras = headers.findIndex((h) => h.includes("horas") || h.includes("ht"));

      const preview = [];
      for (let i = headerIdx + 1; i < json.length; i++) {
        const row = json[i] || [];
        const nome = row[colNome];
        if (!nome) continue;
        const identRaw = colId >= 0 ? row[colId] : null;
        const ident = identRaw != null ? String(identRaw).trim() : null;
        const perRaw = colPer >= 0 ? row[colPer] : null;
        const horasRaw = colHoras >= 0 ? row[colHoras] : null;
        const seed = applySeed(String(nome));
        const matched = ident && byId.has(ident) ? byId.get(ident) : null;
        preview.push({
          linha: i + 1,
          nome_planilha: String(nome),
          identificador_planilha: ident,
          periodicidade: normalizePeriodicidade(perRaw),
          horas_planilha: typeof horasRaw === "number" ? horasRaw : null,
          // Match
          matched: !!matched,
          equipamento_auvo: matched ? { identificador: matched.identificador, nome: matched.nome, cliente: matched.cliente } : null,
          // Seed (sugestão revisável)
          seed_horas_total: seed.htTotal,
          seed_horas_tec: seed.htTec,
          seed_qtd_tec: seed.qtd,
          seed_criticidade: seed.crit,
        });
      }
      const casados = preview.filter((p) => p.matched).length;
      return new Response(JSON.stringify({ ok: true, total: preview.length, casados, nao_casados: preview.length - casados, equipamentos_grupo: equips.length, rows: preview }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // COMMIT: usuário envia rows já validados
    if (!Array.isArray(rows)) {
      return new Response(JSON.stringify({ ok: false, error: "rows obrigatório para commit" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = rows
      .filter((r: any) => r.codigo_barras_auvo && r.periodicidade)
      .map((r: any) => {
        const htTotal = Number(r.horas_estimadas_total ?? 0);
        const htTec = Number(r.horas_por_tecnico ?? htTotal);
        const qtd = Math.max(1, Number(r.qtd_tecnicos ?? 1));
        return {
          grupo_id,
          codigo_barras_auvo: String(r.codigo_barras_auvo),
          ano_referencia,
          horas_estimadas_total: htTotal,
          horas_por_tecnico: htTec,
          qtd_tecnicos: qtd,
          periodicidade: normalizePeriodicidade(r.periodicidade),
          criticidade: ["CRITICA", "ALTA", "MEDIA", "BAIXA"].includes(String(r.criticidade)) ? String(r.criticidade) : "MEDIA",
          mes_inicio_ciclo: Number(r.mes_inicio_ciclo ?? 1),
          ativo: r.ativo !== false,
          status: "RASCUNHO",
        };
      });

    if (payload.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Nenhuma linha válida pra gravar" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: upErr, data: upData } = await supabase
      .from("equipamento_plano_preventivo")
      .upsert(payload, { onConflict: "grupo_id,codigo_barras_auvo,ano_referencia" })
      .select("id");
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, gravados: upData?.length || 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("plano-preventivo-import", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});