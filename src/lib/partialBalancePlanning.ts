import { resolvePartialWriteoffArrival } from "../../supabase/functions/_shared/partial-writeoff-balance";
import { latestMissingPartsArrival, todayISO, type ChegadaItem } from "./agendamento";

export const PARTIAL_BALANCE_FORECAST = "SALDO_BAIXA_PARCIAL";

/** Aplica também aos snapshots anteriores à correção, sem reaproveitar a chegada de lotes já baixados. */
export function normalizeChegadaForPlanning(item: ChegadaItem): ChegadaItem {
  const partial = resolvePartialWriteoffArrival({
    group: item.grupo,
    status: item.saldo_baixa_parcial_status ?? "unavailable",
    pendingProducts: item.produtos ?? [],
    missingProducts: item.pecas_em_falta ?? [],
    allInStock: item.todos_em_estoque === true,
    today: todayISO(),
  });
  if (partial) return { ...item, ...partial };
  const date = latestMissingPartsArrival(item.pecas_em_falta);
  return date ? { ...item, data_chegada: date, proxima_reposicao: date } : item;
}

export function isPartialBalanceForecast(
  forecast: { previsao_tipo?: string | null; previsao_continuidade?: boolean; auvo_task_id?: string | null },
  arrival?: ChegadaItem | null,
): boolean {
  return Boolean(forecast.previsao_continuidade && !forecast.auvo_task_id
    && (forecast.previsao_tipo === PARTIAL_BALANCE_FORECAST
      || (forecast.previsao_tipo === "ORCAMENTO_EXECUCAO" && arrival?.grupo === "baixa_parcial")));
}

export function partialBalancePlanningStatus(arrival?: ChegadaItem | null): string {
  if (arrival?.saldo_baixa_parcial_encerrado) return "Saldo encerrado · sem peças restantes";
  if (arrival?.saldo_baixa_parcial_status !== "verified") return "Saldo a confirmar no Pick & Pack";
  if (arrival.todos_em_estoque) return "Saldo restante disponível em estoque";
  return arrival.data_chegada ? "Saldo restante · chegada prevista" : "Saldo restante · prazo das peças não confirmado";
}

export function partialBalanceConversionStatus(arrival?: ChegadaItem | null): string {
  if (arrival?.saldo_baixa_parcial_encerrado) return "SALDO_ENCERRADO";
  return arrival?.saldo_baixa_parcial_status === "verified" ? "SALDO_PENDENTE" : "SALDO_A_CONFIRMAR";
}
