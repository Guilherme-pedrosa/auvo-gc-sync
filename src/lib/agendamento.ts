// Regras puras do módulo "Agendamento" (duas faixas: compras de peças + OS prontas).

export const ORC_PECA_SITUACOES = [
  { id: "8743484", label: "APROVADO · aguardando compra", short: "Ag. compra" },
  { id: "8743485", label: "COMPRADO · aguardando chegada", short: "Ag. chegada" },
  { id: "8894381", label: "Aguardando chegada · peça em garantia", short: "Garantia" },
] as const;

export const ORC_PECA_SITUACAO_IDS = ORC_PECA_SITUACOES.map((s) => s.id);

export type AgendaBucket = "nao_agendada" | "atrasada" | "hoje" | "futura";

export const AGENDA_BUCKETS: { id: AgendaBucket; label: string; hint: string }[] = [
  { id: "nao_agendada", label: "Sem agendamento", hint: "OS gerada, ainda sem data/técnico" },
  { id: "atrasada", label: "Atrasadas", hint: "Data de execução já passou" },
  { id: "hoje", label: "Hoje", hint: "Execução prevista para hoje" },
  { id: "futura", label: "Agendadas", hint: "Execução prevista à frente" },
];

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getAgendaBucket(data: string | null | undefined, tecnico: string | null | undefined): AgendaBucket {
  const dia = String(data ?? "").slice(0, 10);
  const temTecnico = !!String(tecnico ?? "").trim();
  if (!dia || !temTecnico) return "nao_agendada";
  const hoje = todayISO();
  if (dia < hoje) return "atrasada";
  if (dia === hoje) return "hoje";
  return "futura";
}

export function diasDesde(data: string | null | undefined): number | null {
  const dia = String(data ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const ms = Date.now() - new Date(`${dia}T00:00:00`).getTime();
  return Math.floor(ms / 86_400_000);
}

export function parseValor(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number(raw) || 0;
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Primeiro id de tarefa Auvo de execução (o GC pode gravar "123/456"). */
export function parseExecTaskId(raw: unknown): string | null {
  const txt = String(raw ?? "").trim();
  if (!txt) return null;
  const first = txt.split(/[\/,;\s]+/).map((s) => s.replace(/\D/g, "")).find((s) => s.length >= 4);
  return first || null;
}