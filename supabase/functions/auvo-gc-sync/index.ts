import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const MIN_DELAY_MS = 400;
let lastGcCall = 0;
let lastAuvoCall = 0;

async function rateLimitedFetch(url: string, options: RequestInit, type: "gc" | "auvo"): Promise<Response> {
  const now = Date.now();
  const last = type === "gc" ? lastGcCall : lastAuvoCall;
  const elapsed = now - last;
  if (elapsed < MIN_DELAY_MS) await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  if (type === "gc") lastGcCall = Date.now();
  else lastAuvoCall = Date.now();
  return fetch(url, options);
}

// ─── Auvo v2 Login ───
async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auvo login failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(bearerToken: string): Record<string, string> {
  return { "Authorization": `Bearer ${bearerToken}`, "Content-Type": "application/json" };
}

const SITUACOES_EXCLUIR = [
  "7116099", "7124107", "8760417", "7063724",
];

// ─── STEP 1: Buscar OS com tarefa Auvo ───
async function fetchOsComTarefaAuvo(gcHeaders: Record<string, string>): Promise<Array<{
  gc_os_id: string;
  gc_os_codigo: string;
  auvo_task_id: string;
  nome_situacao: string;
  situacao_id: string;
}>> {
  const atributoId = Deno.env.get("GC_ATRIBUTO_TAREFA_ID") || "73344";
  const atributoLabel = (Deno.env.get("AUVO_ATRIBUTO_LABEL") || "Tarefa Execução").toLowerCase();
  const results: Array<{
    gc_os_id: string; gc_os_codigo: string; auvo_task_id: string;
    nome_situacao: string; situacao_id: string;
  }> = [];

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
    if (!response.ok) { console.error(`[auvo-gc-sync] GC OS list error: ${response.status}`); break; }

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const os of records) {
      const situacaoId = String(os.situacao_id || "");
      if (SITUACOES_EXCLUIR.includes(situacaoId)) continue;

      const atributos: any[] = os.atributos || [];
      const atributoTarefa = atributos.find((a: any) => {
        const label = String(a.label || a.nome || "").toLowerCase();
        return label === atributoLabel || label.includes("tarefa") || label.includes("execu");
      });
      if (!atributoTarefa?.valor || String(atributoTarefa.valor).trim() === "") continue;

      results.push({
        gc_os_id: String(os.id),
        gc_os_codigo: String(os.codigo || os.id),
        auvo_task_id: String(atributoTarefa.valor).trim(),
        nome_situacao: String(os.nome_situacao || ""),
        situacao_id: situacaoId,
      });
    }
    page++;
  }
  return results;
}

// ─── STEP 2: Consultar tarefa Auvo (v2) ───
async function getAuvoTask(taskId: string, bearerToken: string): Promise<any | null> {
  const url = `${AUVO_BASE_URL}/tasks/${taskId}`;
  try {
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
    if (response.status === 404) return null;
    if (!response.ok) { console.error(`[auvo-gc-sync] Auvo task ${taskId} error: ${response.status}`); return null; }
    const data = await response.json();
    const entity = data?.result ?? data;
    if (!entity) return null;
    return {
      taskID: entity.taskID ?? entity.id,
      finished: entity.finished === true || entity.finished === "true",
      pendency: String(entity.pendency ?? entity.pendencia ?? ""),
      taskStatus: String(entity.taskStatus ?? ""),
      checkIn: entity.checkIn === true,
      checkOut: entity.checkOut === true,
      report: String(entity.report ?? ""),
      _raw: entity,
    };
  } catch (err) {
    console.error(`[auvo-gc-sync] Erro ao buscar tarefa ${taskId}:`, err);
    return null;
  }
}

// ─── STEP 2.1: Buscar peças do orçamento GC ───
async function fetchItensPecasOsGC(
  gcOsId: string, gcHeaders: Record<string, string>
): Promise<Array<{ descricao: string; quantidade: number; codigo?: string }>> {
  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;
  try {
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
    if (!response.ok) return [];
    const data = await response.json();
    const osObj = data?.data ?? data;
    const produtos: any[] = osObj?.produtos || osObj?.itens || osObj?.servicos_produtos || osObj?.pecas || [];
    return produtos
      .filter((p: any) => {
        const desc = String(p.descricao || p.nome || p.produto || "").trim();
        const qty = parseFloat(String(p.quantidade || p.qtd || "0"));
        return desc.length > 0 && qty > 0;
      })
      .map((p: any) => ({
        descricao: String(p.descricao || p.nome || p.produto || ""),
        quantidade: parseFloat(String(p.quantidade || p.qtd || "1")),
        codigo: String(p.codigo || p.id || ""),
      }));
  } catch (err) {
    console.error(`[auvo-gc-sync] Erro ao buscar itens GC OS ${gcOsId}:`, err);
    return [];
  }
}

