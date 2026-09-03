export const MIN_EXECUTION_PHOTOS = 3;
export const MIN_REPORT_CHARACTERS = 35;
export const MIN_REPORT_WORDS = 5;

export type QuestionnaireAnswer = {
  question?: unknown;
  reply?: unknown;
};

export type TechnicianTaskAuditInput = {
  auvo_task_id: string;
  atualizado_em?: string | null;
  tecnico_id?: string | null;
  tecnico?: string | null;
  cliente?: string | null;
  data_tarefa?: string | null;
  data_conclusao?: string | null;
  status_auvo?: string | null;
  check_out?: boolean | null;
  pendencia?: string | null;
  descricao?: string | null;
  orientacao?: string | null;
  questionario_preenchido?: boolean | null;
  questionario_respostas?: unknown;
  gc_os_codigo?: string | null;
  auvo_link?: string | null;
};

export type TechnicianTaskAudit = {
  taskId: string;
  technicianId: string;
  technicianName: string;
  client: string;
  date: string;
  description: string;
  gcOsCode: string;
  auvoUrl: string;
  photoCount: number;
  formIssue: boolean;
  reportIssue: boolean;
  photoIssue: boolean;
  formReasons: string[];
  reportReason: string;
  photoReason: string;
};

export type TechnicianScheduleIssue = {
  id?: string;
  auvo_task_id: string;
  tecnico_id?: string | null;
  tecnico_nome?: string | null;
  cliente?: string | null;
  data_planejada?: string | null;
  descricao?: string | null;
  motivo?: string | null;
};

export type DivergenceKind = "schedule" | "form" | "report" | "photos" | "checkin";

export type DivergenceIssue = {
  kind: DivergenceKind;
  label: string;
  detail: string;
};

export type TechnicianDivergenceRecord = {
  key: string;
  taskId: string;
  technicianId: string;
  technicianName: string;
  client: string;
  date: string;
  description: string;
  gcOsCode: string;
  auvoUrl: string;
  photoCount: number | null;
  issues: DivergenceIssue[];
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const isBlankReply = (value: unknown) => {
  const reply = normalize(value);
  return !reply || [".", "-", "na", "n/a", "null", "undefined", "0"].includes(reply);
};

const isFinished = (task: TechnicianTaskAuditInput) =>
  task.check_out === true || ["finalizada", "concluida"].includes(normalize(task.status_auvo));

const hasPendingText = (value: unknown) => {
  const pending = normalize(value);
  return Boolean(pending && !["nenhuma", "sem pendencia", "0"].includes(pending));
};

function answersFrom(value: unknown): QuestionnaireAnswer[] {
  if (!Array.isArray(value)) return [];
  const answers: QuestionnaireAnswer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const nested = Array.isArray(record.answers) ? record.answers : null;
    if (nested) {
      for (const nestedAnswer of nested) {
        if (!nestedAnswer || typeof nestedAnswer !== "object") continue;
        const answer = nestedAnswer as Record<string, unknown>;
        answers.push({
          question: answer.question ?? answer.questionDescription,
          reply: answer.reply,
        });
      }
      continue;
    }
    answers.push({
      question: record.question ?? record.questionDescription,
      reply: record.reply,
    });
  }
  return answers;
}

export function hasQuestionnaireResponses(value: unknown) {
  return answersFrom(value).some((answer) => !isBlankReply(answer.reply));
}

