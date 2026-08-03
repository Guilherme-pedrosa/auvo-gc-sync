export type BudgetSourcePreflightInput = {
  docsCount: number;
  docsError?: string | null;
  historyLoaded: boolean;
  historyError?: string | null;
};

export type BudgetSourcePreflightResult = {
  ready: boolean;
  failures: string[];
  warnings: string[];
};

/**
 * Paid analysis is blocked only when a source pipeline actually FAILED.
 * An empty-but-successful library (no adherent document for this equipment)
 * or an empty history is valid evidence — it degrades to a warning.
 */
export function evaluateBudgetSourcePreflight(input: BudgetSourcePreflightInput): BudgetSourcePreflightResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const docsError = String(input.docsError || "").trim();
  if (docsError) {
    failures.push(`Biblioteca CHAT não carregada: ${docsError}`);
  } else if (Number(input.docsCount || 0) <= 0) {
    warnings.push("Biblioteca CHAT consultada, mas nenhum documento aderente foi encontrado para este equipamento.");
  }
  if (!input.historyLoaded) {
    const historyError = String(input.historyError || "").trim();
    if (historyError) {
      failures.push(`Histórico do equipamento não carregado: ${historyError}`);
    } else {
      warnings.push("Histórico do equipamento não retornou itens; a análise seguirá sem esse reforço.");
    }
  }
  return { ready: failures.length === 0, failures, warnings };
}
