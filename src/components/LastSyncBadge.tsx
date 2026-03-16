import { useLastSync } from "@/hooks/useLastSync";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Database } from "lucide-react";

interface LastSyncBadgeProps {
  className?: string;
  /** Override timestamp (ISO string) — if provided, skips the DB query */
  overrideTimestamp?: string | null;
}

export default function LastSyncBadge({ className = "", overrideTimestamp }: LastSyncBadgeProps) {
  const { data: dbSync } = useLastSync();
  const lastSync = overrideTimestamp ?? dbSync;

  if (!lastSync) return null;

  const date = parseISO(lastSync);
  const relative = formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
  const absolute = format(date, "dd/MM/yyyy HH:mm");

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] text-muted-foreground ${className}`}
      title={`Última sincronização: ${absolute}`}
    >
      <Database className="h-3 w-3" />
      Sinc: {relative}
    </span>
  );
}
