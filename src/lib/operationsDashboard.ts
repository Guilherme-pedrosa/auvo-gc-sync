export type TaskSnapshotRow = {
  auvo_task_id: string;
  mirror_key?: string | null;
  data_tarefa?: string | null;
  status_auvo?: string | null;
  tecnico?: string | null;
  tecnico_id?: string | null;
  check_in?: boolean | null;
  check_out?: boolean | null;
  check_in_iso?: string | null;
  check_out_iso?: string | null;
  questionario_preenchido?: boolean | null;
  pendencia?: string | null;
  duracao_decimal?: number | null;
  duracao_deslocamento?: number | null;
  orcamento_realizado?: boolean | null;
  os_realizada?: boolean | null;
  atualizado_em?: string | null;
};

export type KanbanSnapshotRow = {
  coluna: string;
  atualizado_em?: string | null;
};

export type PreventiveSnapshotRow = {
  identificador?: string | null;
  status_preventiva?: string | null;
  proxima_preventiva?: string | null;
  atualizado_em?: string | null;
};

export type AnalysisSnapshotRow = {
  status_analise?: string | null;
  prioridade?: string | null;
  atualizado_em?: string | null;
};

export type FollowupColumnRow = {
  id: string;
  titulo: string;
  situacao_id?: string | null;
};

export type SyncMetaRow = {
  id: string;
  ultimo_sync?: string | null;
  sync_status?: string | null;
  sync_finished_at?: string | null;
  sync_error?: string | null;
};

export type OperationsDashboardSource = {
  tasks: TaskSnapshotRow[];
  budgetCards: KanbanSnapshotRow[];
  workshopCards: KanbanSnapshotRow[];
  followupCards: KanbanSnapshotRow[];
  followupColumns: FollowupColumnRow[];
  preventiveRows: PreventiveSnapshotRow[];
  plannedPreventiveIds?: string[];
  analysisRows: AnalysisSnapshotRow[];
  missedActivities: number;
  syncMeta?: SyncMetaRow | null;
};

export type FreshnessItem = {
  key: "central" | "budget" | "followup" | "preventive" | "workshop";
  label: string;
  timestamp: string | null;
  status: "healthy" | "attention" | "error" | "unknown";
  detail: string;
};

