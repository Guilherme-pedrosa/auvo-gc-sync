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

    if (action === "list") {
      // Lê do cache do followup (já sincronizado), coluna 7063588
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
      const missing = itens.filter((i: any) => !linkMap.has(String(i.gc_orcamento_id)));
      await Promise.all(
        missing.map(async (i: any) => {
          try {
            const r = await fetch(`${GC_BASE_URL}/api/orcamentos/${i.gc_orcamento_id}`, { headers: gcHeaders });
            const j: any = await r.json().catch(() => ({}));
            const hash = String((j?.data ?? j)?.hash || "").trim();
            if (hash) linkMap.set(String(i.gc_orcamento_id), `https://gestaoclick.com/prop/${hash}`);
          } catch (_) { /* ignore */ }
        }),
      );
      const enriched = itens.map((i: any) => ({
        ...i,
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
        return ok({ ok: true, orcamento: cached.orcamento, tarefas: cached.tarefas || [], cached: true });
      }

      const resp = await fetch(`${GC_BASE_URL}/api/orcamentos/${gcOrcId}`, { headers: gcHeaders });
      const json: any = await resp.json().catch(() => ({}));
      const orc = json?.data ?? json;
      if (!orc || typeof orc !== "object") return ok({ ok: false, error: "Orçamento não encontrado" });
      // valida cliente do orçamento
      const cli = normalize(String(orc.nome_cliente || ""));
      if (!clientesNorm.has(cli)) return ok({ ok: false, error: "Orçamento fora do grupo do usuário" });

      // Procura tarefa Auvo relacionada (via tarefas_central)
      const { data: tarefas } = await admin
        .from("tarefas_central")
        .select("auvo_task_id, auvo_task_url, auvo_link, auvo_survey_url, gc_orc_link, gc_os_link, status_auvo")
        .eq("gc_orcamento_id", gcOrcId)
        .limit(5);

      // Persiste no cache
      await admin.from("orcamento_detalhe_cache").upsert({
        gc_orcamento_id: gcOrcId,
        fingerprint,
        orcamento: orc,
        tarefas: tarefas || [],
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "gc_orcamento_id" });

      return ok({ ok: true, orcamento: orc, tarefas: tarefas || [], cached: false });
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