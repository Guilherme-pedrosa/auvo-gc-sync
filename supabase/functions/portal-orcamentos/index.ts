import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const SITUACAO_AGUARDANDO_APROVACAO = "7063588";
const SITUACAO_APROVADO_VIA_LINK = "9153484";
const SITUACAO_AG_INFORMACOES = "8757598";

async function fetchAguardandoAprovacao(gcHeaders: Record<string, string>) {
  const records: any[] = [];
  const MAX_PAGES = 50;
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const url = `${GC_BASE_URL}/api/orcamentos?limite=100&pagina=${pagina}&situacao_id=${SITUACAO_AGUARDANDO_APROVACAO}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: gcHeaders });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 4000 + attempt * 2000));
        continue;
      }
      break;
    }
    if (!res || !res.ok) throw new Error(`Falha ao sincronizar orçamentos no GC (HTTP ${res?.status || "sem resposta"})`);
    const json = await res.json().catch(() => ({}));
    const data = Array.isArray(json?.data) ? json.data : [];
    records.push(...data);
    const totalPaginas = Number(json?.meta?.total_paginas || 1);
    if (pagina >= totalPaginas) break;
  }
  return records;
}

function mapOrcamento(orc: any) {
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

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const normalize = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(ltda|me|sa|s\.a\.|s\/a|eireli|epp)\s*\.?$/i, "")
    .replace(/\s+/g, " ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN")!;
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ error: "Não autorizado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return ok({ error: "Não autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Carrega profile + grupo
    const { data: profile } = await admin
      .from("profiles")
      .select("id, nome, email, grupo_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.grupo_id) return ok({ ok: false, error: "Usuário sem grupo configurado" });

    const { data: membros } = await admin
      .from("grupo_cliente_membros")
      .select("cliente_nome")
      .eq("grupo_id", profile.grupo_id);
    const clientesNorm = new Set((membros || []).map((m: any) => normalize(m.cliente_nome)));
    if (clientesNorm.size === 0) return ok({ ok: true, itens: [] });

    const body = await req.json().catch(() => ({}));
    const action = body?.action || "list";

    const gcHeaders = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    if (action === "refresh") {
      const atuais = await fetchAguardandoAprovacao(gcHeaders);
      const atualIds = new Set(atuais.map((orc: any) => String(orc.id)).filter(Boolean));
      const { data: cacheAtual } = await admin
        .from("followup_kanban_cache")
        .select("gc_orcamento_id, coluna, posicao")
        .eq("coluna", SITUACAO_AGUARDANDO_APROVACAO);

      const posById = new Map<string, number>();
      let maxPos = -1;
      for (const row of cacheAtual || []) {
        const id = String((row as any).gc_orcamento_id);
        const pos = Number((row as any).posicao ?? 0);
        posById.set(id, pos);
        if (pos > maxPos) maxPos = pos;
      }

      const now = new Date().toISOString();
      const upserts = atuais.map((orc: any) => {
        const m = mapOrcamento(orc);
        const id = m.gc_orcamento_id;
        const pos = posById.has(id) ? posById.get(id)! : ++maxPos;
        return {
          gc_orcamento_id: id,
          coluna: SITUACAO_AGUARDANDO_APROVACAO,
          posicao: pos,
          situacao_id_origem: SITUACAO_AGUARDANDO_APROVACAO,
          dados: m,
          atualizado_em: now,
        };
      });
      for (let i = 0; i < upserts.length; i += 200) {
        const { error } = await admin
          .from("followup_kanban_cache")
          .upsert(upserts.slice(i, i + 200), { onConflict: "gc_orcamento_id" });
        if (error) throw error;
      }
      // NÃO remove em bloco: itens que sumiram da paginação do GC podem ser
      // resultado de race / paginação parcial / mudança temporária de situação.
      // Em vez disso, verifica cada um individualmente via GET e só remove
      // se confirmadamente saiu da situação "Aguardando Aprovação".
      const removidosCandidatos = (cacheAtual || [])
        .filter((row: any) => !atualIds.has(String(row.gc_orcamento_id)))
        .map((row: any) => String(row.gc_orcamento_id));
      const aRemover: string[] = [];
      await Promise.all(
        removidosCandidatos.map(async (id) => {
          try {
            const r = await fetch(`${GC_BASE_URL}/api/orcamentos/${id}`, { headers: gcHeaders });
            const j: any = await r.json().catch(() => ({}));
            const orc = j?.data ?? j;
            const sit = String(orc?.situacao_id ?? "");
            if (sit && sit !== SITUACAO_AGUARDANDO_APROVACAO) {
              aRemover.push(id);
            }
          } catch (_) {
            // erro de rede: NÃO remove (preserva cache)
          }
        }),
      );
      if (aRemover.length > 0) {
        await admin.from("followup_kanban_cache").delete().in("gc_orcamento_id", aRemover);
      }
    }

    if (action === "list" || action === "refresh") {
      // Lê do cache do followup, coluna 7063588
      const { data: cache } = await admin
        .from("followup_kanban_cache")
        .select("*")
        .eq("coluna", SITUACAO_AGUARDANDO_APROVACAO);
      const itens = (cache || [])
        .map((r: any) => r.dados)
        .filter((d: any) => d && clientesNorm.has(normalize(d.cliente)));

      // Enriquece com equipamento via tarefas_central
      const ids = itens.map((i: any) => String(i.gc_orcamento_id)).filter(Boolean);
      const equipMap = new Map<string, string>();
      const linkMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: tarefas } = await admin
          .from("tarefas_central")
          .select("gc_orcamento_id, equipamento_nome, gc_orc_link")
          .in("gc_orcamento_id", ids);
        for (const t of tarefas || []) {
          const k = String((t as any).gc_orcamento_id);
          const nome = String((t as any).equipamento_nome || "").trim();
          if (nome && !equipMap.has(k)) equipMap.set(k, nome);
          const link = String((t as any).gc_orc_link || "").trim();
          if (link && link.includes("/prop/") && !linkMap.has(k)) linkMap.set(k, link);
        }
      }
      // Para os que não vieram pela tarefas_central, busca o hash no GC e monta /prop/{hash}
      const tipoMap = new Map<string, string>();
      const missing = itens.filter(
        (i: any) => !linkMap.has(String(i.gc_orcamento_id)) || !i.tipo,
      );
      await Promise.all(
        missing.map(async (i: any) => {
          try {
            const r = await fetch(`${GC_BASE_URL}/api/orcamentos/${i.gc_orcamento_id}`, { headers: gcHeaders });
            const j: any = await r.json().catch(() => ({}));
            const orc = j?.data ?? j;
            const hash = String(orc?.hash || "").trim();
            if (hash) linkMap.set(String(i.gc_orcamento_id), `https://gestaoclick.com/prop/${hash}`);
            const tipo = String(orc?.tipo || "").trim().toLowerCase();
            if (tipo) tipoMap.set(String(i.gc_orcamento_id), tipo);
          } catch (_) { /* ignore */ }
        }),
      );
      const enriched = itens
        .map((i: any) => ({
          ...i,
          tipo: String(i.tipo || tipoMap.get(String(i.gc_orcamento_id)) || "").toLowerCase(),
          equipamento: equipMap.get(String(i.gc_orcamento_id)) || "",
          gc_orc_link: linkMap.get(String(i.gc_orcamento_id)) || null,
        }));
      return ok({ ok: true, itens: enriched });
    }

    if (action === "detail") {
      const gcOrcId = String(body.gc_orcamento_id || "");
      if (!gcOrcId) return ok({ ok: false, error: "gc_orcamento_id obrigatório" });

      // Fingerprint a partir do cache do followup (atualiza só quando o sync detecta mudança real)
      const { data: fkRow } = await admin
        .from("followup_kanban_cache")
        .select("dados, atualizado_em")
        .eq("gc_orcamento_id", gcOrcId)
        .maybeSingle();
      const fingerprint = fkRow
        ? `${fkRow.atualizado_em}|${JSON.stringify(fkRow.dados || {})}`
        : "no-followup";

      // Lê cache de detalhe
      const { data: cached } = await admin
        .from("orcamento_detalhe_cache")
        .select("orcamento, tarefas, fingerprint")
        .eq("gc_orcamento_id", gcOrcId)
        .maybeSingle();

      if (cached && cached.fingerprint === fingerprint) {
        const cli = normalize(String((cached.orcamento as any)?.nome_cliente || ""));
        if (!clientesNorm.has(cli)) return ok({ ok: false, error: "Orçamento fora do grupo do usuário" });
        // Aplica também o fallback por atributo 73341 (TAREFA OS) sobre o orçamento em cache,
        // pra recuperar tarefas que apontam pra outro orcamento mas estão referenciadas aqui.
        const cachedTarefas: any[] = Array.isArray(cached.tarefas) ? cached.tarefas : [];
        const atribsC: any[] = Array.isArray((cached.orcamento as any)?.atributos)
          ? (cached.orcamento as any).atributos
          : [];
        const idsC = new Set<string>();
        for (const a of atribsC) {
          const node = a?.atributo || a;
          if (String(node?.atributo_id || "") !== "73341") continue;
          const raw = String(node?.conteudo || "").trim();
          for (const part of raw.split(/[\/,;\s]+/)) {
            const id = part.trim();
            if (/^\d{6,}$/.test(id)) idsC.add(id);
          }
        }
        let extraC: any[] = [];
        if (idsC.size > 0) {
          const { data: t2c } = await admin
            .from("tarefas_central")
            .select("auvo_task_id, auvo_task_url, auvo_link, auvo_survey_url, gc_orc_link, gc_os_link, status_auvo")
            .in("auvo_task_id", Array.from(idsC));
          extraC = t2c || [];
        }
        const mapC = new Map<string, any>();
        for (const t of [...cachedTarefas, ...extraC]) {
          const k = String(t.auvo_task_id || "");
          if (k && !mapC.has(k)) mapC.set(k, t);
        }
        const mergedTarefas = Array.from(mapC.values());
        const { data: obsLogC } = await admin
          .from("orcamento_aprovacao_log")
          .select("observacao, user_nome, user_email, created_at")
          .eq("gc_orcamento_id", gcOrcId)
          .eq("acao", "observation")
          .not("observacao", "is", null)
          .order("created_at", { ascending: false })
          .limit(20);
        return ok({ ok: true, orcamento: cached.orcamento, tarefas: mergedTarefas, observacoes_cliente: obsLogC || [], cached: true });
      }

      const resp = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, { headers: gcHeaders });
      const json: any = await resp.json().catch(() => ({}));
      const orc = json?.data ?? json;
      if (!orc || typeof orc !== "object") return ok({ ok: false, error: "Orçamento não encontrado" });
      // valida cliente do orçamento
      const cli = normalize(String(orc.nome_cliente || ""));
      if (!clientesNorm.has(cli)) return ok({ ok: false, error: "Orçamento fora do grupo do usuário" });

      // Procura tarefa Auvo relacionada (via tarefas_central)
      const { data: tarefasPorOrc } = await admin
        .from("tarefas_central")
        .select("auvo_task_id, auvo_task_url, auvo_link, auvo_survey_url, gc_orc_link, gc_os_link, status_auvo")
        .eq("gc_orcamento_id", gcOrcId)
        .limit(5);

      // Fallback: lê atributo 73341 (TAREFA OS) do próprio orçamento no GC
      // e busca a tarefa por auvo_task_id (caso a tarefa do Auvo aponte pra outro
      // orçamento mas o orçamento atual referencie a tarefa no campo extra).
      const atribs: any[] = Array.isArray((orc as any).atributos) ? (orc as any).atributos : [];
      const taskIdsFromOrc = new Set<string>();
      for (const a of atribs) {
        const node = a?.atributo || a;
        const attrId = String(node?.atributo_id || "");
        if (attrId !== "73341") continue;
        const raw = String(node?.conteudo || "").trim();
        if (!raw) continue;
        // pode vir como "74403201" ou "74403201/74403202"
        for (const part of raw.split(/[\/,;\s]+/)) {
          const id = part.trim();
          if (/^\d{6,}$/.test(id)) taskIdsFromOrc.add(id);
        }
      }
      let tarefasPorAttr: any[] = [];
      if (taskIdsFromOrc.size > 0) {
        const { data: t2 } = await admin
          .from("tarefas_central")
          .select("auvo_task_id, auvo_task_url, auvo_link, auvo_survey_url, gc_orc_link, gc_os_link, status_auvo")
          .in("auvo_task_id", Array.from(taskIdsFromOrc));
        tarefasPorAttr = t2 || [];
      }
      // Merge dedup por auvo_task_id
      const tarefasMap = new Map<string, any>();
      for (const t of [...(tarefasPorOrc || []), ...tarefasPorAttr]) {
        const k = String(t.auvo_task_id || "");
        if (k && !tarefasMap.has(k)) tarefasMap.set(k, t);
      }
      const tarefas = Array.from(tarefasMap.values());

      // Histórico de observações enviadas pelo cliente neste orçamento
      const { data: obsLog } = await admin
        .from("orcamento_aprovacao_log")
        .select("observacao, user_nome, user_email, created_at")
        .eq("gc_orcamento_id", gcOrcId)
        .eq("acao", "observation")
        .not("observacao", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

      // Persiste no cache
      await admin.from("orcamento_detalhe_cache").upsert({
        gc_orcamento_id: gcOrcId,
        fingerprint,
        orcamento: orc,
        tarefas: tarefas || [],
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "gc_orcamento_id" });

      return ok({ ok: true, orcamento: orc, tarefas: tarefas || [], observacoes_cliente: obsLog || [], cached: false });
    }

    if (action === "approve" || action === "observation") {
      const gcOrcId = String(body.gc_orcamento_id || "");
      const gcOrcCodigo = String(body.gc_orcamento_codigo || "");
      const observacaoTexto = String(body.observacao || "").trim();
      const termoAceito = Boolean(body.termo_aceito);
      if (!gcOrcId) return ok({ ok: false, error: "gc_orcamento_id obrigatório" });
      if (action === "approve" && !termoAceito)
        return ok({ ok: false, error: "É necessário aceitar o termo de aprovação" });
      if (action === "observation" && !observacaoTexto)
        return ok({ ok: false, error: "Observação obrigatória" });

      // GET completo
      const getResp = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, { headers: gcHeaders });
      const getJson: any = await getResp.json().catch(() => ({}));
      const orcAtual = getJson?.data ?? getJson;
      if (!orcAtual || typeof orcAtual !== "object") {
        return ok({ ok: false, error: `Orçamento ${gcOrcId} não encontrado (HTTP ${getResp.status})` });
      }
      const cli = normalize(String(orcAtual.nome_cliente || ""));
      if (!clientesNorm.has(cli)) return ok({ ok: false, error: "Orçamento fora do grupo do usuário" });

      const situacaoAntes = String(orcAtual.situacao_id ?? "");
      const novaSituacao =
        action === "approve" ? SITUACAO_APROVADO_VIA_LINK : SITUACAO_AG_INFORMACOES;

      const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const quem = profile.nome || profile.email || "Cliente";
      const obsAtual = String(orcAtual.observacao || "");
      let novaObs = obsAtual;
      if (action === "approve") {
        const linha = `\n\n[${stamp}] APROVADO VIA PORTAL por ${quem} — Termo aceito.`;
        novaObs = (obsAtual + linha).trim();
      } else {
        const linha = `\n\n[${stamp}] OBSERVAÇÃO do cliente ${quem}:\n${observacaoTexto}`;
        novaObs = (obsAtual + linha).trim();
      }

      const payload: Record<string, unknown> = {
        ...orcAtual,
        situacao_id: novaSituacao,
        observacao: novaObs,
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

      // Log obrigatório
      await admin.from("orcamento_aprovacao_log").insert({
        gc_orcamento_id: gcOrcId,
        gc_orcamento_codigo: gcOrcCodigo || String(orcAtual.codigo || ""),
        cliente: String(orcAtual.nome_cliente || ""),
        acao: action,
        situacao_id_antes: situacaoAntes,
        situacao_id_depois: success ? novaSituacao : null,
        observacao: action === "observation" ? observacaoTexto : null,
        termo_aceito: action === "approve" ? termoAceito : false,
        user_id: user.id,
        user_nome: profile.nome,
        user_email: profile.email,
        ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"),
        user_agent: req.headers.get("user-agent"),
        detalhes: { http_status: putResp.status, gc_response: putJson },
      });

      if (!success) {
        return ok({ ok: false, error: `Falha na alteração no GestãoClick (HTTP ${putResp.status})`, body: putJson });
      }

      // Atualiza cache local: remove da coluna 7063588 (some da lista)
      await admin.from("followup_kanban_cache").delete().eq("gc_orcamento_id", gcOrcId);
      // Invalida cache de detalhe
      await admin.from("orcamento_detalhe_cache").delete().eq("gc_orcamento_id", gcOrcId);

      return ok({ ok: true, situacao_id_depois: novaSituacao });
    }

    return ok({ ok: false, error: `Ação desconhecida: ${action}` });
  } catch (e) {
    console.error("[portal-orcamentos] erro", e);
    return ok({ ok: false, error: (e as Error).message });
  }
});