import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const SITUACOES = ["7063588", "7063587", "7084340", "8757598", "7065899"];

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function fetchSituacao(situacaoId: string, gcHeaders: Record<string, string>) {
  const records: any[] = [];
  const MAX_PAGES = 50;
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${pagina}&situacao_id=${situacaoId}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: gcHeaders });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 4000 + attempt * 2000));
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      console.error(`[followup-kanban] situacao ${situacaoId} pagina ${pagina} status ${res?.status}`);
      break;
    }
    const json = await res.json().catch(() => ({}));
    const data = Array.isArray(json?.data) ? json.data : [];
    records.push(...data);
    const totalPaginas = json?.meta?.total_paginas || 1;
    if (pagina >= totalPaginas) break;
  }
  return records;
}

function mapOrc(orc: any) {
  return {
    gc_orcamento_id: String(orc.id),
    gc_orcamento_codigo: String(orc.codigo || ""),
    cliente: String(orc.nome_cliente || ""),
    situacao_id: String(orc.situacao_id || ""),
    situacao: String(orc.nome_situacao || ""),
    cor_situacao: String(orc.cor_situacao || ""),
    valor_total: Number(orc.valor_total || 0),
    vendedor: String(orc.nome_vendedor || ""),
    data: String(orc.data || ""),
    link: `https://gestaoclick.com/orcamentos_servicos/editar/${orc.id}?retorno=%2Forcamentos_servicos`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "load";
    const sb = getSb();

    if (action === "load") {
      const [{ data: colunas }, { data: itens }] = await Promise.all([
        sb.from("followup_kanban_colunas").select("*").order("ordem"),
        sb.from("followup_kanban_cache").select("*").order("posicao"),
      ]);
      return ok({ ok: true, colunas: colunas || [], itens: itens || [] });
    }

    if (action === "sync") {
      const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
      const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
      if (!gcAccessToken || !gcSecretToken) {
        return ok({ ok: false, error: "GC credentials missing" });
      }
      const gcHeaders = {
        "access-token": gcAccessToken,
        "secret-access-token": gcSecretToken,
        "Content-Type": "application/json",
      };

      // Garante colunas fixas no banco (idempotente)
      for (let i = 0; i < SITUACOES.length; i++) {
        const sid = SITUACOES[i];
        await sb
          .from("followup_kanban_colunas")
          .upsert(
            { id: sid, titulo: `Situação ${sid}`, ordem: i, eh_situacao: true, situacao_id: sid },
            { onConflict: "id", ignoreDuplicates: true },
          );
      }

      const all: any[] = [];
      for (const sid of SITUACOES) {
        const recs = await fetchSituacao(sid, gcHeaders);
        all.push(...recs);
      }

      // Atualiza títulos das colunas fixas com o nome real da situação vindo do GC
      const nomePorSituacao = new Map<string, string>();
      for (const orc of all) {
        const sid = String(orc.situacao_id || "");
        const nome = String(orc.nome_situacao || "").trim();
        if (sid && nome && !nomePorSituacao.has(sid)) nomePorSituacao.set(sid, nome);
      }
      for (const [sid, nome] of nomePorSituacao.entries()) {
        await sb
          .from("followup_kanban_colunas")
          .update({ titulo: nome, atualizado_em: new Date().toISOString() })
          .eq("id", sid);
      }

      // Cache atual
      const { data: cacheAtual } = await sb.from("followup_kanban_cache").select("*");
      const cacheMap = new Map<string, any>();
      (cacheAtual || []).forEach((r) => cacheMap.set(r.gc_orcamento_id, r));

      let inseridos = 0, movidos = 0, mantidos = 0;
      const upserts: any[] = [];

      // Calcula próximas posições por coluna
      const posByColuna = new Map<string, number>();
      (cacheAtual || []).forEach((r) => {
        const cur = posByColuna.get(r.coluna) ?? -1;
        if (r.posicao > cur) posByColuna.set(r.coluna, r.posicao);
      });

      for (const orc of all) {
        const m = mapOrc(orc);
        if (!SITUACOES.includes(m.situacao_id)) continue;
        const prev = cacheMap.get(m.gc_orcamento_id);
        if (!prev) {
          const nextPos = (posByColuna.get(m.situacao_id) ?? -1) + 1;
          posByColuna.set(m.situacao_id, nextPos);
          upserts.push({
            gc_orcamento_id: m.gc_orcamento_id,
            coluna: m.situacao_id,
            posicao: nextPos,
            situacao_id_origem: m.situacao_id,
            dados: m,
            atualizado_em: new Date().toISOString(),
          });
          inseridos++;
        } else if (prev.situacao_id_origem !== m.situacao_id) {
          const nextPos = (posByColuna.get(m.situacao_id) ?? -1) + 1;
          posByColuna.set(m.situacao_id, nextPos);
          upserts.push({
            gc_orcamento_id: m.gc_orcamento_id,
            coluna: m.situacao_id,
            posicao: nextPos,
            situacao_id_origem: m.situacao_id,
            dados: m,
            atualizado_em: new Date().toISOString(),
          });
          movidos++;
        } else {
          // mantém coluna/posicao; só atualiza dados
          upserts.push({
            gc_orcamento_id: m.gc_orcamento_id,
            coluna: prev.coluna,
            posicao: prev.posicao,
            situacao_id_origem: m.situacao_id,
            dados: m,
            atualizado_em: new Date().toISOString(),
          });
          mantidos++;
        }
      }

      // Upsert em lotes
      const CHUNK = 200;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        const batch = upserts.slice(i, i + CHUNK);
        const { error } = await sb.from("followup_kanban_cache").upsert(batch, { onConflict: "gc_orcamento_id" });
        if (error) console.error("[followup-kanban] upsert error", error);
      }

      return ok({ ok: true, total: all.length, inseridos, movidos, mantidos });
    }

    if (action === "move") {
      const { gc_orcamento_id, coluna, posicao } = body;
      if (!gc_orcamento_id || !coluna) return ok({ ok: false, error: "params missing" });
      const { error } = await sb
        .from("followup_kanban_cache")
        .update({ coluna, posicao: posicao ?? 0, atualizado_em: new Date().toISOString() })
        .eq("gc_orcamento_id", gc_orcamento_id);
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true });
    }

    if (action === "reorder") {
      // body.updates: [{ gc_orcamento_id, coluna, posicao }]
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      for (const u of updates) {
        await sb
          .from("followup_kanban_cache")
          .update({ coluna: u.coluna, posicao: u.posicao, atualizado_em: new Date().toISOString() })
          .eq("gc_orcamento_id", u.gc_orcamento_id);
      }
      return ok({ ok: true, count: updates.length });
    }

    if (action === "add_column") {
      const titulo = String(body?.titulo || "").trim();
      if (!titulo) return ok({ ok: false, error: "titulo obrigatório" });
      const { data: ult } = await sb
        .from("followup_kanban_colunas")
        .select("ordem")
        .order("ordem", { ascending: false })
        .limit(1);
      const ordem = (ult?.[0]?.ordem ?? -1) + 1;
      const id = `custom_${crypto.randomUUID()}`;
      const { error } = await sb
        .from("followup_kanban_colunas")
        .insert({ id, titulo, ordem, eh_situacao: false });
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true, id });
    }

    if (action === "rename_column") {
      const { id, titulo } = body;
      if (!id || !titulo) return ok({ ok: false, error: "params missing" });
      const { error } = await sb
        .from("followup_kanban_colunas")
        .update({ titulo, atualizado_em: new Date().toISOString() })
        .eq("id", id);
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true });
    }

    if (action === "delete_column") {
      const { id } = body;
      if (!id) return ok({ ok: false, error: "id obrigatório" });
      const { data: col } = await sb.from("followup_kanban_colunas").select("eh_situacao").eq("id", id).single();
      if (col?.eh_situacao) return ok({ ok: false, error: "Não pode deletar coluna de situação" });
      const { count } = await sb
        .from("followup_kanban_cache")
        .select("gc_orcamento_id", { count: "exact", head: true })
        .eq("coluna", id);
      if ((count ?? 0) > 0) return ok({ ok: false, error: "Coluna não está vazia" });
      const { error } = await sb.from("followup_kanban_colunas").delete().eq("id", id);
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true });
    }

    if (action === "reorder_columns") {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
      for (let i = 0; i < ids.length; i++) {
        await sb
          .from("followup_kanban_colunas")
          .update({ ordem: i, atualizado_em: new Date().toISOString() })
          .eq("id", ids[i]);
      }
      return ok({ ok: true });
    }

    return ok({ ok: false, error: `action desconhecida: ${action}` });
  } catch (e) {
    console.error("[followup-kanban] erro", e);
    return ok({ ok: false, error: (e as Error).message });
  }
});