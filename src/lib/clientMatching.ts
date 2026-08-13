
/**
 * Normaliza um nome removendo acentos, caracteres especiais, espaços extras
 * e sufixos comuns de empresas (LTDA, ME, etc).
 */
export function normalizeClientName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(ltda|me|s\.?a\.?|eireli|epp|mei)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcula a similaridade entre dois nomes baseada em tokens.
 * Retorna true se houver uma sobreposição significativa.
 */
export function areNamesDivergent(nameA: string | null | undefined, nameB: string | null | undefined): boolean {
  if (!nameA || !nameB) return false;
  
  const normA = normalizeClientName(nameA);
  const normB = normalizeClientName(nameB);
  
  if (normA === normB) return false;
  if (!normA || !normB) return false;

  const tokensA = normA.split(" ").filter(t => t.length > 2);
  const tokensB = normB.split(" ").filter(t => t.length > 2);
  
  if (tokensA.length === 0 || tokensB.length === 0) return normA !== normB;

  const intersection = tokensA.filter(t => tokensB.includes(t));
  const overlap = intersection.length / Math.max(tokensA.length, tokensB.length);
  
  // LOG PARA DEBUG NO NAVEGADOR
  // console.log(`[DivergenceCheck] "${nameA}" vs "${nameB}" | Overlap: ${overlap.toFixed(2)}`);

  // Reduzido para 50% para ser mais permissivo com nomes compostos
  return overlap < 0.5;
}

/**
 * Normaliza CPFs e CNPJs mantendo apenas dígitos.
 */
export function normalizeDocument(doc: string | null | undefined): string {
  if (!doc) return "";
  return doc.replace(/\D/g, "");
}
