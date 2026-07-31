export type BudgetAiPhotoCategory = "identification" | "defect" | "parts" | "general";

export type BudgetAiPhoto = {
  url: string;
  label: string;
  category: BudgetAiPhotoCategory;
  originalIndex: number;
};

export type BudgetAiReadinessInput = {
  equipment?: string | null;
  equipmentId?: string | null;
  orientation?: string | null;
  parts?: string | null;
  services?: string | null;
  observations?: string | null;
  photos?: BudgetAiPhoto[];
};

export type BudgetAiReadiness = {
  canAnalyze: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
};

export type BudgetAiEvidence = {
  statement: string;
  evidence: string;
  source: string;
};

export type BudgetAiHypothesis = {
  statement: string;
  reason: string;
  confidence: "baixa" | "media" | "alta";
  needs_validation: boolean;
};

export type BudgetAiRecommendation = {
  item: string;
  type: "peca" | "insumo" | "servico" | "verificacao";
  status: "confirmado" | "recomendar" | "verificar";
  reason: string;
  evidence: string;
  source: string;
  confidence: "baixa" | "media" | "alta";
  part_code?: string;
  code_evidence?: string;
  code_confidence?: "baixa" | "media" | "alta";
};

export type BudgetAiStructuredAnalysis = {
  version: string;
  summary: string;
  status: "pode_seguir" | "pode_seguir_com_ressalvas" | "validacao_adicional";
  equipment: {
    name: string;
    manufacturer: string;
    model: string;
    id: string;
    confidence: "baixa" | "media" | "alta";
    evidence: string;
  };
  readiness: {
    blocked: boolean;
    reasons: string[];
    missing: string[];
  };
  facts: BudgetAiEvidence[];
  hypotheses: BudgetAiHypothesis[];
  recommendations: BudgetAiRecommendation[];
  filling_improvements: string[];
  observation_suggested: string;
  policies: Array<{ policy: string; reason: string }>;
  questions: string[];
};

export type BudgetAiResponseMeta = {
  model?: string;
  mode?: "standard" | "deep";
  prompt_version?: string;
  photos_received?: number;
  photos_used?: number;
  docs?: number;
  docs_titles?: string[];
  web?: boolean;
  elapsed_ms?: number;
};

const HTTP_URL_REGEX = /https?:\/\/[^\s,;]+/gi;

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function classifyPhoto(label: string): BudgetAiPhotoCategory {
  const normalized = normalizeLabel(label);
  if (/placa|etiqueta|serie|serial|modelo|identifica|patrimonio/.test(normalized)) return "identification";
  if (/defeito|falha|problema|avaria|dano/.test(normalized)) return "defect";
  if (/peca|material|componente/.test(normalized)) return "parts";
  return "general";
}

function selectEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return [items[0]];
  const selected: T[] = [];
  const used = new Set<number>();
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.round(index * (items.length - 1) / (limit - 1));
    if (!used.has(sourceIndex)) {
      used.add(sourceIndex);
      selected.push(items[sourceIndex]);
    }
  }
  return selected;
}

export function extractBudgetAiPhotos(
  answers: Array<{ question?: string; reply?: string }>,
  limit = 10,
): BudgetAiPhoto[] {
  const photos: BudgetAiPhoto[] = [];
  let originalIndex = 0;
  for (const answer of answers || []) {
    const reply = String(answer?.reply || "");
    const matches = reply.match(HTTP_URL_REGEX) || [];
    for (const url of matches) {
      photos.push({
        url,
        label: String(answer?.question || "Foto sem identificação"),
        category: classifyPhoto(String(answer?.question || "")),
        originalIndex: originalIndex++,
      });
    }
  }

  const categoryOrder: BudgetAiPhotoCategory[] = ["identification", "defect", "parts", "general"];
  const selected: BudgetAiPhoto[] = [];
  for (const category of categoryOrder) {
    const categoryPhotos = photos.filter((photo) => photo.category === category);
    if (categoryPhotos.length > 0) selected.push(...selectEvenly(categoryPhotos, Math.min(2, categoryPhotos.length)));
  }

  const selectedUrls = new Set(selected.map((photo) => photo.url));
  const remaining = photos.filter((photo) => !selectedUrls.has(photo.url));
  selected.push(...selectEvenly(remaining, Math.max(0, limit - selected.length)));

  return selected
    .slice(0, limit)
    .sort((a, b) => a.originalIndex - b.originalIndex);
}

