import { clockToMinutes, minutesToClock } from "./auvoDuration";

/** Store planned time only on the real task; forecasts may refer to an older task. */
export async function saveConfirmedAgendaDuration(
  client: any,
  taskId: string,
  durationMinutes: number,
  taskDate?: string,
): Promise<void> {
  const { data: rows, error } = await client.from("agenda_agendamentos")
    .select("id,hora_inicio,previsao_continuidade")
    .eq("auvo_task_id", taskId)
    .or("previsao_continuidade.is.null,previsao_continuidade.eq.false");
  if (error) throw error;
  for (const row of rows || []) {
    if (row.previsao_continuidade) continue;
    const start = taskDate?.slice(11, 16) || row.hora_inicio?.slice(0, 5);
    const patch = {
      duracao_planejada_minutos: durationMinutes,
      ...(start ? { hora_fim: `${minutesToClock((clockToMinutes(start) + durationMinutes) % 1440)}:00` } : {}),
      ...(taskDate ? { data: taskDate.slice(0, 10), hora_inicio: `${taskDate.slice(11, 16)}:00` } : {}),
    };
    const { error: updateError } = await client.from("agenda_agendamentos")
      .update(patch).eq("id", row.id).eq("auvo_task_id", taskId)
      .or("previsao_continuidade.is.null,previsao_continuidade.eq.false");
    if (updateError) throw updateError;
  }
}
