export const RESOLVED_WITHOUT_BUDGET_COLUMN = "resolvido_sem_orcamento";

/** Janela fixa de backlog: cards sem resolução dos últimos 6 meses nunca somem. */
export const BUDGET_BACKLOG_MONTHS = 6;

export type BudgetAgingLevel = "normal" | "warning" | "critical";

export type BudgetResolutionLike = {
  orcamento_realizado?: boolean | null;
  os_realizada?: boolean | null;
};

/** Card sem resolução = não gerou orçamento nem OS no GestãoClick. */
export function isUnresolvedBudgetCard(item: BudgetResolutionLike | null | undefined): boolean {
  return !item?.orcamento_realizado && !item?.os_realizada;
}

export function getBudgetCardAgeDays(
  taskDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const raw = String(taskDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today - start) / 86_400_000);
  return days < 0 ? 0 : days;
}

/** >30 dias sem resolução = crítico (vermelho cintilante); >15 dias = atenção (amarelo). */
export function getBudgetAgingLevel(
  item: (BudgetResolutionLike & { data_tarefa?: string | null }) | null | undefined,
  now: Date = new Date(),
): BudgetAgingLevel {
  if (!isUnresolvedBudgetCard(item)) return "normal";
  const days = getBudgetCardAgeDays(item?.data_tarefa, now);
  if (days === null) return "normal";
  if (days > 30) return "critical";
  if (days > 15) return "warning";
  return "normal";
}

export const BUDGET_PENDING_SYSTEM_COLUMNS = new Set([
  "a_fazer",
  "falta_preenchimento",
]);

export type BudgetSyncStatusPayload = {
  run_id?: string | null;
  status?: string | null;
  error?: string | null;
};

export type BudgetSyncPollEvaluation = {
  state: "waiting" | "succeeded" | "failed";
  message?: string;
};

export function evaluateBudgetSyncStatus(
  payload: BudgetSyncStatusPayload | null | undefined,
  expectedRunId: string,
): BudgetSyncPollEvaluation {
  if (payload?.error) {
    return { state: "failed", message: payload.error };
  }

  const currentRunId = String(payload?.run_id || "");
  if (currentRunId && currentRunId !== expectedRunId) {
    return {
      state: "failed",
      message: "Outra sincronização substituiu esta execução. Atualize a tela e tente novamente.",
    };
  }

  if (payload?.status === "succeeded") return { state: "succeeded" };
  if (payload?.status === "failed") {
    return {
      state: "failed",
      message: "A sincronização falhou no servidor.",
    };
  }

  return { state: "waiting" };
}

export type BudgetKanbanCardIdentity = {
  auvo_task_id: string;
};

export type BudgetKanbanColumnLike<T extends BudgetKanbanCardIdentity> = {
  id: string;
  title: string;
  items: T[];
};

export function shouldAutoRouteToDoneToday(
  sourceColumnId: string,
  budgetDate: string | null | undefined,
  today: string,
): boolean {
  return BUDGET_PENDING_SYSTEM_COLUMNS.has(sourceColumnId)
    && Boolean(budgetDate)
    && String(budgetDate).slice(0, 10) === today;
}

/**
 * Moves the card by its stable task id instead of using the visible array index.
 * Visible indexes differ from stored indexes whenever filters are active.
 */
export function moveBudgetKanbanCard<T extends BudgetKanbanCardIdentity>(
  columns: BudgetKanbanColumnLike<T>[],
  taskId: string,
  targetColumnId: string,
  targetColumnTitle: string,
  destinationVisibleIndex = 0,
  visibleDestinationTaskIds: string[] = [],
): BudgetKanbanColumnLike<T>[] {
  const next = columns.map((column) => ({ ...column, items: [...column.items] }));
  let movedCard: T | null = null;

  for (const column of next) {
    const index = column.items.findIndex((item) => item.auvo_task_id === taskId);
    if (index === -1) continue;
    movedCard = column.items.splice(index, 1)[0];
    break;
  }

  if (!movedCard) return columns;

  let target = next.find((column) => column.id === targetColumnId);
  if (!target) {
    target = { id: targetColumnId, title: targetColumnTitle, items: [] };
    next.push(target);
  }

  const visibleIds = visibleDestinationTaskIds.filter((id) => id !== taskId);
  const beforeId = visibleIds[destinationVisibleIndex];
  let insertAt = 0;

  if (beforeId) {
    const beforeIndex = target.items.findIndex((item) => item.auvo_task_id === beforeId);
    insertAt = beforeIndex === -1 ? target.items.length : beforeIndex;
  } else if (visibleIds.length > 0) {
    const lastVisibleId = visibleIds[visibleIds.length - 1];
    const lastVisibleIndex = target.items.findIndex((item) => item.auvo_task_id === lastVisibleId);
    insertAt = lastVisibleIndex === -1 ? target.items.length : lastVisibleIndex + 1;
  }

  target.items.splice(insertAt, 0, movedCard);
  return next;
}
