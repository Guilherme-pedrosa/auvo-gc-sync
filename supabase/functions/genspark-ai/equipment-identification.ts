export type KnownEquipmentIdentification = {
  manufacturer: string[];
  modelFamily: string | null;
};

/**
 * Identificação determinística usada antes de qualquer pesquisa externa.
 * Os códigos LM seguem a codificação oficial da RATIONAL:
 * LM1 = iCombi Pro; LM2 = iCombi Classic/CombiMaster Plus XS.
 */
export function identifyKnownEquipment(equipment: string): KnownEquipmentIdentification {
  const text = String(equipment || "").toLowerCase();
  const knownBrands: Array<{ pattern: RegExp; terms: string[] }> = [
    { pattern: /\brational\b/i, terms: ["rational"] },
    { pattern: /\bhobart\b|\bvulcan\b/i, terms: ["hobart", "vulcan"] },
    { pattern: /\bpr[aá]tica\b/i, terms: ["pratica", "prática"] },
    { pattern: /\btramontina\b/i, terms: ["tramontina"] },
    { pattern: /\belgin\b/i, terms: ["elgin"] },
  ];
  const brand = knownBrands.find((item) => item.pattern.test(text));
  if (!brand) return { manufacturer: [], modelFamily: null };

  const modelPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bi\s*combi\s*pro\b|\bicombipro\b|\blm1\d{2}[a-g][eg]\b/i, name: "iCombi Pro" },
    { pattern: /\bi\s*combi\s*classic\b|\bicombiclassic\b|\blm2\d{2}[a-g][eg]\b/i, name: "iCombi Classic" },
    { pattern: /\bi\s*vario\b/i, name: "iVario" },
    { pattern: /\bself\s*cooking\s*center\b|\bselfcookingcenter\b|\bscc\b/i, name: "SelfCookingCenter" },
    { pattern: /\bcombi\s*master\b|\bcombimaster\b|\bcpc\b/i, name: "CombiMaster" },
    { pattern: /\becomax\b/i, name: "Ecomax" },
  ];
  const model = modelPatterns.find((item) => item.pattern.test(text));
  return { manufacturer: brand.terms, modelFamily: model?.name || null };
}
