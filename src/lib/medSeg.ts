import type { MedASO, MedAgendamento } from "@/hooks/medSeg/useMedSeg";

export type Situacao = "Válido" | "Vencendo" | "Vencido" | "Agendado" | "Aguardando Documento" | "Sem ASO";

export const diffDays = (dateStr?: string | null) => {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - now.getTime()) / 86400000);
};

export const situacaoDoColaborador = (
  vigente: MedASO | undefined,
  agendamentos: MedAgendamento[]
): Situacao => {
  const realizadoSemDoc = agendamentos.find((a) => a.status === "realizado" && !a.aso_id);
  if (realizadoSemDoc) return "Aguardando Documento";
  if (!vigente) {
    const futuro = agendamentos.find((a) => (a.status === "agendado" || a.status === "confirmado") && diffDays(a.data)! >= 0);
    return futuro ? "Agendado" : "Sem ASO";
  }
  const d = diffDays(vigente.data_validade);
  if (d == null) return "Válido";
  if (d < 0) return "Vencido";
  if (d <= 30) return "Vencendo";
  return "Válido";
};

export const situacaoBadge = (s: Situacao) => {
  switch (s) {
    case "Válido":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    case "Vencendo":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    case "Vencido":
      return "bg-red-500/15 text-red-700 border-red-500/30";
    case "Agendado":
      return "bg-sky-500/15 text-sky-700 border-sky-500/30";
    case "Aguardando Documento":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
};

export const formatDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR");
};