function urlsFrom(value: unknown) {
  return String(value ?? "").match(/https?:\/\/[^\s<>"']+/gi) || [];
}

const isPhotoAnswer = (answer: QuestionnaireAnswer, url: string) => {
  const question = normalize(answer.question);
  if (/assinatura/.test(question)) return false;
  return /(foto|imagem|evidencia)/.test(question)
    || /\.(jpe?g|png|webp|heic)(?:\?|$)/i.test(url)
    || /auvo-producao\.s3\./i.test(url);
};

export function countExecutionPhotos(value: unknown) {
  const urls = new Set<string>();
  for (const answer of answersFrom(value)) {
    for (const url of urlsFrom(answer.reply)) {
      if (isPhotoAnswer(answer, url)) urls.add(url.replace(/[),.;]+$/, ""));
    }
  }
  return urls.size;
}

const textWithoutUrls = (value: unknown) =>
  String(value ?? "")
    .replace(/https?:\/\/[^\s<>"']+/gi, " ")
    .replace(/[^\p{L}\p{N}\s.,;:!?()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordCount = (value: string) => value.match(/[\p{L}\p{N}]+/gu)?.length || 0;

function executionReportCandidates(value: unknown) {
  const answers = answersFrom(value);
  const narrative = answers
    .filter((answer) => {
      const question = normalize(answer.question);
      return !/(foto|imagem|evidencia|horas? para|tempo estimado|assinatura)/.test(question);
    })
    .map((answer) => ({
      question: normalize(answer.question),
      text: textWithoutUrls(answer.reply),
    }))
    .filter((answer) => !isBlankReply(answer.text));

  const preferred = narrative.filter((answer) =>
    /(observ|relato|servic|diagnost|soluc|causa|execuc|atendimento)/.test(answer.question),
  );
  return preferred.length > 0 ? preferred : narrative;
}

export function hasComprehensibleExecutionReport(value: unknown) {
  const candidates = executionReportCandidates(value);

  if (candidates.some((answer) =>
    answer.text.length >= MIN_REPORT_CHARACTERS && wordCount(answer.text) >= MIN_REPORT_WORDS,
  )) return true;

  const combined = candidates.map((answer) => answer.text).join(" ");
  return combined.length >= 80 && wordCount(combined) >= 10;
}

export function auditTechnicianTask(task: TechnicianTaskAuditInput): TechnicianTaskAudit | null {
  if (!isFinished(task)) return null;

  const answers = answersFrom(task.questionario_respostas);
  const blankFields = answers
    .filter((answer) => isBlankReply(answer.reply))
    .map((answer) => String(answer.question || "Campo sem identificação").trim())
    .filter(Boolean);
  const pending = hasPendingText(task.pendencia);
  const formReasons = [
    ...(task.questionario_preenchido !== true || answers.length === 0 ? ["Formulário não enviado ou sem respostas"] : []),
    ...(blankFields.length > 0 ? [`Campos sem preenchimento: ${blankFields.join(", ")}`] : []),
    ...(pending ? [`Pendência registrada: ${String(task.pendencia).trim()}`] : []),
  ];
  const reportOk = hasComprehensibleExecutionReport(task.questionario_respostas);
  const reportText = executionReportCandidates(task.questionario_respostas)
    .map((answer) => answer.text)
    .join(" ")
    .trim();
  const reportPreview = reportText.length > 160 ? `${reportText.slice(0, 157)}...` : reportText;
  const photoCount = countExecutionPhotos(task.questionario_respostas);

  return {
    taskId: String(task.auvo_task_id || "").trim(),
    technicianId: String(task.tecnico_id || task.tecnico || "").trim(),
    technicianName: String(task.tecnico || "Sem técnico").trim() || "Sem técnico",
    client: String(task.cliente || "Sem cliente").trim() || "Sem cliente",
    date: String(task.data_conclusao || task.data_tarefa || "").slice(0, 10),
    description: String(task.descricao || "").trim(),
    gcOsCode: String(task.gc_os_codigo || "").trim(),
    auvoUrl: String(task.auvo_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${task.auvo_task_id}`),
    photoCount,
    formIssue: formReasons.length > 0,
    reportIssue: !reportOk,
    photoIssue: photoCount < MIN_EXECUTION_PHOTOS,
    formReasons,
    reportReason: reportOk
      ? ""
      : reportText
        ? `Relato encontrado: “${reportPreview}” — ${reportText.length} caractere(s) e ${wordCount(reportText)} palavra(s); não explica a execução com clareza suficiente`
        : "Nenhum relato técnico de execução foi encontrado nas respostas do formulário",
    photoReason: photoCount === 0
      ? `Nenhuma foto anexada (mínimo operacional: ${MIN_EXECUTION_PHOTOS})`
      : photoCount < MIN_EXECUTION_PHOTOS
        ? `Somente ${photoCount} foto(s) anexada(s) (mínimo operacional: ${MIN_EXECUTION_PHOTOS})`
        : "",
  };
}

export function auditTechnicianTasks(rows: TechnicianTaskAuditInput[]) {
  const latest = new Map<string, TechnicianTaskAuditInput>();
  for (const row of rows) {
    const taskId = String(row.auvo_task_id || "").trim();
    if (!taskId) continue;
    const current = latest.get(taskId);
    const currentTime = current?.atualizado_em ? Date.parse(current.atualizado_em) : 0;
    const rowTime = row.atualizado_em ? Date.parse(row.atualizado_em) : 0;
    if (!current || rowTime >= currentTime) latest.set(taskId, row);
  }
  return [...latest.values()].map(auditTechnicianTask).filter((audit): audit is TechnicianTaskAudit => Boolean(audit));
}

export type TechnicianCheckinIssue = {
  taskId: string;
  technicianId: string;
  technicianName: string;
  client: string;
  date: string;
  description: string;
  gcOsCode: string;
  auvoUrl: string;
  checkInIso: string;
};

export function buildTechnicianDivergenceRecords(
  scheduleIssues: TechnicianScheduleIssue[],
  taskAudits: TechnicianTaskAudit[],
  checkinIssues: TechnicianCheckinIssue[] = [],
) {
  const records = new Map<string, TechnicianDivergenceRecord>();

  const ensure = (input: Omit<TechnicianDivergenceRecord, "issues">) => {
    const current = records.get(input.key);
    if (current) return current;
    const record = { ...input, issues: [] };
    records.set(input.key, record);
    return record;
  };

  for (const item of scheduleIssues) {
    const taskId = String(item.auvo_task_id || "").trim();
    const technicianId = String(item.tecnico_id || item.tecnico_nome || "sem-tecnico").trim();
    const record = ensure({
      key: `${technicianId}::${taskId || item.id || item.data_planejada}`,
      taskId,
      technicianId,
      technicianName: String(item.tecnico_nome || "Sem técnico").trim() || "Sem técnico",
      client: String(item.cliente || "Sem cliente").trim() || "Sem cliente",
      date: String(item.data_planejada || "").slice(0, 10),
      description: String(item.descricao || "").trim(),
      gcOsCode: "",
      auvoUrl: taskId ? `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}` : "",
      photoCount: null,
    });
    record.issues.push({
      kind: "schedule",
      label: "Não atendida",
      detail: String(item.motivo || "Agendamento não executado no dia planejado").trim(),
    });
  }

  for (const audit of taskAudits) {
    if (!audit.formIssue && !audit.reportIssue && !audit.photoIssue) continue;
    const key = `${audit.technicianId || audit.technicianName}::${audit.taskId}`;
    const record = ensure({
      key,
      taskId: audit.taskId,
      technicianId: audit.technicianId,
      technicianName: audit.technicianName,
      client: audit.client,
      date: audit.date,
      description: audit.description,
      gcOsCode: audit.gcOsCode,
      auvoUrl: audit.auvoUrl,
      photoCount: audit.photoCount,
    });
    if (audit.formIssue) record.issues.push({ kind: "form", label: "Formulário", detail: audit.formReasons.join("; ") });
    if (audit.reportIssue) record.issues.push({ kind: "report", label: "Sem relato útil", detail: audit.reportReason });
    if (audit.photoIssue) record.issues.push({ kind: "photos", label: "Fotos insuficientes", detail: audit.photoReason });
  }

  for (const checkin of checkinIssues) {
    const record = ensure({
      key: `${checkin.technicianId || checkin.technicianName}::${checkin.taskId}`,
      taskId: checkin.taskId,
      technicianId: checkin.technicianId,
      technicianName: checkin.technicianName,
      client: checkin.client,
      date: checkin.date,
      description: checkin.description,
      gcOsCode: checkin.gcOsCode,
      auvoUrl: checkin.auvoUrl,
      photoCount: null,
    });
    const started = Date.parse(checkin.checkInIso);
    const startedLabel = Number.isFinite(started)
      ? new Date(started).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : checkin.checkInIso;
    record.issues.push({
      kind: "checkin",
      label: "Check-in aberto",
      detail: `Check-in em ${startedLabel} sem check-out registrado — a tarefa ficou aberta no Auvo`,
    });
  }

  return [...records.values()].sort((a, b) => b.date.localeCompare(a.date) || a.technicianName.localeCompare(b.technicianName));
}

export function summarizeDivergenceRecords(records: TechnicianDivergenceRecord[]) {
  const count = (kind: DivergenceKind) => records.filter((record) => record.issues.some((issue) => issue.kind === kind)).length;
  return {
    schedule: count("schedule"),
    form: count("form"),
    report: count("report"),
    photos: count("photos"),
    records: records.length,
    technicians: new Set(records.map((record) => record.technicianId || record.technicianName)).size,
  };
}
