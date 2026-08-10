export type AgendaTaskStatusInput = {
  data?: string | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  status_auvo?: string | null;
  pausada?: boolean | null;
  gc_os_situacao?: string | null;
};

export type AgendaVisualStatus = "finalizada" | "pausada" | "atrasada" | null;

const TECHNICAL_PENDING_TOKENS = [
  "PENDENTE",
  "PENDENCIA",
  "RETORNO",
  "CORRECAO",
  "REFAZER",
];

const normalize = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

function isMoreThanTwoHoursLate(item: AgendaTaskStatusInput, now: Date): boolean {
  const dateMatch = String(item.data || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const clockMatch = String(item.hora_fim || item.hora_inicio || "").match(/^(\d{1,2}):(\d{2})/);
  if (!dateMatch || !clockMatch) return false;

  const expectedEnd = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(clockMatch[1]),
    Number(clockMatch[2]),
    0,
    0,
  );
  return now.getTime() > expectedEnd.getTime() + 2 * 60 * 60 * 1000;
}

export function agendaVisualStatus(
  item: AgendaTaskStatusInput,
  now: Date = new Date(),
): AgendaVisualStatus {
  const auvoStatus = normalize(item.status_auvo);
  const gcSituation = normalize(item.gc_os_situacao);
  const finalized = auvoStatus.includes("FINALIZ") || auvoStatus.includes("CONCLUI");
  const paused = auvoStatus.includes("PAUSAD") || (!auvoStatus && item.pausada === true);
  const hasTechnicalPending = TECHNICAL_PENDING_TOKENS.some((token) => gcSituation.includes(token));

  // O estado Auvo manda na cor. Uma OS vinculada apenas complementa a regra
  // de pendência; nunca transforma tarefa aberta em finalizada.
  if (paused) return "pausada";
  if (finalized) return hasTechnicalPending ? null : "finalizada";

  const running = auvoStatus.includes("ANDAMENTO") || auvoStatus.includes("DESLOCAMENTO");
  if (!running && isMoreThanTwoHoursLate(item, now)) return "atrasada";
  return null;
}
