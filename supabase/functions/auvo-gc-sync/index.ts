import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const MIN_DELAY_MS = 200; // reduzido para processar mais OS (Auvo permite 400 req/min)
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
  "7116099", // EXECUTADO - AG. NEGOCIAÇÃO (destino)
  "7124107", // EXECUTADO COM NOTA EMITIDA
  "8760417", // LIBERADO P/ FATURAMENTO
  "7063724", // AGUARDANDO PAGAMENTO
  "7261986", // EXECUTADO POR CONTRATO
  "7438044", // EXECUTADO EM GARANTIA
  "7535001", // EXECUTADO - PATRIMÔNIO
  "7720756", // FINANCEIRO SEPARADO
  "8677491", // CIGAM
  "8889036", // FECHADO CHAMADO
];

const MAX_OS_POR_EXECUCAO = 500; // coleta do GC (rápida, sem Auvo)
const MAX_AUVO_CHECKS = 150; // limite de consultas ao Auvo por execução

// ─── WHITELIST de situações permitidas para alteração ───
const SITUACOES_PERMITIDAS = [
  "7063579", "7063580", "7659440", "7063581", "7063705",
  "7213493", "7684665", "7748831", "8219136",
  "7116099", // destino padrão da sync (EXECUTADO - AG. NEGOCIAÇÃO)
  "8889036", // FECHADO CHAMADO
  "8896431", // TRANSITÓRIA (permite editar vendedor, financeiro, etc.)
];

function validarSituacaoPermitida(situacaoId: string): boolean {
  return SITUACOES_PERMITIDAS.includes(situacaoId);
}

function parseCurrency(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const raw = value.trim();
  if (!raw) return 0;

  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  let normalized = raw;

  if (hasDot && hasComma) {
    // Ex.: 1.234,56
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Ex.: 123,45
    normalized = raw.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumWrappedItems(items: unknown, wrapperKey: "servico" | "produto"): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => {
    const wrapped = (item && typeof item === "object")
      ? ((item as Record<string, unknown>)[wrapperKey] ?? item)
      : item;

    if (!wrapped || typeof wrapped !== "object") return acc;

    const data = wrapped as Record<string, unknown>;
    const valorTotal = parseCurrency(data.valor_total);
    if (valorTotal > 0) return acc + valorTotal;

    const qtd = parseCurrency(data.quantidade || 1);
    const venda = parseCurrency(data.valor_venda);
    const desconto = parseCurrency(data.desconto_valor);
    return acc + Math.max(0, (qtd * venda) - desconto);
  }, 0);
}

function formatCurrency(value: number): string {
  return Math.max(0, value).toFixed(2);
}

// ─── STEP 1: Buscar OS com tarefa Auvo ───
async function fetchOsComTarefaAuvo(gcHeaders: Record<string, string>, dataInicio?: string, dataFim?: string): Promise<Array<{
  gc_os_id: string;
  gc_os_codigo: string;
  auvo_task_id: string;
  nome_situacao: string;
  situacao_id: string;
  data_os: string;
  gc_cliente: string;
}>> {
  const atributoId = Deno.env.get("GC_ATRIBUTO_TAREFA_ID") || "73344";
  const atributoLabel = (Deno.env.get("AUVO_ATRIBUTO_LABEL") || "Tarefa Execução").toLowerCase();
  const results: Array<{
    gc_os_id: string; gc_os_codigo: string; auvo_task_id: string;
    nome_situacao: string; situacao_id: string; data_os: string; gc_cliente: string; gc_valor_total: string;
  }> = [];

  // Acumuladores totais
  let totalExcluidas = 0;
  let totalSemAtributo = 0;
  let totalSemValor = 0;
  let totalProcessadas = 0;

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && results.length < MAX_OS_POR_EXECUCAO) {
    let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    if (dataInicio) url += `&data_inicio=${dataInicio}`;
    if (dataFim) url += `&data_fim=${dataFim}`;

    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");

    if (response.status === 429) {
      console.warn("[auvo-gc-sync] GC rate limit — aguardando 3s...");
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    if (!response.ok) { console.error(`[auvo-gc-sync] GC OS list error: ${response.status}`); break; }

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;
    console.log(`[auvo-gc-sync] Página ${page}/${totalPages}: ${records.length} OS`);

    for (const os of records) {
      if (results.length >= MAX_OS_POR_EXECUCAO) break;
      totalProcessadas++;
      // Log keys da primeira OS para diagnóstico de campos
      if (totalProcessadas === 1) {
        console.log(`[auvo-gc-sync] OS sample keys: ${Object.keys(os).join(", ")}`);
        console.log(`[auvo-gc-sync] OS sample data fields: data=${os.data}, data_cadastro=${os.data_cadastro}, data_criacao=${os.data_criacao}, created_at=${os.created_at}, data_abertura=${os.data_abertura}`);
      }
      const situacaoId = String(os.situacao_id || "");
      if (SITUACOES_EXCLUIR.includes(situacaoId)) { totalExcluidas++; continue; }

      const atributos: any[] = os.atributos || [];
      const atributoTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        const id = String(nested.atributo_id || nested.id || "");
        const label = String(nested.descricao || nested.label || nested.nome || "").toLowerCase();
        return id === atributoId || label === atributoLabel || label.includes("tarefa execu");
      });
      if (!atributoTarefa) { totalSemAtributo++; continue; }
      const nested2 = atributoTarefa?.atributo || atributoTarefa;
      const valor = String(nested2?.conteudo || nested2?.valor || "").trim();
      if (!valor || !/^\d+$/.test(valor)) { totalSemValor++; continue; }

      results.push({
        gc_os_id: String(os.id),
        gc_os_codigo: String(os.codigo || os.id),
        auvo_task_id: valor,
        nome_situacao: String(os.nome_situacao || ""),
        situacao_id: situacaoId,
        data_os: String(os.data_entrada || os.cadastrado_em || ""),
        gc_cliente: String(os.nome_cliente || ""),
        gc_valor_total: String(os.valor_total || "0"),
      });
    }
    console.log(`[auvo-gc-sync] Página ${page}: totalExcluídas=${totalExcluidas}, totalSemAtributo=${totalSemAtributo}, totalSemValor=${totalSemValor}, candidatas=${results.length}`);
    page++;
  }

  console.log(`[auvo-gc-sync] FUNIL GC: processadas=${totalProcessadas} | excluídas=${totalExcluidas} | semAtributo=${totalSemAtributo} | semValor=${totalSemValor} | candidatas=${results.length}${results.length >= MAX_OS_POR_EXECUCAO ? " (LIMITE ATINGIDO)" : ""}`);
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
    const osObj = data?.data?.data ?? data?.data ?? data;
    // GC wraps products as { produto: { nome_produto, quantidade, ... } }
    const produtosRaw: any[] = osObj?.produtos || [];
    const result = produtosRaw
      .map((p: any) => {
        const inner = p?.produto || p;
        const desc = String(inner.nome_produto || inner.descricao || inner.nome || inner.produto || "").trim();
        const qty = parseFloat(String(inner.quantidade || inner.qtd || "0"));
        const codigo = String(inner.produto_id || inner.codigo || inner.id || "");
        return { descricao: desc, quantidade: qty, codigo };
      })
      .filter(p => p.descricao.length > 0 && p.quantidade > 0);
    console.log(`[auvo-gc-sync] OS ${gcOsId}: ${result.length} produtos encontrados no GC: ${result.map(p => `${p.quantidade}x ${p.descricao}`).join(", ")}`);
    return result;
  } catch (err) {
    console.error(`[auvo-gc-sync] Erro ao buscar itens GC OS ${gcOsId}:`, err);
    return [];
  }
}

