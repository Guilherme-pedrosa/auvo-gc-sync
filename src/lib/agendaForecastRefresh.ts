export const AGENDA_FORECAST_POLL_MS = 20_000;
export const AGENDA_FORECAST_STATE_FIELDS = [
  "id", "auvo_task_id", "previsao_continuidade", "previsao_tipo", "conversao_status", "conversao_erro",
  "gc_os_codigo", "gc_orcamento_codigo", "data", "hora_inicio", "hora_fim",
  "colaborador_id", "colaborador_nome", "origem", "status",
] as const;

export type AgendaForecastState = {
  id: string;
  auvo_task_id?: string | null;
  previsao_continuidade?: boolean | null;
  previsao_tipo?: string | null;
  conversao_status?: string | null;
  conversao_erro?: string | null;
} & Partial<Record<typeof AGENDA_FORECAST_STATE_FIELDS[number], unknown>>;

export function pendingAgendaForecasts<T extends AgendaForecastState>(rows: T[]): T[] {
  return rows.filter(row => row.previsao_continuidade === true
    && row.previsao_tipo === "ORCAMENTO_EXECUCAO"
    && !String(row.auvo_task_id ?? "").trim()).sort((a, b) => a.id.localeCompare(b.id));
}

/** Timestamps de tentativas não mudam o card; não devem recarregar toda a escala. */
export function agendaForecastStateKey(rows: AgendaForecastState[]): string {
  return JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))
    .map(row => AGENDA_FORECAST_STATE_FIELDS.map(field => row[field] ?? null)));
}

export function agendaForecastStateChanged(previous: AgendaForecastState[], current: AgendaForecastState[]): boolean {
  return agendaForecastStateKey(previous) !== agendaForecastStateKey(current);
}
