import { OPEN_OS_SITUATIONS } from "./osOpenStatuses";

type Invoke = (name: string, options: { body: Record<string, unknown> }) => PromiseLike<{ data: any; error: any }>;
type Day = { start: string; end: string };
export type ReportsSyncTotals = { tasks: number; saved: number; orders: number; transitioned: number };

export async function describeSyncError(error: any): Promise<string> {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const payload = await response.clone().json();
      if (payload?.code === "IDLE_TIMEOUT" || response.status === 504) {
        return "O servidor excedeu o tempo de resposta. Este lote não teve conclusão confirmada; os dados já gravados foram preservados.";
      }
      if (typeof payload?.error === "string") return payload.error;
      if (typeof payload?.message === "string") return payload.message;
    } catch { /* Non-JSON gateway response. */ }
    if (response.status) return `Falha ao consultar o servidor (HTTP ${response.status}).`;
  }
  return error?.message || "Não foi possível concluir a sincronização.";
}

export async function syncReportsInSteps(
  invoke: Invoke,
  options: {
    days: Day[];
    situationIds?: string[];
    onProgress: (message: string, completed: number) => void;
    onSaved?: () => void;
    signal?: AbortSignal;
  },
): Promise<ReportsSyncTotals> {
  const totals = { tasks: 0, saved: 0, orders: 0, transitioned: 0 };
  const ids = options.situationIds?.length ? options.situationIds : OPEN_OS_SITUATIONS.map(row => row.id);
  const knownIds = new Set<string>();
  const budgetCodes = new Set<string>();
  let completed = 0;
  const call = async (label: string, body: Record<string, unknown>) => {
    options.signal?.throwIfAborted();
    options.onProgress(label, completed);
    const { data, error } = await invoke("central-sync", { body: { ...body, wait: true } });
    options.signal?.throwIfAborted();
    if (error) throw new Error(`${label}: ${await describeSyncError(error)}`);
    if (body.reports_only && data?.auvo_paginacao_completa === false) {
      throw new Error(`${label}: ${data?.error || "O Auvo não confirmou a consulta completa desta data. Os registros existentes foram preservados."}`);
    }
    if (data?.success !== true || data?.background || Number(data?.errors || 0) > 0 || data?.auvo_error) {
      throw new Error(`${label}: ${data?.error || data?.auvo_error || "O servidor não confirmou a gravação completa deste lote."}`);
    }
    if (body.report_step && data.report_step !== body.report_step) {
      throw new Error("A atualização do serviço de sincronização ainda não está disponível. Tente novamente após a publicação.");
    }
    completed++;
    options.onSaved?.();
    return data;
  };

  for (const situationId of ids) {
    let page: number | null = 1;
    do {
      const currentPage: number = page;
      const name = OPEN_OS_SITUATIONS.find(row => row.id === situationId)?.label || situationId;
      const data = await call(`Atualizando OS: ${name}, página ${page}`, {
        report_step: "os_page", situacao_ids: [situationId], report_page: page,
      });
      for (const id of data.os_ids || []) knownIds.add(String(id));
      for (const code of data.budget_codes || []) budgetCodes.add(String(code));
      totals.orders += Number(data.upserted || 0);
      page = data.next_page ?? null;
      if (page !== null && (!Number.isInteger(page) || page <= currentPage)) throw new Error("Paginação de OS inválida; sincronização interrompida.");
    } while (page !== null);
  }

  let after: string | null = null;
  do {
    const data = await call("Conferindo mudanças de situação das OS", {
      report_step: "os_reconcile", situacao_ids: ids, known_os_ids: [...knownIds], after_os_id: after,
    });
    totals.transitioned += Number(data.transitioned || 0);
    const next = data.next_after ?? null;
    if (next !== null && (typeof next !== "string" || (after !== null && next <= after))) throw new Error("Paginação de conferência inválida.");
    after = next;
  } while (after !== null);

  const codes = [...budgetCodes];
  for (let i = 0; i < codes.length; i += 3) {
    await call(`Conferindo orçamentos vinculados: ${i + 1}–${Math.min(i + 3, codes.length)}/${codes.length}`, {
      report_step: "budgets", budget_codes: codes.slice(i, i + 3),
    });
  }
  for (const [index, day] of options.days.entries()) {
    const data = await call(`Atualizando tarefas Auvo ${index + 1}/${options.days.length}: ${day.start}`, {
      reports_only: true, reconcile_open_os: false, start_date: day.start, end_date: day.end,
    });
    totals.tasks += Number(data.auvo_tarefas || 0);
    totals.saved += Number(data.upserted || 0);
  }
  options.onProgress("Todos os lotes foram concluídos e gravados.", completed);
  return totals;
}
