export type BudgetSourcePreflightInput = {
  docsCount: number;
  docsError?: string | null;
  historyLoaded: boolean;
  historyError?: string | null;
};

export type BudgetSourcePreflightResult = {
  ready: boolean;
  failures: string[];
};

/**
 * Paid analysis may only start after the internal library was actually read
 * and the equipment-history lookup completed. An empty but successful history
 * is valid; a failed/not-executed lookup is not.
 */
export function evaluateBudgetSourcePreflight(input: BudgetSourcePreflightInput): BudgetSourcePreflightResult {
  const failures: string[] = [];
  if (Number(input.docsCount || 0) <= 0) {
    failures.push(`Biblioteca CHAT não carregada: ${input.docsError || "nenhum documento aderente foi extraído"}`);
  }
  if (!input.historyLoaded) {
    failures.push(`Histórico do equipamento não carregado: ${input.historyError || "a consulta não foi concluída"}`);
  }
  return { ready: failures.length === 0, failures };
}
