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
