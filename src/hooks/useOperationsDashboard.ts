import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  buildOperationsDashboardSnapshot,
  type AnalysisSnapshotRow,
  type FollowupColumnRow,
  type KanbanSnapshotRow,
  type PreventiveSnapshotRow,
  type SyncMetaRow,
  type TaskSnapshotRow,
} from "@/lib/operationsDashboard";

const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Falha ao carregar dados operacionais");
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export function useOperationsDashboard() {
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["operations-dashboard", monthStart, today],
    queryFn: async () => {
      const [
        tasks,
        budgetCards,
        workshopCards,
        followupCards,
        followupColumnsResult,
        preventiveRows,
        plannedRows,
        analysisResult,
        missedActivitiesResult,
        syncMetaResult,
      ] = await Promise.all([
        fetchAllPages<TaskSnapshotRow>((from, to) =>
          supabase
            .from("tarefas_central")
            .select("auvo_task_id,mirror_key,data_tarefa,status_auvo,tecnico,tecnico_id,check_in,check_out,check_in_iso,check_out_iso,questionario_preenchido,pendencia,duracao_decimal,duracao_deslocamento,orcamento_realizado,os_realizada,atualizado_em")
            .gte("data_tarefa", monthStart)
            .lte("data_tarefa", today)
            .order("atualizado_em", { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<KanbanSnapshotRow>((from, to) =>
          supabase
            .from("kanban_orcamentos_cache")
            .select("coluna,atualizado_em")
            .range(from, to),
        ),
        fetchAllPages<KanbanSnapshotRow>((from, to) =>
          supabase
            .from("kanban_oficina_cache")
            .select("coluna,atualizado_em")
            .range(from, to),
        ),
        fetchAllPages<KanbanSnapshotRow>((from, to) =>
          supabase
            .from("followup_kanban_cache")
            .select("coluna,atualizado_em")
            .range(from, to),
        ),
        supabase
          .from("followup_kanban_colunas")
          .select("id,titulo,situacao_id")
          .order("ordem"),
        fetchAllPages<PreventiveSnapshotRow>((from, to) =>
          supabase
            .from("equipamento_preventiva_consolidado")
            .select("identificador,status_preventiva,proxima_preventiva,atualizado_em")
            .range(from, to),
        ),
        fetchAllPages<{ codigo_barras_auvo: string | null }>((from, to) =>
          supabase
            .from("equipamento_plano_preventivo")
            .select("codigo_barras_auvo")
            .eq("ativo", true)
            .range(from, to),
        ),
        supabase
          .from("analises_operacionais")
          .select("status_analise,prioridade,atualizado_em"),
        supabase
          .from("atividades_nao_executadas")
          .select("id", { count: "exact", head: true })
          .gte("data_planejada", monthStart)
          .lte("data_planejada", today),
        supabase
          .from("kanban_sync_meta")
          .select("id,ultimo_sync,sync_status,sync_finished_at,sync_error")
          .eq("id", "default")
          .maybeSingle(),
      ]);

      if (followupColumnsResult.error) throw followupColumnsResult.error;
      if (analysisResult.error) throw analysisResult.error;
      if (missedActivitiesResult.error) throw missedActivitiesResult.error;
      if (syncMetaResult.error) throw syncMetaResult.error;

      return buildOperationsDashboardSnapshot(
        {
          tasks,
          budgetCards,
          workshopCards,
          followupCards,
          followupColumns: (followupColumnsResult.data || []) as FollowupColumnRow[],
          preventiveRows,
          plannedPreventiveIds: plannedRows.map((row) => row.codigo_barras_auvo || "").filter(Boolean),
          analysisRows: (analysisResult.data || []) as AnalysisSnapshotRow[],
          missedActivities: missedActivitiesResult.count || 0,
          syncMeta: syncMetaResult.data as SyncMetaRow | null,
        },
        now,
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
