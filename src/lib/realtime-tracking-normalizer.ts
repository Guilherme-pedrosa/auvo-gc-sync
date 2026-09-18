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
    .replace(/[̀-ͯ]/g, "")
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

const VENDOR_PREFIX = "vend::";
const AUVO_PREFIX = "auvo::";
const AUVO_NAME_PREFIX = "auvo-name::";

/**
 * Identidade do técnico Auvo que um grupo da Edge Function representa.
 *
 * Três formatos já circularam na edge `realtime-tracking`:
 * - antigo: grupos por vendedor do GestãoClick (`vend::<nome>`), com o responsável
 *   real do Auvo em `_auvoTechId`/`_auvoTechName` de cada tarefa;
 * - intermediário: grupos `auvo::<userID>`;
 * - atual (main desde f2663ebb0, publicado em 15/09/2026): grupos já por responsável
 *   Auvo, com `id` = userID puro (ex.: "192262") e `nome` do técnico, sem campos por
 *   tarefa. Tratar esse id puro como "sem técnico" jogava todas as tarefas num único
 *   cartão "Sem técnico".
 */
function auvoGroupIdentity(group: { id: string; nome: string }): { id: string; nome: string } | null {
  const id = String(group.id ?? "").trim();
  const nome = String(group.nome ?? "").trim();
  if (!id || id.startsWith(VENDOR_PREFIX) || id.startsWith(AUVO_NAME_PREFIX)) return null;
  const auvoId = id.startsWith(AUVO_PREFIX) ? id.slice(AUVO_PREFIX.length).trim() : id;
  if (!auvoId) return null;
  return { id: auvoId, nome };
}

/**
 * Normaliza a resposta da Edge Function antes de a tela e o modo TV renderizarem os
 * cartões: o responsável real do Auvo é sempre a fonte de verdade, venha ele por tarefa
 * (`_auvoTechId`/`_auvoTechName`) ou pelo grupo já montado pela edge. O vendedor do
 * GestãoClick continua apenas como informação comercial (`gcVendedor`).
 */
export function regroupTrackingByAuvoAssignee<
  TTask extends TrackingTask,
  TPayload extends TrackingPayload<TTask>,
>(payload: TPayload): TPayload {
  const groups = new Map<string, TrackingGroup<TTask>>();

  for (const sourceGroup of payload.tecnicos ?? []) {
    const groupAuvo = auvoGroupIdentity(sourceGroup);
    const isVendorGroup = String(sourceGroup.id ?? "").startsWith(VENDOR_PREFIX);
    for (const sourceTask of sourceGroup.tarefas ?? []) {
      const auvoTechId = String(sourceTask._auvoTechId ?? "").trim();
      const auvoTechName = String(sourceTask._auvoTechName ?? "").trim();
      const technicianId = auvoTechId || groupAuvo?.id || "";
      const technicianName = auvoTechName || groupAuvo?.nome || "Sem técnico";
      const groupKey = technicianId
        ? `${AUVO_PREFIX}${technicianId}`
        : `${AUVO_NAME_PREFIX}${normalizeKey(technicianName) || "sem-tecnico"}`;

      const task = {
        ...sourceTask,
        gcVendedor: sourceTask.gcVendedor || (isVendorGroup ? sourceGroup.nome : undefined),
      } as TTask;

      const current = groups.get(groupKey);
      if (current) {
        current.tarefas.push(task);
        if (current.nome === "Sem técnico" && technicianName !== "Sem técnico") current.nome = technicianName;
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
