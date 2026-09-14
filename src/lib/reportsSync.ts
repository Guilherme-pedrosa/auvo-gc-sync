import { OPEN_OS_SITUATIONS } from "./osOpenStatuses";

type Invoke = (name: string, options: { body: Record<string, unknown> }) => PromiseLike<{ data: any; error: any }>;
type Day = { start: string; end: string };
export type ReportsSyncOsWarning = { kind?: "os"; os_id: string; status: number | null; message: string };
export type ReportsSyncDayWarning = {
  kind: "auvo_day"; os_id?: never; start_date: string; end_date: string;
  status: number | null; message: string;
};
export type ReportsSyncWarning = ReportsSyncOsWarning | ReportsSyncDayWarning;
export type ReportsSyncTotals = {
  tasks: number; saved: number; orders: number; transitioned: number;
  warnings: ReportsSyncWarning[]; incomplete: boolean;
};

export function reportsSyncPendingSummary(warnings: ReportsSyncWarning[]): string {
  const days = warnings.filter(warning => warning.kind === "auvo_day").length;
  const orders = warnings.length - days;
  return [
    orders ? `${orders} OS pendentes de conferência` : "",
    days ? `${days} ${days === 1 ? "dia Auvo não confirmado" : "dias Auvo não confirmados"}` : "",
  ].filter(Boolean).join("; ");
}

function authenticationFailed(error: any, message: string): boolean {
  const status = Number(error?.context?.status ?? error?.status);
  return error?.syncAuthenticationFailed === true || status === 401 || status === 403
    || /\b(?:HTTP|status|respondeu|login failed)\s*[:=(]?\s*(?:401|403)\b|\bunauthori[sz]ed\b|\bforbidden\b|(?:JWT|token).{0,30}(?:invalid|expired|inv[aá]lid|expirad)|(?:invalid|expired|inv[aá]lid|expirad).{0,30}(?:JWT|token)/i.test(message);
}

function syncStepError(label: string, message: string, source: any = null): Error {
  return Object.assign(new Error(`${label}: ${message}`), {
    syncAuthenticationFailed: authenticationFailed(source, message),
  });
}

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
    onWarnings?: (warnings: ReportsSyncWarning[]) => void;
    signal?: AbortSignal;
  },
): Promise<ReportsSyncTotals> {
  const totals: ReportsSyncTotals = { tasks: 0, saved: 0, orders: 0, transitioned: 0, warnings: [], incomplete: false };
  const ids = options.situationIds?.length ? options.situationIds : OPEN_OS_SITUATIONS.map(row => row.id);
  const knownIds = new Set<string>();
  const budgetCodes = new Set<string>();
  let completed = 0;
  const call = async (label: string, body: Record<string, unknown>) => {
    options.signal?.throwIfAborted();
    options.onProgress(label, completed);
    const { data, error } = await invoke("central-sync", { body: { ...body, wait: true } });
    options.signal?.throwIfAborted();
    if (error) throw syncStepError(label, await describeSyncError(error), error);
    if (body.reports_only && data?.auvo_paginacao_completa === false) {
      throw syncStepError(label, data?.error || "O Auvo não confirmou a consulta completa desta data. Os registros existentes foram preservados.", data);
    }
    if (data?.success !== true || data?.background || Number(data?.errors || 0) > 0 || data?.auvo_error) {
      throw syncStepError(label, data?.error || data?.auvo_error || "O servidor não confirmou a gravação completa deste lote.", data);
    }
    if (body.report_step && data.report_step !== body.report_step) {
      throw new Error("A atualização do serviço de sincronização ainda não está disponível. Tente novamente após a publicação.");
    }
    if (data?.incomplete && (body.report_step !== "os_reconcile" || !Array.isArray(data.warnings) || !data.warnings.length)) {
      throw new Error(`${label}: o servidor não confirmou a conclusão deste lote.`);
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
    if (Array.isArray(data.warnings) && data.warnings.length) {
      for (const warning of data.warnings) {
        if (!warning || typeof warning.os_id !== "string" || typeof warning.message !== "string") {
          throw new Error("O serviço retornou uma pendência de conferência inválida.");
        }
        if (!totals.warnings.some(existing => existing.os_id === warning.os_id)) totals.warnings.push(warning);
      }
      totals.incomplete = true;
      options.onWarnings?.([...totals.warnings]);
    }
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
    const label = `Atualizando tarefas Auvo ${index + 1}/${options.days.length}: ${day.start}`;
    try {
      const data = await call(label, {
        reports_only: true, reconcile_open_os: false, start_date: day.start, end_date: day.end,
      });
      totals.tasks += Number(data.auvo_tarefas || 0);
      totals.saved += Number(data.upserted || 0);
    } catch (error: any) {
      // Each day is an independent persisted batch. A failed provider response
      // must remain pending without blocking the remaining dates or counting as saved.
      options.signal?.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      const detail = await describeSyncError(error);
      options.signal?.throwIfAborted();
      if (authenticationFailed(error, detail)) throw error;
      const reason = detail.startsWith(`${label}: `) ? detail.slice(label.length + 2) : detail;
      if (!totals.warnings.some(warning => warning.kind === "auvo_day"
        && warning.start_date === day.start && warning.end_date === day.end)) {
        totals.warnings.push({
          kind: "auvo_day", start_date: day.start, end_date: day.end, status: null,
          message: `${day.start}${day.end !== day.start ? ` a ${day.end}` : ""}: consulta Auvo não confirmada. ${reason}`,
        });
      }
      totals.incomplete = true;
      options.onWarnings?.([...totals.warnings]);
    }
  }
  options.onProgress(totals.incomplete
    ? totals.warnings.some(warning => warning.kind === "auvo_day")
      ? `Sincronização parcial: ${reportsSyncPendingSummary(totals.warnings)}. Os demais lotes foram processados; registros existentes preservados.`
      : `Lotes processados; ${totals.warnings.length} OS ficaram pendentes de conferência. Registros preservados.`
    : "Todos os lotes foram concluídos e gravados.", completed);
  return totals;
}
