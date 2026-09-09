import { useLastSync } from "@/hooks/useLastSync";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Database } from "lucide-react";

interface LastSyncBadgeProps {
  className?: string;
  /** Override timestamp (ISO string) — if provided, skips the DB query */
  overrideTimestamp?: string | null;
}

const BR_TIMEZONE = "America/Sao_Paulo";

/** Data e hora sempre no fuso de Brasília, independente do fuso do navegador. */
export function formatBrasilia(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BR_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function LastSyncBadge({ className = "", overrideTimestamp }: LastSyncBadgeProps) {
  const { data: dbSync } = useLastSync();
  const lastSync = overrideTimestamp ?? dbSync;

  if (!lastSync) return null;

  const date = parseISO(lastSync);
  if (Number.isNaN(date.getTime())) return null;

  const absolute = formatBrasilia(date);
  const relative = formatDistanceToNow(date, { addSuffix: true, locale: ptBR });

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground ${className}`}
      title={`Última atualização: ${absolute} (horário de Brasília) · ${relative}`}
    >
      <Database className="h-3 w-3" />
      Última atualização: {absolute}
    </span>
  );
}
