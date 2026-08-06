import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildTechnicianDashboardData,
  buildTechnicianAllowlist,
  type TechnicianTaskRow,
} from "@/lib/technicianDashboard";

const PAGE_SIZE = 1000;
const TECH_ROLE_PATTERN = /(tecnic|técnic)/i;
const AUX_PATTERN = /auxiliar/i;
const TASK_FIELDS = "auvo_task_id,mirror_key,atualizado_em,tecnico_id,tecnico,data_tarefa,data_conclusao,status_auvo,check_out,check_in_iso,check_out_iso,pendencia,questionario_preenchido,duracao_decimal,duracao_deslocamento,gc_os_id,gc_os_valor_total,gc_orcamento_id,gc_orc_valor_total,os_realizada";

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Falha ao carregar tarefas dos técnicos");
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export function useTechnicianDashboard(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["tech-dashboard-direct", startDate, endDate],
    queryFn: async () => {
      const [scheduledTasks, completedFromOtherPeriods, staff] = await Promise.all([
        fetchAllPages<TechnicianTaskRow>((from, to) =>
          supabase
            .from("tarefas_central")
            .select(TASK_FIELDS)
            .gte("data_tarefa", startDate)
            .lte("data_tarefa", endDate)
            .order("atualizado_em", { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<TechnicianTaskRow>((from, to) =>
          supabase
            .from("tarefas_central")
            .select(TASK_FIELDS)
            .not("data_conclusao", "is", null)
            .gte("data_conclusao", startDate)
            .lte("data_conclusao", endDate)
            .or(`data_tarefa.lt.${startDate},data_tarefa.gt.${endDate},data_tarefa.is.null`)
            .order("atualizado_em", { ascending: false })
            .range(from, to),
        ),
        supabase
          .from("rh_colaboradores")
          .select("nome,cargo,funcao,auvo_user_id,ativo")
          .eq("ativo", true)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message || "Falha ao carregar colaboradores do RH");
            return data || [];
          }),
      ]);

      // Somente colaboradores do RH cadastrados como técnico ou auxiliar técnico
      const tecnicos = staff.filter((person) => {
        const cargo = `${person.cargo || ""} ${person.funcao || ""}`;
        if (!cargo.trim()) return false;
        return TECH_ROLE_PATTERN.test(cargo) || AUX_PATTERN.test(cargo);
      });

      return buildTechnicianDashboardData(
        [...scheduledTasks, ...completedFromOtherPeriods],
        startDate,
        endDate,
        buildTechnicianAllowlist(tecnicos),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
