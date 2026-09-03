import { DAILY_WORK_HOURS, countBusinessDays, isBusinessDay } from "./businessDays";
import {
  auditTechnicianTask,
  buildTechnicianDivergenceRecords,
  type TechnicianCheckinIssue,
  type TechnicianDivergenceRecord,
  type TechnicianScheduleIssue,
  type TechnicianTaskAudit,
} from "./technicianDivergences";

type Interval = { start: number; end: number };

/** Horas realmente em execução: une intervalos sobrepostos por dia útil e limita à jornada de 8h. */
function productiveHoursFromIntervals(intervals: Interval[]): number {
  const byDay = new Map<string, Interval[]>();
  for (const interval of intervals) {
    if (!(interval.end > interval.start)) continue;
    for (let cursor = interval.start; cursor < interval.end; ) {
      const day = new Date(cursor).toISOString().slice(0, 10);
      const dayEnd = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      const slice = { start: cursor, end: Math.min(interval.end, dayEnd) };
      if (isBusinessDay(day)) {
        const list = byDay.get(day) || [];
        list.push(slice);
        byDay.set(day, list);
      }
      cursor = slice.end;
    }
  }
  let total = 0;
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    let dayTotal = 0;
    let current = sorted[0];
    for (const item of sorted.slice(1)) {
      if (item.start <= current.end) current = { start: current.start, end: Math.max(current.end, item.end) };
      else {
        dayTotal += current.end - current.start;
        current = item;
      }
    }
    dayTotal += current.end - current.start;
    total += Math.min(dayTotal / 3_600_000, DAILY_WORK_HOURS);
  }
  return total;
}

export type TechnicianQualityInput = {
  tarefas_total: number;
  tarefas_finalizadas: number;
  tarefas_com_pendencia: number;
  tarefas_sem_questionario?: number;
  checkins_sem_checkout?: number;
  tarefas_nao_atendidas?: number;
  tarefas_com_formulario_incompleto?: number;
  tarefas_sem_relato?: number;
  tarefas_com_poucas_fotos?: number;
  taxa_finalizacao: number;
  media_execucoes_dia: number;
  tempo_atividade_pct: number;
};

export type TechnicianGoal = {
  nome_tecnico: string;
  meta_faturamento: number;
  ativo?: boolean;
};

export type TechnicianTaskRow = {
  auvo_task_id: string;
  mirror_key?: string | null;
  atualizado_em?: string | null;
  tecnico_id?: string | null;
  tecnico?: string | null;
  data_tarefa?: string | null;
  data_conclusao?: string | null;
  status_auvo?: string | null;
  check_out?: boolean | null;
  check_in_iso?: string | null;
  check_out_iso?: string | null;
  pendencia?: string | null;
  questionario_preenchido?: boolean | null;
  questionario_respostas?: unknown;
  descricao?: string | null;
  orientacao?: string | null;
  gc_os_codigo?: string | null;
  auvo_link?: string | null;
  duracao_decimal?: number | null;
  duracao_deslocamento?: number | null;
  cliente?: string | null;
  gc_os_id?: string | null;
  gc_os_valor_total?: number | null;
  gc_orcamento_id?: string | null;
  gc_orc_valor_total?: number | null;
  os_realizada?: boolean | null;
};

export type TechnicianData = TechnicianQualityInput & {
  id: string;
  nome: string;
  tarefas_abertas: number;
  tarefas_em_execucao: number;
  tarefas_com_os: number;
  qualidade_pct: number;
  tempo_horas: number;
  deslocamento_horas: number;
  dias_trabalhados: number;
  dias_uteis: number;
  horas_disponiveis: number;
  horas_produtivas_liquidas: number;
  produtividade_pct: number;
  valor_total: number;
  faturamento_hora: number;
  horas_contrato: number;
  valor_contratos: number;
  tarefas_por_dia: Record<string, number>;
  finalizadas_por_dia: Record<string, number>;
};