// ─── STEP 2.2: Buscar materiais Auvo (v2) ───
async function fetchMateriaisAuvoTask(
  taskId: string, bearerToken: string, tarefaRaw?: any
): Promise<Array<{ descricao: string; quantidade: number }>> {
  const materiais: Array<{ descricao: string; quantidade: number }> = [];

  if (tarefaRaw) {
    const produtosNaTarefa: any[] = tarefaRaw?.products || tarefaRaw?.materials || tarefaRaw?.materiais || tarefaRaw?.itens || [];
    for (const p of produtosNaTarefa) {
      const desc = String(p.description || p.descricao || p.name || p.nome || "").trim();
      const qty = parseFloat(String(p.quantity || p.quantidade || p.qtd || "1"));
      if (desc) materiais.push({ descricao: desc, quantidade: qty });
    }

    const questionnaires: any[] = tarefaRaw?.questionnaires || [];
    for (const q of questionnaires) {
      for (const answer of (q.answers || [])) {
        const qDesc = String(answer.questionDescription || "").toLowerCase();
        if (qDesc.includes("peça") || qDesc.includes("peca") || qDesc.includes("material") ||
            qDesc.includes("produto") || qDesc.includes("componente") || qDesc.includes("part") || qDesc.includes("item")) {
          const replyText = String(answer.reply || "").trim();
          if (replyText) materiais.push({ descricao: replyText, quantidade: 1 });
        }
      }
    }
    if (materiais.length > 0) return materiais;
  }

  try {
    const url = `${AUVO_BASE_URL}/tasks/${taskId}/products`;
    const response = await rateLimitedFetch(url, { headers: auvoHeaders(bearerToken) }, "auvo");
    if (response.ok) {
      const data = await response.json();
      const lista: any[] = data?.result?.entityList || data?.result?.Entities || data?.result || data?.data || [];
      for (const p of lista) {
        const desc = String(p.description || p.descricao || p.name || p.nome || "").trim();
        const qty = parseFloat(String(p.quantity || p.quantidade || "1"));
        if (desc) materiais.push({ descricao: desc, quantidade: qty });
      }
    }
  } catch (err) {
    console.warn(`[auvo-gc-sync] Endpoint /tasks/${taskId}/products indisponível:`, err);
  }

  return materiais;
}

