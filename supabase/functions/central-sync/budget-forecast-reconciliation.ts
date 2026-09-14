import {
  BUDGET_EXECUTION_FORECAST,
  explicitExecutionTaskIds,
  isPartialWriteoffBudget,
  normalizeGcDocumentCode,
  selectOsForBudgetForecast,
} from "../_shared/agenda-forecast-promotion.ts";

export type ForecastPromotionSummary = {
  forecasts: number;
  promoted: number;
  alreadyPromoted: number;
  waitingOs: number;
  waitingTask: number;
  blocked: number;
  errors: number;
};

type Dependencies = {
  // Reads use central-sync's existing GC quota/timeout controls.
  readGc: (path: string) => Promise<any>;
  mapOs: (raw: any) => any;
};

/** Discover execution by the GC document, including Auvo tasks without a date/user. */
export async function reconcileBudgetExecutionForecasts(
  db: any,
  deps: Dependencies,
  budgetCodes?: string[],
): Promise<ForecastPromotionSummary> {
  const summary: ForecastPromotionSummary = {
    forecasts: 0, promoted: 0, alreadyPromoted: 0,
    waitingOs: 0, waitingTask: 0, blocked: 0, errors: 0,
  };
  let query = db.from("agenda_agendamentos")
    .select("id,gc_orcamento_codigo,criado_em")
    .eq("previsao_tipo", BUDGET_EXECUTION_FORECAST)
    .eq("previsao_continuidade", true)
    .is("auvo_task_id", null)
    // Retry corrected links, including previously blocked rows, without starving new ones.
    .order("conversao_tentada_em", { ascending: true, nullsFirst: true })
    .order("id")
    .limit(25);
  if (budgetCodes?.length) query = query.in("gc_orcamento_codigo", budgetCodes);
  const { data: forecasts, error } = await query;
  if (error) {
    console.warn(`[central-sync] Falha ao consultar previsões: ${error.message}`);
    summary.errors++;
    return summary;
  }
  summary.forecasts = forecasts?.length || 0;

  const customerOrders = new Map<string, any[]>();
  const mark = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("agenda_agendamentos").update({
      ...patch, conversao_tentada_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    }).eq("id", id).eq("previsao_tipo", BUDGET_EXECUTION_FORECAST)
      .eq("previsao_continuidade", true).is("auvo_task_id", null);
    if (error) throw new Error(error.message);
  };

  for (const forecast of forecasts || []) {
    const budgetCode = normalizeGcDocumentCode(forecast.gc_orcamento_codigo);
    try {
      const budgetData = await deps.readGc(`/api/orcamentos?codigo=${encodeURIComponent(budgetCode)}&limite=5`);
      if (!Array.isArray(budgetData?.data)) throw new Error("GC não confirmou a consulta do orçamento");
      const budget = budgetData.data.find((row: any) => normalizeGcDocumentCode(row.codigo) === budgetCode);
      if (!budget?.cliente_id) throw new Error(`GC não confirmou o cliente do orçamento ${budgetCode}`);
      if (isPartialWriteoffBudget(budget)) {
        await mark(forecast.id, {
          previsao_tipo: "SALDO_BAIXA_PARCIAL", conversao_status: "SALDO_A_CONFIRMAR", conversao_erro: null,
        });
        continue;
      }
      const customerId = String(budget.cliente_id);
      if (!customerOrders.has(customerId)) {
        const rows: any[] = [];
        let complete = false;
        for (let page = 1; page <= 10; page++) {
          const result = await deps.readGc(`/api/ordens_servicos?cliente_id=${encodeURIComponent(customerId)}&limite=100&pagina=${page}`);
          if (!Array.isArray(result?.data)) throw new Error("GC não confirmou a lista de OS do cliente");
          rows.push(...result.data.map(deps.mapOs));
          if (result.data.length < 100) { complete = true; break; }
        }
        if (!complete) throw new Error("A consulta de OS do cliente não foi concluída; vínculo preservado");
        customerOrders.set(customerId, rows);
      }
      // Never choose from a partial list or from the task's old diagnostic budget.
      const unique = new Map<string, any>();
      for (const os of customerOrders.get(customerId) || []) {
        if (normalizeGcDocumentCode(os.gc_os_orcamento_codigo) === budgetCode) {
          unique.set(String(os.gc_os_id || os.gc_os_codigo), os);
        }
      }
      const osMatches = selectOsForBudgetForecast([...unique.values()], forecast.criado_em);
      if (osMatches.length === 0) {
        summary.waitingOs++;
        await mark(forecast.id, { gc_os_codigo: null, conversao_status: "AGUARDANDO_OS", conversao_erro: null });
        continue;
      }
      if (osMatches.length > 1) {
        summary.blocked++;
        await mark(forecast.id, {
          conversao_status: "BLOQUEADA",
          conversao_erro: `Mais de uma OS está vinculada ao orçamento ${budgetCode}: ${osMatches.map((os) => os.gc_os_codigo).join(", ")}`,
        });
        continue;
      }
      const os = osMatches[0];
      const osCode = normalizeGcDocumentCode(os.gc_os_codigo);
      const execIds = explicitExecutionTaskIds(os.gc_os_tarefa_exec);
      if (execIds.length === 0) {
        summary.waitingTask++;
        await mark(forecast.id, { gc_os_codigo: osCode, conversao_status: "AGUARDANDO_TAREFA", conversao_erro: null });
        continue;
      }
      if (execIds.length > 1) {
        summary.blocked++;
        await mark(forecast.id, {
          gc_os_codigo: osCode, conversao_status: "BLOQUEADA",
          conversao_erro: `A OS ${osCode} possui mais de uma tarefa de execução: ${execIds.join(", ")}`,
        });
        continue;
      }
      const { data, error } = await db.functions.invoke("auvo-task-update", {
        body: { action: "promote-budget-forecast", gcOrcamentoCodigo: budgetCode, gcOsCodigo: osCode, execTaskId: execIds[0] },
      });
      if (error) throw new Error(error.message);
      if (data?.promoted) summary.promoted++;
      else if (data?.alreadyPromoted) summary.alreadyPromoted++;
      else if (["task_started", "technician_not_linked"].includes(data?.reason)) summary.blocked++;
      else if (!["no_forecast", "forecast_already_converted", "forecast_changed", "partial_balance"].includes(data?.reason)) summary.errors++;
    } catch (error) {
      summary.errors++;
      // A failed provider read is not evidence that the OS disappeared.
      await mark(forecast.id, { conversao_status: "ERRO", conversao_erro: String((error as Error).message || error) })
        .catch((markError) => console.warn(`[central-sync] previsão ${forecast.id}: ${markError}`));
    }
  }
  return summary;
}