function hasUsefulText(value?: string | null): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.length >= 3 && !["n/a", "na", "não", "nao", "nenhum", "nenhuma", "-", "."].includes(normalized);
}

export function evaluateBudgetAiReadiness(input: BudgetAiReadinessInput): BudgetAiReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasEquipment = hasUsefulText(input.equipment);
  const hasOrientation = hasUsefulText(input.orientation);
  const hasTechnicalDetail = [input.parts, input.services, input.observations].some(hasUsefulText);
  const hasPhotos = (input.photos?.length || 0) > 0;

  if (!hasEquipment && !hasOrientation) blockers.push("Equipamento e orientação do chamado não foram identificados.");
  if (!hasTechnicalDetail && !hasOrientation) blockers.push("Não há descrição técnica suficiente para analisar.");
  if (!hasEquipment) warnings.push("Equipamento não identificado.");
  if (!hasUsefulText(input.equipmentId)) warnings.push("ID, patrimônio ou série não informado.");
  if (!hasUsefulText(input.parts)) warnings.push("Peças necessárias não informadas.");
  if (!hasUsefulText(input.services)) warnings.push("Serviços necessários não informados.");
  if (!hasUsefulText(input.observations)) warnings.push("Observações técnicas não informadas.");
  if (!hasPhotos) warnings.push("Nenhuma foto disponível para validação visual.");

  const availableSignals = [hasEquipment, hasOrientation, hasUsefulText(input.parts), hasUsefulText(input.services), hasUsefulText(input.observations), hasPhotos]
    .filter(Boolean).length;

  return {
    canAnalyze: blockers.length === 0,
    score: Math.round(availableSignals / 6 * 100),
    blockers,
    warnings,
  };
}

export function withBudgetAiTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("AI_REQUEST_TIMEOUT")), timeoutMs);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

// ---------------------------------------------------------------------------
// Histórico de peças (rastreio) como contexto para a IA
// ---------------------------------------------------------------------------

export type BudgetAiPartHistoryItem = {
  codigo?: string | null;
  descricao?: string | null;
  qtd_orcada?: number | null;
  qtd_vendida?: number | null;
  valor_orcado?: number | null;
  valor_vendido?: number | null;
  ocorrencias?: number | null;
  ultima_data?: string | null;
  documentos?: Array<{
    origem?: string | null;
    documento_codigo?: string | null;
    data?: string | null;
    situacao?: string | null;
    vendida?: boolean | null;
    quantidade?: number | null;
    auvo_task_id?: string | null;
  }> | null;
};

export type BudgetAiPartOccurrence = {
  descricao?: string | null;
  codigo?: string | null;
  quantidade?: number | null;
  origem?: string | null;
  documento_codigo?: string | null;
  situacao?: string | null;
  data?: string | null;
  vendida?: boolean | null;
};

export type BudgetAiPartsHistoryPayload = {
  consolidado?: BudgetAiPartHistoryItem[];
  pecas?: BudgetAiPartOccurrence[];
  consolidado_servicos?: BudgetAiPartHistoryItem[];
  servicos?: BudgetAiPartOccurrence[];
  totais?: { os?: number; orcamentos?: number; itens?: number };
};

export type BudgetAiPartsHistoryContext = {
  text: string;
  matches: Array<{
    solicitado: string;
    historico: string;
    codigo: string;
    ultima_data: string | null;
    confianca: "alta" | "media" | "baixa";
    score: number;
    evidencias: string[];
    tipo?: "peca" | "servico";
  }>;
  itemsConsidered: number;
};

const STOPWORDS = new Set([
  "de", "da", "do", "para", "com", "sem", "por", "e", "ou", "un", "und", "pc", "pcs", "kit",
  "peca", "pecas", "troca", "trocar", "substituir", "unidade", "unidades", "a", "o", "os", "as",
]);