export type OperationsDashboardSnapshot = {
  today: {
    total: number;
    open: number;
    inProgress: number;
    paused: number;
    finished: number;
    unassigned: number;
  };
  month: {
    total: number;
    finished: number;
    activeTechnicians: number;
    hours: number;
    travelHours: number;
    withOs: number;
    withoutGc: number;
    withPendingIssue: number;
    checkInWithoutCheckout: number;
    finishedWithoutQuestionnaire: number;
    missedActivities: number;
  };
  budget: {
    total: number;
    open: number;
    toDo: number;
    missingForm: number;
    awaitingApproval: number;
    awaitingSend: number;
    awaitingAnalysis: number;
    awaitingCorrection: number;
    approvedWaitingPurchase: number;
    purchasedWaitingArrival: number;
    osGenerated: number;
  };
  workshop: {
    total: number;
    active: number;
    entry: number;
    awaitingOs: number;
    quotation: number;
    approved: number;
    partsRequested: number;
    inProgress: number;
    returned: number;
  };
  followup: {
    total: number;
    open: number;
    stages: Array<{ id: string; label: string; count: number }>;
  };
  preventive: {
    total: number;
    overdue: number;
    dueNext30Days: number;
    never: number;
    upToDate: number;
    withoutNextDate: number;
  };
  analyses: {
    open: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  freshness: FreshnessItem[];
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const sum = (values: Array<number | null | undefined>) =>
  values.reduce<number>((total, value) => total + (Number(value) || 0), 0);

const rounded = (value: number) => Math.round(value * 10) / 10;

const latestTimestamp = (rows: Array<{ atualizado_em?: string | null }>) => {
  const timestamps = rows
    .map((row) => row.atualizado_em)
    .filter((value): value is string => Boolean(value))
    .sort();
  return timestamps.at(-1) ?? null;
};

const countColumn = (rows: KanbanSnapshotRow[], column: string) =>
  rows.filter((row) => normalize(row.coluna) === normalize(column)).length;

const isFinished = (task: TaskSnapshotRow) =>
  task.check_out === true || ["finalizada", "concluida"].includes(normalize(task.status_auvo));

const hasPendingIssue = (task: TaskSnapshotRow) => {
  const pending = normalize(task.pendencia);
  return Boolean(pending && pending !== "nenhuma" && pending !== "0");
};

export function dedupeTasks(rows: TaskSnapshotRow[]): TaskSnapshotRow[] {
  const byTask = new Map<string, TaskSnapshotRow>();

  for (const row of rows) {
    const key = String(row.auvo_task_id || row.mirror_key || "").trim();
    if (!key) continue;

    const current = byTask.get(key);
    const currentTime = current?.atualizado_em ? Date.parse(current.atualizado_em) : 0;
    const candidateTime = row.atualizado_em ? Date.parse(row.atualizado_em) : 0;
    if (!current || candidateTime >= currentTime) byTask.set(key, row);
  }

  return [...byTask.values()];
}

function freshnessStatus(
  timestamp: string | null,
  now: Date,
  warningAfterHours: number,
): FreshnessItem["status"] {
  if (!timestamp) return "unknown";
  const ageHours = (now.getTime() - Date.parse(timestamp)) / 3_600_000;
  return Number.isFinite(ageHours) && ageHours <= warningAfterHours ? "healthy" : "attention";
}

export function buildOperationsDashboardSnapshot(
  source: OperationsDashboardSource,
  now: Date = new Date(),
): OperationsDashboardSnapshot {
  const todayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const tasks = dedupeTasks(source.tasks);
  const todayTasks = tasks.filter((task) => String(task.data_tarefa || "").slice(0, 10) === todayKey);
  const finishedTasks = tasks.filter(isFinished);
  const todayStatusCount = (statuses: string[]) => todayTasks.filter((task) => statuses.includes(normalize(task.status_auvo))).length;

  const followupColumnLabels = new Map(
    source.followupColumns.flatMap((column) => [
      [String(column.id), column.titulo] as const,
      ...(column.situacao_id ? [[String(column.situacao_id), column.titulo] as const] : []),
    ]),
  );
  const followupCounts = new Map<string, number>();
  for (const card of source.followupCards) {
    followupCounts.set(card.coluna, (followupCounts.get(card.coluna) || 0) + 1);
  }
  const followupStages = [...followupCounts.entries()]
    .map(([id, count]) => ({ id, label: followupColumnLabels.get(id) || `Etapa ${id}`, count }))
    .sort((a, b) => b.count - a.count);
  const validatedFollowup = followupStages
    .filter((stage) => normalize(stage.label).includes("validado"))
    .reduce((total, stage) => total + stage.count, 0);

  const preventiveTotal = source.preventiveRows.length;
  const dueLimit = new Date(now);
  dueLimit.setDate(dueLimit.getDate() + 30);
  const dueLimitKey = dueLimit.toISOString().slice(0, 10);
  const dueNext30Days = source.preventiveRows.filter((row) => {
    const next = String(row.proxima_preventiva || "").slice(0, 10);
    return next >= todayKey && next <= dueLimitKey;
  }).length;

  // Atraso só conta para equipamentos com plano de preventivas ativo,
  // e apenas após 30 dias de atraso (mês vigente nunca é atraso).
  const plannedIds = new Set((source.plannedPreventiveIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const monthStartKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const graceDate = new Date(now);
  graceDate.setDate(graceDate.getDate() - 30);
  const graceKey = graceDate.toISOString().slice(0, 10);
  const overdueCutoff = graceKey < monthStartKey ? graceKey : monthStartKey;
  const overdueRows = source.preventiveRows.filter((row) => {
    const id = String(row.identificador || "").trim();
    if (!id || !plannedIds.has(id)) return false;
    const next = String(row.proxima_preventiva || "").slice(0, 10);
    if (!next) return false;
    return next < overdueCutoff;
  });

  const openAnalyses = source.analysisRows.filter((row) => !["resolvida", "concluida", "arquivada"].includes(normalize(row.status_analise)));
  const analysisPriority = (priority: string) => openAnalyses.filter((row) => normalize(row.prioridade) === priority).length;

  const terminalBudgetColumns = new Set([
    "os_realizada",
    "resolvido_sem_orcamento",
    "orc_cancelado",
    "orc_nao_aprovado",
  ]);
  const openBudget = source.budgetCards.filter((row) => !terminalBudgetColumns.has(normalize(row.coluna))).length;
  const terminalWorkshopColumns = new Set(["concluido", "devolvido"]);
  const activeWorkshop = source.workshopCards.filter((row) => !terminalWorkshopColumns.has(normalize(row.coluna))).length;

  const centralTimestamp = latestTimestamp(tasks);
  const budgetTimestamp = source.syncMeta?.sync_finished_at || source.syncMeta?.ultimo_sync || latestTimestamp(source.budgetCards);
  const followupTimestamp = latestTimestamp(source.followupCards);
  const preventiveTimestamp = latestTimestamp(source.preventiveRows);
  const workshopTimestamp = latestTimestamp(source.workshopCards);
  const budgetError = normalize(source.syncMeta?.sync_status) === "failed" || Boolean(source.syncMeta?.sync_error);

  return {
    today: {
      total: todayTasks.length,
      open: todayStatusCount(["aberta"]),
      inProgress: todayStatusCount(["em andamento", "em deslocamento"]),
      paused: todayStatusCount(["pausada"]),
      finished: todayTasks.filter(isFinished).length,
      unassigned: todayTasks.filter((task) => !String(task.tecnico || "").trim()).length,
    },
    month: {
      total: tasks.length,
      finished: finishedTasks.length,
      activeTechnicians: new Set(tasks.map((task) => String(task.tecnico_id || task.tecnico || "").trim()).filter(Boolean)).size,
      hours: rounded(sum(tasks.map((task) => task.duracao_decimal))),
      travelHours: rounded(sum(tasks.map((task) => task.duracao_deslocamento))),
      withOs: tasks.filter((task) => task.os_realizada).length,
      withoutGc: tasks.filter((task) => !task.os_realizada && !task.orcamento_realizado).length,
      withPendingIssue: tasks.filter(hasPendingIssue).length,
      checkInWithoutCheckout: tasks.filter((task) => Boolean(task.check_in_iso) && !task.check_out_iso).length,
      finishedWithoutQuestionnaire: finishedTasks.filter((task) => !task.questionario_preenchido).length,
      missedActivities: source.missedActivities,
    },
    budget: {
      total: source.budgetCards.length,
      open: openBudget,
      toDo: countColumn(source.budgetCards, "a_fazer"),
      missingForm: countColumn(source.budgetCards, "falta_preenchimento"),
      awaitingApproval: countColumn(source.budgetCards, "orc_aguardando_aprovação"),
      awaitingSend: countColumn(source.budgetCards, "orc_aguardando_envio"),
      awaitingAnalysis: countColumn(source.budgetCards, "orc_aguardando_análise_supervisão"),
      awaitingCorrection: countColumn(source.budgetCards, "orc_ag_informações_/_correções"),
      approvedWaitingPurchase: countColumn(source.budgetCards, "orc_aprovado_-_aguardando_compra"),
      purchasedWaitingArrival: countColumn(source.budgetCards, "orc_comprado_-_aguardando_chegada"),
      osGenerated: countColumn(source.budgetCards, "orc_aprovado_-_os_gerada") + countColumn(source.budgetCards, "os_realizada"),
    },
    workshop: {
      total: source.workshopCards.length,
      active: activeWorkshop,
      entry: countColumn(source.workshopCards, "entrada"),
      awaitingOs: countColumn(source.workshopCards, "aguardando_os"),
      quotation: countColumn(source.workshopCards, "orcamento"),
      approved: countColumn(source.workshopCards, "aprovado"),
      partsRequested: countColumn(source.workshopCards, "pecas_solicitadas"),
      inProgress: countColumn(source.workshopCards, "em_execucao"),
      returned: countColumn(source.workshopCards, "devolvido"),
    },
    followup: {
      total: source.followupCards.length,
      open: source.followupCards.length - validatedFollowup,
      stages: followupStages,
    },
    preventive: {
      total: preventiveTotal,
      overdue: source.preventiveRows.filter((row) => normalize(row.status_preventiva) === "vencido").length,
      dueNext30Days,
      never: source.preventiveRows.filter((row) => normalize(row.status_preventiva) === "nunca").length,
      upToDate: source.preventiveRows.filter((row) => normalize(row.status_preventiva) === "em_dia").length,
      withoutNextDate: source.preventiveRows.filter((row) => !row.proxima_preventiva).length,
    },
    analyses: {
      open: openAnalyses.length,
      critical: analysisPriority("critica"),
      high: analysisPriority("alta"),
      medium: analysisPriority("media"),
      low: analysisPriority("baixa"),
    },
    freshness: [
      {
        key: "central",
        label: "Central Auvo",
        timestamp: centralTimestamp,
        status: freshnessStatus(centralTimestamp, now, 4),
        detail: "Agenda, execução e apontamentos",
      },
      {
        key: "budget",
        label: "Kanban de orçamentos",
        timestamp: budgetTimestamp,
        status: budgetError ? "error" : freshnessStatus(budgetTimestamp, now, 8),
        detail: budgetError ? source.syncMeta?.sync_error || "A última sincronização falhou" : "Contrato de sincronização e cache",
      },
      {
        key: "followup",
        label: "Follow-up comercial",
        timestamp: followupTimestamp,
        status: freshnessStatus(followupTimestamp, now, 12),
        detail: "Situações dos orçamentos no GestãoClick",
      },
      {
        key: "preventive",
        label: "Preventivas",
        timestamp: preventiveTimestamp,
        status: freshnessStatus(preventiveTimestamp, now, 36),
        detail: "Consolidação dos equipamentos",
      },
      {
        key: "workshop",
        label: "Oficina",
        timestamp: workshopTimestamp,
        status: freshnessStatus(workshopTimestamp, now, 72),
        detail: "Última movimentação registrada no fluxo",
      },
    ],
  };
}
