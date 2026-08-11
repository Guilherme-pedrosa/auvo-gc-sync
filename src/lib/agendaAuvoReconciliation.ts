export type AgendaAuvoReconciliationRow = {
  id?: string | null;
  auvo_task_id?: string | null;
  data?: string | null;
  origem?: string | null;
  gc_os_codigo?: string | null;
  gc_orcamento_codigo?: string | null;
  previsao_tipo?: string | null;
  conversao_status?: string | null;
};

type AgendaAuvoReconciliationOptions = {
  syncComplete: boolean;
  startDate: string;
  endDate: string;
};

const text = (value: unknown) => String(value ?? "").trim();

/**
 * Remove somente espelhos locais de tarefas Auvo que deixaram de existir no
 * período consultado. Vínculos com documentos do GestãoClick são preservados,
 * assim como previsões convertidas. Uma resposta parcial nunca autoriza limpeza.
 */
export function missingAuvoAgendaIds(
  rows: AgendaAuvoReconciliationRow[],
  returnedTaskIds: Iterable<string>,
  options: AgendaAuvoReconciliationOptions,
): string[] {
  if (!options.syncComplete) return [];

  const returned = new Set([...returnedTaskIds].map(text).filter(Boolean));
  const ids = new Set<string>();

  for (const row of rows) {
    const id = text(row.id);
    const taskId = text(row.auvo_task_id);
    const date = text(row.data);
    if (!id || !taskId || returned.has(taskId)) continue;
    if (text(row.origem).toUpperCase() !== "AUVO") continue;
    if (!date || date < options.startDate || date > options.endDate) continue;
    if (text(row.gc_os_codigo) || text(row.gc_orcamento_codigo)) continue;
    if (text(row.previsao_tipo) === "ORCAMENTO_EXECUCAO") continue;
    if (text(row.conversao_status) === "CONVERTIDA") continue;
    ids.add(id);
  }

  return [...ids];
}
