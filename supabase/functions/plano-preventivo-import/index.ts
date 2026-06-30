import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_PER = new Set(["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"]);

// Mapeia o nome da ABA do Excel para o cliente correspondente no Auvo.
// O match e o cálculo de órfãos devem ser feitos SOMENTE contra a casa da aba.
const ABA_PARA_CLIENTE: Record<string, string> = {
  "gra bistro": "GRA BISTRO",
  "nip napoli": "NIP NAPOLI - REDE IZ",
  "fulles kitchen": "FULLES KITCHEN LTDA",
  "1929 trattoria": "1929 TRATTORIA MODERNA",
  "famu": "FAMU RESTAURANTE",
  "iz restaurante": "IZ RESTAURANTE",
};
function clienteDaAba(sheetName: string): string | null {
  const k = String(sheetName || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ABA_PARA_CLIENTE[k] ?? null;
}

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

function normalizeCriticidade(raw: any): "CRITICA" | "ALTA" | "MEDIA" | "BAIXA" {
  const s = String(raw || "").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.startsWith("CRIT")) return "CRITICA";
  if (s.startsWith("ALT")) return "ALTA";
  if (s.startsWith("BAI")) return "BAIXA";
  return "MEDIA";
}

function cleanId(raw: any): string | null {
  if (raw == null) return null;
  let s = String(raw);
  // Remove formula prefix ={"..."} or ="..." constructs
  s = s.replace(/^=\{?"?/, "").replace(/"?\}?$/, "");
  s = s.replace(/[="{}]/g, "").trim();
  if (!s) return null;
  return s;
}

// Gera as chaves candidatas para um ID: como veio, sem zeros à esquerda,
// e padronizado em 16 dígitos. Resolve divergência de zeros à esquerda
// entre Excel (texto) e banco (pode ter sido salvo como número).
function idVariants(s: string | null): string[] {
  if (!s) return [];
  const v = new Set<string>();
  v.add(s);
  if (/^\d+$/.test(s)) {
    v.add(s.replace(/^0+/, "") || "0");   // sem zeros à esquerda
    v.add(s.padStart(16, "0"));           // 16 dígitos
  }
  return [...v];
}

function normalizeKey(s: string): string {
  return String(s || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ----- Sheet parsing -----
function parseHouseSheet(sheet: any): {
  rows: Array<{
    linha: number;
    excel_id: string | null;
    excel_nome: string;
    categoria: string;
    criticidade: string;
    periodicidade: string;
    ht_total: number;
    mes_inicio_ciclo: number;
    meses_planejados: number[];
  }>;
  header_ok: boolean;
} {
  const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  // Find header row: contains "ID" and "Equipamento" and "Period."
  let headerIdx = -1;
  for (let i = 0; i < Math.min(json.length, 10); i++) {
    const r = (json[i] || []).map((v: any) => String(v ?? "").trim().toLowerCase());
    if (r[0] === "id" && r.some((c) => c.includes("equipamento")) && r.some((c) => c.includes("period"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { rows: [], header_ok: false };

  const out = [];
  for (let i = headerIdx + 1; i < json.length; i++) {
    const row = json[i] || [];
    const firstCell = String(row[0] ?? "").trim();
    const firstLow = firstCell.toLowerCase();
    // Stop at totals
    if (firstLow.startsWith("total do m") || firstLow.startsWith("meta contratada") ||
        firstLow.startsWith("saldo") || firstLow.startsWith("fila")) break;
    const id = cleanId(row[0]);
    const nome = row[1];
    if (!nome) continue;
    const categoria = String(row[2] ?? "").trim();
    const criticidade = normalizeCriticidade(row[3]);
    const periodicidade = normalizePeriodicidade(row[4]);
    const ht = Number(row[5] ?? 0) || 0;
    // Months at indexes 6..17
    const meses: number[] = [];
    for (let m = 0; m < 12; m++) {
      const v = row[6 + m];
      if (v !== null && v !== undefined && v !== "" && !isNaN(Number(v))) meses.push(m + 1);
    }
    const mes_inicio = meses.length > 0 ? meses[0] : 1;
    out.push({
      linha: i + 1,
      excel_id: id,
      excel_nome: String(nome),
      categoria,
      criticidade,
      periodicidade,
      ht_total: ht,
      mes_inicio_ciclo: mes_inicio,
      meses_planejados: meses,
    });
  }
  return { rows: out, header_ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { grupo_id, ano_referencia, mode, xlsx_base64, sheet, rows } = body as {
      grupo_id?: string;
      ano_referencia?: number;
      mode: "list_sheets" | "preview" | "commit";
      xlsx_base64?: string;
      sheet?: string;
      rows?: any[];
    };
    if (!mode) {
      return new Response(JSON.stringify({ ok: false, error: "mode obrigatório" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============ LIST SHEETS ============
    if (mode === "list_sheets") {
      if (!xlsx_base64) return new Response(JSON.stringify({ ok: false, error: "xlsx_base64 obrigatório" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const bin = Uint8Array.from(atob(xlsx_base64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(bin, { type: "array" });
      const sheets = wb.SheetNames
        .filter((n) => !/^resumo$|^tabela ht$/i.test(n.trim()))
        .map((name) => {
          const parsed = parseHouseSheet(wb.Sheets[name]);
          return { name, header_ok: parsed.header_ok, count: parsed.rows.length };
        });
      return new Response(JSON.stringify({ ok: true, sheets }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!grupo_id || !ano_referencia) {
      return new Response(JSON.stringify({ ok: false, error: "grupo_id e ano_referencia obrigatórios" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Carrega catálogo Auvo do grupo
    const { data: membros } = await supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", grupo_id);
    const clientesGrupo = new Set((membros || []).map((m: any) => normalizeKey(m.cliente_nome)));
    const { data: equipsAll } = await supabase.from("equipamentos_auvo")
      .select("id, identificador, nome, cliente, status, tipo_id")
      .not("identificador", "is", null);
    const equipsGrupo = (equipsAll || []).filter((e: any) => clientesGrupo.size === 0 || clientesGrupo.has(normalizeKey(e.cliente)));
    const byId = new Map<string, any>();
    for (const e of equipsGrupo) {
      const base = String(e.identificador ?? "").trim();
      for (const k of idVariants(base)) byId.set(k, e);
    }
    // lookup que tenta todas as variantes do ID do Excel
    const findEquip = (excelId: string | null): any => {
      for (const k of idVariants(excelId)) {
        const hit = byId.get(k);
        if (hit) return hit;
      }
      return null;
    };

    // Tipos catálogo
    const { data: tiposAll } = await supabase.from("tipos_equipamento").select("id, nome, categoria, periodicidade, criticidade, horas_por_tecnico");
    const tipoByNome = new Map<string, any>((tiposAll || []).map((t: any) => [normalizeKey(t.nome), t]));
    const tipoById = new Map<string, any>((tiposAll || []).map((t: any) => [t.id, t]));

    // Planos atuais do grupo no ano
    const { data: planosAtuais } = await supabase.from("equipamento_plano_preventivo")
      .select("codigo_barras_auvo, periodicidade, criticidade, horas_estimadas_total, horas_por_tecnico, qtd_tecnicos, mes_inicio_ciclo")
      .eq("grupo_id", grupo_id).eq("ano_referencia", ano_referencia);
    const planoByCb = new Map<string, any>((planosAtuais || []).map((p: any) => [String(p.codigo_barras_auvo), p]));

    // ============ PREVIEW ============
    if (mode === "preview") {
      if (!xlsx_base64 || !sheet) return new Response(JSON.stringify({ ok: false, error: "xlsx_base64 e sheet obrigatórios" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const bin = Uint8Array.from(atob(xlsx_base64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(bin, { type: "array" });
      if (!wb.SheetNames.includes(sheet)) {
        return new Response(JSON.stringify({ ok: false, error: `Aba "${sheet}" não existe` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const parsed = parseHouseSheet(wb.Sheets[sheet]);
      if (!parsed.header_ok) {
        return new Response(JSON.stringify({ ok: false, error: `Aba "${sheet}" não tem cabeçalho ID|Equipamento|...|Period. na linha 4` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ESCOPO POR CASA: restringe o universo de equipamentos à casa da aba.
      const clienteAba = clienteDaAba(sheet);
      const equipsCasa = clienteAba
        ? equipsGrupo.filter((e: any) => normalizeKey(e.cliente) === normalizeKey(clienteAba))
        : equipsGrupo;
      // índice por variantes restrito à casa
      const byIdCasa = new Map<string, any>();
      for (const e of equipsCasa) {
        for (const k of idVariants(String(e.identificador ?? "").trim())) byIdCasa.set(k, e);
      }
      const findEquipCasa = (excelId: string | null): any => {
        for (const k of idVariants(excelId)) { const h = byIdCasa.get(k); if (h) return h; }
        return null;
      };

      const previewRows: any[] = [];
      const idsEncontrados = new Set<string>();
      for (const r of parsed.rows) {
        const matched = r.excel_id ? findEquipCasa(r.excel_id) : null;
        if (matched) { for (const k of idVariants(r.excel_id)) idsEncontrados.add(k); }
        let erro: string | null = null;
        if (!r.excel_id) erro = "sem_id";
        else if (!matched) erro = "nao_encontrado";
        else if (matched.status && matched.status !== "Ativo") erro = "inativo";

        const tipoAtual = matched?.tipo_id ? tipoById.get(matched.tipo_id) : null;
        const planoAtual = matched ? planoByCb.get(String(matched.identificador)) : null;

        const conflitos: Array<{campo: string; atual: any; excel: any}> = [];
        if (tipoAtual && normalizeKey(tipoAtual.nome) !== normalizeKey(r.categoria)) {
          conflitos.push({ campo: "tipo_equipamento", atual: tipoAtual.nome, excel: r.categoria });
        }
        if (planoAtual) {
          if (planoAtual.periodicidade !== r.periodicidade) conflitos.push({ campo: "periodicidade", atual: planoAtual.periodicidade, excel: r.periodicidade });
          if (planoAtual.criticidade !== r.criticidade) conflitos.push({ campo: "criticidade", atual: planoAtual.criticidade, excel: r.criticidade });
          if (Number(planoAtual.horas_estimadas_total) !== r.ht_total) conflitos.push({ campo: "horas", atual: planoAtual.horas_estimadas_total, excel: r.ht_total });
          if (Number(planoAtual.mes_inicio_ciclo) !== r.mes_inicio_ciclo) conflitos.push({ campo: "mes_inicio_ciclo", atual: planoAtual.mes_inicio_ciclo, excel: r.mes_inicio_ciclo });
        }

        previewRows.push({
          linha: r.linha,
          excel_id: r.excel_id,
          excel_nome: r.excel_nome,
          categoria: r.categoria,
          criticidade: r.criticidade,
          periodicidade: r.periodicidade,
          ht_total: r.ht_total,
          mes_inicio_ciclo: r.mes_inicio_ciclo,
          meses_planejados: r.meses_planejados,
          erro,
          auvo_match: matched ? {
            id: matched.id,
            identificador: matched.identificador,
            nome: matched.nome,
            cliente: matched.cliente,
            status: matched.status,
            tipo_id_atual: matched.tipo_id,
            tipo_nome_atual: tipoAtual?.nome ?? null,
          } : null,
          plano_atual: planoAtual ? {
            periodicidade: planoAtual.periodicidade,
            criticidade: planoAtual.criticidade,
            horas_estimadas_total: Number(planoAtual.horas_estimadas_total),
            mes_inicio_ciclo: planoAtual.mes_inicio_ciclo,
          } : null,
          conflitos,
        });
      }

      // Equipamentos do Auvo (ativos) DESTA CASA fora do Excel.
      // Considera todas as variantes de ID ao verificar se foi encontrado.
      const orfaosAuvo = equipsCasa
        .filter((e: any) => {
          if (e.status !== "Ativo") return false;
          return !idVariants(String(e.identificador ?? "").trim()).some((k) => idsEncontrados.has(k));
        })
        .map((e: any) => ({ id: e.id, identificador: e.identificador, nome: e.nome, cliente: e.cliente }));

      const stats = {
        total_excel: previewRows.length,
        casados: previewRows.filter((p) => p.auvo_match && !p.erro).length,
        nao_encontrados: previewRows.filter((p) => p.erro === "nao_encontrado").length,
        sem_id: previewRows.filter((p) => p.erro === "sem_id").length,
        inativos: previewRows.filter((p) => p.erro === "inativo").length,
        com_conflito: previewRows.filter((p) => p.conflitos.length > 0).length,
        orfaos_auvo: orfaosAuvo.length,
      };

      return new Response(JSON.stringify({ ok: true, sheet, ano_referencia, stats, rows: previewRows, orfaos_auvo: orfaosAuvo }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============ COMMIT ============
    if (!Array.isArray(rows)) {
      return new Response(JSON.stringify({ ok: false, error: "rows obrigatório para commit" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Garante tipos_equipamento existentes (cria os faltantes a partir do Excel)
    const categoriasNecessarias = new Set<string>();
    for (const r of rows as any[]) {
      if (r.apply_tipo && r.categoria) categoriasNecessarias.add(String(r.categoria).trim());
    }
    const tipoNomeToId = new Map<string, string>();
    for (const cat of categoriasNecessarias) {
      const existing = tipoByNome.get(normalizeKey(cat));
      if (existing) { tipoNomeToId.set(cat, existing.id); continue; }
      // Cria com periodicidade/criticidade/horas média do Excel para esse tipo
      const sample = (rows as any[]).find((r: any) => r.categoria === cat) || {};
      const ins = await supabase.from("tipos_equipamento").insert({
        nome: cat,
        categoria: cat,
        periodicidade: normalizePeriodicidade(sample.periodicidade),
        criticidade: normalizeCriticidade(sample.criticidade),
        horas_por_tecnico: Number(sample.ht_total ?? 2.5),
        qtd_tecnicos: 1,
      }).select("id").single();
      if (ins.error) throw ins.error;
      tipoNomeToId.set(cat, ins.data.id);
    }

    // 2) Upsert dos planos (filtra conflitos não confirmados)
    let planosGravados = 0;
    let tiposAplicados = 0;
    let puladosConflito = 0;
    let puladosInativo = 0;

    for (const r of rows as any[]) {
      if (!r.codigo_barras_auvo || !r.periodicidade) continue;
      if (r.skip) continue;
      const planoExistente = planoByCb.get(String(r.codigo_barras_auvo));
      const hasConflict = !!(r.conflitos && r.conflitos.length > 0);
      if (planoExistente && hasConflict && !r.overwrite_conflict) {
        puladosConflito++;
        continue;
      }

      // Status equipamento Auvo
      if (r.auvo_equip_id) {
        const equipRow = equipsGrupo.find((e: any) => e.id === r.auvo_equip_id);
        if (equipRow && equipRow.status && equipRow.status !== "Ativo") {
          puladosInativo++;
          continue;
        }
      }

      const htTotal = Number(r.ht_total ?? 0);
      const qtd = Math.max(1, Number(r.qtd_tecnicos ?? 1));
      const htTec = Number(r.horas_por_tecnico ?? htTotal / qtd);

      const { error: upErr } = await supabase
        .from("equipamento_plano_preventivo")
        .upsert({
          grupo_id,
          codigo_barras_auvo: String(r.codigo_barras_auvo),
          ano_referencia,
          horas_estimadas_total: htTotal,
          horas_por_tecnico: htTec > 0 ? htTec : 2.5,
          qtd_tecnicos: qtd,
          periodicidade: normalizePeriodicidade(r.periodicidade),
          criticidade: normalizeCriticidade(r.criticidade),
          mes_inicio_ciclo: Number(r.mes_inicio_ciclo ?? 1),
          ativo: true,
          status: "RASCUNHO",
        }, { onConflict: "grupo_id,codigo_barras_auvo,ano_referencia" });
      if (upErr) throw upErr;
      planosGravados++;

      // Aplica tipo no equipamento
      if (r.apply_tipo && r.auvo_equip_id && r.categoria) {
        const tipoId = tipoNomeToId.get(String(r.categoria).trim());
        if (tipoId) {
          const { error: tErr } = await supabase.from("equipamentos_auvo").update({ tipo_id: tipoId }).eq("id", r.auvo_equip_id);
          if (!tErr) tiposAplicados++;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      planos_gravados: planosGravados,
      tipos_aplicados: tiposAplicados,
      pulados_conflito: puladosConflito,
      pulados_inativo: puladosInativo,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("plano-preventivo-import", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});