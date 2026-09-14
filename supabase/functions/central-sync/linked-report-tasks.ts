import { auvoTaskStatus } from "../_shared/auvo-task-status.ts";
import { auvoCheckInDate, auvoCheckOutDate, computeAuvoWorkedHours } from "../_shared/auvo-worked-time.ts";
import { auvoTaskTypeDescription, auvoTaskTypeId } from "../_shared/auvo-task-type.ts";
import { resolveQuestionnaireData } from "./questionnaire-normalizer.ts";

export type LinkedTaskWarning = {
  kind: "auvo_task"; task_id: string; status: number | null; message: string;
};

export function confirmedAuvoTask(payload: any, requestedId: string): any {
  const task = payload?.result ?? payload?.data?.result ?? payload?.data ?? payload;
  const actualId = String(task?.taskID ?? task?.taskId ?? task?.id ?? "");
  const status = task?.taskStatus ?? task?.status;
  const statusCode = Number(typeof status === "object" ? status?.id ?? status?.status : status);
  const statusLabel = typeof status === "object" ? status?.description : typeof status === "string" ? status : "";
  const statusConfirmed = [1, 2, 3, 4, 5, 6].includes(statusCode)
    || (typeof statusLabel === "string" && statusLabel.trim().length > 0 && !Number.isFinite(Number(statusLabel)));
  if (!task || Array.isArray(task) || actualId !== requestedId
    || !statusConfirmed) {
    throw new Error(`Auvo não confirmou a identidade e a situação da tarefa ${requestedId}. Registro preservado.`);
  }
  return { ...task, taskID: requestedId };
}

