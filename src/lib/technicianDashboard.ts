import { DAILY_WORK_HOURS, countBusinessDays } from "./businessDays";

export type TechnicianQualityInput = {
  tarefas_total: number;
  tarefas_finalizadas: number;
  tarefas_com_pendencia: number;
  tarefas_sem_questionario?: number;
  checkins_sem_checkout?: number;
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
  duracao_decimal?: number | null;
  duracao_deslocamento?: number | null;
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
  tarefas_com_os: number;
  qualidade_pct: number;
  tempo_horas: number;
  deslocamento_horas: number;
  dias_trabalhados: number;
  dias_uteis: number;
  horas_disponiveis: number;
  produtividade_pct: number;
  valor_total: number;
  faturamento_hora: number;
  tarefas_por_dia: Record<string, number>;
  finalizadas_por_dia: Record<string, number>;
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
    produtividade_pct: number;
    total_pendencias: number;
    total_sem_questionario: number;
    total_checkins_sem_checkout: number;
    valor_total: number;
  };
  tecnicos: TechnicianData[];
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

export function technicianOperationalScore(technician: TechnicianQualityInput) {
  const checks = [
    technician.taxa_finalizacao >= 70,
    technician.media_execucoes_dia >= 1,
    technician.tempo_atividade_pct >= 70,
    technician.tarefas_com_pendencia === 0
      && (technician.tarefas_sem_questionario || 0) === 0
      && (technician.checkins_sem_checkout || 0) === 0,
  ];
  return checks.filter(Boolean).length * 25;
}

export function technicianQualityIssues(technician: TechnicianQualityInput) {
  return technician.tarefas_com_pendencia
    + (technician.tarefas_sem_questionario || 0)
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

export function buildTechnicianDashboardData(
  rows: TechnicianTaskRow[],
  startDate: string,
  endDate: string,
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
    withOs: number;
    qualityFailures: number;
    hours: number;
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

  for (const task of tasks) {
    const technicianId = String(task.tecnico_id || task.tecnico || "").trim();
    const name = String(task.tecnico || "").trim();
    if (!technicianId || !name) continue;
    const accumulator = technicians.get(technicianId) || {
      id: technicianId,
      nome: name,
      total: 0,
      finished: 0,
      pending: 0,
      missingQuestionnaire: 0,
      openCheckins: 0,
      withOs: 0,
      qualityFailures: 0,
      hours: 0,
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
    const openCheckin = Boolean(task.check_in_iso && !task.check_out_iso);
    const taskDate = String(task.data_conclusao || task.data_tarefa || startDate).slice(0, 10);

    accumulator.total++;
    if (finished) accumulator.finished++;
    if (pending) accumulator.pending++;
    if (missingQuestionnaire) accumulator.missingQuestionnaire++;
    if (openCheckin) accumulator.openCheckins++;
    if (task.os_realizada || task.gc_os_id) accumulator.withOs++;
    if (pending || missingQuestionnaire || openCheckin) accumulator.qualityFailures++;
    accumulator.hours += Number(task.duracao_decimal) || 0;
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
      tarefas_com_os: tech.withOs,
      qualidade_pct: tech.total > 0 ? Math.max(0, Math.round(((tech.total - tech.qualityFailures) / tech.total) * 100)) : 0,
      taxa_finalizacao: tech.total > 0 ? Math.round((tech.finished / tech.total) * 100) : 0,
      media_execucoes_dia: Math.round((tech.finished / days) * 10) / 10,
      tempo_horas: hours,
      deslocamento_horas: Math.round(tech.travelHours * 10) / 10,
      tempo_atividade_pct: Math.round((tech.hours / (days * 8)) * 100),
      dias_trabalhados: days,
      dias_uteis: businessDays,
      horas_disponiveis: availableHours,
      produtividade_pct: availableHours > 0 ? Math.round((hours / availableHours) * 100) : 0,
      valor_total: value,
      faturamento_hora: hours > 0 ? Math.round((value / hours) * 100) / 100 : 0,
      tarefas_por_dia: tech.tasksByDay,
      finalizadas_por_dia: tech.finishedByDay,
    };
  }).sort((a, b) => b.tarefas_finalizadas - a.tarefas_finalizadas);

  return {
    resumo: {
      periodo: { inicio: startDate, fim: endDate },
      total_tarefas: tasks.length,
      total_finalizadas: tasks.filter(isFinished).length,
      total_tecnicos: data.length,
      total_horas: Math.round(data.reduce((total, tech) => total + tech.tempo_horas, 0) * 10) / 10,
      total_deslocamento_horas: Math.round(data.reduce((total, tech) => total + tech.deslocamento_horas, 0) * 10) / 10,
      dias_uteis: businessDays,
      horas_disponiveis: Math.round(availableHours * data.length * 10) / 10,
      produtividade_pct: availableHours > 0 && data.length > 0
        ? Math.round((data.reduce((total, tech) => total + tech.tempo_horas, 0) / (availableHours * data.length)) * 100)
        : 0,
      total_pendencias: data.reduce((total, tech) => total + tech.tarefas_com_pendencia, 0),
      total_sem_questionario: data.reduce((total, tech) => total + (tech.tarefas_sem_questionario || 0), 0),
      total_checkins_sem_checkout: data.reduce((total, tech) => total + (tech.checkins_sem_checkout || 0), 0),
      valor_total: Math.round(data.reduce((total, tech) => total + tech.valor_total, 0) * 100) / 100,
    },
    tecnicos: data,
  };
}
