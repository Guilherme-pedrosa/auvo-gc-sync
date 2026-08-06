import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PremiacaoFaturamento = {
  month: string;
  total: number;
  porTecnico: Map<string, { faturamento: number; os_count: number; nome: string }>;
};

export const normalizeTechKey = (name: string) =>
  (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)[0] || "";

/**
 * Faturamento oficial por técnico — mesma fonte da tela de Premiação
 * (OS do GestãoClick pela data de saída do mês, com rateio das divisões).
 */
export function usePremiacaoFaturamento(month: string | null) {
  return useQuery<PremiacaoFaturamento | null>({
    queryKey: ["premiacao-faturamento", month],
    enabled: !!month,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("premiacao", { body: { month } });
      if (error) throw error;
      const resp = data as {
        ok?: boolean;
        error?: string;
        tecnicos?: Array<{ tecnico: string; os_count: number; faturamento?: number; valor_pecas: number; valor_servicos: number }>;
        totais?: { faturamento?: number };
      };
      if (resp?.ok === false) throw new Error(resp.error || "Falha ao carregar o faturamento da Premiação");
      const porTecnico = new Map<string, { faturamento: number; os_count: number; nome: string }>();
      let calculatedTotal = 0;
      for (const tech of resp?.tecnicos || []) {
        const value = Number(tech.faturamento ?? (tech.valor_pecas || 0) + (tech.valor_servicos || 0)) || 0;
        calculatedTotal += value;
        const key = normalizeTechKey(tech.tecnico);
        const current = porTecnico.get(key);
        porTecnico.set(key, {
          nome: tech.tecnico,
          faturamento: (current?.faturamento || 0) + value,
          os_count: (current?.os_count || 0) + (Number(tech.os_count) || 0),
        });
      }
      const officialTotal = Number(resp?.totais?.faturamento);
      const total = Number.isFinite(officialTotal) ? officialTotal : calculatedTotal;
      return { month: month as string, total: Math.round(total * 100) / 100, porTecnico };
    },
  });
}