const date = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) && !raw.startsWith("0001-") ? raw.slice(0, 10) : null;
};
const time = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("0001-")) return null;
  const match = raw.match(/(?:T|\s|^)(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : null;
};
const iso = (value: string | null): string | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

function workedHours(task: any): number {
  // The planned-duration parser rounds to minutes. Keep official worked seconds.
  const duration = String(task.duration ?? task.Duration ?? "").trim();
  const span = duration.match(/^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (span && Number(span[3]) < 60 && Number(span[4]) < 60) {
    const seconds = Number(span[1] || 0) * 86400 + Number(span[2]) * 3600
      + Number(span[3]) * 60 + Number(span[4]) + Number(`0.${span[5] || 0}`);
    if (seconds > 0) return Math.round(seconds / 3600 * 10_000) / 10_000;
  }
  return computeAuvoWorkedHours(task);
}

/** Auvo-owned fields only: reading an execution cannot replace the GC diagnostic link. */
export function mapLinkedAuvoReportTask(task: any): Record<string, unknown> {
  const taskId = String(task.taskID);
  const checkIn = auvoCheckInDate(task);
  const checkOut = auvoCheckOutDate(task);
  const taskDate = task.taskDate !== undefined ? task.taskDate : task.task_date !== undefined ? task.task_date : task.date;
  const endDate = task.taskEndDate !== undefined ? task.taskEndDate
    : task.taskEndDateTime !== undefined ? task.taskEndDateTime : task.scheduledEndDate;
  const technician = task.userTo ?? task.user_to ?? task.assignedUser ?? {};
  const patch: Record<string, unknown> = {
    status_auvo: auvoTaskStatus(task),
    duracao_decimal: workedHours(task),
    check_in: task.checkIn === true || !!checkIn,
    check_out: task.checkOut === true || !!checkOut,
    check_in_iso: iso(checkIn), check_out_iso: iso(checkOut),
    data_conclusao: date(checkOut),
    auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
    atualizado_em: new Date().toISOString(),
  };
  // Missing schedule is valid. Never use the GC date to invent an Auvo schedule.
  if (taskDate !== undefined) patch.data_tarefa = date(taskDate);
  if (taskDate !== undefined || checkIn || task.startTime !== undefined) {
    patch.hora_inicio = time(checkIn) || time(task.startTime ?? task.startHour) || time(taskDate);
  }
  if (endDate !== undefined || checkOut || task.endTime !== undefined) {
    patch.hora_fim = time(checkOut) || time(task.endTime ?? task.endHour) || time(endDate);
  }
  if (task.idUserTo !== undefined || task.id_user_to !== undefined || task.userTo !== undefined) {
    const id = Number(task.idUserTo ?? task.id_user_to ?? technician.userID ?? technician.id);
    patch.tecnico_id = Number.isSafeInteger(id) && id > 0 ? String(id) : "";
  }
  const name = task.userToName ?? technician.name ?? technician.login ?? task.technician;
  if (name !== undefined) patch.tecnico = String(name ?? "").trim();
  if (patch.tecnico_id === "") patch.tecnico = "";
  const customer = task.customerDescription ?? task.customerName ?? task.customer?.tradeName ?? task.customer?.companyName;
  if (customer !== undefined) patch.cliente = String(customer ?? "").trim();
  if (task.orientation !== undefined) patch.orientacao = String(task.orientation ?? "").slice(0, 500);
  if (task.report !== undefined) patch.relato_usuario = String(task.report ?? "");
  if (task.pendency !== undefined) patch.pendencia = String(task.pendency ?? "");
  const typeId = auvoTaskTypeId(task);
  const description = auvoTaskTypeDescription(task);
  if (typeId) patch.task_type_id = typeId;
  if (description) patch.descricao = description;
  if (task.taskUrl !== undefined) patch.auvo_task_url = String(task.taskUrl ?? "");
  if (task.survey !== undefined) patch.auvo_survey_url = String(task.survey ?? "");
  if (Array.isArray(task.questionnaires)) {
    const questionnaire = resolveQuestionnaireData("216040", task.questionnaires);
    patch.questionario_id = questionnaire.questionnaireId;
    patch.questionario_respostas = questionnaire.answers;
    patch.questionario_preenchido = questionnaire.filled;
  }
  return patch;
}

/** Each explicit GC task is fetched once, including tasks absent from the mirror. */
export async function syncLinkedReportTasks(db: any, taskIds: string[], deps: {
  getTask: (id: string) => Promise<Response>;
  enrich?: (task: any) => Promise<Record<string, unknown>>;
  afterSave?: (task: any) => Promise<void>;
}) {
  const warnings: LinkedTaskWarning[] = [];
  let tasks = 0;
  let saved = 0;
  for (const taskId of [...new Set(taskIds)]) {
    let status: number | null = null;
    try {
      const response = await deps.getTask(taskId);
      status = response.status;
      if (!response.ok) throw new Error(`Tarefa Auvo ${taskId}: HTTP ${status}. Registro preservado.`);
      const task = confirmedAuvoTask(await response.json(), taskId);
      const patch = { ...mapLinkedAuvoReportTask(task), ...(await deps.enrich?.(task) ?? {}) };
      const { data: existing, error: readError } = await db.from("tarefas_central")
        .select("mirror_key").eq("auvo_task_id", taskId);
      if (readError) throw new Error(`Falha ao ler tarefa ${taskId}: ${readError.message}`);
      if (!existing?.length) {
        const { error } = await db.from("tarefas_central").upsert({
          auvo_task_id: taskId, mirror_key: `${taskId}::os:::orc:`,
          cliente: "", tecnico: "", tecnico_id: "", data_tarefa: null,
          os_realizada: false, orcamento_realizado: false, ...patch,
        }, { onConflict: "mirror_key", defaultToNull: false, ignoreDuplicates: true });
        if (error) throw error;
      }
      // Includes concurrent inserts, without resetting their GC/budget flags.
      // One Auvo task may belong to several documents: update every mirror.
      const { error: updateError } = await db.from("tarefas_central").update(patch).eq("auvo_task_id", taskId);
      if (updateError) throw updateError;
      await deps.afterSave?.(task);
      tasks++;
      saved++;
    } catch (error: any) {
      if (status === 401 || status === 403 || error?.name === "AbortError") throw error;
      warnings.push({ kind: "auvo_task", task_id: taskId, status,
        message: error?.message || `Não foi possível confirmar a tarefa Auvo ${taskId}. Registro preservado.` });
    }
  }
  return { success: true, auvo_tarefas: tasks, upserted: saved, warnings, incomplete: warnings.length > 0 };
}
