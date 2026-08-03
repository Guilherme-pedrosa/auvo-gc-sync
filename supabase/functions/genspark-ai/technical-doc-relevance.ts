const normalize = (value: string) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const TERM_ALIASES: Record<string, string[]> = {
  power: ["potencia", "placa potencia", "power board"],
  potencia: ["power", "placa power", "power board"],
  placa: ["board", "placa eletronica", "placa potencia", "power board"],
  ventilador: ["fan", "cooling fan", "refrigeracao", "ventilacao"],
  ventilacao: ["ventilador", "fan", "cooling fan", "refrigeracao"],
  refrigeracao: ["ventilador", "fan", "cooling fan", "ventilacao"],
  dreno: ["drain", "drenagem", "sifao", "mangote", "joelho"],
  drenagem: ["drain", "dreno", "sifao", "mangote", "joelho"],
  sifao: ["dreno", "drain", "drenagem", "mangote", "joelho"],
  mangote: ["dreno", "drain", "drenagem", "sifao", "mangueira"],
  joelho: ["dreno", "drain", "drenagem", "sifao", "cotovelo"],
  abracadeira: ["abracadeiras", "clamp", "fixacao"],
  abracadeiras: ["abracadeira", "clamp", "fixacao"],
  campainha: ["buzzer", "alarme", "sinal sonoro"],
};

export function expandTechnicalTerms(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const rawTerm of terms) {
    const term = normalize(rawTerm);
    if (!term) continue;
    expanded.add(term);
    for (const alias of TERM_ALIASES[term] || []) expanded.add(normalize(alias));
  }
  return Array.from(expanded);
}

export function scoreTechnicalText(value: string, terms: string[]): number {
  const text = normalize(value);
  let score = 0;
  for (const term of terms) {
    if (!term || !text.includes(term)) continue;
    score += term.includes(" ") ? 9 : 4;
  }
  return score;
}

export function unrelatedDocumentPenalty(value: string, activeTerms: string[]): number {
  const text = normalize(value);
  const query = ` ${activeTerms.map(normalize).join(" ")} `;
  const requested = (pattern: RegExp) => pattern.test(query);
  let penalty = 0;

  if (/\bcopia\b/.test(text)) penalty -= 5;
  if (/modo show/.test(text) && !requested(/\bshow\b/)) penalty -= 30;
  if (/transformacao de tensao|mudanca de tensao|voltagem/.test(text) && !requested(/tensao|voltagem|voltage/)) penalty -= 28;
  if (/sistema de limpeza|sense klean|lavagem/.test(text) && !requested(/limpeza|lavagem|klean/)) penalty -= 22;
  if (/receita|coccao|cozimento/.test(text) && !requested(/receita|coccao|cozimento/)) penalty -= 18;
  if (/instalacao/.test(text) && !requested(/instalacao|instalar/)) penalty -= 16;
  if (/\bapp\b|portal unox|criar seu acesso/.test(text) && !requested(/\bapp\b|portal|acesso/)) penalty -= 24;
  if (/serie ?5e/.test(text) && requested(/mindmaps/) && !requested(/serie ?5e/)) penalty -= 32;

  return penalty;
}

export function canonicalTechnicalDocumentKey(value: string): string {
  return normalize(value)
    .replace(/\b(unox|novo|copia|copy)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPdfPageSample(totalPages: number, maxPages = 16): number[] {
  const safeTotal = Math.max(0, Math.floor(totalPages));
  if (safeTotal <= maxPages) return Array.from({ length: safeTotal }, (_, index) => index + 1);

  const pages = new Set<number>([1, 2, 3, 4]);
  const remaining = Math.max(0, maxPages - pages.size);
  for (let index = 1; index <= remaining; index++) {
    pages.add(Math.max(1, Math.min(safeTotal, Math.round(1 + (index * (safeTotal - 1)) / (remaining + 1)))));
  }
  return Array.from(pages);
}