function tokenize(value: string): string[] {
  return normalizeLabel(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function formatCurrency(value?: number | null): string {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function docLabel(doc: {
  origem?: string | null;
  documento_codigo?: string | null;
  data?: string | null;
  vendida?: boolean | null;
}): string {
  const tipo = doc.origem === "os" ? "OS" : "Orçamento";
  return `${tipo} ${doc.documento_codigo || "?"}${doc.data ? ` (${doc.data})` : ""}${doc.vendida ? " — VENDIDA" : " — orçada"}`;
}

function docsSummary(item: BudgetAiPartHistoryItem, limit = 4): string[] {
  return (item.documentos || []).slice(0, limit).map((doc) => docLabel(doc));
}

/**
 * Cruza o texto de peças solicitadas pelo técnico com o histórico de peças
 * orçadas/vendidas do equipamento e devolve um bloco de contexto para a IA.
 */
export function buildPartsHistoryContext(
  payload: BudgetAiPartsHistoryPayload | null | undefined,
  requestedPartsText: string,
  limit = 40,
): BudgetAiPartsHistoryContext | null {
  const consolidado = (payload?.consolidado || []).filter((item) => item?.descricao);
  const ocorrencias = (payload?.pecas || []).filter((item) => item?.descricao);
  const consolidadoServicos = (payload?.consolidado_servicos || []).filter((item) => item?.descricao);
  const ocorrenciasServicos = (payload?.servicos || []).filter((item) => item?.descricao);
  if (
    consolidado.length === 0 && ocorrencias.length === 0 &&
    consolidadoServicos.length === 0 && ocorrenciasServicos.length === 0
  ) return null;

  const requestedLines = String(requestedPartsText || "")
    .split(/[\n\r;•·|]|(?:,\s)|(?:\s[-–]\s)|(?:\s\/\s)/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length >= 3);

  const matchAgainst = (
    catalog: BudgetAiPartHistoryItem[],
    tipo: "peca" | "servico",
  ): BudgetAiPartsHistoryContext["matches"] => {
    const found: BudgetAiPartsHistoryContext["matches"] = [];
    for (const line of requestedLines) {
      const tokens = tokenize(line);
      if (tokens.length === 0) continue;
      const candidates: { item: BudgetAiPartHistoryItem; score: number }[] = [];
      for (const item of catalog) {
        const historyTokens = new Set(tokenize(String(item.descricao || "") + " " + String(item.codigo || "")));
        const hits = tokens.filter((token) => historyTokens.has(token)).length;
        if (hits === 0) continue;
        const score = hits / tokens.length;
        // aceita quando cobre boa parte do pedido OU quando há pelo menos 2 termos
        // técnicos em comum (ex.: "laudo nr13", "limpeza de queimadores")
        if (score < 0.34 && hits < 2) continue;
        candidates.push({ item, score });
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => b.score - a.score);
      for (const best of candidates.slice(0, 3)) {
      const vendidaAlguma = (Number(best.item.qtd_vendida) || 0) > 0;
      const confianca: "alta" | "media" | "baixa" =
        best.score >= 0.85 && String(best.item.codigo || "") && vendidaAlguma
          ? "alta"
          : best.score >= 0.65
            ? "media"
            : "baixa";
      found.push({
        solicitado: line,
        historico: String(best.item.descricao || ""),
        codigo: String(best.item.codigo || ""),
        ultima_data: best.item.ultima_data || null,
        confianca,
        score: Math.round(best.score * 100) / 100,
        evidencias: docsSummary(best.item),
        tipo,
      });
      }
    }
    return found;
  };

  const matchesPecas = matchAgainst(consolidado, "peca");
  const matchesServicos = matchAgainst(consolidadoServicos, "servico");
  const seenMatch = new Set<string>();
  const matches = [...matchesPecas, ...matchesServicos].filter((m) => {
    const key = `${m.tipo}|${m.solicitado.toLowerCase()}|${m.historico.toLowerCase()}`;
    if (seenMatch.has(key)) return false;
    seenMatch.add(key);
    return true;
  });

  const top = consolidado.slice(0, limit);
  const ultimasOcorrencias = ocorrencias.slice(0, 25);
  const topServicos = consolidadoServicos.slice(0, limit);
  const ultimosServicos = ocorrenciasServicos.slice(0, 25);

  const lines: string[] = [];
  lines.push(
    `Documentos no histórico: ${payload?.totais?.os ?? 0} OS e ${payload?.totais?.orcamentos ?? 0} orçamento(s); ${payload?.totais?.itens ?? ocorrencias.length} item(ns) de peça e ${ocorrenciasServicos.length} lançamento(s) de serviço.`,
  );

  if (top.length > 0) {
    lines.push("Peças já orçadas/vendidas neste equipamento (consolidado):");
    for (const item of top) {
      const docs = docsSummary(item, 3);
      lines.push(
        `- ${item.descricao}${item.codigo ? ` [cód. ${item.codigo}]` : " [sem código cadastrado]"} · orçada ${Number(item.qtd_orcada) || 0}x (${formatCurrency(item.valor_orcado)}) · vendida ${Number(item.qtd_vendida) || 0}x (${formatCurrency(item.valor_vendido)}) · ocorrências ${Number(item.ocorrencias) || 0} · última ${item.ultima_data || "n/d"}${docs.length ? ` · usada em: ${docs.join("; ")}` : ""}`,
      );
    }
  }

  if (ultimasOcorrencias.length > 0) {
    lines.push("Últimos lançamentos (mais recentes primeiro):");
    for (const item of ultimasOcorrencias) {
      lines.push(
        `- ${item.data || "s/data"} · ${item.origem === "os" ? "OS" : "Orçamento"} ${item.documento_codigo || "?"} (${item.situacao || "sem situação"}) · ${item.descricao}${item.codigo ? ` [cód. ${item.codigo}]` : ""} · qtd ${Number(item.quantidade) || 0} · ${item.vendida ? "VENDIDA" : "apenas orçada"}`,
      );
    }
  }

  if (topServicos.length > 0) {
    lines.push("Serviços/mão de obra já orçados/vendidos neste equipamento (consolidado):");
    for (const item of topServicos) {
      const docs = docsSummary(item, 3);
      lines.push(
        `- ${item.descricao}${item.codigo ? ` [cód. ${item.codigo}]` : " [sem código cadastrado]"} · orçado ${Number(item.qtd_orcada) || 0}x (${formatCurrency(item.valor_orcado)}) · vendido ${Number(item.qtd_vendida) || 0}x (${formatCurrency(item.valor_vendido)}) · ocorrências ${Number(item.ocorrencias) || 0} · última ${item.ultima_data || "n/d"}${docs.length ? ` · usado em: ${docs.join("; ")}` : ""}`,
      );
    }
  }

  if (ultimosServicos.length > 0) {
    lines.push("Últimos serviços lançados (mais recentes primeiro):");
    for (const item of ultimosServicos) {
      lines.push(
        `- ${item.data || "s/data"} · ${item.origem === "os" ? "OS" : "Orçamento"} ${item.documento_codigo || "?"} (${item.situacao || "sem situação"}) · ${item.descricao}${item.codigo ? ` [cód. ${item.codigo}]` : ""} · qtd ${Number(item.quantidade) || 0} · ${item.vendida ? "VENDIDO" : "apenas orçado"}`,
      );
    }
  }

  if (matches.length > 0) {
    lines.push("Correspondências entre o que o técnico pediu agora e o histórico (use o CÓDIGO e cite o documento como prova):");
    for (const match of matches) {
      lines.push(
        `- [${match.tipo === "servico" ? "SERVIÇO" : "PEÇA"}] "${match.solicitado}" ≈ "${match.historico}"${match.codigo ? ` [cód. ${match.codigo}]` : " [sem código cadastrado]"} · confiança ${match.confianca} (similaridade ${Math.round(match.score * 100)}%) · última vez em ${match.ultima_data || "n/d"}${match.evidencias.length ? ` · prova: ${match.evidencias.join("; ")}` : ""}`,
      );
    }
  } else if (requestedLines.length > 0) {
    lines.push("Nenhuma peça/serviço solicitado agora bate com a nomenclatura do histórico deste equipamento.");
  }

  if (requestedLines.length > 0) {
    const matchedLines = new Set(matches.map((m) => m.solicitado.toLowerCase()));
    const semMatch = requestedLines.filter((line) => !matchedLines.has(line.toLowerCase()));
    lines.push(
      `ITENS SOLICITADOS AGORA (${requestedLines.length}) — todos devem ser avaliados individualmente, peças E serviços: ${requestedLines.join(" | ")}`,
    );
    if (semMatch.length > 0) {
      lines.push(
        `Sem correspondência no histórico (recomendar mesmo assim, sem código, confiança baixa): ${semMatch.join(" | ")}`,
      );
    }
  }

  return {
    text: lines.join("\n"),
    matches,
    itemsConsidered: top.length + ultimasOcorrencias.length + topServicos.length + ultimosServicos.length,
  };
}