// ─── STEP 2.2: Parsear texto livre de peças (multi-linha) ───
// Formato: "01 placa controladora cód (16020427)\n02 sensor digital..."
function parsePecasTextoLivre(texto: string): Array<{ descricao: string; quantidade: number }> {
  const linhas = texto.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const resultado: Array<{ descricao: string; quantidade: number }> = [];

  for (const linha of linhas) {
    const match = linha.match(/^(\d+)\s+(.+)/);
    if (match) {
      resultado.push({
        quantidade: parseInt(match[1], 10) || 1,
        descricao: match[2].trim(),
      });
    } else {
      resultado.push({ descricao: linha, quantidade: 1 });
    }
  }

  return resultado;
}

// ─── STEP 2.2b: Buscar materiais Auvo (v2) ───
async function fetchMateriaisAuvoTask(
  taskId: string, bearerToken: string, tarefaRaw?: any
): Promise<Array<{ descricao: string; quantidade: number }>> {
  const materiais: Array<{ descricao: string; quantidade: number }> = [];

  if (tarefaRaw) {
    // 1. Campo products da API (geralmente vazio)
    const produtosNaTarefa: any[] = tarefaRaw?.products || tarefaRaw?.materials || tarefaRaw?.materiais || tarefaRaw?.itens || [];
    for (const p of produtosNaTarefa) {
      const desc = String(p.description || p.descricao || p.name || p.nome || "").trim();
      const qty = parseFloat(String(p.quantity || p.quantidade || p.qtd || "1"));
      if (desc) materiais.push({ descricao: desc, quantidade: qty });
    }

    // 2. Questionários — parsear campos de peças como texto livre multi-linha
    const questionnaires: any[] = tarefaRaw?.questionnaires || [];
    const CAMPOS_PECAS = ["peças necessárias", "pecas necessarias", "peças trocadas", "pecas trocadas",
      "peças utilizadas", "pecas utilizadas", "materiais utilizados", "material utilizado"];

    for (const q of questionnaires) {
      for (const answer of (q.answers || [])) {
        const qDesc = String(answer.questionDescription || "").toLowerCase().trim();
        const replyText = String(answer.reply || "").trim();
        // Ignora respostas vazias ou URLs (fotos)
        if (!replyText || replyText.startsWith("http://") || replyText.startsWith("https://")) continue;

        const ehCampoPecas = CAMPOS_PECAS.some(cp => qDesc.includes(cp)) ||
          ((qDesc.includes("peça") || qDesc.includes("peca")) && !qDesc.includes("foto"));

        if (ehCampoPecas) {
          const pecasParsed = parsePecasTextoLivre(replyText);
          console.log(`[auvo-gc-sync] Task ${taskId} — campo "${answer.questionDescription}": ${pecasParsed.length} peças parseadas de texto livre`);
          for (const p of pecasParsed) {
            console.log(`[auvo-gc-sync]   → ${p.quantidade}x ${p.descricao}`);
          }
          materiais.push(...pecasParsed);
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
): { coberto: boolean; matchParcial: boolean; melhorMatch: string | null; score: number; qtdOrcamento: number; qtdExecucao: number; qtdOk: boolean } {
  const tokensOrc = tokenizar(itemOrcamento.descricao);
  if (tokensOrc.length === 0) return { coberto: true, matchParcial: false, melhorMatch: null, score: 1, qtdOrcamento: itemOrcamento.quantidade, qtdExecucao: itemOrcamento.quantidade, qtdOk: true };

  let melhorScore = 0;
  let melhorMatch: string | null = null;
  let melhorQtdExec = 0;

  for (const mat of materiaisExecucao) {
    const tokensExec = tokenizar(mat.descricao);
    const tokensExecSet = new Set(tokensExec);
    const matchCount = tokensOrc.filter(t => {
      if (tokensExecSet.has(t)) return true;
      for (const te of tokensExec) { if (te.includes(t) || t.includes(te)) return true; }
      return false;
    }).length;
    const score = matchCount / tokensOrc.length;
    if (score > melhorScore) { melhorScore = score; melhorMatch = mat.descricao; melhorQtdExec = mat.quantidade; }
  }

  const qtdOk = melhorScore >= thresholdCompleto ? melhorQtdExec >= itemOrcamento.quantidade : false;

  return {
    coberto: melhorScore >= thresholdCompleto && qtdOk,
    matchParcial: (melhorScore >= thresholdParcial && melhorScore < thresholdCompleto) || (melhorScore >= thresholdCompleto && !qtdOk),
    melhorMatch,
    score: Math.round(melhorScore * 100),
    qtdOrcamento: itemOrcamento.quantidade,
    qtdExecucao: melhorQtdExec,
    qtdOk,
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
      cobertos.push({ descricao: peca.descricao, match: resultado.melhorMatch || "", score: resultado.score, qtd_orc: resultado.qtdOrcamento, qtd_exec: resultado.qtdExecucao });
    } else if (resultado.matchParcial) {
      const motivo = resultado.score >= (THRESHOLD_COMPLETO * 100) && !resultado.qtdOk
        ? `Quantidade divergente: orçamento=${resultado.qtdOrcamento}, execução=${resultado.qtdExecucao}`
        : `Match parcial (${resultado.score}%)`;
      parciais.push({ descricao: peca.descricao, melhor_match: resultado.melhorMatch || "", score: resultado.score, qtd_orc: resultado.qtdOrcamento, qtd_exec: resultado.qtdExecucao, motivo });
    } else {
      faltando.push({
        descricao: peca.descricao,
        motivo: resultado.melhorMatch ? `Melhor match insuficiente: "${resultado.melhorMatch}" (${resultado.score}%)` : "Sem correspondência nos materiais da execução",
      });
    }
  }

  // Aprovado SOMENTE se todas as peças foram 100% cobertas (sem parciais e sem faltando)
  const aprovado = faltando.length === 0 && parciais.length === 0 && cobertos.length > 0;
  const resumo = aprovado
    ? `✅ ${cobertos.length}/${pecasOrcamento.length} peças cobertas`
    : faltando.length > 0
      ? `❌ BLOQUEADO — ${faltando.length} peças sem cobertura de ${pecasOrcamento.length} no orçamento`
      : `⚠️ ${cobertos.length} cobertas, ${parciais.length} parciais — necessita revisão`;

  return { aprovado, sem_pecas_orcamento: false, pecas_orcamento: pecasOrcamento, materiais_execucao: materiaisExecucao, itens_cobertos: cobertos, itens_faltando: faltando, itens_parciais: parciais, resumo };
}

// ─── Situação transitória que permite editar vendedor, financeiro, etc. ───
const SITUACAO_TRANSITORIA = "8896431";

// ─── STEP 3: Atualizar situação GC preservando OS completa + vendedor mapeado ───
// Fluxo: situação atual → transitória (edita vendedor/dados) → situação destino
type AtualizarSituacaoOptions = {
  vendedorId?: string | null;
  vendedorNome?: string | null;
  dataSaida?: string | null; // Data de saída da OS (formato yyyy-MM-dd), preenchida com data de execução da tarefa Auvo
};

async function executarPutOs(
  gcOsId: string,
  payload: Record<string, unknown>,
  gcHeaders: Record<string, string>,
  label: string,
): Promise<{ success: boolean; status: number; body: unknown }> {
  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;

  // Campos de leitura que podem causar rejeição/efeito colateral no PUT
  const camposRemover = ["id", "codigo", "nome_situacao", "cor_situacao", "hash", "cadastrado_em", "modificado_em"];
  for (const campo of camposRemover) delete payload[campo];

  // data_saida: se fornecida via options, usar; caso contrário manter vazio
  // NÃO sobrescrever aqui — será definida em atualizarSituacaoOsGC

  // Recalcula totais a partir dos itens para evitar valor_total zerado
  const totalServicos = sumWrappedItems(payload.servicos, "servico");
  const totalProdutos = sumWrappedItems(payload.produtos, "produto");
  const desconto = parseCurrency(payload.desconto_valor);
  const frete = parseCurrency(payload.valor_frete);
  const totalCalculado = totalServicos + totalProdutos + frete - desconto;

  if (totalServicos > 0 || totalProdutos > 0 || totalCalculado > 0) {
    payload.valor_servicos = formatCurrency(totalServicos);
    payload.valor_produtos = formatCurrency(totalProdutos);
    payload.valor_total = formatCurrency(totalCalculado);
    payload.valor = formatCurrency(totalCalculado);

    // Ajustar parcelas para bater com o valor_total (evita erro de R$ 0,01)
    const parcelas = payload.parcelas;
    if (Array.isArray(parcelas) && parcelas.length > 0) {
      const totalParcelasAtual = parcelas.reduce((sum: number, p: any) => {
        const wrapped = p?.parcela || p;
        return sum + parseCurrency(wrapped?.valor || wrapped?.valor_parcela || 0);
      }, 0);
      const diff = totalCalculado - totalParcelasAtual;
      // Only fix small rounding diffs (< R$ 1.00)
      if (Math.abs(diff) > 0.001 && Math.abs(diff) < 1.0) {
        // Adjust the last parcela
        const lastParcela = parcelas[parcelas.length - 1];
        const wrapped = lastParcela?.parcela || lastParcela;
        const currentVal = parseCurrency(wrapped?.valor || wrapped?.valor_parcela || 0);
        const newVal = currentVal + diff;
        if (wrapped?.valor !== undefined) wrapped.valor = formatCurrency(newVal);
        if (wrapped?.valor_parcela !== undefined) wrapped.valor_parcela = formatCurrency(newVal);
        // If neither key existed, set valor
        if (wrapped?.valor === undefined && wrapped?.valor_parcela === undefined) {
          wrapped.valor = formatCurrency(newVal);
        }
        console.log(`[auvo-gc-sync] Ajuste de parcela: diff=${diff.toFixed(4)}, última parcela ${formatCurrency(currentVal)} → ${formatCurrency(newVal)}`);
      }
    }
  }

  console.log(
    `[auvo-gc-sync] ${label} OS ${gcOsId}: situacao_id=${String(payload.situacao_id)}, vendedor_id=${String(payload.vendedor_id || "N/A")}, nome_vendedor=${String(payload.nome_vendedor || "N/A")}, valor_total=${String(payload.valor_total || "N/A")}`,
  );

  const response = await rateLimitedFetch(url, {
    method: "PUT",
    headers: gcHeaders,
    body: JSON.stringify(payload),
  }, "gc");

  const body = await response.json().catch(() => ({}));
  return { success: response.ok, status: response.status, body };
}

async function buscarOsAtual(gcOsId: string, gcHeaders: Record<string, string>): Promise<Record<string, unknown> | null> {
  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;
  const getResp = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
  if (!getResp.ok) {
    console.error(`[auvo-gc-sync] Erro ao buscar OS ${gcOsId}: HTTP ${getResp.status}`);
    return null;
  }
  const getData = await getResp.json();
  const osAtual = getData?.data ?? getData;
  if (!osAtual || typeof osAtual !== "object") return null;
  return osAtual as Record<string, unknown>;
}

async function atualizarSituacaoOsGC(
  gcOsId: string,
  situacaoId: string,
  gcHeaders: Record<string, string>,
  options: AtualizarSituacaoOptions = {},
): Promise<{ success: boolean; status: number; body: unknown }> {
  if (!validarSituacaoPermitida(situacaoId)) {
    console.error(`[BLOQUEADO] Tentativa de alterar OS ${gcOsId} para situação ${situacaoId} que NÃO está na whitelist!`);
    return { success: false, status: 403, body: `Situação ${situacaoId} bloqueada pela whitelist` };
  }

  try {
    // ── STEP A: Buscar OS atual ──
    const osAtual = await buscarOsAtual(gcOsId, gcHeaders);
    if (!osAtual) {
      return { success: false, status: 500, body: "Não foi possível buscar OS atual" };
    }

    // ── STEP B: Mover para situação TRANSITÓRIA (permite editar vendedor, financeiro) ──
    const payloadTransitorio: Record<string, unknown> = {
      ...osAtual,
      situacao_id: SITUACAO_TRANSITORIA,
    };

    // Aplicar vendedor mapeado já na etapa transitória
    if (options.vendedorId) {
      payloadTransitorio.vendedor_id = options.vendedorId;
      if (options.vendedorNome) payloadTransitorio.nome_vendedor = options.vendedorNome;
    }

    // Aplicar data de saída (data de execução da tarefa Auvo)
    if (options.dataSaida) {
      payloadTransitorio.data_saida = options.dataSaida;
    }

    const transitResult = await executarPutOs(gcOsId, { ...payloadTransitorio }, gcHeaders, "TRANSITÓRIA");
    if (!transitResult.success) {
      console.error(`[auvo-gc-sync] Falha ao mover OS ${gcOsId} para transitória: HTTP ${transitResult.status}`);
      return { success: false, status: transitResult.status, body: `Falha na etapa transitória: ${JSON.stringify(transitResult.body)}` };
    }

    console.log(`[auvo-gc-sync] OS ${gcOsId} → transitória ${SITUACAO_TRANSITORIA} OK`);

    // ── STEP C: Buscar OS novamente (agora na transitória, com vendedor atualizado) e mover para destino final ──
    const osTransitoria = await buscarOsAtual(gcOsId, gcHeaders);
    if (!osTransitoria) {
      return { success: false, status: 500, body: "Não foi possível buscar OS após etapa transitória" };
    }

    const payloadFinal: Record<string, unknown> = {
      ...osTransitoria,
      situacao_id: situacaoId,
    };

    // Garantir vendedor no payload final também
    if (options.vendedorId) {
      payloadFinal.vendedor_id = options.vendedorId;
      if (options.vendedorNome) payloadFinal.nome_vendedor = options.vendedorNome;
    }

    // Garantir data de saída no payload final também
    if (options.dataSaida) {
      payloadFinal.data_saida = options.dataSaida;
    }

    const finalResult = await executarPutOs(gcOsId, payloadFinal, gcHeaders, "FINAL");

    if (finalResult.success) {
      console.log(`[auvo-gc-sync] OS ${gcOsId} → destino ${situacaoId} OK`);
    } else {
      console.error(`[auvo-gc-sync] Falha ao mover OS ${gcOsId} para destino ${situacaoId}: HTTP ${finalResult.status}`);
    }

    return finalResult;
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

    // ─── Actions that only need GC (no Auvo login required) ───
    
    // ─── Action: batch_scan — listar OS na situação 7116099 modificadas após uma data ───
    if (body?.action === "batch_scan") {
      const modificadoApos = body.modificado_apos || "2026-03-11 17:46:00";
      console.log(`[auvo-gc-sync] BATCH_SCAN: buscando OS em situação 7116099 modificadas após ${modificadoApos}`);
      
      const todasOs: Array<{ id: string; codigo: string; modificado_em: string; nome_situacao: string }> = [];
      let page = 1;
      let totalPages = 1;
      
      while (page <= totalPages) {
        const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}&situacao_id=7116099`;
        const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
        if (!response.ok) break;
        const data = await response.json();
        const records: any[] = Array.isArray(data?.data) ? data.data : [];
        totalPages = data?.meta?.total_paginas || 1;
        
        for (const os of records) {
          const modEm = String(os.modificado_em || "");
          if (modEm >= modificadoApos) {
            todasOs.push({
              id: String(os.id),
              codigo: String(os.codigo || os.id),
              modificado_em: modEm,
              nome_situacao: String(os.nome_situacao || ""),
            });
          }
        }
        page++;
      }
      
      console.log(`[auvo-gc-sync] BATCH_SCAN: ${todasOs.length} OS encontradas modificadas após ${modificadoApos}`);
      return new Response(JSON.stringify({ 
        total: todasOs.length, 
        modificado_apos: modificadoApos,
        os_list: todasOs 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Action: batch_revert — reverter OS em lote para uma situação específica ───
    if (body?.action === "batch_revert") {
      const osList: Array<{ id: string; codigo: string; situacao_destino_id: string }> = body.os_list || [];
      const dryRunRevert: boolean = body.dry_run === true;
      
      if (!osList.length) {
        return new Response(JSON.stringify({ error: "os_list é obrigatório (array de {id, codigo, situacao_destino_id})" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log(`[auvo-gc-sync] BATCH_REVERT: ${osList.length} OS para reverter. dry_run=${dryRunRevert}`);
      
      const results: any[] = [];
      let revertidas = 0;
      let errosRevert = 0;
      
      for (const os of osList) {
        if (!validarSituacaoPermitida(os.situacao_destino_id)) {
          errosRevert++;
          results.push({ gc_os_id: os.id, gc_os_codigo: os.codigo, resultado: "bloqueado", detalhe: `Situação ${os.situacao_destino_id} NÃO está na whitelist de situações permitidas` });
          continue;
        }
        if (dryRunRevert) {
          results.push({ gc_os_id: os.id, gc_os_codigo: os.codigo, resultado: "dry_run_ok", detalhe: `Seria revertida para situação ${os.situacao_destino_id}` });
          revertidas++;
          continue;
        }
        
        const vendedorOpts = os.gc_vendedor_id ? { vendedorId: String(os.gc_vendedor_id), vendedorNome: os.gc_vendedor_nome ? String(os.gc_vendedor_nome) : null } : {};
        const result = await atualizarSituacaoOsGC(os.id, os.situacao_destino_id, gcHeaders, vendedorOpts);
        if (result.success) {
          revertidas++;
          results.push({ gc_os_id: os.id, gc_os_codigo: os.codigo, resultado: "revertida", detalhe: `HTTP ${result.status} → situação ${os.situacao_destino_id}` });
        } else {
          errosRevert++;
          results.push({ gc_os_id: os.id, gc_os_codigo: os.codigo, resultado: "erro_gc", detalhe: `HTTP ${result.status} — ${JSON.stringify(result.body)}` });
        }
      }
      
      // Log the batch revert
      await supabase.from("auvo_gc_sync_log").insert({
        executado_em: new Date().toISOString(),
        os_candidatas: osList.length,
        os_atualizadas: revertidas,
        erros: errosRevert,
        dry_run: dryRunRevert,
        duracao_ms: Date.now() - startTime,
        observacao: `REVERSÃO EM LOTE: ${osList.length} OS${dryRunRevert ? " (simulação)" : ""}`,
        detalhes: results,
      });
      
      return new Response(JSON.stringify({ 
        success: true, 
        total: osList.length, 
        revertidas, 
        erros: errosRevert,
        dry_run: dryRunRevert,
        results 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Action: revert_os — reverter OS individual ───
    if (body?.action === "revert_os") {
      const gcOsId = String(body.gc_os_id || "");
      const situacaoAnteriorId = String(body.situacao_id_antes || "");
      const gcOsCodigo = String(body.gc_os_codigo || "");
      const vendedorId = body.gc_vendedor_id ? String(body.gc_vendedor_id) : null;
      const vendedorNome = body.gc_vendedor_nome ? String(body.gc_vendedor_nome) : null;
      const dataSaida = body.data_saida ? String(body.data_saida) : null;
      if (!gcOsId || !situacaoAnteriorId) {
        return new Response(JSON.stringify({ error: "gc_os_id e situacao_id_antes são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!validarSituacaoPermitida(situacaoAnteriorId)) {
        return new Response(JSON.stringify({ error: `Situação ${situacaoAnteriorId} NÃO está na whitelist de situações permitidas. Permitidas: ${SITUACOES_PERMITIDAS.join(", ")}` }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`[auvo-gc-sync] REVERT: OS ${gcOsCodigo} (${gcOsId}) → situação ${situacaoAnteriorId} | vendedor: ${vendedorNome || "N/A"} (${vendedorId || "N/A"}) | data_saida: ${dataSaida || "N/A"}`);
      const revertResult = await atualizarSituacaoOsGC(gcOsId, situacaoAnteriorId, gcHeaders, { vendedorId, vendedorNome, dataSaida });
      
      await supabase.from("auvo_gc_sync_log").insert({
        executado_em: new Date().toISOString(),
        os_candidatas: 1,
        os_atualizadas: revertResult.success ? 1 : 0,
        erros: revertResult.success ? 0 : 1,
        dry_run: false,
        duracao_ms: Date.now() - startTime,
        observacao: `REVERSÃO manual: OS ${gcOsCodigo}`,
        detalhes: [{
          gc_os_id: gcOsId, gc_os_codigo: gcOsCodigo, auvo_task_id: "",
          resultado: revertResult.success ? "revertida" : "erro_gc",
          detalhe: revertResult.success 
            ? `Revertida para situação ${situacaoAnteriorId} | HTTP ${revertResult.status}`
            : `Erro ao reverter: HTTP ${revertResult.status} — ${JSON.stringify(revertResult.body)}`,
          situacao_antes: "EXECUTADO – AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
          situacao_depois: revertResult.success ? `Revertida (${situacaoAnteriorId})` : null,
          situacao_id_antes: "7116099",
          situacao_id_depois: revertResult.success ? situacaoAnteriorId : null,
        }],
      });

      return new Response(JSON.stringify({ 
        success: revertResult.success, gc_os_id: gcOsId, gc_os_codigo: gcOsCodigo,
        status: revertResult.status, body: revertResult.body,
      }), {
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Action: get_last_conciliacao — carregar último snapshot salvo ───
    if (body?.action === "get_last_conciliacao") {
      const { data: lastRows, error: lastError } = await supabase
        .from("auvo_gc_sync_log")
        .select("executado_em, detalhes")
        .eq("observacao", "CONCILIACAO_SNAPSHOT")
        .order("executado_em", { ascending: false })
        .limit(1);

      if (lastError) {
        return new Response(JSON.stringify({ error: `Erro ao carregar conciliação salva: ${lastError.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const last = lastRows?.[0];
      const detalhes = last?.detalhes as any;
      const itens = Array.isArray(detalhes?.itens)
        ? detalhes.itens
        : (Array.isArray(detalhes) ? detalhes : []);

      return new Response(JSON.stringify({
        total: itens.length,
        conciliadas: itens.filter((i: any) => i.conciliada).length,
        pendentes: itens.filter((i: any) => !i.conciliada).length,
        itens,
        snapshot_em: last?.executado_em || null,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // ─── Action: validate_pecas — validar peças de uma OS individual ───
    if (body?.action === "validate_pecas") {
      const gcOsId = String(body.gc_os_id || "");
      const auvoTaskId = String(body.auvo_task_id || "");
      if (!gcOsId || !auvoTaskId) {
        return new Response(JSON.stringify({ error: "gc_os_id e auvo_task_id são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        // Buscar tarefa Auvo para ter o raw com questionários
        const tarefaUrl = `${AUVO_BASE_URL}/tasks/${auvoTaskId}`;
        const tarefaResp = await rateLimitedFetch(tarefaUrl, { headers: auvoHeaders(auvoBearerToken) }, "auvo");
        let tarefaRaw: any = null;
        if (tarefaResp.ok) {
          const tarefaData = await tarefaResp.json();
          tarefaRaw = tarefaData?.result ?? tarefaData;
        } else {
          await tarefaResp.text(); // consume body
        }

        const resultado = await validarPecasOsVsExecucao(gcOsId, auvoTaskId, tarefaRaw, gcHeaders, auvoBearerToken);
        return new Response(JSON.stringify(resultado), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body?.action === "debug_task") {
      const taskId = String(body.task_id || "");
      if (!taskId) {
        return new Response(JSON.stringify({ error: "task_id obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const url = `${AUVO_BASE_URL}/tasks/${taskId}`;
        const response = await rateLimitedFetch(url, { headers: auvoHeaders(auvoBearerToken) }, "auvo");
        const rawText = await response.text();
        let parsed: any = null;
        try { parsed = JSON.parse(rawText); } catch {}
        const entity = parsed?.result ?? parsed;

        const questionnaires = entity?.questionnaires || entity?.questionnaireAnswers || [];
        const products = entity?.products || entity?.materials || entity?.materiais || entity?.itens || [];
        
        console.log(`[debug_task] Task ${taskId} — keys: ${Object.keys(entity || {}).join(", ")}`);
        console.log(`[debug_task] questionnaires (${questionnaires.length}):`, JSON.stringify(questionnaires).substring(0, 3000));
        console.log(`[debug_task] products (${products.length}):`, JSON.stringify(products).substring(0, 1000));

        return new Response(JSON.stringify({
          task_id: taskId,
          http_status: response.status,
          entity_keys: Object.keys(entity || {}),
          questionnaires,
          products,
          raw_preview: rawText.substring(0, 5000),
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── Action: conciliacao — visão de conciliação bancária ───
    if (body?.action === "conciliacao") {
      const dataInicioConcil: string | undefined = body.data_inicio || undefined;
      const dataFimConcil: string | undefined = body.data_fim || undefined;
      const filtroClienteConcil: string = (body.filtro_cliente || "").trim().toLowerCase();

      console.log(`[conciliacao] Buscando OS para conciliação: data_inicio=${dataInicioConcil || "todas"}, data_fim=${dataFimConcil || "todas"}`);

      // Carregar último snapshot salvo para evitar "zerar" dados já conciliados
      const { data: lastSnapshotRows } = await supabase
        .from("auvo_gc_sync_log")
        .select("detalhes")
        .eq("observacao", "CONCILIACAO_SNAPSHOT")
        .order("executado_em", { ascending: false })
        .limit(1);

      const lastDetalhes = lastSnapshotRows?.[0]?.detalhes as any;
      const itensAnteriores: any[] = Array.isArray(lastDetalhes?.itens)
        ? lastDetalhes.itens
        : (Array.isArray(lastDetalhes) ? lastDetalhes : []);
      const mapaAnterior: Record<string, any> = {};
      for (const item of itensAnteriores) {
        if (item?.gc_os_id) mapaAnterior[String(item.gc_os_id)] = item;
      }
      console.log(`[conciliacao] Snapshot anterior carregado: ${itensAnteriores.length} itens`);

      // Carregar mapeamento vendedores
      const { data: mapeamentosConcil } = await supabase
        .from("auvo_gc_usuario_map")
        .select("auvo_user_id, gc_vendedor_id, gc_vendedor_nome, auvo_user_nome")
        .eq("ativo", true);
      const mapaVendedoresConcil: Record<string, { gc_vendedor_id: string; gc_vendedor_nome: string }> = {};
      for (const m of (mapeamentosConcil || [])) {
        mapaVendedoresConcil[String(m.auvo_user_id)] = { gc_vendedor_id: String(m.gc_vendedor_id), gc_vendedor_nome: m.gc_vendedor_nome };
      }

      // Buscar TODAS as OS com tarefa Auvo (incluindo situações finais)
      const atributoId = Deno.env.get("GC_ATRIBUTO_TAREFA_ID") || "73344";
      const atributoLabel = (Deno.env.get("AUVO_ATRIBUTO_LABEL") || "Tarefa Execução").toLowerCase();
      const todasOs: Array<{
        gc_os_id: string; gc_os_codigo: string; auvo_task_id: string;
        nome_situacao: string; situacao_id: string; data_os: string; gc_cliente: string; gc_valor_total: string;
      }> = [];

      let pageConcil = 1;
      let totalPagesConcil = 1;
      const maxOsConcilBody = Number(body?.max_os || 0);
      const maxOsConcil = Number.isFinite(maxOsConcilBody) && maxOsConcilBody > 0
        ? maxOsConcilBody
        : Number.POSITIVE_INFINITY;
      console.log(`[conciliacao] Limite de OS aplicado: ${Number.isFinite(maxOsConcil) ? maxOsConcil : "SEM LIMITE"}`);

      while (pageConcil <= totalPagesConcil && todasOs.length < maxOsConcil) {
        let url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${pageConcil}`;
        if (dataInicioConcil) url += `&data_inicio=${dataInicioConcil}`;
        if (dataFimConcil) url += `&data_fim=${dataFimConcil}`;
        const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");
        if (response.status === 429) { await new Promise(r => setTimeout(r, 3000)); continue; }
        if (!response.ok) break;
        const data = await response.json();
        const records: any[] = Array.isArray(data?.data) ? data.data : [];
        totalPagesConcil = data?.meta?.total_paginas || 1;

        for (const os of records) {
          if (todasOs.length >= maxOsConcil) break;
          if (filtroClienteConcil && !String(os.nome_cliente || "").toLowerCase().includes(filtroClienteConcil)) continue;
          const atributos: any[] = os.atributos || [];
          const atributoTarefa = atributos.find((a: any) => {
            const nested = a?.atributo || a;
            const id = String(nested.atributo_id || nested.id || "");
            const label = String(nested.descricao || nested.label || nested.nome || "").toLowerCase();
            return id === atributoId || label === atributoLabel || label.includes("tarefa execu");
          });
          if (!atributoTarefa) continue;
          const nested2 = atributoTarefa?.atributo || atributoTarefa;
          const valor = String(nested2?.conteudo || nested2?.valor || "").trim();
          if (!valor || !/^\d+$/.test(valor)) continue;

          todasOs.push({
            gc_os_id: String(os.id),
            gc_os_codigo: String(os.codigo || os.id),
            auvo_task_id: valor,
            nome_situacao: String(os.nome_situacao || ""),
            situacao_id: String(os.situacao_id || ""),
            data_os: String(os.data_entrada || os.cadastrado_em || ""),
            gc_cliente: String(os.nome_cliente || ""),
            gc_valor_total: String(os.valor_total || "0"),
          });
        }
        pageConcil++;
      }

      console.log(`[conciliacao] ${todasOs.length} OS com tarefa Auvo encontradas`);

      // Buscar dados Auvo para cada OS (com limite)
      const MAX_AUVO = Math.min(todasOs.length, 100);
      const itens: any[] = [];
      let auvoChecksConcil = 0;

      for (const os of todasOs) {
        const conciliada = SITUACOES_EXCLUIR.includes(os.situacao_id);
        const itemAnterior = mapaAnterior[os.gc_os_id];

        // Para OS conciliadas, reaproveita dados anteriores (tempo/técnico) e atualiza só os campos alterados
        if (conciliada) {
          if (itemAnterior && String(itemAnterior.auvo_task_id || "") === os.auvo_task_id) {
            itens.push({
              ...itemAnterior,
              gc_os_id: os.gc_os_id,
              gc_os_codigo: os.gc_os_codigo,
              gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao,
              gc_situacao_id: os.situacao_id,
              data_os: os.data_os,
              auvo_task_id: os.auvo_task_id,
              gc_valor_total: os.gc_valor_total,
              conciliada: true,
            });
          } else {
            itens.push({
              gc_os_id: os.gc_os_id,
              gc_os_codigo: os.gc_os_codigo,
              gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao,
              gc_situacao_id: os.situacao_id,
              data_os: os.data_os,
              auvo_task_id: os.auvo_task_id,
              gc_valor_total: os.gc_valor_total,
              conciliada: true,
              auvo_finalizada: true,
              auvo_pendencia: "",
              auvo_tecnico_nome: "",
              auvo_tecnico_id: "",
              auvo_cliente: "",
              gc_vendedor_id: null,
              gc_vendedor_nome: null,
              vendedor_status: "desconhecido",
              tempo_trabalho_seg: 0,
              tempo_pausa_seg: 0,
              checkin_hora: null,
              checkout_hora: null,
            });
          }
          continue;
        }

        if (auvoChecksConcil >= MAX_AUVO) {
          // Limite de chamadas Auvo: reaproveita snapshot anterior quando existir
          if (itemAnterior && String(itemAnterior.auvo_task_id || "") === os.auvo_task_id) {
            itens.push({
              ...itemAnterior,
              gc_os_id: os.gc_os_id,
              gc_os_codigo: os.gc_os_codigo,
              gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao,
              gc_situacao_id: os.situacao_id,
              data_os: os.data_os,
              auvo_task_id: os.auvo_task_id,
              gc_valor_total: os.gc_valor_total,
              conciliada: false,
            });
          } else {
            itens.push({
              gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao, gc_situacao_id: os.situacao_id, data_os: os.data_os,
              auvo_task_id: os.auvo_task_id, gc_valor_total: os.gc_valor_total, conciliada: false,
              auvo_finalizada: null, auvo_pendencia: null, auvo_tecnico_nome: null, auvo_tecnico_id: null,
              auvo_cliente: null, gc_vendedor_id: null, gc_vendedor_nome: null, vendedor_status: "nao_consultado",
              tempo_trabalho_seg: 0, tempo_pausa_seg: 0, checkin_hora: null, checkout_hora: null,
            });
          }
          continue;
        }

        auvoChecksConcil++;
        const tarefa = await getAuvoTask(os.auvo_task_id, auvoBearerToken);

        if (!tarefa) {
          if (itemAnterior && String(itemAnterior.auvo_task_id || "") === os.auvo_task_id) {
            itens.push({
              ...itemAnterior,
              gc_os_id: os.gc_os_id,
              gc_os_codigo: os.gc_os_codigo,
              gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao,
              gc_situacao_id: os.situacao_id,
              data_os: os.data_os,
              auvo_task_id: os.auvo_task_id,
              gc_valor_total: os.gc_valor_total,
              conciliada: false,
              vendedor_status: "nao_encontrada",
            });
          } else {
            itens.push({
              gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, gc_cliente: os.gc_cliente,
              gc_situacao: os.nome_situacao, gc_situacao_id: os.situacao_id, data_os: os.data_os,
              auvo_task_id: os.auvo_task_id, gc_valor_total: os.gc_valor_total, conciliada: false,
              auvo_finalizada: null, auvo_pendencia: null, auvo_tecnico_nome: null, auvo_tecnico_id: null,
              auvo_cliente: null, gc_vendedor_id: null, gc_vendedor_nome: null, vendedor_status: "nao_encontrada",
              tempo_trabalho_seg: 0, tempo_pausa_seg: 0, checkin_hora: null, checkout_hora: null,
            });
          }
          continue;
        }

        const raw = tarefa._raw || {};
        const auvoTecnicoId = String(raw.idUserTo || raw.idUserFrom || "").trim();
        const auvoTecnicoNome = String(raw.userToName || raw.userFromName || raw.collaboratorName || "").trim();
        const auvoCliente = String(raw.customerName || raw.customer?.name || raw.customerDescription || "").trim();

        // Extrair tempos — campos reais da API Auvo v2
        // duration = string "HH:MM:SS", timeControl = array de pausas
        const checkinHora = raw.checkInDate || null;
        const checkoutHora = raw.checkOutDate || null;

        // Calcular tempo de trabalho a partir de checkIn/checkOut
        let tempoTrabalhoSeg = 0;
        if (checkinHora && checkoutHora) {
          try {
            const diffMs = new Date(checkoutHora).getTime() - new Date(checkinHora).getTime();
            if (diffMs > 0) tempoTrabalhoSeg = Math.floor(diffMs / 1000);
          } catch {}
        }

        // Calcular pausas a partir de timeControl ou reasonForPause
        let tempoPausaSeg = 0;
        const timeControl: any[] = raw.timeControl || [];
        for (const tc of timeControl) {
          const pauseStart = tc.pauseStart || tc.startPause || tc.start;
          const pauseEnd = tc.pauseEnd || tc.endPause || tc.end || tc.resumeDate;
          if (pauseStart && pauseEnd) {
            try {
              const diffMs = new Date(pauseEnd).getTime() - new Date(pauseStart).getTime();
              if (diffMs > 0) tempoPausaSeg += Math.floor(diffMs / 1000);
            } catch {}
          }
          // Auvo pode ter duration em segundos direto
          if (tc.duration && typeof tc.duration === "number") {
            tempoPausaSeg += tc.duration;
          }
        }

        // Se há pausas, descontar do tempo de trabalho
        if (tempoPausaSeg > 0 && tempoTrabalhoSeg > tempoPausaSeg) {
          tempoTrabalhoSeg -= tempoPausaSeg;
        }

        // Fallback: usar campo duration (formato "HH:MM:SS")
        if (tempoTrabalhoSeg === 0 && raw.duration) {
          const dStr = String(raw.duration);
          const dMatch = dStr.match(/^(\d+):(\d+):(\d+)$/);
          if (dMatch) {
            tempoTrabalhoSeg = parseInt(dMatch[1]) * 3600 + parseInt(dMatch[2]) * 60 + parseInt(dMatch[3]);
          }
        }

        // Vendedor
        let gcVendedorId: string | null = null;
        let gcVendedorNome: string | null = null;
        let vendedorStatus: string = "sem_tecnico";
        if (auvoTecnicoId && auvoTecnicoId !== "0") {
          const vendedorMap = mapaVendedoresConcil[auvoTecnicoId];
          if (vendedorMap) {
            gcVendedorId = vendedorMap.gc_vendedor_id;
            gcVendedorNome = vendedorMap.gc_vendedor_nome;
            vendedorStatus = "mapeado";
          } else {
            vendedorStatus = "sem_mapeamento";
          }
        }

        // ─── Validação de peças (automática na conciliação) ───
        let pecasStatus: string = "nao_validado";
        let pecasResumo: string | null = null;
        let pecasAprovado: boolean | null = null;
        let pecasOrcQtd = 0;
        let pecasCobertasQtd = 0;
        let pecasFaltandoQtd = 0;
        let pecasParciaisQtd = 0;
        let pecasDetalhes: any = null;

        if (tarefa.finished) {
          try {
            const validacao = await validarPecasOsVsExecucao(os.gc_os_id, os.auvo_task_id, raw, gcHeaders, auvoBearerToken);
            pecasAprovado = validacao.aprovado;
            pecasResumo = validacao.resumo;
            pecasOrcQtd = validacao.pecas_orcamento.length;
            pecasCobertasQtd = validacao.itens_cobertos.length;
            pecasFaltandoQtd = validacao.itens_faltando.length;
            pecasParciaisQtd = validacao.itens_parciais.length;
            pecasStatus = validacao.sem_pecas_orcamento ? "sem_pecas" : (validacao.aprovado ? "ok" : "divergente");
            pecasDetalhes = {
              itens_cobertos: validacao.itens_cobertos,
              itens_faltando: validacao.itens_faltando,
              itens_parciais: validacao.itens_parciais,
              materiais_execucao: validacao.materiais_execucao,
              pecas_orcamento: validacao.pecas_orcamento,
            };
          } catch (err) {
            console.warn(`[conciliacao] Erro ao validar peças OS ${os.gc_os_codigo}:`, err);
            pecasStatus = "erro";
          }
        }

        itens.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, gc_cliente: os.gc_cliente,
          gc_situacao: os.nome_situacao, gc_situacao_id: os.situacao_id, data_os: os.data_os,
          auvo_task_id: os.auvo_task_id, gc_valor_total: os.gc_valor_total, conciliada: false,
          auvo_finalizada: tarefa.finished, auvo_pendencia: tarefa.pendency,
          auvo_tecnico_nome: auvoTecnicoNome, auvo_tecnico_id: auvoTecnicoId,
          auvo_cliente: auvoCliente,
          gc_vendedor_id: gcVendedorId, gc_vendedor_nome: gcVendedorNome, vendedor_status: vendedorStatus,
          tempo_trabalho_seg: tempoTrabalhoSeg, tempo_pausa_seg: tempoPausaSeg,
          checkin_hora: checkinHora, checkout_hora: checkoutHora,
          pecas_status: pecasStatus, pecas_aprovado: pecasAprovado, pecas_resumo: pecasResumo,
          pecas_orc_qtd: pecasOrcQtd, pecas_cobertas_qtd: pecasCobertasQtd,
          pecas_faltando_qtd: pecasFaltandoQtd, pecas_parciais_qtd: pecasParciaisQtd,
          pecas_detalhes: pecasDetalhes,
        });
      }

      const totalConciliadas = itens.filter(i => i.conciliada).length;
      const totalPendentes = itens.filter(i => !i.conciliada).length;

      // Detectar quantos itens mudaram em relação ao snapshot anterior
      let itensAlterados = 0;
      for (const item of itens) {
        const prev = mapaAnterior[item.gc_os_id];
        if (!prev) {
          itensAlterados++;
          continue;
        }
        const currentCmp = JSON.stringify(item);
        const prevCmp = JSON.stringify(prev);
        if (currentCmp !== prevCmp) itensAlterados++;
      }

      // Persistir snapshot completo da conciliação para manter estado entre execuções
      const snapshotPayload = {
        filtros: {
          data_inicio: dataInicioConcil || null,
          data_fim: dataFimConcil || null,
          filtro_cliente: filtroClienteConcil || null,
          max_os: Number.isFinite(maxOsConcil) ? maxOsConcil : null,
        },
        gerado_em: new Date().toISOString(),
        itens,
      };

      const { error: snapshotError } = await supabase.from("auvo_gc_sync_log").insert({
        executado_em: new Date().toISOString(),
        os_candidatas: itens.length,
        os_atualizadas: itensAlterados,
        os_com_pendencia: itens.filter(i => !!String(i.auvo_pendencia || "").trim()).length,
        os_sem_pendencia: itens.filter(i => i.auvo_finalizada === true && !String(i.auvo_pendencia || "").trim()).length,
        os_nao_encontradas: itens.filter(i => i.vendedor_status === "nao_encontrada").length,
        erros: 0,
        dry_run: true,
        duracao_ms: Date.now() - startTime,
        observacao: "CONCILIACAO_SNAPSHOT",
        detalhes: snapshotPayload,
      });

      if (snapshotError) {
        console.error(`[conciliacao] Erro ao salvar snapshot: ${snapshotError.message}`);
      } else {
        console.log(`[conciliacao] Snapshot salvo: ${itens.length} itens (${itensAlterados} alterados)`);
      }

      console.log(`[conciliacao] Resultado: ${itens.length} itens, ${totalConciliadas} conciliadas, ${totalPendentes} pendentes`);

      return new Response(JSON.stringify({
        total: itens.length,
        conciliadas: totalConciliadas,
        pendentes: totalPendentes,
        alteradas: itensAlterados,
        snapshot_em: snapshotPayload.gerado_em,
        itens,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const osIdsManual: string[] = body?.os_ids || [];
    const dryRun: boolean = body?.dry_run === true;
    const dataInicio: string | undefined = body?.data_inicio || undefined;
    const dataFim: string | undefined = body?.data_fim || undefined;
    const incluirPendencia: boolean = body?.incluir_pendencia === true;
    const filtroCliente: string = (body?.filtro_cliente || "").trim().toLowerCase();

    console.log(`[auvo-gc-sync] Iniciando sync. dry_run=${dryRun}, data_inicio=${dataInicio || "todas"}, data_fim=${dataFim || "todas"}, incluir_pendencia=${incluirPendencia}, filtro_cliente=${filtroCliente || "nenhum"}`);

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

    const osCandidatas = await fetchOsComTarefaAuvo(gcHeaders, dataInicio, dataFim);
    console.log(`[auvo-gc-sync] ${osCandidatas.length} OS com tarefa Auvo encontradas`);

    const logEntries: any[] = [];
    let atualizadas = 0;
    let semPendencia = 0;
    let comPendencia = 0;
    let erros = 0;
    let naoEncontradas = 0;
    let divergenciaPecas = 0;

    const MAX_EXECUTION_TIME_MS = 50000;
    let auvoChecks = 0;

    for (const os of osCandidatas) {
      // Check de tempo e limite de chamadas Auvo
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[auvo-gc-sync] ⚠️ Tempo limite atingido — parando com ${logEntries.length} OS processadas de ${osCandidatas.length} candidatas`);
        break;
      }
      if (auvoChecks >= MAX_AUVO_CHECKS) {
        console.warn(`[auvo-gc-sync] ⚠️ Limite de ${MAX_AUVO_CHECKS} consultas Auvo atingido — parando`);
        break;
      }
      if (osIdsManual.length > 0 && !osIdsManual.includes(os.gc_os_id)) continue;
      // Filtro por cliente (frontend)
      if (filtroCliente && !os.gc_cliente.toLowerCase().includes(filtroCliente)) continue;

      auvoChecks++;
      const tarefa = await getAuvoTask(os.auvo_task_id, auvoBearerToken);

      if (!tarefa) {
        naoEncontradas++;
        logEntries.push({ gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id, resultado: "nao_encontrada", detalhe: "Tarefa não encontrada no Auvo", situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: null, data_os: os.data_os, gc_cliente: os.gc_cliente });
        continue;
      }

      // Extrair técnico e cliente de toda tarefa
      const auvoTecnicoId = String(tarefa._raw?.idUserTo || tarefa._raw?.idUserFrom || "").trim();
      const auvoTecnicoNome = String(tarefa._raw?.userToName || tarefa._raw?.userFromName || tarefa._raw?.collaboratorName || "").trim();
      const auvoCliente = String(tarefa._raw?.customerName || tarefa._raw?.customer?.name || tarefa._raw?.customerDescription || "").trim();

      // ─── FILTRO: só processar tarefas finalizadas (com ou sem pendência) ───
      if (!tarefa.finished) {
        continue;
      }

      const finalizadaSemPendencia = !tarefa.pendency || tarefa.pendency.trim() === "";

      if (!finalizadaSemPendencia && !incluirPendencia) {
        comPendencia++;
        logEntries.push({ gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id, resultado: "com_pendencia", detalhe: `finished=${tarefa.finished} | pendency="${tarefa.pendency}" | taskStatus=${tarefa.taskStatus}`, situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: null, data_os: os.data_os, auvo_tecnico_id: auvoTecnicoId || null, auvo_tecnico_nome: auvoTecnicoNome || null, gc_cliente: os.gc_cliente, auvo_cliente: auvoCliente || null });
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
          situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: null, data_os: os.data_os,
          auvo_tecnico_id: auvoTecnicoId || null, auvo_tecnico_nome: auvoTecnicoNome || null,
          gc_cliente: os.gc_cliente, auvo_cliente: auvoCliente || null,
          pecas_orcamento: validacaoPecas.pecas_orcamento,
          materiais_execucao: validacaoPecas.materiais_execucao,
          itens_cobertos: validacaoPecas.itens_cobertos,
          itens_faltando: validacaoPecas.itens_faltando,
          itens_parciais: validacaoPecas.itens_parciais,
        });
        continue;
      }

      // ─── Resolver vendedor ───
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

      // ─── Extrair data de execução da tarefa (taskDate) para data_saida da OS ───
      // Formato esperado pelo GC: yyyy-MM-dd
      const auvoTaskDate = String(tarefa._raw?.taskDate || tarefa._raw?.checkOutDate || "").split("T")[0] || null;

      if (dryRun) {
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "dry_run_ok",
          detalhe: `Seria atualizada para situação 7116099 | Peças: ${validacaoPecas.resumo} | Vendedor: ${gcVendedorNome || vendedorStatus} | data_saida: ${auvoTaskDate || "N/A"}`,
          situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: "EXECUTADO – AG. NEGOCIAÇÃO (7116099)",
          auvo_tecnico_id: auvoTecnicoId || null, auvo_tecnico_nome: auvoTecnicoNome || null, data_os: os.data_os,
          gc_cliente: os.gc_cliente, auvo_cliente: auvoCliente || null,
          gc_vendedor_id: gcVendedorId, gc_vendedor_nome: gcVendedorNome, vendedor_status: vendedorStatus,
        });
        continue;
      }

      const gcResult = await atualizarSituacaoOsGC(os.gc_os_id, "7116099", gcHeaders, {
        vendedorId: gcVendedorId,
        vendedorNome: gcVendedorNome,
        dataSaida: auvoTaskDate,
      });

      if (gcResult.success) {
        atualizadas++;
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "atualizada",
          detalhe: `HTTP ${gcResult.status} — situação 7116099 | Vendedor: ${gcVendedorNome || vendedorStatus} | Peças: ${validacaoPecas.resumo}`,
          situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: "EXECUTADO – AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
          auvo_tecnico_id: auvoTecnicoId || null, auvo_tecnico_nome: auvoTecnicoNome || null, data_os: os.data_os,
          gc_cliente: os.gc_cliente, auvo_cliente: auvoCliente || null,
          gc_vendedor_id: gcVendedorId, gc_vendedor_nome: gcVendedorNome, vendedor_status: vendedorStatus,
        });
      } else {
        erros++;
        logEntries.push({
          gc_os_id: os.gc_os_id, gc_os_codigo: os.gc_os_codigo, auvo_task_id: os.auvo_task_id,
          resultado: "erro_gc", detalhe: `HTTP ${gcResult.status} — ${JSON.stringify(gcResult.body)}`,
          situacao_antes: os.nome_situacao, situacao_id_antes: os.situacao_id, situacao_depois: null, data_os: os.data_os,
          auvo_tecnico_id: auvoTecnicoId || null, vendedor_status: vendedorStatus,
          gc_cliente: os.gc_cliente, auvo_cliente: auvoCliente || null,
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
