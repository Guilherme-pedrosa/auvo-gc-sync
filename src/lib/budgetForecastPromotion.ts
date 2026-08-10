import { supabase } from "@/integrations/supabase/client";

export type BudgetExecutionForecast = {
  id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  colaborador_id: string | null;
  colaborador_nome: string;
  auvo_user_id: string | null;
  gc_orcamento_codigo: string;
};

function normalizeCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function durationClock(start: string, end: string): string {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
    return hours * 60 + minutes;
  };
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  const duration = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : (24 * 60 - startMinutes) + endMinutes;
  return `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
}

export async function loadBudgetExecutionForecast(
  budgetCode: unknown,
): Promise<BudgetExecutionForecast | null> {
  const normalized = normalizeCode(budgetCode);
  if (!normalized) return null;
  const { data: forecast, error } = await supabase
    .from("agenda_agendamentos")
    .select("id,data,hora_inicio,hora_fim,colaborador_id,colaborador_nome,gc_orcamento_codigo")
    .eq("gc_orcamento_codigo", normalized)
    .eq("previsao_tipo", "ORCAMENTO_EXECUCAO")
    .eq("previsao_continuidade", true)
    .maybeSingle();
  if (error) throw error;
  if (!forecast) return null;

  let auvoUserId: string | null = null;
  if (forecast.colaborador_id) {
    const { data: collaborator, error: collaboratorError } = await supabase
      .from("rh_colaboradores")
      .select("auvo_user_id")
      .eq("id", forecast.colaborador_id)
      .maybeSingle();
    if (collaboratorError) throw collaboratorError;
    if (collaborator?.auvo_user_id) auvoUserId = String(collaborator.auvo_user_id);
  }
  return { ...forecast, auvo_user_id: auvoUserId } as BudgetExecutionForecast;
}

export async function promoteBudgetExecutionForecast(input: {
  budgetCode: unknown;
  osCode: unknown;
  execTaskId: unknown;
}) {
  const { data, error } = await supabase.functions.invoke("auvo-task-update", {
    body: {
      action: "promote-budget-forecast",
      gcOrcamentoCodigo: normalizeCode(input.budgetCode),
      gcOsCodigo: normalizeCode(input.osCode),
      execTaskId: normalizeCode(input.execTaskId),
    },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data?.error || data?.reason || "Não foi possível converter a previsão");
  return data;
}