// ─── STEP 2.3: Comparação flexível ───
function normalizarDescricao(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set(["de", "da", "do", "para", "com", "sem", "por", "em", "no", "na", "os", "as", "um", "uma"]);

function tokenizar(texto: string): string[] {
  return normalizarDescricao(texto).split(" ").filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function itemOrcamentoCoberto(
  itemOrcamento: { descricao: string; quantidade: number },
  materiaisExecucao: Array<{ descricao: string; quantidade: number }>,
  thresholdCompleto: number,
  thresholdParcial: number
): { coberto: boolean; matchParcial: boolean; melhorMatch: string | null; score: number } {
  const tokensOrc = tokenizar(itemOrcamento.descricao);
  if (tokensOrc.length === 0) return { coberto: true, matchParcial: false, melhorMatch: null, score: 1 };

  let melhorScore = 0;
  let melhorMatch: string | null = null;

  for (const mat of materiaisExecucao) {
    const tokensExec = tokenizar(mat.descricao);
    const tokensExecSet = new Set(tokensExec);
    const matchCount = tokensOrc.filter(t => {
      if (tokensExecSet.has(t)) return true;
      for (const te of tokensExec) { if (te.includes(t) || t.includes(te)) return true; }
      return false;
    }).length;
    const score = matchCount / tokensOrc.length;
    if (score > melhorScore) { melhorScore = score; melhorMatch = mat.descricao; }
  }

  return {
    coberto: melhorScore >= thresholdCompleto,
    matchParcial: melhorScore >= thresholdParcial && melhorScore < thresholdCompleto,
    melhorMatch,
    score: Math.round(melhorScore * 100),
  };
}

// ─── STEP 2.4: Validação principal de peças ───
interface ResultadoValidacaoPecas {
  aprovado: boolean;
  sem_pecas_orcamento: boolean;
  pecas_orcamento: Array<{ descricao: string; quantidade: number; codigo?: string }>;
  materiais_execucao: Array<{ descricao: string; quantidade: number }>;
  itens_cobertos: Array<{ descricao: string; match: string; score: number }>;
  itens_faltando: Array<{ descricao: string; motivo: string }>;
  itens_parciais: Array<{ descricao: string; melhor_match: string; score: number }>;
  resumo: string;
}

async function validarPecasOsVsExecucao(
  gcOsId: string, auvoTaskId: string, tarefaRaw: any,
  gcHeaders: Record<string, string>, auvoBearerToken: string
): Promise<ResultadoValidacaoPecas> {
  const THRESHOLD_COMPLETO = parseInt(Deno.env.get("AUVO_PECAS_THRESHOLD") || "75") / 100;
  const THRESHOLD_PARCIAL = parseInt(Deno.env.get("AUVO_PECAS_PARCIAL") || "40") / 100;

  const [pecasOrcamento, materiaisExecucao] = await Promise.all([
    fetchItensPecasOsGC(gcOsId, gcHeaders),
    fetchMateriaisAuvoTask(auvoTaskId, auvoBearerToken, tarefaRaw),
  ]);

  if (pecasOrcamento.length === 0) {
    return {
      aprovado: true, sem_pecas_orcamento: true, pecas_orcamento: [], materiais_execucao: materiaisExecucao,
      itens_cobertos: [], itens_faltando: [], itens_parciais: [],
      resumo: "OS sem peças no orçamento — aprovação automática",
    };
  }

  if (materiaisExecucao.length === 0) {
    return {
      aprovado: false, sem_pecas_orcamento: false, pecas_orcamento: pecasOrcamento, materiais_execucao: [],
      itens_cobertos: [], itens_parciais: [],
      itens_faltando: pecasOrcamento.map(p => ({ descricao: p.descricao, motivo: "Nenhum material registrado na execução Auvo" })),
      resumo: `BLOQUEADO — ${pecasOrcamento.length} peças no orçamento, 0 materiais na execução`,
    };
  }

  const cobertos: Array<{ descricao: string; match: string; score: number }> = [];
  const faltando: Array<{ descricao: string; motivo: string }> = [];
  const parciais: Array<{ descricao: string; melhor_match: string; score: number }> = [];

  for (const peca of pecasOrcamento) {
    const resultado = itemOrcamentoCoberto(peca, materiaisExecucao, THRESHOLD_COMPLETO, THRESHOLD_PARCIAL);
    if (resultado.coberto) {
      cobertos.push({ descricao: peca.descricao, match: resultado.melhorMatch || "", score: resultado.score });
    } else if (resultado.matchParcial) {
      parciais.push({ descricao: peca.descricao, melhor_match: resultado.melhorMatch || "", score: resultado.score });
    } else {
      faltando.push({
        descricao: peca.descricao,
        motivo: resultado.melhorMatch ? `Melhor match insuficiente: "${resultado.melhorMatch}" (${resultado.score}%)` : "Sem correspondência nos materiais da execução",
      });
    }
  }

  const aprovado = faltando.length === 0;
  const resumo = aprovado
    ? `✅ ${cobertos.length} peças cobertas${parciais.length > 0 ? `, ${parciais.length} parciais (aviso)` : ""}`
    : `❌ BLOQUEADO — ${faltando.length} peças sem cobertura de ${pecasOrcamento.length} no orçamento`;

  return { aprovado, sem_pecas_orcamento: false, pecas_orcamento: pecasOrcamento, materiais_execucao: materiaisExecucao, itens_cobertos: cobertos, itens_faltando: faltando, itens_parciais: parciais, resumo };
}

// ─── STEP 3: Atualizar situação GC (com vendedor opcional) ───
async function atualizarSituacaoOsGC(
  gcOsId: string, situacaoId: string, gcHeaders: Record<string, string>,
  gcVendedorId?: string | null
): Promise<{ success: boolean; status: number; body: unknown }> {
  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;
  const payload: Record<string, unknown> = { situacao_id: situacaoId };
  if (gcVendedorId) {
    payload.vendedor_id = gcVendedorId;
    payload.funcionario_id = gcVendedorId;
  }
  try {
    const response = await rateLimitedFetch(url, {
      method: "PUT", headers: gcHeaders,
      body: JSON.stringify(payload),
    }, "gc");
    const body = await response.json().catch(() => ({}));
    return { success: response.ok, status: response.status, body };
  } catch (err) {
    return { success: false, status: 0, body: String(err) };
  }
}

// ─── MAIN HANDLER ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!gcAccessToken || !gcSecretToken || !auvoApiKey || !auvoApiToken) {
      return new Response(
        JSON.stringify({ error: "Credenciais não configuradas (GC ou Auvo)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const gcHeaders: Record<string, string> = {
      "access-token": gcAccessToken, "secret-access-token": gcSecretToken, "Content-Type": "application/json",
    };

    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // empty body is OK
    }

    // ─── Auvo Login (v2 — Bearer token) ───
    console.log("[auvo-gc-sync] Fazendo login na API Auvo v2...");
    let auvoBearerToken: string;
    try {
      auvoBearerToken = await auvoLogin(auvoApiKey, auvoApiToken);
      console.log("[auvo-gc-sync] Login Auvo v2 OK");
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Falha no login Auvo: ${(err as Error).message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Action: list_auvo_users ───
    if (body?.action === "list_auvo_users") {
      try {
        const paramFilter = encodeURIComponent(JSON.stringify({}));
        const url = `${AUVO_BASE_URL}/users/?Page=1&PageSize=200&Order=asc&ParamFilter=${paramFilter}`;
        console.log(`[auvo-gc-sync] Fetching users from: ${url}`);
        const response = await fetch(url, { headers: auvoHeaders(auvoBearerToken) });
        const text = await response.text();
        console.log(`[auvo-gc-sync] Users response (${response.status}): ${text.substring(0, 500)}`);
        let data: any = {};
        try { data = JSON.parse(text); } catch { /* empty response */ }
        const users = data?.result?.entityList || data?.result?.Entities || data?.result || [];
        return new Response(JSON.stringify({ users, status: response.status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `Erro ao listar usuários Auvo: ${(err as Error).message}`, users: [] }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const osIdsManual: string[] = body?.os_ids || [];
    const dryRun: boolean = body?.dry_run === true;

    console.log(`[auvo-gc-sync] Iniciando sync. dry_run=${dryRun}`);

    // ─── STEP 0: Carregar mapeamento vendedores ───
    const { data: mapeamentos } = await supabase
      .from("auvo_gc_usuario_map")
      .select("auvo_user_id, gc_vendedor_id, gc_vendedor_nome, auvo_user_nome")
      .eq("ativo", true);

    const mapaVendedores: Record<string, { gc_vendedor_id: string; gc_vendedor_nome: string }> = {};
    for (const m of (mapeamentos || [])) {
      mapaVendedores[String(m.auvo_user_id)] = {
        gc_vendedor_id: String(m.gc_vendedor_id),
        gc_vendedor_nome: m.gc_vendedor_nome,
      };
    }
    console.log(`[auvo-gc-sync] ${Object.keys(mapaVendedores).length} mapeamentos de vendedores carregados`);

    const osCandidatas = await fetchOsComTarefaAuvo(gcHeaders);
    console.log(`[auvo-gc-sync] ${osCandidatas.length} OS com tarefa Auvo encontradas`);

    const logEntries: any[] = [];
    let atualizadas = 0;
    let semPendencia = 0;
    let comPendencia = 0;
    let erros = 0;
    let naoEncontradas = 0;
    let divergenciaPecas = 0;

    for (const os of osCandidatas) {
      if (osIdsManual.length > 0 && !osIdsManual.includes(os.gc_os_id)) continue;

      console.log(`[auvo-gc-sync] Processando OS ${os.gc_os_codigo} → tarefa Auvo ${os.auvo_task_id}`);

      const tarefa = await getAuvoTask(os.auvo_task_id, auvoBearerToken);

      if (!tarefa) {
        naoEncontradas++;
        logEntries.push({ gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id, resultado: "nao_encontrada", detalhe: "Tarefa não encontrada no Auvo", situacao_antes: os.nome_situacao, situacao_depois: null });
        continue;
      }

      const finalizadaSemPendencia = tarefa.finished === true && (!tarefa.pendency || tarefa.pendency.trim() === "");

      if (!finalizadaSemPendencia) {
        comPendencia++;
        logEntries.push({ gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id, resultado: tarefa.finished ? "com_pendencia" : "nao_finalizada", detalhe: `finished=${tarefa.finished} | pendency="${tarefa.pendency}" | taskStatus=${tarefa.taskStatus}`, situacao_antes: os.nome_situacao, situacao_depois: null });
        continue;
      }

      semPendencia++;

      // ─── Validação de peças ───
      const validacaoPecas = await validarPecasOsVsExecucao(
        os.gc_os_id, os.auvo_task_id, tarefa._raw, gcHeaders, auvoBearerToken
      );
      console.log(`[auvo-gc-sync] OS ${os.gc_os_codigo} — validação peças: ${validacaoPecas.resumo}`);

      if (!validacaoPecas.aprovado) {
        divergenciaPecas++;
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "divergencia_pecas", detalhe: validacaoPecas.resumo,
          situacao_antes: os.nome_situacao, situacao_depois: null,
          pecas_orcamento: validacaoPecas.pecas_orcamento,
          materiais_execucao: validacaoPecas.materiais_execucao,
          itens_cobertos: validacaoPecas.itens_cobertos,
          itens_faltando: validacaoPecas.itens_faltando,
          itens_parciais: validacaoPecas.itens_parciais,
        });
        continue;
      }

      // ─── Resolver vendedor ───
      const auvoTecnicoId = String(tarefa._raw?.idUserTo || tarefa._raw?.idUserFrom || "").trim();
      let gcVendedorId: string | null = null;
      let gcVendedorNome: string | null = null;
      let vendedorStatus: "mapeado" | "sem_mapeamento" | "sem_tecnico" = "sem_tecnico";

      if (auvoTecnicoId && auvoTecnicoId !== "0") {
        const vendedorMap = mapaVendedores[auvoTecnicoId];
        if (vendedorMap) {
          gcVendedorId = vendedorMap.gc_vendedor_id;
          gcVendedorNome = vendedorMap.gc_vendedor_nome;
          vendedorStatus = "mapeado";
        } else {
          vendedorStatus = "sem_mapeamento";
          console.warn(`[auvo-gc-sync] Técnico Auvo ID ${auvoTecnicoId} sem mapeamento GC`);
        }
      }

      if (dryRun) {
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "dry_run_ok",
          detalhe: `Seria atualizada para situação 7116099 | Peças: ${validacaoPecas.resumo} | Vendedor: ${gcVendedorNome || vendedorStatus}`,
          situacao_antes: os.nome_situacao, situacao_depois: "EXECUTADO – AG. NEGOCIAÇÃO (7116099)",
          auvo_tecnico_id: auvoTecnicoId || null,
          gc_vendedor_id: gcVendedorId, gc_vendedor_nome: gcVendedorNome, vendedor_status: vendedorStatus,
        });
        continue;
      }

      const gcResult = await atualizarSituacaoOsGC(os.gc_os_id, "7116099", gcHeaders, gcVendedorId);

      if (gcResult.success) {
        atualizadas++;
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "atualizada",
          detalhe: `HTTP ${gcResult.status} — situação 7116099 | Vendedor: ${gcVendedorNome || vendedorStatus} | Peças: ${validacaoPecas.resumo}`,
          situacao_antes: os.nome_situacao, situacao_depois: "EXECUTADO – AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
          auvo_tecnico_id: auvoTecnicoId || null,
          gc_vendedor_id: gcVendedorId, gc_vendedor_nome: gcVendedorNome, vendedor_status: vendedorStatus,
        });
      } else {
        erros++;
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "erro_gc", detalhe: `HTTP ${gcResult.status} — ${JSON.stringify(gcResult.body)}`,
          situacao_antes: os.nome_situacao, situacao_depois: null,
          auvo_tecnico_id: auvoTecnicoId || null, vendedor_status: vendedorStatus,
        });
      }
    }

    const duracao = Date.now() - startTime;

    await supabase.from("auvo_gc_sync_log").insert({
      executado_em: new Date().toISOString(),
      os_candidatas: osCandidatas.length,
      os_atualizadas: atualizadas,
      os_com_pendencia: comPendencia,
      os_sem_pendencia: semPendencia,
      os_nao_encontradas: naoEncontradas,
      os_divergencia_pecas: divergenciaPecas,
      erros, dry_run: dryRun, duracao_ms: duracao, detalhes: logEntries,
    });

    const summary = { atualizadas, comPendencia, semPendencia, naoEncontradas, divergenciaPecas, erros, osCandidatas: osCandidatas.length, dryRun, duracao_ms: duracao };
    console.log("[auvo-gc-sync] Concluído:", summary);

    return new Response(JSON.stringify({ success: true, ...summary, log: logEntries }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[auvo-gc-sync] Erro fatal:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
