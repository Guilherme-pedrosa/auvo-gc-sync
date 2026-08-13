
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
export function areNamesDivergent(
  nameA: string | null | undefined, 
  nameB: string | null | undefined,
  alternativeNamesA: (string | null | undefined)[] = []
): boolean {
  if (!nameA || !nameB) return false;
  
  const normA = normalizeClientName(nameA);
  const normB = normalizeClientName(nameB);
  
  if (normA === normB) return false;
  
  // Lista de nomes para comparar do lado A (ex: Nome, Nome Fantasia, Razão Social)
  const namesA = [nameA, ...alternativeNamesA].filter(Boolean) as string[];
  
  // Se qualquer um dos nomes do lado A for similar ao nome B, não há divergência
  const hasMatch = namesA.some(name => {
    const nA = normalizeClientName(name);
    const nB = normalizeClientName(nameB);
    
    if (nA === nB) return true;
    
    const tokensA = nA.split(" ").filter(t => t.length > 2);
    const tokensB = nB.split(" ").filter(t => t.length > 2);
    
    if (tokensA.length === 0 || tokensB.length === 0) return nA === nB;

    const intersection = tokensA.filter(t => tokensB.includes(t));
    const overlap = intersection.length / Math.max(tokensA.length, tokensB.length);
    
    return overlap >= 0.7;
  });

  return !hasMatch;
}

/**
 * Normaliza CPFs e CNPJs mantendo apenas dígitos.
 */
export function normalizeDocument(doc: string | null | undefined): string {
  if (!doc) return "";
  return doc.replace(/\D/g, "");
}