/** Tarefa do período que não entra no painel (sem técnico ou executor fora do cadastro de técnicos do RH). */
export type OutsideDashboardTask = {
  auvo_task_id: string;
  tecnico: string;
  cliente: string;
  data: string;
  motivo: string;
  auvoUrl: string;
};

export type TechnicianDashboardData = {
  resumo: {
    periodo: { inicio: string; fim: string };
    total_tarefas: number;
    total_finalizadas: number;
    total_tecnicos: number;
    total_horas: number;
    total_deslocamento_horas: number;
    dias_uteis: number;
    horas_disponiveis: number;
    horas_produtivas_liquidas: number;
    produtividade_pct: number;
    total_pendencias: number;
    total_sem_questionario: number;
    total_checkins_sem_checkout: number;
    total_em_execucao: number;
    total_nao_atendidas: number;
    total_formularios_incompletos: number;
    total_sem_relato: number;
    total_poucas_fotos: number;
    tarefas_fora_painel: number;
    valor_total: number;
    total_horas_contrato: number;
    total_valor_contratos: number;
  };
  tecnicos: TechnicianData[];
  divergencias: TechnicianDivergenceRecord[];
  fora_painel: OutsideDashboardTask[];
};

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export function findTechnicianGoal(name: string, goals: TechnicianGoal[]) {
  const normalizedName = normalizeName(name);
  return goals.find((goal) => {
    if (goal.ativo === false) return false;
    const normalizedGoal = normalizeName(goal.nome_tecnico);
    return normalizedName === normalizedGoal
      || normalizedName.startsWith(`${normalizedGoal} `)
      || normalizedGoal.startsWith(`${normalizedName} `);
  });
}

/** Técnicos válidos = colaboradores do RH com cargo/função de técnico ou auxiliar técnico. */
export type TechnicianAllowlist = { ids: Set<string>; names: string[] };

export function buildTechnicianAllowlist(
  people: { nome?: string | null; auvo_user_id?: string | null }[],
): TechnicianAllowlist {
  const ids = new Set<string>();
  const names: string[] = [];
  for (const person of people) {
    const id = String(person.auvo_user_id || "").trim();
    if (id) ids.add(id);
    const name = normalizeName(String(person.nome || ""));
    if (name) names.push(name);
  }
  return { ids, names };
}

export function isAllowedTechnician(id: string, name: string, allowed: TechnicianAllowlist) {
  if (allowed.ids.has(String(id).trim())) return true;
  const normalized = normalizeName(name);
  if (!normalized) return false;
  return allowed.names.some((allowedName) =>
    normalized === allowedName
    || normalized.startsWith(`${allowedName} `)
    || allowedName.startsWith(`${normalized} `),
  );
}

/** Valor/hora de contrato por cliente normalizado. */
export type ContractRates = Map<string, number>;

export function buildContractRates(
  contracts: { valor_hora?: number | null; cliente_nome?: string | null; grupo_id?: string | null }[],
  groupMembers: { grupo_id?: string | null; cliente_nome?: string | null }[] = [],
): ContractRates {
  const rates: ContractRates = new Map();
  for (const contract of contracts) {
    const rate = Number(contract.valor_hora) || 0;
    if (rate <= 0) continue;
    if (contract.cliente_nome) rates.set(normalizeName(contract.cliente_nome), rate);
    if (contract.grupo_id) {
      for (const member of groupMembers) {
        if (member.grupo_id === contract.grupo_id && member.cliente_nome) {
          rates.set(normalizeName(member.cliente_nome), rate);
        }
      }
    }
  }
  return rates;
}

