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
