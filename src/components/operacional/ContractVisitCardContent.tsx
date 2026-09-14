import { CircleCheckBig, Clock3 } from "lucide-react";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import { formatWorkedMinutes } from "@/lib/agendaWorkedTime";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const hours = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`;
const dateLabel = (value: string | null | undefined) => {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join("/") : "Não informada";
};
const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function summarizeContractVisitForTechnician(item: AgendaAgendamento) {
  const details = Array.isArray(item.contrato_visita_tarefas_detalhes)
    ? item.contrato_visita_tarefas_detalhes as Array<{ tarefa_id?: string | number; tecnico?: string; horas?: string | number }>
    : [];
  const collaborator = norm(item.colaborador_nome);
  const matched = details.filter((detail) => {
    const technician = norm(detail.tecnico || "");
    return technician && collaborator && (
      technician === collaborator || collaborator.includes(technician) || technician.includes(collaborator)
    );
  });
  const selected = matched.length ? matched : details;
  const knownHours = selected.filter((detail) => detail.horas != null && detail.horas !== "" && Number.isFinite(Number(detail.horas)) && Number(detail.horas) >= 0);
  const total = knownHours.reduce((sum, detail) => sum + Number(detail.horas), 0);
  const taskIds = [...new Set(selected.map((detail) => String(detail.tarefa_id || "").trim()).filter(Boolean))];
  return {
    hours: knownHours.length > 0 ? total : Number(item.contrato_visita_horas_realizadas || 0),
    taskIds: taskIds.length ? taskIds : item.contrato_visita_tarefa_ids ?? [],
    technicianMatched: matched.length > 0 && knownHours.length > 0,
  };
}

function visitStatus(item: AgendaAgendamento) {
  return item.previsao_tipo === "CONTRATO_REALIZADO" || item.contrato_visita_execucao_id || item.contrato_visita_realizada_em
    ? "Realizada" : "Programada";
}

export function contractVisitActivity(item: AgendaAgendamento) {
  const contract = norm(item.contrato_nome || "");
  const type = norm(item.contrato_tipo_nome || "");
  if (contract.includes("duto")) return "Dutos";
  if (type.includes("coifa") || contract.includes("coifa")) return "Coifas";
  if (type.includes("preventiva")) return "Preventiva";
  return item.contrato_tipo_nome || item.contrato_nome || "Tipo não definido";
}

export function contractVisitCardTitle(item: AgendaAgendamento) {
  const summary = summarizeContractVisitForTechnician(item);
  return [
    `${item.cliente} · ${item.contrato_visita_numero || ""}ª visita contratual · ${visitStatus(item)}`,
    `Contrato: ${item.contrato_nome || "Não identificado"} · Tipo: ${item.contrato_tipo_nome || "Não definido"}`,
    item.previsao_tipo === "CONTRATO_REALIZADO"
      ? `${formatWorkedMinutes(Math.round(summary.hours * 60))} ${summary.technicianMatched ? "do técnico" : "da visita"} · ${summary.taskIds.length} tarefa(s)`
      : `Mês: ${item.contrato_visitas_cumpridas || 0}/${item.contrato_visitas_previstas ?? "—"} visitas · ${hours(item.contrato_horas_cumpridas)}/${hours(item.contrato_horas_previstas)}`,
    `Última realização: ${dateLabel(item.contrato_visita_ultima_realizada_em || item.contrato_visita_realizada_em)}`,
    item.descricao,
    item.previsao_detalhes,
  ].filter(Boolean).join("\n");
}

/** A previsão ocupa só uma linha; o saldo completo fica no detalhe. */
export function ContractVisitCardContent({ item }: { item: AgendaAgendamento }) {
  const status = visitStatus(item);
  return (
    <div data-contract-visit-summary className="flex min-w-0 items-center gap-1 text-[11px] font-medium leading-4 normal-case">
      <span role="img" aria-label={`Visita ${status.toLowerCase()}`} className="shrink-0">
        {status === "Realizada"
          ? <CircleCheckBig className="h-3 w-3" aria-hidden="true" />
          : <Clock3 className="h-3 w-3" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1 truncate" title={`${item.cliente} · ${contractVisitActivity(item)}`}>{item.cliente}</span>
      <span className="shrink-0 text-[10px]">{status === "Realizada" ? "Contabilizado" : "Contrato previsto"}</span>
    </div>
  );
}

export function ContractVisitDetailsDialog({ item, onClose, onEdit, onContinue }: {
  item: AgendaAgendamento | null;
  onClose: () => void;
  onEdit: (item: AgendaAgendamento) => void;
  onContinue?: (item: AgendaAgendamento) => void;
}) {
  if (!item) return null;
  const summary = summarizeContractVisitForTechnician(item);
  const completed = item.previsao_tipo === "CONTRATO_REALIZADO";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.contrato_visita_numero || ""}ª visita · {item.cliente}</DialogTitle>
          <DialogDescription>{contractVisitActivity(item)} · {visitStatus(item)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Contrato</dt><dd>{item.contrato_nome || "Não identificado"}</dd>
          <dt className="text-muted-foreground">Data na agenda</dt><dd>{dateLabel(item.data)} · {item.hora_inicio.slice(0, 5)}–{item.hora_fim.slice(0, 5)}</dd>
          <dt className="text-muted-foreground">Técnico</dt><dd>{item.colaborador_nome}</dd>
          <dt className="text-muted-foreground">Competência</dt><dd>{String(item.contrato_visita_competencia || "").slice(0, 7).split("-").reverse().join("/") || "Não informada"}</dd>
          <dt className="text-muted-foreground">Realizada em</dt><dd>{dateLabel(item.contrato_visita_realizada_em)}</dd>
          {!completed && <>
            <dt className="text-muted-foreground">Progresso no mês</dt><dd>{item.contrato_visitas_cumpridas || 0}/{item.contrato_visitas_previstas ?? "—"} visitas · {hours(item.contrato_horas_cumpridas)}/{hours(item.contrato_horas_previstas)}</dd>
            <dt className="text-muted-foreground">Última realização</dt><dd>{dateLabel(item.contrato_visita_ultima_realizada_em || item.contrato_visita_realizada_em)}</dd>
            <dt className="text-muted-foreground">Saldo de horas</dt><dd>{hours(Math.max(0, Number(item.contrato_horas_previstas || 0) - Number(item.contrato_horas_cumpridas || 0)))}</dd>
          </>}
          {(completed || summary.taskIds.length > 0) && <>
            <dt className="text-muted-foreground">Horas reconhecidas</dt><dd>{formatWorkedMinutes(Math.round(summary.hours * 60))} {summary.technicianMatched ? "do técnico" : "da visita"}</dd>
            <dt className="text-muted-foreground">Tarefas</dt><dd className="break-words">{summary.taskIds.map((id) => `#${id}`).join(" · ") || "Nenhuma informada"}</dd>
          </>}
        </dl>
        {item.descricao && <p className="whitespace-pre-wrap text-sm">{item.descricao}</p>}
        {item.previsao_detalhes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.previsao_detalhes}</p>}
        {!completed && <div className="flex flex-wrap gap-2">
          <Button onClick={() => { onClose(); onEdit(item); }}>Editar previsão</Button>
          {onContinue && <Button variant="outline" onClick={() => { onClose(); onContinue(item); }}>Prever continuação</Button>}
        </div>}
      </DialogContent>
    </Dialog>
  );
}