export function technicianOperationalScore(technician: TechnicianQualityInput) {
  const checks = [
    technician.taxa_finalizacao >= 70,
    technician.media_execucoes_dia >= 1,
    technician.tempo_atividade_pct >= 70,
    technician.tarefas_com_pendencia === 0
      && (technician.tarefas_sem_questionario || 0) === 0
      && (technician.checkins_sem_checkout || 0) === 0
      && (technician.tarefas_nao_atendidas || 0) === 0
      && (technician.tarefas_com_formulario_incompleto || 0) === 0
      && (technician.tarefas_sem_relato || 0) === 0
      && (technician.tarefas_com_poucas_fotos || 0) === 0,
  ];
  return checks.filter(Boolean).length * 25;
}

export function technicianQualityIssues(technician: TechnicianQualityInput) {
  const formIssues = technician.tarefas_com_formulario_incompleto
    ?? (technician.tarefas_com_pendencia + (technician.tarefas_sem_questionario || 0));
  return formIssues
    + (technician.tarefas_nao_atendidas || 0)
    + (technician.tarefas_sem_relato || 0)
    + (technician.tarefas_com_poucas_fotos || 0)
    + (technician.checkins_sem_checkout || 0);
}

export function technicianGoalProgress(value: number, goal?: TechnicianGoal) {
  if (!goal || goal.meta_faturamento <= 0) return null;
  return Math.round((value / goal.meta_faturamento) * 100);
}

const normalizeStatus = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const isFinished = (task: TechnicianTaskRow) =>
  task.check_out === true || ["finalizada", "concluida"].includes(normalizeStatus(task.status_auvo));

