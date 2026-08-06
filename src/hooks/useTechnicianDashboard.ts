import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildTechnicianDashboardData,
  buildTechnicianAllowlist,
  buildContractRates,
  type TechnicianTaskRow,
} from "@/lib/technicianDashboard";

const PAGE_SIZE = 1000;
const TECH_ROLE_PATTERN = /(tecnic|técnic)/i;
const AUX_PATTERN = /auxiliar/i;
const TASK_FIELDS = "auvo_task_id,mirror_key,atualizado_em,tecnico_id,tecnico,cliente,data_tarefa,data_conclusao,status_auvo,check_out,check_in_iso,check_out_iso,pendencia,questionario_preenchido,duracao_decimal,duracao_deslocamento,gc_os_id,gc_os_valor_total,gc_orcamento_id,gc_orc_valor_total,os_realizada";

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
      const [scheduledTasks, completedFromOtherPeriods, staff, contracts, groupMembers] = await Promise.all([
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
        supabase
          .from("contratos")
          .select("valor_hora,cliente_nome,grupo_id,ativo,vigencia_inicio,vigencia_fim")
          .eq("ativo", true)
          .then(({ data }) => data || []),
        supabase
          .from("grupo_cliente_membros")
          .select("grupo_id,cliente_nome")
          .then(({ data }) => data || []),
      ]);

      // Somente colaboradores do RH cadastrados como técnico ou auxiliar técnico
      const tecnicos = staff.filter((person) => {
        const cargo = `${person.cargo || ""} ${person.funcao || ""}`;
        if (!cargo.trim()) return false;
        return TECH_ROLE_PATTERN.test(cargo) || AUX_PATTERN.test(cargo);
      });

      const vigentes = contracts.filter((contract) => {
        if (contract.vigencia_inicio && contract.vigencia_inicio > endDate) return false;
        if (contract.vigencia_fim && contract.vigencia_fim < startDate) return false;
        return true;
      });

      return buildTechnicianDashboardData(
        [...scheduledTasks, ...completedFromOtherPeriods],
        startDate,
        endDate,
        buildTechnicianAllowlist(tecnicos),
        buildContractRates(vigentes, groupMembers),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
