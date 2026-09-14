import { CircleCheckBig, Clock3 } from "lucide-react";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import type { AgendaContractIndicator } from "@/lib/agendaContractIndicators";
import { agendaVisualStatus } from "@/lib/agendaTaskStatus";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { contractVisitActivity, contractVisitCardTitle } from "./ContractVisitCardContent";

/** Um único sinal por tarefa; visitas e competências ficam nos detalhes. */
export function AgendaContractBadge({ task, indicators, onOpen, onDragStart }: {
  task: AgendaAgendamento;
  indicators: AgendaContractIndicator[];
  onOpen: (card: AgendaAgendamento) => void;
  onDragStart: (card: AgendaAgendamento) => void;
}) {
  if (!indicators.length) return null;
  const active = indicators.filter(item => item.status === "contabilizada" || !item.contractCard.contrato_visita_execucao_id);
  const historyOnly = active.length === 0;
  const accounted = active.length > 0 && active.every(item => item.status === "contabilizada");
  const pendingValidation = !accounted && agendaVisualStatus(task) === "finalizada";
  const label = historyOnly && !pendingValidation ? "Vínculo anterior" : accounted ? "Contabilizado" : pendingValidation ? "Aguardando validação" : "Conta no contrato";
  const activities = [...new Set(indicators.map(item => contractVisitActivity(item.contractCard)))].join(" / ");
  const single = indicators.length === 1 ? indicators[0] : null;
  const canDrag = Boolean(single && single.contractCard.previsao_tipo !== "CONTRATO_REALIZADO");
  const explanation = historyOnly
    ? "Esta tarefa consta no planejamento de visitas anteriores. Esse histórico não comprova contabilização nem uma nova visita prevista."
    : accounted
    ? "Esta tarefa já foi reconhecida na execução do contrato."
    : pendingValidation
      ? "Há vínculo contratual aguardando validação. Consulte os detalhes para conferir o que já foi contabilizado."
      : "Tarefa vinculada ao contrato; as horas serão reconhecidas após a execução válida.";
  const badge = <button type="button" data-contract-visit-recognition
    aria-label={`${label} · ${activities} · ${task.cliente}`}
    title={`${explanation}\n${indicators.map(item => contractVisitCardTitle(item.contractCard)).join("\n\n")}`}
    draggable={canDrag}
    onDragStart={() => { if (canDrag && single) onDragStart(single.contractCard); }}
    onClick={single ? () => onOpen(single.contractCard) : undefined}
    className={cn("absolute bottom-1 right-1 inline-flex h-3.5 w-[76px] items-center justify-center gap-1 rounded-full border px-1 text-[9px] font-medium normal-case leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      accounted ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        : pendingValidation ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200")}
  >
    {accounted ? <CircleCheckBig className="h-2.5 w-2.5 shrink-0" /> : <Clock3 className="h-2.5 w-2.5 shrink-0" />}
    Contrato
  </button>;
  if (single) return badge;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>{badge}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-72 w-80 overflow-y-auto">
      <DropdownMenuLabel>Visitas vinculadas à tarefa</DropdownMenuLabel>
      {indicators.map(indicator => <DropdownMenuItem key={indicator.contractCard.id}
        onSelect={() => onOpen(indicator.contractCard)} className="flex-col items-start gap-0.5">
        <span className="font-medium">{indicator.contractCard.contrato_nome || contractVisitActivity(indicator.contractCard)}</span>
        <span className="text-xs text-muted-foreground">
          {indicator.contractCard.contrato_visita_numero}ª visita · {indicator.contractCard.contrato_visita_competencia || indicator.contractCard.data}
          {indicator.status === "contabilizada" ? " · Contabilizado"
            : indicator.contractCard.contrato_visita_execucao_id ? " · Vínculo anterior" : " · Vínculo previsto"}
        </span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
