import { supabase } from "@/integrations/supabase/client";
import { latestMissingPartsArrival, type ChegadaItem } from "@/lib/agendamento";

export const PREVISAO_CHEGADA_QUERY_KEY = ["compras-chegadas"] as const;

export async function fetchPrevisoesChegada(): Promise<ChegadaItem[]> {
  const { data, error } = await supabase.functions.invoke("compras-chegadas", { body: {} });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data?.error || "Falha ao consultar a chegada das peças");

  return ((data?.itens || []) as ChegadaItem[]).map((item) => {
    const maiorPrazo = latestMissingPartsArrival(item.pecas_em_falta);
    return maiorPrazo
      ? { ...item, data_chegada: maiorPrazo, proxima_reposicao: maiorPrazo }
      : item;
  });
}

export function chegadaDoAgendamento(
  agendamento: { gc_orcamento_codigo?: string | null; gc_os_codigo?: string | null },
  chegadas: ChegadaItem[],
): ChegadaItem | null {
  const orcamento = String(agendamento.gc_orcamento_codigo || "").trim();
  const os = String(agendamento.gc_os_codigo || "").trim();

  return chegadas.find((item) => {
    const itemOrcamento = String(item.orcamento_codigo || (item.vinculo_tipo === "orcamento" ? item.vinculo_codigo : "")).trim();
    const itemOs = String(item.os_codigo || (item.vinculo_tipo === "os" ? item.vinculo_codigo : "")).trim();
    return Boolean((orcamento && itemOrcamento === orcamento) || (os && itemOs === os));
  }) ?? null;
}