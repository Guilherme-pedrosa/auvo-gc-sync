import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const SITUACOES = ["7063588", "7063587", "7084340", "8757598", "7065899"];
const SITUACAO_AGUARDANDO_APROVACAO = "7063588";
const SITUACAO_NAO_APROVADO = "7841143";

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
  let complete = true;
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
      // Falha da API do GC ⇒ listagem parcial. Sinaliza para que a
      // reconciliação (que remove cards ausentes) seja abortada.
      complete = false;
      break;
    }
    const json = await res.json().catch(() => ({}));
    const data = Array.isArray(json?.data) ? json.data : [];
    records.push(...data);
    const totalPaginas = json?.meta?.total_paginas || 1;
    if (pagina >= totalPaginas) break;
  }
  return { records, complete };
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
    tipo: String(orc.tipo || ""),
    hash: String(orc.hash || ""),
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
      let listagemCompleta = true;
      for (const sid of SITUACOES) {
        const { records, complete } = await fetchSituacao(sid, gcHeaders);
        all.push(...records);
        if (!complete) listagemCompleta = false;
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

      // Reconciliação: cards em cache que não vieram em nenhuma situação monitorada
      // (mudaram de situação ou foram excluídos no GC) precisam ser reavaliados 1 a 1.
      const vistosIds = new Set(all.map((o) => String(o.id)));
      const orfaos = (cacheAtual || [])
        .map((r) => String(r.gc_orcamento_id))
        .filter((id) => !vistosIds.has(id));

      let atualizadosOrfaos = 0, removidos = 0;
      const MAX_ORFAOS = 300;
      for (const id of orfaos.slice(0, MAX_ORFAOS)) {
        try {
          const r = await fetch(`${GC_BASE_URL}/api/orcamentos/${id}`, { headers: gcHeaders });
          if (r.status === 404 || r.status === 410) {
            await sb.from("followup_kanban_cache").delete().eq("gc_orcamento_id", id);
            removidos++;
            continue;
          }
          const j: any = await r.json().catch(() => ({}));
          const o = j?.data ?? j;
          if (!o || typeof o !== "object" || !o.id) continue;
          const m = mapOrc(o);
          if (SITUACOES.includes(m.situacao_id)) {
            const nextPos = (posByColuna.get(m.situacao_id) ?? -1) + 1;
            posByColuna.set(m.situacao_id, nextPos);
            await sb.from("followup_kanban_cache").update({
              coluna: m.situacao_id,
              posicao: nextPos,
              situacao_id_origem: m.situacao_id,
              dados: m,
              atualizado_em: new Date().toISOString(),
            }).eq("gc_orcamento_id", id);
          } else {
            // saiu do fluxo de follow-up (aprovado, faturado, cancelado...)
            await sb.from("followup_kanban_cache").delete().eq("gc_orcamento_id", id);
            removidos++;
          }
          atualizadosOrfaos++;
        } catch (e) {
          console.error(`[followup-kanban] reconcile ${id}`, (e as Error).message);
        }
      }

      return ok({
        ok: true,
        total: all.length,
        inseridos,
        movidos,
        mantidos,
        reconciliados: atualizadosOrfaos,
        removidos,
      });
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

    // Histórico de conversa: observações do cliente + respostas WAI + OBS interna do GC
    if (action === "conversa") {
      const gcOrcId = String(body?.gc_orcamento_id || "");
      if (!gcOrcId) return ok({ ok: false, error: "gc_orcamento_id obrigatório" });

      const { data: logs } = await sb
        .from("orcamento_aprovacao_log")
        .select("acao, observacao, user_nome, user_email, created_at, termo_aceito")
        .eq("gc_orcamento_id", gcOrcId)
        .order("created_at", { ascending: true });

      let obsInterna = "";
      const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
      const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
      if (gcAccessToken && gcSecretToken) {
        try {
          const r = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, {
            headers: {
              "access-token": gcAccessToken,
              "secret-access-token": gcSecretToken,
              "Content-Type": "application/json",
            },
          });
          const j: any = await r.json().catch(() => ({}));
          const o = j?.data ?? j;
          obsInterna = String(o?.observacoes_interna || "");
        } catch (_e) {
          obsInterna = "";
        }
      }

      // Parse dos carimbos gravados na OBS interna do GC (fonte de verdade)
      type Ev = {
        acao: string;
        observacao: string;
        user_nome: string;
        user_email: string | null;
        created_at: string | null;
        origem: string;
      };
      const parseBR = (s: string): string | null => {
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[,\s]+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return null;
        const [, d, mo, y, h, mi, se] = m;
        // -03:00 (America/Sao_Paulo)
        return `${y}-${mo}-${d}T${h}:${mi}:${se || "00"}-03:00`;
      };
      const eventosObs: Ev[] = [];
      if (obsInterna) {
        const blocos = obsInterna.split(/\n(?=\[\d{2}\/\d{2}\/\d{4})/g);
        for (const bloco of blocos) {
          const head = bloco.match(/^\[([^\]]+)\]\s*(.*)$/m);
          if (!head) continue;
          const quando = parseBR(head[1].trim());
          const primeiraLinha = head[2] || "";
          const resto = bloco.slice(bloco.indexOf(primeiraLinha) + primeiraLinha.length).trim();

          const mObs = primeiraLinha.match(/^OBSERVAÇÃO do cliente\s+([^(:]+)/i);
          const mAprov = primeiraLinha.match(/^APROVADO VIA PORTAL por\s+([^(—]+)/i);
          const mResp = primeiraLinha.match(/^RESPOSTA WAI[^—]*—\s*([^:]+)/i);
          const mEmail = primeiraLinha.match(/e-mail:\s*([^\s|)]+)/i);

          if (mObs) {
            const inline = primeiraLinha.split(":").slice(1).join(":").trim();
            eventosObs.push({
              acao: "observation",
              observacao: (resto || inline || "").trim(),
              user_nome: mObs[1].trim(),
              user_email: mEmail?.[1] || null,
              created_at: quando,
              origem: "gc",
            });
          } else if (mAprov) {
            eventosObs.push({
              acao: "approve",
              observacao: "Aprovado via portal (termo aceito).",
              user_nome: mAprov[1].trim(),
              user_email: mEmail?.[1] || null,
              created_at: quando,
              origem: "gc",
            });
          } else if (mResp) {
            eventosObs.push({
              acao: "reply",
              observacao: resto.trim(),
              user_nome: mResp[1].trim(),
              user_email: null,
              created_at: quando,
              origem: "gc",
            });
          }
        }
      }

      // Mescla com o log local (evita duplicar o mesmo texto)
      const chave = (e: any) =>
        `${e.acao}|${String(e.observacao || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120)}`;
      const vistos = new Set(eventosObs.map(chave));
      const eventos: any[] = [...eventosObs];
      for (const l of logs || []) {
        if (!l.observacao && l.acao !== "approve") continue;
        const k = chave(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        eventos.push({ ...l, origem: "log" });
      }
      eventos.sort((a, b) =>
        String(a.created_at || "").localeCompare(String(b.created_at || "")),
      );

      return ok({ ok: true, eventos, observacoes_interna: obsInterna });
    }

    // Resposta interna visível ao cliente: grava na OBS interna do GC e,
    // opcionalmente, devolve o orçamento para "Aguardando Aprovação".
    if (action === "reply") {
      const gcOrcId = String(body?.gc_orcamento_id || "");
      const texto = String(body?.texto || "").trim();
      const devolver = body?.devolver_para_aprovacao !== false;
      // Situação destino: "manter" | id permitido. Compat: usa devolver_para_aprovacao quando ausente.
      const SITUACOES_PERMITIDAS: Record<string, string> = {
        [SITUACAO_AGUARDANDO_APROVACAO]: "Aguardando Aprovação",
        [SITUACAO_NAO_APROVADO]: "Não Aprovado",
      };
      const destinoRaw = body?.situacao_destino === undefined || body?.situacao_destino === null
        ? (devolver ? SITUACAO_AGUARDANDO_APROVACAO : "manter")
        : String(body.situacao_destino);
      if (destinoRaw !== "manter" && !SITUACOES_PERMITIDAS[destinoRaw]) {
        return ok({ ok: false, error: `situacao_destino inválida: ${destinoRaw}` });
      }
      if (!gcOrcId) return ok({ ok: false, error: "gc_orcamento_id obrigatório" });
      if (texto.length < 2) return ok({ ok: false, error: "texto obrigatório" });

      const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
      const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
      if (!gcAccessToken || !gcSecretToken) return ok({ ok: false, error: "GC credentials missing" });
      const gcHeaders = {
        "access-token": gcAccessToken,
        "secret-access-token": gcSecretToken,
        "Content-Type": "application/json",
      };

      // Autor (opcional — usa o token do usuário logado quando presente)
      let autor = "Equipe WAI";
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      let userId: string | null = null;
      if (token) {
        const { data: u } = await sb.auth.getUser(token);
        userId = u?.user?.id ?? null;
        if (userId) {
          const { data: p } = await sb.from("profiles").select("nome, email").eq("id", userId).maybeSingle();
          autor = String(p?.nome || p?.email || autor).trim();
        }
      }

      // GET completo → merge → PUT (padrão não destrutivo do GC)
      const getResp = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, { headers: gcHeaders });
      const getJson: any = await getResp.json().catch(() => ({}));
      const orcAtual = getJson?.data ?? getJson;
      if (!orcAtual || typeof orcAtual !== "object") {
        return ok({ ok: false, error: `Orçamento ${gcOrcId} não encontrado (HTTP ${getResp.status})` });
      }

      const situacaoAntes = String(orcAtual.situacao_id ?? "");
      const alteraSituacao = destinoRaw !== "manter";
      const novaSituacao = alteraSituacao ? destinoRaw : situacaoAntes;
      const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const obsAtual = String(orcAtual.observacoes_interna || "");
      const linha = `\n\n[${stamp}] RESPOSTA WAI (visível ao cliente) — ${autor}:\n${texto}`;

      const payload: Record<string, unknown> = {
        ...orcAtual,
        situacao_id: novaSituacao,
        observacoes_interna: (obsAtual + linha).trim(),
      };
      for (const f of ["id", "codigo", "nome_situacao", "cor_situacao", "hash", "cadastrado_em", "modificado_em"]) {
        delete (payload as any)[f];
      }

      const putResp = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, {
        method: "PUT",
        headers: gcHeaders,
        body: JSON.stringify(payload),
      });
      const putJson: any = await putResp.json().catch(() => ({}));
      const success = putResp.ok && putJson?.code !== 400;

      await sb.from("orcamento_aprovacao_log").insert({
        gc_orcamento_id: gcOrcId,
        gc_orcamento_codigo: String(orcAtual.codigo || ""),
        cliente: String(orcAtual.nome_cliente || ""),
        acao: "reply",
        situacao_id_antes: situacaoAntes,
        situacao_id_depois: success ? novaSituacao : null,
        observacao: texto,
        termo_aceito: false,
        user_id: userId,
        user_nome: autor,
        ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"),
        user_agent: req.headers.get("user-agent"),
        detalhes: { http_status: putResp.status, gc_response: putJson },
      });

      if (!success) {
        return ok({ ok: false, error: `Falha ao gravar no GestãoClick (HTTP ${putResp.status})` });
      }

      // Reflete no cache do kanban e invalida o detalhe do portal
      if (alteraSituacao) {
        const { data: prev } = await sb
          .from("followup_kanban_cache")
          .select("dados")
          .eq("gc_orcamento_id", gcOrcId)
          .maybeSingle();
        const dados = {
          ...((prev?.dados as any) || {}),
          situacao_id: novaSituacao,
          situacao: SITUACOES_PERMITIDAS[novaSituacao] || (prev?.dados as any)?.situacao,
        };
        await sb
          .from("followup_kanban_cache")
          .update({
            coluna: novaSituacao,
            situacao_id_origem: novaSituacao,
            dados,
            atualizado_em: new Date().toISOString(),
          })
          .eq("gc_orcamento_id", gcOrcId);
      }
      await sb.from("orcamento_detalhe_cache").delete().eq("gc_orcamento_id", gcOrcId);

      return ok({ ok: true, situacao_id_depois: novaSituacao });
    }

    return ok({ ok: false, error: `action desconhecida: ${action}` });
  } catch (e) {
    console.error("[followup-kanban] erro", e);
    return ok({ ok: false, error: (e as Error).message });
  }
});