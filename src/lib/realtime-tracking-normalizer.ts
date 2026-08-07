type TrackingTask = {
  taskId: string;
  status: string;
  atrasada: boolean;
  gcVendedor?: string;
  _auvoTechId?: string;
  _auvoTechName?: string;
};

type TrackingSummary = {
  total: number;
  finalizadas: number;
  emAndamento: number;
  agendadas: number;
  atrasadas: number;
};

type TrackingGroup<TTask extends TrackingTask> = {
  id: string;
  nome: string;
  tarefas: TTask[];
  resumo: TrackingSummary;
};

type TrackingPayload<TTask extends TrackingTask> = {
  total_tarefas: number;
  total_tecnicos: number;
  total_atrasadas: number;
  tecnicos: TrackingGroup<TTask>[];
};

const normalizeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildSummary = <TTask extends TrackingTask>(tarefas: TTask[]): TrackingSummary => ({
  total: tarefas.length,
  finalizadas: tarefas.filter((task) => task.status === "Finalizada").length,
  emAndamento: tarefas.filter((task) => task.status === "Em andamento").length,
  agendadas: tarefas.filter((task) => task.status === "Agendada").length,
  atrasadas: tarefas.filter((task) => task.atrasada).length,
});

/**
 * Compatibilidade para respostas antigas da Edge Function.
 *
 * A versão antiga agrupava as tarefas pelo vendedor do GestãoClick, mas já
 * enviava o responsável real do Auvo em `_auvoTechId`/`_auvoTechName`. Este
 * normalizador usa esses campos como fonte de verdade antes de a tela e o modo
 * TV renderizarem os cartões.
 */
export function regroupTrackingByAuvoAssignee<
  TTask extends TrackingTask,
  TPayload extends TrackingPayload<TTask>,
>(payload: TPayload): TPayload {
  const groups = new Map<string, TrackingGroup<TTask>>();

  for (const sourceGroup of payload.tecnicos ?? []) {
    for (const sourceTask of sourceGroup.tarefas ?? []) {
      const auvoTechId = String(sourceTask._auvoTechId ?? "").trim();
      const auvoTechName = String(sourceTask._auvoTechName ?? "").trim();
      const sourceIsAuvo = sourceGroup.id.startsWith("auvo::");
      const technicianName = auvoTechName || (sourceIsAuvo ? sourceGroup.nome : "") || "Sem técnico";
      const technicianId = auvoTechId || (sourceIsAuvo ? sourceGroup.id.replace(/^auvo::/, "") : "");
      const groupKey = technicianId
        ? `auvo::${technicianId}`
        : `auvo-name::${normalizeKey(technicianName) || "sem-tecnico"}`;

      const task = {
        ...sourceTask,
        gcVendedor:
          sourceTask.gcVendedor ||
          (sourceGroup.id.startsWith("vend::") ? sourceGroup.nome : undefined),
      } as TTask;

      const current = groups.get(groupKey);
      if (current) {
        current.tarefas.push(task);
      } else {
        groups.set(groupKey, {
          id: groupKey,
          nome: technicianName,
          tarefas: [task],
          resumo: buildSummary([task]),
        });
      }
    }
  }

  const tecnicos = Array.from(groups.values()).map((group) => ({
    ...group,
    resumo: buildSummary(group.tarefas),
  }));
  const tarefas = tecnicos.flatMap((group) => group.tarefas);

  return {
    ...payload,
    tecnicos,
    total_tarefas: tarefas.length,
    total_tecnicos: tecnicos.length,
    total_atrasadas: tarefas.filter((task) => task.atrasada).length,
  };
}