const hasPendingIssue = (task: TechnicianTaskRow) => {
  const pending = normalizeStatus(task.pendencia);
  return Boolean(pending && pending !== "nenhuma" && pending !== "0");
};

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const auvoTaskUrl = (task: TechnicianTaskRow) =>
  String(task.auvo_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${task.auvo_task_id}`);

export function buildTechnicianDashboardData(
  rows: TechnicianTaskRow[],
  startDate: string,
  endDate: string,
  allowed?: TechnicianAllowlist | null,
  contractRates?: ContractRates | null,
  scheduleIssues: TechnicianScheduleIssue[] = [],
  now: Date = new Date(),
): TechnicianDashboardData {
  const snapshots = new Map<string, TechnicianTaskRow>();
  for (const row of rows) {
    const taskId = String(row.auvo_task_id || row.mirror_key || "").trim();
    if (!taskId) continue;
    const current = snapshots.get(taskId);
    const currentTime = current?.atualizado_em ? Date.parse(current.atualizado_em) : 0;
    const candidateTime = row.atualizado_em ? Date.parse(row.atualizado_em) : 0;
    if (!current || candidateTime >= currentTime) snapshots.set(taskId, row);
  }
  const tasks = [...snapshots.values()];

  type Accumulator = {
    id: string;
    nome: string;
    total: number;
    finished: number;
    pending: number;
    missingQuestionnaire: number;
    openCheckins: number;
    runningCheckins: number;
    scheduleIssues: number;
    formIssues: number;
    reportIssues: number;
    photoIssues: number;
    withOs: number;
    qualityFailureTaskIds: Set<string>;
    hours: number;
    intervals: Interval[];
    contractHours: number;
    contractValue: number;
    travelHours: number;
    value: number;
    days: Set<string>;
    tasksByDay: Record<string, number>;
    finishedByDay: Record<string, number>;
  };

  const technicians = new Map<string, Accumulator>();
  const documents = new Map<string, { value: number; technicianIds: Set<string> }>();
  const businessDays = countBusinessDays(startDate, endDate);
  const availableHours = businessDays * DAILY_WORK_HOURS;
  const todayKey = localDayKey(now);
  const outside: OutsideDashboardTask[] = [];
  const taskAudits: TechnicianTaskAudit[] = [];
  const checkinIssues: TechnicianCheckinIssue[] = [];
  let acceptedTasks = 0;
  let acceptedFinished = 0;

  for (const task of tasks) {
    const technicianId = String(task.tecnico_id || task.tecnico || "").trim();
    const name = String(task.tecnico || "").trim();
    const outsideReason = !technicianId || !name
      ? "Tarefa sem técnico atribuído no Auvo"
      : allowed && !isAllowedTechnician(technicianId, name, allowed)
        ? "Executor fora do cadastro de técnicos do RH (cargo/função de técnico ou auxiliar)"
        : null;
    if (outsideReason) {
      outside.push({
        auvo_task_id: String(task.auvo_task_id || task.mirror_key || "").trim(),
        tecnico: name || "Sem técnico",
        cliente: String(task.cliente || "Sem cliente").trim() || "Sem cliente",
        data: String(task.data_conclusao || task.data_tarefa || "").slice(0, 10),
        motivo: outsideReason,
        auvoUrl: auvoTaskUrl(task),
      });
      continue;
    }
    const accumulator = technicians.get(technicianId) || {
      id: technicianId,
      nome: name,
      total: 0,
      finished: 0,
      pending: 0,
      missingQuestionnaire: 0,
      openCheckins: 0,
      runningCheckins: 0,
      scheduleIssues: 0,
      formIssues: 0,
      reportIssues: 0,
      photoIssues: 0,
      withOs: 0,
      qualityFailureTaskIds: new Set<string>(),
      hours: 0,
      intervals: [],
      contractHours: 0,
      contractValue: 0,
      travelHours: 0,
      value: 0,
      days: new Set<string>(),
      tasksByDay: {},
      finishedByDay: {},
    };
    technicians.set(technicianId, accumulator);

    const finished = isFinished(task);
    const pending = hasPendingIssue(task);
    const missingQuestionnaire = finished && task.questionario_preenchido !== true;
    const hasOpenCheckin = Boolean(task.check_in_iso && !task.check_out_iso);
    // Check-in aberto de hoje = técnico em execução agora (normal); de dias anteriores = tarefa esquecida aberta (alerta).
    const checkinTime = hasOpenCheckin ? Date.parse(String(task.check_in_iso)) : NaN;
    const runningCheckin = hasOpenCheckin && Number.isFinite(checkinTime) && localDayKey(new Date(checkinTime)) === todayKey;
    const openCheckin = hasOpenCheckin && !runningCheckin;
    const executionAudit = auditTechnicianTask(task);
    if (executionAudit) taskAudits.push(executionAudit);
    const formIssue = executionAudit?.formIssue === true;
    const reportIssue = executionAudit?.reportIssue === true;
    const photoIssue = executionAudit?.photoIssue === true;
    const taskDate = String(task.data_conclusao || task.data_tarefa || startDate).slice(0, 10);

    accumulator.total++;
    acceptedTasks++;
    if (finished) {
      accumulator.finished++;
      acceptedFinished++;
    }
    if (pending) accumulator.pending++;
    if (missingQuestionnaire) accumulator.missingQuestionnaire++;
    if (runningCheckin) accumulator.runningCheckins++;
    if (openCheckin) {
      accumulator.openCheckins++;
      checkinIssues.push({
        taskId: String(task.auvo_task_id || task.mirror_key || "").trim(),
        technicianId,
        technicianName: name,
        client: String(task.cliente || "Sem cliente").trim() || "Sem cliente",
        date: taskDate,
        description: String(task.descricao || "").trim(),
        gcOsCode: String(task.gc_os_codigo || "").trim(),
        auvoUrl: auvoTaskUrl(task),
        checkInIso: String(task.check_in_iso || ""),
      });
    }
    if (formIssue) accumulator.formIssues++;
    if (reportIssue) accumulator.reportIssues++;
    if (photoIssue) accumulator.photoIssues++;
    if (task.os_realizada || task.gc_os_id) accumulator.withOs++;
    if (pending || missingQuestionnaire || openCheckin || formIssue || reportIssue || photoIssue) {
      accumulator.qualityFailureTaskIds.add(String(task.auvo_task_id || task.mirror_key || ""));
    }
    accumulator.hours += Number(task.duracao_decimal) || 0;
    if (finished && contractRates?.size) {
      const rate = contractRates.get(normalizeName(String(task.cliente || ""))) || 0;
      const taskHours = Number(task.duracao_decimal) || 0;
      if (rate > 0 && taskHours > 0) {
        accumulator.contractHours += taskHours;
        accumulator.contractValue += taskHours * rate;
      }
    }
    if (task.check_in_iso && task.check_out_iso) {
      const start = Date.parse(task.check_in_iso);
      const end = Date.parse(task.check_out_iso);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) accumulator.intervals.push({ start, end });
    }
    accumulator.travelHours += Number(task.duracao_deslocamento) || 0;
    accumulator.days.add(taskDate);
    accumulator.tasksByDay[taskDate] = (accumulator.tasksByDay[taskDate] || 0) + 1;
    if (finished) accumulator.finishedByDay[taskDate] = (accumulator.finishedByDay[taskDate] || 0) + 1;

    const documentKey = task.gc_os_id
      ? `os:${task.gc_os_id}`
      : task.gc_orcamento_id
        ? `orc:${task.gc_orcamento_id}`
        : "";
    const documentValue = Number(task.gc_os_valor_total) || Number(task.gc_orc_valor_total) || 0;
    if (documentKey && documentValue > 0) {
      const document = documents.get(documentKey) || { value: documentValue, technicianIds: new Set<string>() };
      document.value = Math.max(document.value, documentValue);
      document.technicianIds.add(technicianId);
      documents.set(documentKey, document);
    }
  }

  const seenScheduleIssues = new Set<string>();
  const acceptedScheduleIssues: TechnicianScheduleIssue[] = [];
  for (const issue of scheduleIssues) {
    const issueKey = `${issue.tecnico_id || issue.tecnico_nome || ""}::${issue.auvo_task_id}`;
    if (seenScheduleIssues.has(issueKey)) continue;
    seenScheduleIssues.add(issueKey);
    const technicianId = String(issue.tecnico_id || "").trim();
    const technicianName = String(issue.tecnico_nome || "").trim();
    const technician = technicians.get(technicianId)
      || [...technicians.values()].find((item) => normalizeName(item.nome) === normalizeName(technicianName));
    if (!technician) continue;
    technician.scheduleIssues++;
    technician.qualityFailureTaskIds.add(String(issue.auvo_task_id || issueKey));
    acceptedScheduleIssues.push(issue);
  }

  for (const document of documents.values()) {
    const allocation = document.technicianIds.size ? document.value / document.technicianIds.size : 0;
    for (const technicianId of document.technicianIds) {
      const technician = technicians.get(technicianId);
      if (technician) technician.value += allocation;
    }
  }

  const data = [...technicians.values()].map<TechnicianData>((tech) => {
    const days = Math.max(tech.days.size, 1);
    const hours = Math.round(tech.hours * 10) / 10;
    const productiveHours = Math.round(productiveHoursFromIntervals(tech.intervals) * 10) / 10;
    const value = Math.round(tech.value * 100) / 100;
    return {
      id: tech.id,
      nome: tech.nome,
      tarefas_total: tech.total,
      tarefas_finalizadas: tech.finished,
      tarefas_abertas: tech.total - tech.finished,
      tarefas_com_pendencia: tech.pending,
      tarefas_sem_questionario: tech.missingQuestionnaire,
      checkins_sem_checkout: tech.openCheckins,
      tarefas_em_execucao: tech.runningCheckins,
      tarefas_nao_atendidas: tech.scheduleIssues,
      tarefas_com_formulario_incompleto: tech.formIssues,
      tarefas_sem_relato: tech.reportIssues,
      tarefas_com_poucas_fotos: tech.photoIssues,
      tarefas_com_os: tech.withOs,
      qualidade_pct: tech.total > 0 ? Math.max(0, Math.round(((tech.total - tech.qualityFailureTaskIds.size) / tech.total) * 100)) : 0,
      taxa_finalizacao: tech.total > 0 ? Math.round((tech.finished / tech.total) * 100) : 0,
      media_execucoes_dia: Math.round((tech.finished / days) * 10) / 10,
      tempo_horas: hours,
      deslocamento_horas: Math.round(tech.travelHours * 10) / 10,
      tempo_atividade_pct: Math.round((tech.hours / (days * 8)) * 100),
      dias_trabalhados: days,
      dias_uteis: businessDays,
      horas_disponiveis: availableHours,
      horas_produtivas_liquidas: productiveHours,
      produtividade_pct: availableHours > 0 ? Math.round((productiveHours / availableHours) * 100) : 0,
      valor_total: value,
      faturamento_hora: hours > 0 ? Math.round((value / hours) * 100) / 100 : 0,
      horas_contrato: Math.round(tech.contractHours * 10) / 10,
      valor_contratos: Math.round(tech.contractValue * 100) / 100,
      tarefas_por_dia: tech.tasksByDay,
      finalizadas_por_dia: tech.finishedByDay,
    };
  }).sort((a, b) => b.tarefas_finalizadas - a.tarefas_finalizadas);

  return {
    resumo: {
      periodo: { inicio: startDate, fim: endDate },
      // Mesma base da tabela: somente tarefas de técnicos do painel, para os cards baterem com a soma por técnico.
      total_tarefas: acceptedTasks,
      total_finalizadas: acceptedFinished,
      total_tecnicos: data.length,
      total_horas: Math.round(data.reduce((total, tech) => total + tech.tempo_horas, 0) * 10) / 10,
      total_deslocamento_horas: Math.round(data.reduce((total, tech) => total + tech.deslocamento_horas, 0) * 10) / 10,
      dias_uteis: businessDays,
      horas_disponiveis: Math.round(availableHours * data.length * 10) / 10,
      horas_produtivas_liquidas: Math.round(data.reduce((total, tech) => total + tech.horas_produtivas_liquidas, 0) * 10) / 10,
      produtividade_pct: availableHours > 0 && data.length > 0
        ? Math.round((data.reduce((total, tech) => total + tech.horas_produtivas_liquidas, 0) / (availableHours * data.length)) * 100)
        : 0,
      total_pendencias: data.reduce((total, tech) => total + tech.tarefas_com_pendencia, 0),
      total_sem_questionario: data.reduce((total, tech) => total + (tech.tarefas_sem_questionario || 0), 0),
      total_checkins_sem_checkout: data.reduce((total, tech) => total + (tech.checkins_sem_checkout || 0), 0),
      total_em_execucao: data.reduce((total, tech) => total + (tech.tarefas_em_execucao || 0), 0),
      total_nao_atendidas: data.reduce((total, tech) => total + (tech.tarefas_nao_atendidas || 0), 0),
      total_formularios_incompletos: data.reduce((total, tech) => total + (tech.tarefas_com_formulario_incompleto || 0), 0),
      total_sem_relato: data.reduce((total, tech) => total + (tech.tarefas_sem_relato || 0), 0),
      total_poucas_fotos: data.reduce((total, tech) => total + (tech.tarefas_com_poucas_fotos || 0), 0),
      tarefas_fora_painel: outside.length,
      valor_total: Math.round(data.reduce((total, tech) => total + tech.valor_total, 0) * 100) / 100,
      total_horas_contrato: Math.round(data.reduce((total, tech) => total + tech.horas_contrato, 0) * 10) / 10,
      total_valor_contratos: Math.round(data.reduce((total, tech) => total + tech.valor_contratos, 0) * 100) / 100,
    },
    tecnicos: data,
    divergencias: buildTechnicianDivergenceRecords(acceptedScheduleIssues, taskAudits, checkinIssues),
    fora_painel: outside.sort((a, b) => b.data.localeCompare(a.data) || a.tecnico.localeCompare(b.tecnico)),
  };
}
