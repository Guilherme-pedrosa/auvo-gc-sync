import { supabase } from "@/integrations/supabase/client";
import { type ChegadaItem } from "@/lib/agendamento";
import { normalizeChegadaForPlanning } from "./partialBalancePlanning";

export const PREVISAO_CHEGADA_QUERY_KEY = ["compras-chegadas"] as const;

export async function fetchPrevisoesChegada(): Promise<ChegadaItem[]> {
  const { data, error } = await supabase.functions.invoke("compras-chegadas", { body: {} });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data?.error || "Falha ao consultar a chegada das peças");

  return ((data?.itens || []) as ChegadaItem[]).map(normalizeChegadaForPlanning);
}

export function chegadaDoAgendamento(
  agendamento: { gc_orcamento_codigo?: string | null; gc_os_codigo?: string | null },
  chegadas: ChegadaItem[],
): ChegadaItem | null {
  const orcamento = String(agendamento.gc_orcamento_codigo || "").trim();
  const os = String(agendamento.gc_os_codigo || "").trim();

  // Orçamento identifica o saldo; a OS pode pertencer a uma baixa anterior.
  if (orcamento) return chegadas.find((item) => {
    const itemOrcamento = String(item.orcamento_codigo || (item.vinculo_tipo === "orcamento" ? item.vinculo_codigo : "")).trim();
    return itemOrcamento === orcamento;
  }) ?? null;
  return chegadas.find((item) => {
    const itemOs = String(item.os_codigo || (item.vinculo_tipo === "os" ? item.vinculo_codigo : "")).trim();
    return Boolean(os && itemOs === os);
  }) ?? null;
}
