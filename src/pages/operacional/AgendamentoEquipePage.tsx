import { useMemo, useState, useEffect, useRef } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, RefreshCw, Printer, Plus, Truck, Users, AlertTriangle, Download, CalendarClock, Clock3, CircleCheckBig, Tags as TagsIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useColaboradores, useRhClientes } from "@/hooks/rh/useRh";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useAgendaVeiculos,
  useAgendaSemana,
  useSalvarCelulaTecnico,
  useSalvarCelulaVeiculo,
  useSaveAgendamento,
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { useQueryClient } from "@tanstack/react-query";
import AgendamentoEquipeDialog from "@/components/operacional/AgendamentoEquipeDialog";
import TarefaAuvoDetalheDialog from "@/components/operacional/TarefaAuvoDetalheDialog";
import CriarTarefaGeralDialog from "@/components/operacional/CriarTarefaGeralDialog";
import AgendaRelatorioDialog from "@/components/operacional/AgendaRelatorioDialog";
import {
  AGENDA_TASK_SYNC_FIELDS,
  agendaTaskSnapshotChanged,
  mergeAgendaTaskSnapshot,
} from "@/lib/agendaIncrementalSync";
import {
  agendaVisualStatus,
  shouldHighlightPendingGcExecution,
} from "@/lib/agendaTaskStatus";
import { AgendaFilters } from "@/components/operacional/AgendaFilters";
import {
  agendaTaskWorkedTime,
  formatWorkedClock,
  formatWorkedMinutes,
  summarizeAgendaWorkedTime,
} from "@/lib/agendaWorkedTime";
import { toast } from "sonner";
import { areNamesDivergent } from "@/lib/clientMatching";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAgendaTagLinks,
  useAgendaTags,
  type AgendaTag,
} from "@/hooks/operacional/useAgendaTags";
import {
  agendaMatchesTagFilter,
  agendaTagTextColor,
  normalizeAgendaTagColor,
} from "@/lib/agendaTags";
import {
  formatSignedAgendaMinutes,
  summarizeAgendaOsPlannedVsActual,
} from "@/lib/agendaPlannedVsActual";
import { missingAuvoAgendaIds } from "@/lib/agendaAuvoReconciliation";
import {
  contractMonthlyHoursAreFulfilled,
  sortAgendaItemsWithContractPlanFirst,
} from "@/lib/agendaContractVisits";

const DIAS_TRADUZIDOS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

const norm = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const formatContractHours = (hours: number | null | undefined) =>
  `${Number(hours || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`;

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico") || txt.includes("auxiliar");
};

const PALETA = [
  // Azuis
  "bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]",
  "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "bg-[#EFF6FF] text-[#1E40AF] border-[#DBEAFE]",
  // Amarelos/Laranjas
  "bg-[#FEF3C7] text-[#A16207] border-[#FDE68A]",
  "bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]",
  "bg-[#FEF9C3] text-[#854D0E] border-[#FEF08A]",
  // Roxos/Violets
  "bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF]",
  "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
  "bg-[#EDE9FE] text-[#5B21B6] border-[#DDD6FE]",
  // Cyans/Teals
  "bg-[#ECFEFF] text-[#0E7490] border-[#CFFAFE]",
  "bg-[#F0FDFA] text-[#0F766E] border-[#CCFBF1]",
  "bg-[#E0F7FA] text-[#006064] border-[#B2EBF2]",
  // Outros/Misturas (Removidos tons avermelhados como #FEE2E2, #FFE4E6, etc)
  "bg-[#FDF4FF] text-[#A21CAF] border-[#FAE8FF]",
  "bg-[#FAF5FF] text-[#553C9A] border-[#E9D8FD]",
  "bg-[#FFF8E1] text-[#855B0F] border-[#FFECB3]",
  "bg-[#F0F9FF] text-[#0369A1] border-[#E0F2FE]",
  "bg-[#EBF8FF] text-[#2C5282] border-[#BEE3F8]",
  "bg-[#E6FFFA] text-[#285E61] border-[#B2F5EA]",
  "bg-[#EFEBE9] text-[#4E342E] border-[#D7CCC8]",
  "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0]",
  "bg-[#E8EAF6] text-[#1A237E] border-[#C5CAE9]",
  "bg-[#FFFBEB] text-[#92400E] border-[#FEF3C7]",
  "bg-[#F5F5F4] text-[#44403C] border-[#E7E5E4]",
  "bg-[#EFF6FF] text-[#2563EB] border-[#DBEAFE]",
  "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
  "bg-[#FDF4FF] text-[#C026D3] border-[#FAE8FF]",
  "bg-[#FEFCE8] text-[#A16207] border-[#FEF9C3]",
  "bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]",
  "bg-[#F0F9FF] text-[#0284C7] border-[#E0F9FF]",
  "bg-[#EEF2FF] text-[#4F46E5] border-[#E0E7FF]",
  "bg-[#F5F3FF] text-[#6D28D9] border-[#EDE9FE]",
];

const corCliente = (texto: string) => {
  const t = texto.trim().toUpperCase();
  if (!t) return "";
  if (t === "X" || t === "FOLGA") return "bg-muted text-muted-foreground";
  if (t.startsWith("OFICINA")) return "bg-slate-200 text-slate-800";

  // Hash aprimorado para dispersar melhor as cores e evitar colisões
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = t.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Salt adicional baseado no comprimento para diferenciar strings curtas/similares
  hash += t.length * 31;

  const colorIndex = Math.abs(hash) % PALETA.length;
  return PALETA[colorIndex];
};

const getStatusColor = (a: AgendaAgendamento) => {
  if (a.previsao_tipo === "CONTRATO_REALIZADO") {
    return "bg-violet-100 text-violet-900 border-violet-500 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-700 font-bold";
  }
  if (a.previsao_tipo === "CONTRATO") {
    if (contractMonthlyHoursAreFulfilled(a)) {
      return "bg-emerald-50 text-emerald-950 border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-600 font-bold";
    }
    return "bg-sky-100 text-sky-950 border-sky-500 dark:bg-sky-950/60 dark:text-sky-100 dark:border-sky-600 font-bold";
  }
  const status = agendaVisualStatus(a);
  if (status === "finalizada") {
    return "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800 font-bold";
  }
  if (status === "pausada") {
    return "bg-amber-200 text-amber-950 border-amber-500 dark:bg-amber-900/60 dark:text-amber-200 dark:border-amber-700 font-bold";
  }
  if (status === "atrasada") {
    return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800 font-bold";
  }
  return "";
};

interface CelulaProps {
  itens: AgendaAgendamento[];
  onSalvar: (v: string) => void;
  onAbrirTarefa: (a: AgendaAgendamento) => void;
  onAbrirAgendamento: (a: AgendaAgendamento | null) => void;
  onNovaTarefaAuvo: () => void;
  onPreverProximoDia: (a: AgendaAgendamento) => void;
  onDragStart: (a: AgendaAgendamento) => void;
  onDrop: () => void;
  colorir?: boolean;
  clientesInfo?: any[];
  tagsPorAgendamento: Map<string, AgendaTag[]>;
  tagsSelecionadas: string[];
  apenasPrevisaoOrcamento?: boolean;
}

type ContractVisitTaskDetail = {
  tarefa_id?: string | number | null;
  tecnico?: string | null;
  horas?: string | number | null;
};

const summarizeContractVisitForTechnician = (item: AgendaAgendamento) => {
  const details = Array.isArray(item.contrato_visita_tarefas_detalhes)
    ? (item.contrato_visita_tarefas_detalhes as ContractVisitTaskDetail[])
    : [];
  const collaboratorName = norm(item.colaborador_nome);
  const technicianDetails = details.filter((detail) => {
    const technicianName = norm(String(detail.tecnico || ""));
    return Boolean(
      technicianName
      && collaboratorName
      && (
        technicianName === collaboratorName
        || collaboratorName.includes(technicianName)
        || technicianName.includes(collaboratorName)
      )
    );
  });
  const selected = technicianDetails.length > 0 ? technicianDetails : details;
  const hours = selected.reduce((total, detail) => {
    const value = Number(detail.horas);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const taskIds = [...new Set(selected
    .map((detail) => String(detail.tarefa_id || "").trim())
    .filter(Boolean))];
  return {
    hours: hours > 0 ? hours : Number(item.contrato_visita_horas_realizadas || 0),
    taskIds: taskIds.length > 0 ? taskIds : (item.contrato_visita_tarefa_ids ?? []),
    technicianMatched: technicianDetails.length > 0,
  };
};

function Celula({
  itens,
  onSalvar,
  onAbrirTarefa,
  onAbrirAgendamento,
  onNovaTarefaAuvo,
  onPreverProximoDia,
  onDragStart,
  onDrop,
  colorir = true,
  clientesInfo = [],
  tagsPorAgendamento,
  tagsSelecionadas,
  apenasPrevisaoOrcamento = false,
}: CelulaProps) {
  const [editando, setEditando] = useState(false);
  const manual = itens.find((i) => !i.auvo_task_id && (!i.origem || i.origem === "MANUAL"));
  const [rascunho, setRascunho] = useState(manual?.cliente ?? "");
  const horasTrabalhadas = summarizeAgendaWorkedTime(itens);
  const comparativoOs = summarizeAgendaOsPlannedVsActual(itens);

  if (editando) {
    return (
      <td className="border border-border p-0 align-top">
        <textarea
          autoFocus
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => {
            setEditando(false);
            if (rascunho.trim() !== (manual?.cliente ?? "").trim()) onSalvar(rascunho);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRascunho(manual?.cliente ?? "");
              setEditando(false);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full h-16 resize-none bg-background p-1.5 text-[11px] font-medium uppercase outline-none ring-2 ring-primary"
        />
      </td>
    );
  }

  return (
    <td
      onDoubleClick={() => {
        setRascunho(manual?.cliente ?? "");
        setEditando(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add("bg-primary/5");
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove("bg-primary/5");
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("bg-primary/5");
        onDrop();
      }}
      className="group relative border border-border p-0.5 align-top h-16 min-w-[150px] transition-colors"
    >
      <div className="flex flex-col gap-0.5 h-full">
        {(comparativoOs.plannedMinutes > 0 || comparativoOs.totalOsCount > 0 || horasTrabalhadas.totalMinutes > 0 || horasTrabalhadas.inProgress > 0) && (
          <div className="flex flex-wrap gap-1 normal-case">
            {(comparativoOs.plannedMinutes > 0 || comparativoOs.totalOsCount > 0) && (
              <div
                className="flex items-center gap-1 rounded-sm border border-indigo-200 bg-indigo-50 px-1.5 py-1 text-[10px] font-bold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
                title="Soma a duração planejada de todas as tarefas do dia (OS do GestãoClick, Preventivas no Auvo, Contratos e Previsões)."
              >
                <CalendarClock className="h-3 w-3 shrink-0" />
                <span>
                  Planejado OS: {comparativoOs.plannedMinutes > 0
                    ? formatWorkedMinutes(comparativoOs.plannedMinutes)
                    : "sem duração"}
                </span>
                {comparativoOs.pendingOsCount > 0 && (
                  <span className="font-medium">· {comparativoOs.pendingOsCount} pendente(s)</span>
                )}
                {comparativoOs.missingPlannedOsCount > 0 && (
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    · {comparativoOs.missingPlannedOsCount} OS sem duração
                  </span>
                )}
              </div>
            )}
            {(horasTrabalhadas.totalMinutes > 0 || horasTrabalhadas.inProgress > 0) && (
              <div
                className="flex items-center gap-1 rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-1 text-[10px] font-bold text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                title="Tempo efetivamente trabalhado no Auvo. Previsões e duração planejada não entram neste total."
              >
                <Clock3 className="h-3 w-3 shrink-0" />
                <span>Trabalhado: {formatWorkedMinutes(horasTrabalhadas.totalMinutes)}</span>
                {horasTrabalhadas.inProgress > 0 && (
                  <span className="font-medium">· {horasTrabalhadas.inProgress} em andamento</span>
                )}
              </div>
            )}
            {comparativoOs.completedOsCount > 0 && (
              <div
                className={cn(
                  "flex items-center gap-1 rounded-sm border px-1.5 py-1 text-[10px] font-bold",
                  comparativoOs.differenceMinutes > 0
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                )}
                title="Compara somente OS já concluídas: tempo real de check-in/checkout contra a duração que estava planejada. OS pendentes não reduzem o real."
              >
                <span>
                  OS executadas: {formatWorkedMinutes(comparativoOs.actualCompletedMinutes)} real / {formatWorkedMinutes(comparativoOs.comparedPlannedMinutes)} planejado
                </span>
                <span>· {formatSignedAgendaMinutes(comparativoOs.differenceMinutes)}</span>
              </div>
            )}
          </div>
        )}
        {itens.map((a) => {
          const visitaContratualRealizada = a.previsao_tipo === "CONTRATO_REALIZADO";
          const visitaContratualPlanejada = a.previsao_tipo === "CONTRATO";
          const visitaContratualCumprida = visitaContratualPlanejada
            && Boolean(a.contrato_visita_execucao_id || a.contrato_visita_realizada_em);
          const visitaContratualComExecucaoNoMes = visitaContratualPlanejada
            && Number(a.contrato_visitas_cumpridas || 0) > 0;
          const cargaContratualMensalCumprida = visitaContratualPlanejada
            && contractMonthlyHoursAreFulfilled(a);
          const visitaContratualAlinhada = visitaContratualPlanejada
            && (a.contrato_visita_tarefa_ids?.length ?? 0) > 0;
          const visitaContratualBloqueada = visitaContratualRealizada;
          const resumoVisita = visitaContratualRealizada ? summarizeContractVisitForTechnician(a) : null;
          const horasContratuaisDisponiveis = Math.max(
            0,
            Number(a.contrato_horas_previstas || 0) - Number(a.contrato_horas_cumpridas || 0),
          );
          const dataRealizadaLabel = a.contrato_visita_realizada_em
            ? format(parseISO(a.contrato_visita_realizada_em.slice(0, 10)), "dd/MM/yyyy")
            : null;
          const ultimaRealizadaLabel = dataRealizadaLabel;
          const itemTags = tagsPorAgendamento.get(a.id) ?? [];
          const correspondeAoFiltro = agendaMatchesTagFilter(itemTags, tagsSelecionadas);
          const statusColor = getStatusColor(a);
          const tempoTrabalhado = agendaTaskWorkedTime(a);
          const tipoTarefa = a.auvo_task_id
            ? (a.tipo_tarefa_auvo || "TIPO NÃO INFORMADO")
            : null;
          const situacaoGc = String(a.gc_os_situacao || "").trim();
          const destacarSituacaoGc = shouldHighlightPendingGcExecution(a);
          const clienteGc = String(a.gc_os_cliente || "").trim();
          const clienteDivergente = Boolean(
            a.auvo_task_id && clienteGc && a.cliente && a.vinculo_status !== "vinculado" && areNamesDivergent(a.cliente, clienteGc),
          );
          const identificadoresAntesSituacao = [
            visitaContratualRealizada
              ? `VISITA CONTRATUAL · ${a.contrato_visita_numero || ""}ª VISITA · REALIZADA`
              : visitaContratualPlanejada
                ? `VISITA CONTRATUAL · ${a.contrato_visita_numero || ""}ª VISITA · ${visitaContratualCumprida ? "REALIZADA NO MÊS" : "PROGRAMADA"}`
                : null,
            tipoTarefa,
            a.gc_os_codigo ? `OS ${a.gc_os_codigo}` : null,
          ].filter(Boolean);
          const identificadoresDepoisSituacao = [
            a.auvo_task_id ? `Tarefa ${a.auvo_task_id}` : null,
            !a.gc_os_codigo && !a.auvo_task_id && a.gc_orcamento_codigo
              ? `Orç ${a.gc_orcamento_codigo}`
              : null,
          ].filter(Boolean);
          const possuiIdentificador = identificadoresAntesSituacao.length > 0
            || identificadoresDepoisSituacao.length > 0;

          return (
            <div
              key={a.id}
              className={cn(
                "group/item relative flex items-center rounded-sm transition-all",
                ((tagsSelecionadas.length > 0 && !correspondeAoFiltro) || (apenasPrevisaoOrcamento && a.previsao_tipo !== "ORCAMENTO_EXECUCAO")) && "opacity-20 grayscale",
                ((tagsSelecionadas.length > 0 && correspondeAoFiltro) || (apenasPrevisaoOrcamento && a.previsao_tipo === "ORCAMENTO_EXECUCAO")) && "ring-2 ring-primary/70 ring-offset-1",
              )}
            >
              <button
                type="button"
                draggable={!visitaContratualBloqueada}
                onDragStart={() => {
                  if (!visitaContratualBloqueada) onDragStart(a);
                }}
                title={visitaContratualRealizada
                  ? `${a.contrato_visita_numero || ""}ª visita contratual realizada · ${formatWorkedMinutes(Math.round(Number(resumoVisita?.hours || 0) * 60))} ${resumoVisita?.technicianMatched ? "do técnico" : "da visita"} contabilizadas`
                  : visitaContratualComExecucaoNoMes
                    ? `${formatContractHours(a.contrato_horas_cumpridas)} já cumpridas no mês · última visita em ${ultimaRealizadaLabel || "data não informada"} · ${formatContractHours(horasContratuaisDisponiveis)} disponíveis`
                  : a.origem === "CONTRATO"
                  ? `Previsão contratual${a.descricao ? ` · ${a.descricao}` : ""}${a.previsao_detalhes ? ` · ${a.previsao_detalhes}` : ""}`
                  : a.previsao_continuidade
                  ? `Previsão interna${a.previsao_detalhes ? ` · ${a.previsao_detalhes}` : ""}`
                  : a.auvo_task_id
                    ? `Tipo: ${a.tipo_tarefa_auvo_descricao || tipoTarefa} · Tarefa Auvo #${a.auvo_task_id}${situacaoGc ? ` · Situação GC: ${situacaoGc}` : ""}`
                    : "Agendamento manual"}
                onClick={() => {
                  if (visitaContratualBloqueada) return;
                  if (a.auvo_task_id) onAbrirTarefa(a);
                  else onAbrirAgendamento(a);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1 && a.auvo_task_id) {
                    onAbrirAgendamento(a);
                  }
                }}
                className={cn(
                  "w-full text-left rounded-sm px-1.5 py-1 text-[11px] font-semibold uppercase leading-tight hover:ring-1 hover:ring-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-grab active:cursor-grabbing border border-transparent transition-all",
                  visitaContratualRealizada && "cursor-default active:cursor-default border-2 border-violet-500 shadow-sm",
                  visitaContratualAlinhada && "border-2 border-sky-500 shadow-sm",
                  a.previsao_continuidade && !visitaContratualPlanejada && "border border-dashed border-primary/50 opacity-80",
                  a.previsao_tipo === "ORCAMENTO_EXECUCAO" && a.previsao_continuidade && "border-2 border-primary shadow-[0_0_8px_rgba(var(--primary),0.4)] animate-pulse-subtle",
                  colorir && !statusColor && corCliente(a.cliente),
                  statusColor,
                  clienteDivergente && "border-2 border-destructive ring-1 ring-destructive/50",
                )}
              >
                <div className="flex flex-col">
                  <span className="truncate">
                    {identificadoresAntesSituacao.join(" · ")}
                    {situacaoGc && a.gc_os_codigo && (
                      <>
                        {" "}
                        <span
                          className={cn(
                            destacarSituacaoGc
                              && "font-extrabold text-yellow-600 dark:text-yellow-300",
                          )}
                          title={destacarSituacaoGc
                            ? "Tarefa finalizada no Auvo, mas a OS ainda não está executada no GestãoClick."
                            : undefined}
                        >
                          [{situacaoGc}]
                        </span>
                      </>
                    )}
                    {identificadoresDepoisSituacao.length > 0 && (
                      <>
                        {identificadoresAntesSituacao.length > 0 ? " · " : ""}
                        {identificadoresDepoisSituacao.join(" · ")}
                      </>
                    )}
                    {possuiIdentificador ? ` - ${a.cliente}` : a.cliente}
                  </span>
                  {(visitaContratualPlanejada || visitaContratualRealizada) && (
                    <span
                      className="truncate text-[9px] font-extrabold normal-case"
                      title={`Contrato seguido: ${a.contrato_nome || "não identificado"} · Tipo: ${a.contrato_tipo_nome || "não definido"}`}
                    >
                      Contrato seguido: {a.contrato_nome || "não identificado"} · Tipo: {a.contrato_tipo_nome || "não definido"}
                    </span>
                  )}
                  {visitaContratualComExecucaoNoMes && (
                    <span
                      className={cn(
                        "mt-1 flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-black normal-case",
                        cargaContratualMensalCumprida
                          ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-50"
                          : "border-sky-300 bg-white/70 text-sky-950 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100",
                      )}
                    >
                      {cargaContratualMensalCumprida
                        ? <CircleCheckBig className="h-3 w-3 shrink-0" />
                        : <Clock3 className="h-3 w-3 shrink-0" />}
                      <span>
                        {cargaContratualMensalCumprida ? "CARGA MENSAL CUMPRIDA" : "PROGRESSO NO MÊS"}: {formatContractHours(a.contrato_horas_cumpridas)} · {a.contrato_visitas_cumpridas ?? 0}/{a.contrato_visitas_previstas ?? 0} visita(s)
                        {ultimaRealizadaLabel ? ` · última em ${ultimaRealizadaLabel}` : ""} · saldo: {formatContractHours(horasContratuaisDisponiveis)} disponíveis
                      </span>
                    </span>
                  )}
                  {clienteDivergente && a.vinculo_status !== "vinculado" && (
                    <span
                      className="mt-0.5 flex items-center gap-1 rounded-sm bg-destructive/15 px-1 py-0.5 text-[9px] font-bold normal-case text-destructive"
                      title={`Cliente divergente · Auvo: ${a.cliente} · GC: ${clienteGc} · Status Vínculo: ${a.vinculo_status || "pendente"}`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">Cliente GC divergente: {clienteGc}</span>
                    </span>
                  )}
                  {itemTags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1 normal-case">
                      {itemTags.map((tag) => {
                        const color = normalizeAgendaTagColor(tag.color);
                        return (
                          <span
                            key={tag.id}
                            className="max-w-full truncate rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none"
                            style={{ backgroundColor: color, color: agendaTagTextColor(color) }}
                            title={tag.name}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {tempoTrabalhado.hasCheckIn && (
                    <span className="flex items-center gap-1 text-[9px] font-semibold normal-case opacity-90 truncate">
                      <Clock3 className="h-2.5 w-2.5 shrink-0" />
                      {formatWorkedClock(tempoTrabalhado.checkIn)} → {tempoTrabalhado.hasCheckOut
                        ? formatWorkedClock(tempoTrabalhado.checkOut)
                        : "em andamento"}
                      {tempoTrabalhado.minutes > 0 && ` · ${formatWorkedMinutes(tempoTrabalhado.minutes)}`}
                    </span>
                  )}
                  {visitaContratualRealizada && (
                    <>
                      <span className="flex items-center gap-1 text-[9px] font-extrabold normal-case">
                        <Clock3 className="h-2.5 w-2.5 shrink-0" />
                        {formatWorkedMinutes(Math.round(Number(resumoVisita?.hours || 0) * 60))} contabilizadas
                        {resumoVisita?.taskIds.length
                          ? ` · ${resumoVisita.taskIds.length} tarefa(s)`
                          : ""}
                      </span>
                      {resumoVisita?.technicianMatched ? (
                        <span className="truncate text-[9px] font-medium normal-case">
                          {a.colaborador_nome}
                        </span>
                      ) : null}
                      {resumoVisita?.taskIds.length ? (
                        <span className="truncate text-[9px] font-medium normal-case opacity-80" title={resumoVisita.taskIds.map((id) => `#${id}`).join(" · ")}>
                          Tarefas: {resumoVisita.taskIds.map((id) => `#${id}`).join(" · ")}
                        </span>
                      ) : null}
                    </>
                  )}
                  {visitaContratualPlanejada && a.contrato_visitas_previstas != null && (
                    <span className="flex items-center gap-1 text-[9px] font-extrabold normal-case text-sky-900 dark:text-sky-100">
                      <Clock3 className="h-2.5 w-2.5 shrink-0" />
                      Cumprido: {a.contrato_visitas_cumpridas ?? 0}/{a.contrato_visitas_previstas} visitas
                      {a.contrato_horas_previstas != null
                        ? ` · ${formatContractHours(a.contrato_horas_cumpridas)}/${formatContractHours(a.contrato_horas_previstas)}`
                        : ""}
                    </span>
                  )}
                  {a.previsao_detalhes && !visitaContratualRealizada && !visitaContratualCumprida && (
                    <span className="text-[9px] font-normal lowercase opacity-80 truncate">
                      {a.previsao_detalhes}
                    </span>
                  )}
                  {a.previsao_tipo === "ORCAMENTO_EXECUCAO" && a.previsao_continuidade && a.conversao_status && (
                    <span className="text-[9px] font-normal normal-case opacity-80 truncate">
                      {a.conversao_status === "AGUARDANDO_OS" && "Aguardando geração da OS"}
                      {a.conversao_status === "AGUARDANDO_TAREFA" && `OS ${a.gc_os_codigo || ""} · aguardando tarefa de execução`}
                      {a.conversao_status === "PROCESSANDO" && "Convertendo para tarefa Auvo..."}
                      {a.conversao_status === "BLOQUEADA" && `Conversão bloqueada${a.conversao_erro ? ` · ${a.conversao_erro}` : ""}`}
                      {a.conversao_status === "ERRO" && `Erro na conversão${a.conversao_erro ? ` · ${a.conversao_erro}` : ""}`}
                    </span>
                  )}
                </div>
                {(visitaContratualPlanejada || a.previsao_continuidade) && (
                  <span className="ml-1 text-[9px] lowercase italic text-primary-foreground/70">
                    {a.origem === "CONTRATO" ? "(contrato)" : "(previsão)"}
                  </span>
                )}
              </button>
              {!visitaContratualBloqueada && <div className="absolute -right-1 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-0.5 group-hover/item:flex">
                {(
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreverProximoDia(a);
                    }}
                    title="Prever continuação no próximo dia"
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm transition-transform hover:scale-110"
                  >
                    +
                  </button>
                )}
                {a.previsao_continuidade && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbrirAgendamento(a);
                    }}
                    title="Excluir previsão"
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground shadow-sm transition-transform hover:scale-110"
                  >
                    ×
                  </button>
                )}
              </div>}
            </div>
          );
        })}
        
        {/* Espaço clicável para nova tarefa sempre disponível, mesmo com itens */}
        <button
          type="button"
          onClick={() => onNovaTarefaAuvo()}
          className={cn(
            "w-full text-[11px] opacity-25 hover:opacity-100 transition-opacity min-h-[1.5rem] flex-1 flex items-center justify-center hover:bg-primary/5 rounded-sm border border-transparent hover:border-primary/20",
            itens.length > 0 && "mt-auto py-1"
          )}
          aria-label="Nova tarefa ou previsão"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </td>
  );
}

function CelulaTexto({ valor, onSalvar, onExcluir }: { valor: string; onSalvar: (v: string) => void; onExcluir?: () => void }) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);

  if (editando) {
    return (
      <td className="border border-border p-0 align-top">
        <textarea
          autoFocus
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => {
            setEditando(false);
            if (rascunho.trim() !== valor.trim()) onSalvar(rascunho);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRascunho(valor);
              setEditando(false);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full h-16 resize-none bg-background p-1.5 text-[11px] font-medium uppercase outline-none ring-2 ring-primary"
        />
      </td>
    );
  }

  return (
    <td
      onClick={() => {
        setRascunho(valor);
        setEditando(true);
      }}
      className={cn(
        "group relative border border-border p-1.5 align-top text-[11px] font-semibold uppercase leading-tight cursor-pointer h-16 min-w-[240px] hover:ring-1 hover:ring-primary/50",
        corCliente(valor)
      )}
    >
      {valor || <span className="opacity-25 normal-case font-normal">—</span>}
    </td>
  );
}

export default function AgendamentoEquipePage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAgendamento, setSelectedAgendamento] = useState<AgendaAgendamento | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedColabId, setSelectedColabId] = useState<string | null>(null);
  const [tarefaId, setTarefaId] = useState<string | null>(null);
  const [dialogEditOpen, setDialogEditOpen] = useState(false);
  const [dialogCreateTaskOpen, setDialogCreateTaskOpen] = useState(false);
  const [dialogRelatorioOpen, setDialogRelatorioOpen] = useState(false);
  const [createTaskPrefill, setCreateTaskPrefill] = useState<{ data: string | null; auvoUserId: string | null; nome: string | null }>({ data: null, auvoUserId: null, nome: null });
  const dragItem = useRef<AgendaAgendamento | null>(null);
  const [dialogChoiceOpen, setDialogChoiceOpen] = useState(false);
  const [dialogBulkUpdateOpen, setDialogBulkUpdateOpen] = useState(false);
  const [bulkUpdateContext, setBulkUpdateContext] = useState<{ item: AgendaAgendamento, newDate: string, newColabId: string } | null>(null);
  const [tagsSelecionadas, setTagsSelecionadas] = useState<string[]>([]);
  const [apenasPrevisaoOrcamento, setApenasPrevisaoOrcamento] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [clienteId, setClienteId] = useState("todos");
  const [mostrarPrevisoes, setMostrarPrevisoes] = useState(true);
  const [mostrarVisitasContratuais, setMostrarVisitasContratuais] = useState(true);
  const saveAgendamento = useSaveAgendamento();

  // Expõe o queryClient globalmente para uso no diálogo de criação de tarefa
  useEffect(() => {
    (window as any).queryClient = qc;
    return () => {
      delete (window as any).queryClient;
    };
  }, [qc]);

  const inicioEscala = useMemo(() => new Date(), []);

  // Histórico: mantemos 60 dias passados na grade (não somem mais),
  // mas a página sempre abre posicionada no dia atual.
  const DIAS_PASSADOS = 60;
  const DIAS_FUTUROS = 90;

  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  // A escala visível começa SEMPRE no dia de hoje.
  const diasFuturos = useMemo(
    () => Array.from({ length: DIAS_FUTUROS }, (_, i) => format(addDays(inicioEscala, i), "yyyy-MM-dd")),
    [inicioEscala],
  );

  // Dias anteriores continuam carregados (histórico), mas ficam ocultos até o usuário pedir.
  const diasAnteriores = useMemo(
    () => Array.from({ length: DIAS_PASSADOS }, (_, i) => format(addDays(inicioEscala, i - DIAS_PASSADOS), "yyyy-MM-dd")),
    [inicioEscala],
  );

  const diasTodos = useMemo(() => [...diasAnteriores, ...diasFuturos], [diasAnteriores, diasFuturos]);

  const { data: colaboradores = [], isLoading: loadingCol, refetch: refetchColaboradores } = useColaboradores();
  const { data: veiculos = [], isLoading: loadingVei } = useAgendaVeiculos();
  const { data: rhClientes = [] } = useRhClientes();
  const { data, isLoading, isFetching, refetch: refetchLocal } = useAgendaSemana(diasTodos);
  const agendaIds = useMemo(
    () => (data?.agendamentos ?? []).map((agendamento) => agendamento.id),
    [data?.agendamentos],
  );
  const { data: agendaTags = [], isLoading: loadingTags } = useAgendaTags();
  const { data: agendaTagLinks = [] } = useAgendaTagLinks(agendaIds);
  const [isSyncing, setIsSyncing] = useState(false);
  const customerSyncPromise = useRef<Promise<void> | null>(null);

  const sincronizarClientesEmSegundoPlano = () => {
    if (customerSyncPromise.current) return customerSyncPromise.current;

    const request = (async () => {
      const { error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-customers", forceRefresh: true },
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["auvo-customers"] });
    })()
      .catch((err: unknown) => {
        console.error("[agendamento-equipe] erro ao atualizar clientes do Auvo:", err);
        toast.warning("As tarefas foram sincronizadas, mas os clientes do Auvo não foram atualizados.");
      })
      .finally(() => {
        customerSyncPromise.current = null;
      });

    customerSyncPromise.current = request;
    return request;
  };

  // A sincronização é dividida em janelas: a primeira cobre os próximos dias
  // (o que o usuário realmente enxerga) e volta rápido; o restante do horizonte
  // é processado em segundo plano, sem travar a tela.
  const sincronizarJanela = async (startDate: string, endDate: string) => {
      // Uma única leitura do RH; o retorno é usado nesta sincronização para
      // evitar trabalhar com o estado anterior do React Query.
      const [colaboradoresResult, agendaResult] = await Promise.all([
        refetchColaboradores(),
        supabase.functions.invoke("auvo-agenda", {
          body: { startDate, endDate, fast: true },
        }),
      ]);
      if (colaboradoresResult.error) throw colaboradoresResult.error;
      const colaboradoresAtuais = colaboradoresResult.data ?? colaboradores;

      const { data: syncRes, error } = agendaResult;
      if (error) throw error;
      if ((syncRes as any)?.error) throw new Error((syncRes as any).error);

      const tarefas: any[] = Array.isArray(syncRes?.data) ? syncRes.data : [];
      const syncComplete = (syncRes as any)?.sync_complete === true;
      const apiTaskId = (task: any) => String(
        task?.auvo_task_id ?? task?.taskID ?? task?.taskId ?? task?.id ?? "",
      ).trim();
      const returnedTaskIds = new Set(tarefas.map(apiTaskId).filter(Boolean));

      // Resolução do técnico: auvo_user_id (fonte da verdade) → nome → primeiro nome
      const porAuvoId = new Map<string, any>();
      const porNome = new Map<string, any>();
      const porPrimeiroNome = new Map<string, any>();
      for (const c of colaboradoresAtuais) {
        if (!c.ativo) continue;
        if (c.auvo_user_id) porAuvoId.set(String(c.auvo_user_id), c);
        const n = norm(c.nome);
        porNome.set(n, c);
        const p = n.split(" ")[0];
        if (p && !porPrimeiroNome.has(p)) porPrimeiroNome.set(p, c);
      }
      const resolver = (t: any) => {
        if (t.tecnico_id && porAuvoId.has(String(t.tecnico_id))) return porAuvoId.get(String(t.tecnico_id));
        const n = norm(t.tecnico || "");
        if (!n) return undefined;
        return porNome.get(n) ?? porPrimeiroNome.get(n.split(" ")[0]);
      };

      // 1 linha por tarefa (cliente por linha, clicável)
      const linhas: any[] = [];
      let semTecnico = 0;
      const vistos = new Set<string>();
      
      for (const t of tarefas) {
        if (!t.data_tarefa) continue;
        const colab = resolver(t);
        if (!colab) { semTecnico++; continue; }
        const taskId = apiTaskId(t);
        if (!taskId) continue;
        
        const key = taskId;
        if (vistos.has(key)) continue;
        vistos.add(key);
        
        const clienteLimpo = String(t.cliente || "SEM CLIENTE").trim();

        linhas.push({
          data: t.data_tarefa,
          hora_inicio: t.hora_inicio || null,
          hora_fim: t.hora_fim || null,
          colaborador_id: colab.id,
          colaborador_nome: colab.nome,
          cliente: clienteLimpo,
          descricao: t.orientacao || t.descricao || null,
          status: "AGENDADO",
          auvo_task_id: taskId,
          origem: "AUVO",
          gc_os_codigo: t.gc_os_codigo || null,
          duracao_planejada_minutos: Number(t.duracao_estimada_minutos) > 0
            ? Math.round(Number(t.duracao_estimada_minutos))
            : null,
          // O orçamento é a chave que liga a previsão à OS e não pode ser descartado.
          gc_orcamento_codigo: t.gc_orcamento_codigo || null,
        });
      }

      // Reconsulta somente as tarefas retornadas. Isso captura previsões que a
      // edge function acabou de promover sem varrer toda a tarefas_central.
      const lineTaskIds = [...new Set(linhas.map((line) => String(line.auvo_task_id)).filter(Boolean))];
      const { data: existingTaskRows, error: existingReadError } = lineTaskIds.length
        ? await supabase
          .from("agenda_agendamentos")
          .select("id,auvo_task_id,data,hora_inicio,hora_fim,duracao_planejada_minutos,colaborador_id,colaborador_nome,cliente,descricao,status,origem,gc_os_codigo,gc_orcamento_codigo,previsao_continuidade,previsao_tipo,conversao_status")
          .in("auvo_task_id", lineTaskIds)
        : { data: [], error: null };
      if (existingReadError) throw existingReadError;

      // Ausência só é conclusiva quando a edge function terminou todas as
      // páginas do período. Uma resposta parcial nunca autoriza exclusão local.
      const { data: reconciliationRows, error: reconciliationReadError } = syncComplete
        ? await supabase
          .from("agenda_agendamentos")
          .select("id,auvo_task_id,data,origem,gc_os_codigo,gc_orcamento_codigo,previsao_tipo,conversao_status")
          .gte("data", startDate)
          .lte("data", endDate)
          .not("auvo_task_id", "is", null)
        : { data: [], error: null };
      if (reconciliationReadError) throw reconciliationReadError;

      const taskIdKey = (row: { auvo_task_id?: string | null }) => String(row.auvo_task_id || "").trim();
      const slotKey = (row: { data: string; colaborador_id?: string | null }) =>
        `${row.data}|${String(row.colaborador_id || "")}`;
      const occupiedSlots = new Set(linhas.map(slotKey));
      const existingByTaskId = new Map<string, any>();
      for (const row of existingTaskRows || []) {
        const taskId = taskIdKey(row);
        if (taskId && !existingByTaskId.has(taskId)) existingByTaskId.set(taskId, row);
      }

      const protectedForecast = (row: any) =>
        row.previsao_tipo === "ORCAMENTO_EXECUCAO" || row.conversao_status === "CONVERTIDA";
      const previousRows = data?.agendamentos ?? [];
      const replacedManualIds = previousRows
        .filter((row: any) => {
          if (protectedForecast(row)) return false;
          return !row.auvo_task_id
            && row.origem === "MANUAL"
            && !row.previsao_continuidade
            && occupiedSlots.has(slotKey(row));
        })
        .map((row: any) => String(row.id))
        .filter(Boolean);
      const removedAuvoIds = missingAuvoAgendaIds(
        reconciliationRows ?? [],
        returnedTaskIds,
        {
          syncComplete,
          startDate,
          endDate,
        },
      );
      const deleteIds = [...new Set([...replacedManualIds, ...removedAuvoIds])];

      // Remove rascunhos substituídos e espelhos confirmadamente ausentes no
      // Auvo. Vínculos GC e respostas parciais já foram barrados acima.
      for (let i = 0; i < deleteIds.length; i += 500) {
        const { error: deleteError } = await supabase
          .from("agenda_agendamentos")
          .delete()
          .in("id", deleteIds.slice(i, i + 500));
        if (deleteError) throw deleteError;
      }

      // auvo_task_id é a identidade estável. Mudança de data/técnico atualiza o
      // mesmo UUID; campo omitido preserva o último valor conhecido.
      const upsertRows = linhas.flatMap((line) => {
        const existing = existingByTaskId.get(taskIdKey(line));
        const merged = mergeAgendaTaskSnapshot(existing, {
          ...line,
          id: existing?.id ?? crypto.randomUUID(),
        });
        if (!agendaTaskSnapshotChanged(existing, merged)) return [];
        return [Object.fromEntries([
          ["id", merged.id],
          ["auvo_task_id", merged.auvo_task_id],
          ...AGENDA_TASK_SYNC_FIELDS.map((field) => [field, merged[field]]),
        ])];
      });
      for (let i = 0; i < upsertRows.length; i += 500) {
        const { error: upsertError } = await supabase
          .from("agenda_agendamentos")
          .upsert(upsertRows.slice(i, i + 500) as never, { onConflict: "id" });
        if (upsertError) throw upsertError;
      }

      return { linhas: linhas.length, tarefas: tarefas.length, removedAuvoIds, semTecnico, syncComplete };
  };

  const DIAS_JANELA_RAPIDA = 21;

  const refetch = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Atualizando tarefas do Auvo...");
    try {
      // O mesmo clique também atualiza os clientes, mas esse trabalho não segura
      // a agenda nem o botão de sincronização.
      void sincronizarClientesEmSegundoPlano();

      const fimRapido = diasFuturos[Math.min(DIAS_JANELA_RAPIDA, diasFuturos.length) - 1];
      const { linhas, tarefas, removedAuvoIds, semTecnico, syncComplete } =
        await sincronizarJanela(diasFuturos[0], fimRapido);

      await refetchLocal();
      const syncDetails: string[] = [];
      if (removedAuvoIds.length > 0) {
        syncDetails.push(`${removedAuvoIds.length} tarefa(s) excluída(s) no Auvo removida(s) da agenda.`);
      }
      if (semTecnico > 0) syncDetails.push(`${semTecnico} tarefas sem técnico vinculado no RH.`);
      if (!syncComplete) {
        syncDetails.push("Limpeza de tarefas ausentes adiada porque a resposta do Auvo foi parcial.");
      }
      toast.success(`Escala atualizada: ${linhas} agendamentos (${tarefas} tarefas)`, {
        id: toastId,
        description: [
          `Próximos ${DIAS_JANELA_RAPIDA} dias atualizados. O restante do período continua em segundo plano.`,
          ...syncDetails,
        ].join(" "),
      });

      // Restante do horizonte, sem bloquear a tela nem o botão.
      const inicioRestante = diasFuturos[DIAS_JANELA_RAPIDA];
      if (inicioRestante) {
        void (async () => {
          try {
            await sincronizarJanela(inicioRestante, diasFuturos[diasFuturos.length - 1]);
            await refetchLocal();
            toast.message("Períodos futuros também atualizados.");
          } catch (err) {
            console.error("[agendamento-equipe] falha na janela futura:", err);
            toast.warning("Os próximos dias foram atualizados, mas o período mais distante falhou.");
          }
        })();
      }
    } catch (err) {
      console.error("[agendamento-equipe] erro na sincronização:", err);
      toast.error("Não foi possível atualizar a escala", {
        id: toastId,
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const salvarTecnico = useSalvarCelulaTecnico();
  const salvarVeiculo = useSalvarCelulaVeiculo();

  const handleDragDrop = async (date: string, colabId: string) => {
    const item = dragItem.current;
    if (!item) return;

    // Se for previsão, ignoramos a trava de mesma célula para permitir que a UI force o refresh/reposicionamento se necessário
    // mas na prática, se for a mesma data e colab, não fazemos nada no banco.
    if (item.data === date && item.colaborador_id === colabId) {
      dragItem.current = null;
      return;
    }

    // Se for uma visita contratual, perguntamos se deseja alterar todas as futuras
    const isVisita = Boolean(
      item.previsao_tipo === "CONTRATO" || 
      item.previsao_tipo === "CONTRATO_REALIZADO" || 
      item.origem === "CONTRATO"
    );

    if (isVisita && item.contrato_visita_config_id) {
      setBulkUpdateContext({ item, newDate: date, newColabId: colabId });
      setDialogBulkUpdateOpen(true);
      dragItem.current = null;
      return;
    }

    await executeMove(item, date, colabId);
    dragItem.current = null;
  };

  const executeMove = async (item: AgendaAgendamento, date: string, colabId: string, updateFuture: boolean = false) => {
    const colab = colaboradores.find((c) => c.id === colabId);
    if (!colab) return;

    const ehPrevisao = Boolean(item.previsao_continuidade);
    const toastId = toast.loading(updateFuture ? "Atualizando responsável em todas as visitas..." : (ehPrevisao ? "Movendo previsão..." : "Atualizando agendamento..."));
    
    try {
      if (updateFuture && item.contrato_visita_config_id) {
        // Busca todas as previsões futuras deste contrato a partir da data atual do item movido
        const { data: futuras, error: fetchErr } = await supabase
          .from("agenda_agendamentos")
          .select("*")
          .eq("contrato_visita_config_id", item.contrato_visita_config_id)
          .eq("previsao_tipo", "CONTRATO")
          .is("contrato_visita_execucao_id", null)
          .gte("data", item.data)
          .order("data", { ascending: true });

        if (fetchErr) throw fetchErr;

        if (futuras && futuras.length > 0) {
          const futurasDoTecnico = futuras.filter((f) => (
            item.colaborador_id
              ? f.colaborador_id === item.colaborador_id
              : f.colaborador_nome === item.colaborador_nome
          ));

          for (const futura of futurasDoTecnico) {
            const { error: moveError } = await supabase.rpc("mover_previsao_visita_contratual", {
              p_agendamento_id: futura.id,
              p_data: futura.id === item.id ? date : futura.data,
              p_colaborador_id: colabId,
              p_colaborador_nome: colab.nome,
            });
            if (moveError) throw moveError;
          }
        }
      } else {
        // Movimentação individual (Lógica original)
        if (item.origem === "CONTRATO" && item.previsao_tipo === "CONTRATO") {
          const { error: moveError } = await supabase.rpc("mover_previsao_visita_contratual", {
            p_agendamento_id: item.id,
            p_data: date,
            p_colaborador_id: colabId,
            p_colaborador_nome: colab.nome,
          });
          if (moveError) throw moveError;
        } else if (item.auvo_task_id && item.origem === "AUVO") {
          const patches = [
            { op: "replace", path: "taskDate", value: `${date}T${item.hora_inicio.slice(0, 5)}:00` },
          ];
          
          if (colab.auvo_user_id) {
            patches.push({ op: "replace", path: "idUserTo", value: String(colab.auvo_user_id) });
          }

          const { data: auvoRes, error: auvoErr } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "edit", taskId: item.auvo_task_id, patches },
          });

          if (auvoErr || auvoRes?.status >= 400) {
            throw new Error(auvoRes?.data?.message || "Erro ao atualizar no Auvo");
          }
        }

        // Se for PREVISAO, atualizamos o registro original (id: item.id)
        // Se item.id não existir (não deveria ocorrer em drag&drop de item existente), ele cria um novo.
        if (item.origem !== "CONTRATO" || item.previsao_tipo !== "CONTRATO") {
          await saveAgendamento.mutateAsync({
            id: item.id || undefined,
            data: date,
            colaborador_id: colabId,
            colaborador_nome: colab.nome,
            hora_inicio: item.hora_inicio,
            hora_fim: item.hora_fim,
            duracao_planejada_minutos: item.duracao_planejada_minutos,
            veiculo_id: item.veiculo_id,
            cliente: item.cliente,
            descricao: item.descricao,
            status: item.status,
            auvo_task_id: item.auvo_task_id,
            origem: item.origem,
            gc_os_codigo: item.gc_os_codigo,
            gc_orcamento_codigo: item.gc_orcamento_codigo,
            previsao_continuidade: item.previsao_continuidade,
            previsao_detalhes: item.previsao_detalhes,
          });
        }
      }

      toast.success(updateFuture ? "Responsável atualizado em todas as visitas futuras!" : (ehPrevisao ? "Previsão movida com sucesso!" : "Agendamento movido com sucesso!"), { id: toastId });
      refetchLocal();
    } catch (err: any) {
      console.error("Erro ao mover agendamento:", err);
      toast.error(err.message || "Erro ao mover agendamento", { id: toastId });
    }
  };

  const tecnicos = useMemo(() => {
    const ativos = colaboradores.filter((c) => c.ativo);
    const t = ativos.filter(isTecnico);
    let filtrados = t.length > 0 ? t : ativos;

    if (filtroTexto.trim()) {
      const search = norm(filtroTexto);
      filtrados = filtrados.filter((tec) => norm(tec.nome).includes(search));
    }

    return filtrados.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [colaboradores, filtroTexto]);

  const mapTec = useMemo(() => {
    const m = new Map<string, AgendaAgendamento[]>();
    const search = filtroTexto.trim() ? norm(filtroTexto) : "";

    for (const a of data?.agendamentos ?? []) {
      // Filtro de Previsões / Visitas Contratuais
      const isPrevisao = Boolean(a.previsao_continuidade || a.status === "PREVISAO");
      const isVisita = Boolean(a.previsao_tipo === "CONTRATO" || a.previsao_tipo === "CONTRATO_REALIZADO" || a.origem === "CONTRATO");

      if (isPrevisao && !mostrarPrevisoes) continue;
      if (isVisita && !mostrarVisitasContratuais) continue;

      // Filtro de Cliente (ID específico se selecionado no SearchableSelect)
      if (clienteId !== "todos") {
        // Se o agendamento tem um contrato_id (visita contratual), deve bater exatamente
        if (a.contrato_id && a.contrato_id !== clienteId) continue;
        
        // Se for manual/AUVO, tentamos bater pelo nome normalizado do cliente se não tivermos ID direto
        if (!a.contrato_id) {
          const clienteSelecionado = rhClientes.find(c => c.id === clienteId);
          // Correção: Se um cliente específico foi selecionado, a atividade DEVE corresponder a ele.
          // Se não houver correspondência de nome, removemos da lista.
          if (clienteSelecionado) {
            if (!norm(a.cliente).includes(norm(clienteSelecionado.nome))) continue;
          }
        }
      }

      // Filtro de Texto (Cliente, Técnico, Descrição ou OS) - Busca ampla por substring
      if (search) {
        const matchesCliente = norm(a.cliente).includes(search);
        const matchesTecnico = norm(a.colaborador_nome).includes(search);
        const matchesDescricao = norm(a.descricao || "").includes(search);
        const matchesOs = norm(a.gc_os_codigo || "").includes(search);
        
        // Se houver busca textual, o item só aparece se bater em um dos campos
        if (!matchesCliente && !matchesTecnico && !matchesDescricao && !matchesOs) continue;
      }

      const k = `${a.colaborador_id}|${a.data}`;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      const ordenados = sortAgendaItemsWithContractPlanFirst(arr);
      arr.splice(0, arr.length, ...ordenados);
    }
    return m;
  }, [data, mostrarPrevisoes, mostrarVisitasContratuais, filtroTexto, clienteId, rhClientes]);

  const tagsPorAgendamento = useMemo(() => {
    const tagPorId = new Map(agendaTags.map((tag) => [tag.id, tag]));
    const resultado = new Map<string, AgendaTag[]>();
    for (const link of agendaTagLinks) {
      const tag = tagPorId.get(link.tag_id);
      if (!tag) continue;
      const atuais = resultado.get(link.agendamento_id) ?? [];
      atuais.push(tag);
      resultado.set(link.agendamento_id, atuais);
    }
    for (const itemTags of resultado.values()) {
      itemTags.sort((a, b) => a.name.localeCompare(b.name));
    }
    return resultado;
  }, [agendaTagLinks, agendaTags]);

  const mapVei = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of data?.veiculoDias ?? []) m.set(`${v.veiculo_id}|${v.data}`, v.texto);
    return m;
  }, [data]);

  // Histórico: apenas dias passados que realmente possuem agendamento registrado.
  const diasHistorico = useMemo(() => {
    const comDados = new Set<string>();
    for (const a of data?.agendamentos ?? []) comDados.add(a.data);
    for (const v of data?.veiculoDias ?? []) if (v.texto?.trim()) comDados.add(v.data);
    return diasAnteriores.filter((d) => comDados.has(d));
  }, [data, diasAnteriores]);

  // Colunas renderizadas: sempre iniciam em hoje; o histórico entra antes só quando liberado.
  const dias = useMemo(
    () => (mostrarHistorico ? [...diasHistorico, ...diasFuturos] : diasFuturos),
    [mostrarHistorico, diasHistorico, diasFuturos],
  );

  const adicionarVeiculo = async () => {
    const nome = window.prompt("Nome do veículo (ex: ETIOS PRATA)");
    if (!nome?.trim()) return;
    const placa = window.prompt("Placa do veículo (opcional)");
    await supabase.from("agenda_veiculos").insert({ 
      nome: nome.trim().toUpperCase(), 
      placa: placa?.trim()?.toUpperCase() || null,
      ordem: String(veiculos.length + 1), 
      ativo: true 
    } as never);
    qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
  };

  const [syncFrota, setSyncFrota] = useState(false);
  const sincronizarFrota = async () => {
    setSyncFrota(true);
    const toastId = toast.loading("Buscando veículos na Frota (Technician & Vehicle Hub)...");
    try {
      const { data: res, error } = await supabase.functions.invoke("tvh-veiculos-sync", { body: {} });
      if (error) throw error;
      if (!(res as any)?.ok) throw new Error((res as any)?.error || "Falha na sincronização");
      await qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
      toast.success(
        `Frota sincronizada: ${(res as any).total} veículos (${(res as any).criados} novos, ${(res as any).com_alerta} com tarefa crítica aberta)`,
        {
          id: toastId,
          description: (res as any).maintenance_warning || undefined,
        },
      );
    } catch (e: any) {
      toast.error(`Não foi possível sincronizar a frota: ${e?.message || String(e)}`, { id: toastId });
    } finally {
      setSyncFrota(false);
    }
  };

  const carregando = isLoading || loadingCol || loadingVei;

  // A visão sempre começa no dia atual, inclusive ao liberar o histórico.
  useEffect(() => {
    if (carregando) return;
    const id = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-coluna-hoje='1']").forEach((th) => {
        const container = th.closest<HTMLElement>("[data-agenda-scroll='1']");
        if (!container) return;
        const primeiraColuna = container.querySelector<HTMLElement>("thead th");
        container.scrollLeft = Math.max(0, th.offsetLeft - (primeiraColuna?.offsetWidth ?? 0));
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [carregando, mostrarHistorico]);
  const rotulo = `ESCALA PRÓXIMOS 90 DIAS — A partir de ${format(new Date(), "dd/MM/yyyy", { locale: ptBR })}`;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 px-3 py-2 md:gap-3 md:px-6 md:py-4 border-b bg-card shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <h1 className="text-base md:text-xl font-bold">Escala de Técnicos (90 Dias)</h1>
          <div className="hidden md:flex items-center bg-muted rounded-md p-1 gap-1">
            <span className="px-2 text-xs font-semibold uppercase">{rotulo}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            document.querySelectorAll<HTMLElement>("[data-coluna-hoje='1']").forEach((th) => {
              const container = th.closest<HTMLElement>("[data-agenda-scroll='1']");
              if (!container) return;
              const primeiraColuna = container.querySelector<HTMLElement>("thead th");
              container.scrollTo({
                left: Math.max(0, th.offsetLeft - (primeiraColuna?.offsetWidth ?? 0)),
                behavior: "smooth",
              });
            });
          }}>
            Ir para Hoje
          </Button>
          <Button
            variant={mostrarHistorico ? "secondary" : "outline"}
            size="sm"
            onClick={() => setMostrarHistorico((v) => !v)}
            disabled={carregando || (!mostrarHistorico && diasHistorico.length === 0)}
            title={
              diasHistorico.length === 0
                ? "Nenhum dia anterior com agendamento nos últimos 60 dias"
                : "Exibe os dias anteriores que possuem agendamento"
            }
          >
            {mostrarHistorico
              ? "Ocultar histórico"
              : `Ver histórico${diasHistorico.length ? ` (${diasHistorico.length})` : ""}`}
          </Button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={tagsSelecionadas.length > 0 ? "default" : "outline"} size="sm" className="gap-2 shrink-0">
                <TagsIcon className="h-4 w-4" />
                Tags{tagsSelecionadas.length > 0 ? ` (${tagsSelecionadas.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-72 overflow-y-auto">
              <DropdownMenuLabel>Filtrar escala por tag</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {agendaTags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag.id}
                  checked={tagsSelecionadas.includes(tag.id)}
                  onCheckedChange={(checked) => {
                    setTagsSelecionadas((atuais) => checked === true
                      ? [...new Set([...atuais, tag.id])]
                      : atuais.filter((id) => id !== tag.id));
                  }}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span
                    className="mr-2 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: normalizeAgendaTagColor(tag.color) }}
                  />
                  <span className="truncate">{tag.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {!loadingTags && agendaTags.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Crie uma tag no modal de uma tarefa ou OS.
                </div>
              )}
              {tagsSelecionadas.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTagsSelecionadas([])} className="gap-2 text-destructive">
                    <X className="h-4 w-4" /> Limpar filtro
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            variant={apenasPrevisaoOrcamento ? "default" : "outline"} 
            size="sm" 
            className={cn("gap-2 shrink-0", apenasPrevisaoOrcamento && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2")}
            onClick={() => setApenasPrevisaoOrcamento(!apenasPrevisaoOrcamento)}
          >
            <CalendarClock className="h-4 w-4" />
            <span>Previsão Orç.</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => setDialogRelatorioOpen(true)}>
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Exportar </span>PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            title="Sincronizar tarefas e clientes do Auvo"
            onClick={() => refetch()}
            disabled={isFetching || isSyncing}
          >
            <RefreshCw className={cn("h-4 w-4", (isFetching || isSyncing) && "animate-spin")} />
            <span className="hidden sm:inline">{isSyncing ? "Sincronizando Auvo/GC..." : "Sincronizar Auvo/GC"}</span>
            <span className="sm:hidden">Auvo/GC</span>
          </Button>
          <Button className="gap-2 shrink-0" size="sm" onClick={() => setDialogChoiceOpen(true)}>
            <Plus className="h-4 w-4" /> Nova<span className="hidden sm:inline"> Tarefa / Previsão</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <AgendaFilters
            filtroTexto={filtroTexto}
            setFiltroTexto={setFiltroTexto}
            mostrarPrevisoes={mostrarPrevisoes}
            setMostrarPrevisoes={setMostrarPrevisoes}
            mostrarVisitasContratuais={mostrarVisitasContratuais}
            setMostrarVisitasContratuais={setMostrarVisitasContratuais}
            clienteId={clienteId}
            setClienteId={setClienteId}
          />

          <details className="legenda-agenda text-[11px]" aria-label="Legenda dos status da agenda">
            <summary className="cursor-pointer font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors">Legenda</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="hidden md:inline font-semibold text-muted-foreground uppercase">Legenda:</span>
              <span className="rounded border border-green-300 bg-green-100 px-2 py-1 font-semibold text-green-800">Finalizada sem pendência</span>
              <span className="rounded border border-amber-500 bg-amber-200 px-2 py-1 font-semibold text-amber-950">Pausada</span>
              <span className="rounded border border-red-300 bg-red-100 px-2 py-1 font-semibold text-red-800">Atrasada há mais de 2h</span>
              <span className="flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-1 font-semibold text-sky-800">
                <Clock3 className="h-3 w-3" /> Horas reais: check-in/checkout do Auvo
              </span>
              <span className="rounded border bg-card px-2 py-1 text-muted-foreground">Demais: cor do cliente</span>
            </div>
          </details>
        </div>
        {carregando ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold uppercase tracking-wide">Técnicos</h2>
              </div>
              <div data-agenda-scroll="1" className="overflow-x-auto border rounded-md max-h-[70vh] md:max-h-[600px] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-28 md:w-60 sticky left-0 top-0 bg-muted z-20">
                        Técnico
                      </th>
                      {dias.map((diaStr) => {
                        const date = new Date(diaStr + "T00:00:00");
                        const isHoje = format(new Date(), "yyyy-MM-dd") === diaStr;
                        return (
                          <th 
                            key={diaStr} 
                            id={isHoje ? "hoje-col" : undefined}
                            data-coluna-hoje={isHoje ? "1" : undefined}
                            className={cn(
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[170px] md:min-w-[240px] sticky top-0 bg-muted z-10",
                              isHoje && "bg-primary/10 ring-1 ring-primary/30"
                            )}
                          >
                            {DIAS_TRADUZIDOS[date.getDay() === 0 ? 6 : date.getDay() - 1]}
                            <div className="text-[10px] font-normal opacity-60">
                              {format(date, "dd/MM")}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tecnicos.map((t) => (
                      <tr key={t.id}>
                        <td className="border border-border p-2 text-[11px] font-bold uppercase bg-card sticky left-0 z-10">
                          {t.nome}
                        </td>
                        {dias.map((dia) => {
                          const itens = mapTec.get(`${t.id}|${dia}`) ?? [];
                          const manual = itens.find((i) => !i.auvo_task_id && i.origem !== "AUVO");
                          return (
                            <Celula
                              key={dia}
                              itens={itens}
                              clientesInfo={rhClientes}
                              tagsPorAgendamento={tagsPorAgendamento}
                              tagsSelecionadas={tagsSelecionadas}
                              apenasPrevisaoOrcamento={apenasPrevisaoOrcamento}
                               onAbrirTarefa={(a) => setTarefaId(a.auvo_task_id ?? null)}
                               onAbrirAgendamento={(a) => {
                                 setSelectedAgendamento(a);
                                 setSelectedDate(parseISO(dia));
                                 setSelectedColabId(t.id);
                                 setDialogOpen(true);
                               }}
                              onSalvar={(v) =>
                                salvarTecnico.mutate({
                                  id: manual?.id ?? null,
                                  data: dia,
                                  colaborador_id: t.id,
                                  colaborador_nome: t.nome,
                                  texto: v,
                                })
                              }
                              onDragStart={(a) => { dragItem.current = a; }}
                              onDrop={() => handleDragDrop(dia, t.id)}
                              onNovaTarefaAuvo={() => {
                                setCreateTaskPrefill({
                                  data: dia,
                                  auvoUserId: (t as any).auvo_user_id ? String((t as any).auvo_user_id) : null,
                                  nome: t.nome,
                                });
                                setSelectedDate(parseISO(dia));
                                setSelectedColabId(t.id);
                                setDialogChoiceOpen(true);
                              }}
                              onPreverProximoDia={async (a) => {
                                 const proximoDia = format(addDays(parseISO(a.data), 1), "yyyy-MM-dd");
                                 const toastId = toast.loading("Gerando previsão...");
                                 try {

                                  // Somente colunas reais de agenda_agendamentos: campos
                                  // enriquecidos (status_auvo, check_in_iso, tipo_tarefa_*)
                                  // não existem na tabela e quebravam o insert.
                                  const payload = {
                                    data: proximoDia,
                                    hora_inicio: a.hora_inicio,
                                    hora_fim: a.hora_fim,
                                    duracao_planejada_minutos: a.duracao_planejada_minutos ?? null,
                                    colaborador_id: a.colaborador_id ?? null,
                                    colaborador_nome: a.colaborador_nome,
                                    veiculo_id: a.veiculo_id ?? null,
                                    cliente: a.cliente,
                                    descricao: a.descricao ?? null,
                                    gc_os_codigo: a.gc_os_codigo ?? null,
                                    gc_orcamento_codigo: a.gc_orcamento_codigo ?? null,
                                    contrato_id: a.contrato_id ?? null,
                                    contrato_visita_config_id: a.contrato_visita_config_id ?? null,
                                    contrato_visita_competencia: a.contrato_visita_competencia ?? null,
                                    contrato_visita_numero: a.contrato_visita_numero ?? null,
                                    previsao_detalhes: a.previsao_detalhes ?? null,
                                    status: "PREVISAO",
                                    previsao_continuidade: true,
                                    previsao_tipo: "CONTINUACAO",
                                    conversao_status: null,
                                    conversao_erro: null,
                                    conversao_tentada_em: null,
                                    convertida_em: null,
                                    auvo_task_id: null,
                                    origem: "MANUAL",
                                  };

                                  const { error } = await supabase.from("agenda_agendamentos").insert(payload as any);
                                  if (error) throw error;

                                  qc.invalidateQueries({ queryKey: ["agenda_semana"] });
                                  toast.success("Previsão gerada para o dia seguinte", { id: toastId });
                                } catch (err) {
                                  console.error("Erro ao prever:", err);
                                  toast.error((err as Error)?.message || "Erro ao gerar previsão", { id: toastId });
                                }
                              }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                    {tecnicos.length === 0 && (
                      <tr>
                        <td colSpan={dias.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                          Nenhum técnico ativo cadastrado no RH.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-bold uppercase tracking-wide">Veículos</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={sincronizarFrota}
                    disabled={syncFrota}
                  >
                    <Download className={cn("h-3.5 w-3.5", syncFrota && "animate-pulse")} />
                    {syncFrota ? "Atualizando veículos..." : "Atualizar veículos"}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={adicionarVeiculo}>
                    <Plus className="h-3.5 w-3.5" /> Veículo
                  </Button>
                </div>
              </div>
              <div data-agenda-scroll="1" className="overflow-x-auto border rounded-md max-h-[400px] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-60 sticky left-0 top-0 bg-muted z-20">
                        Veículo
                      </th>
                      {dias.map((diaStr) => {
                        const date = new Date(diaStr + "T00:00:00");
                        const isHoje = format(new Date(), "yyyy-MM-dd") === diaStr;
                        return (
                          <th 
                            key={diaStr}
                            data-coluna-hoje={isHoje ? "1" : undefined}
                            className={cn(
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[240px] sticky top-0 bg-muted z-10",
                              isHoje && "bg-primary/10"
                            )}
                          >
                            {DIAS_TRADUZIDOS[date.getDay() === 0 ? 6 : date.getDay() - 1]}
                            <div className="text-[10px] font-normal opacity-60">
                              {format(date, "dd/MM")}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                     {veiculos.map((v) => (
                        <tr key={v.id} className="group/row">
                          <td className="group border border-border p-2 text-[11px] font-bold uppercase bg-card sticky left-0 z-10 align-top">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="truncate">{v.nome}</span>
                                {v.placa && <div className="text-[10px] font-normal opacity-60">{v.placa}</div>}
                                {v.status && (
                                  <div className="text-[10px] font-normal normal-case opacity-70">{v.status}</div>
                                )}
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Deseja realmente excluir o veículo ${v.nome}? Ele não retornará na próxima sincronização.`)) return;
                                  
                                  const { error } = await supabase
                                    .from("agenda_veiculos")
                                    .update({ deletado_em: new Date().toISOString(), ativo: false } as any)
                                    .eq("id", v.id);
                                  
                                  if (error) {
                                    toast.error("Erro ao excluir veículo");
                                  } else {
                                    toast.success("Veículo excluído");
                                    qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                                title="Excluir veículo permanentemente"
                              >
                                <Plus className="h-3 w-3 rotate-45" />
                              </button>
                            </div>
                            {v.observacao && (
                              <div
                                title={v.observacao}
                                className="mt-1 flex flex-col gap-1 rounded border border-destructive/40 bg-destructive/10 p-1 text-[10px] font-normal normal-case text-destructive"
                              >
                                <div className="flex items-center gap-1 font-bold uppercase text-[9px]">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  <span>Não conformidade — último checklist</span>
                                </div>
                                <span className="whitespace-pre-line leading-snug">{v.observacao}</span>
                              </div>
                            )}
                          </td>
                          {dias.map((dia) => (
                            <CelulaTexto
                              key={dia}
                              valor={mapVei.get(`${v.id}|${dia}`) ?? ""}
                              onSalvar={(texto) => salvarVeiculo.mutate({ veiculo_id: v.id, data: dia, texto })}
                            />
                          ))}
                        </tr>
                      ))}
                    {veiculos.length === 0 && (
                      <tr>
                        <td colSpan={dias.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                          Nenhum veículo cadastrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Diálogo de Escolha: Tarefa ou Previsão */}
      <Dialog open={dialogChoiceOpen} onOpenChange={setDialogChoiceOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>O que deseja lançar?</DialogTitle>
            <DialogDescription>
              Escolha entre criar uma tarefa real no Auvo ou apenas uma previsão interna na agenda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2 items-center justify-center border-2 hover:border-primary hover:bg-primary/5"
              onClick={() => {
                setDialogChoiceOpen(false);
                setDialogCreateTaskOpen(true);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <span className="font-bold">Tarefa Auvo</span>
              <span className="text-[10px] text-muted-foreground font-normal">Sincroniza com aplicativo</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2 items-center justify-center border-2 hover:border-emerald-500 hover:bg-emerald-50"
              onClick={() => {
                setDialogChoiceOpen(false);
                setSelectedAgendamento(null);
                setDialogOpen(true);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <CalendarClock className="h-5 w-5 text-emerald-600" />
              </div>
              <span className="font-bold">Previsão</span>
              <span className="text-[10px] text-muted-foreground font-normal">Apenas escala interna</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo de Atualização em Massa para Visitas Contratuais */}
      <Dialog open={dialogBulkUpdateOpen} onOpenChange={setDialogBulkUpdateOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Mover Visita Contratual</DialogTitle>
            <DialogDescription>
              Você está movendo uma visita contratual. Deseja alterar o responsável apenas desta visita ou de todas as visitas futuras deste contrato a partir deste ponto?
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-4">
            <Button
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              variant="outline"
              onClick={() => {
                if (bulkUpdateContext) {
                  executeMove(bulkUpdateContext.item, bulkUpdateContext.newDate, bulkUpdateContext.newColabId, false);
                }
                setDialogBulkUpdateOpen(false);
                setBulkUpdateContext(null);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-slate-600" />
              </div>
              <div className="text-left">
                <div className="font-bold">Mudar apenas esta</div>
                <div className="text-[10px] text-muted-foreground font-normal">Altera apenas a visita selecionada</div>
              </div>
            </Button>

            <Button
              className="w-full justify-start gap-3 h-auto py-3 px-4 border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50"
              variant="outline"
              onClick={() => {
                if (bulkUpdateContext) {
                  executeMove(bulkUpdateContext.item, bulkUpdateContext.newDate, bulkUpdateContext.newColabId, true);
                }
                setDialogBulkUpdateOpen(false);
                setBulkUpdateContext(null);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-left">
                <div className="font-bold">Mudar todas as futuras</div>
                <div className="text-[10px] text-muted-foreground font-normal">Altera o responsável desta e de todas as próximas visitas deste contrato</div>
              </div>
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => {
              setDialogBulkUpdateOpen(false);
              setBulkUpdateContext(null);
            }}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgendamentoEquipeDialog
        open={dialogOpen || dialogEditOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          setDialogEditOpen(open);
          if (!open) {
            setSelectedAgendamento(null);
            setSelectedDate(undefined);
            setSelectedColabId(null);
          }
        }}
        initialDate={selectedDate}
        initialColaboradorId={selectedColabId}
        agendamento={selectedAgendamento}
      />

      <TarefaAuvoDetalheDialog 
        taskId={tarefaId} 
        onOpenChange={(open) => !open && setTarefaId(null)} 
        onEdit={() => {
          const item = data?.agendamentos?.find(i => i.auvo_task_id === tarefaId);
          if (item) {
            setSelectedAgendamento(item);
            setDialogEditOpen(true);
            setTarefaId(null);
          }
        }}
      />

      <CriarTarefaGeralDialog
        open={dialogCreateTaskOpen}
        onOpenChange={(o) => {
          setDialogCreateTaskOpen(o);
          if (!o) setCreateTaskPrefill({ data: null, auvoUserId: null, nome: null });
        }}
        initialDate={createTaskPrefill.data}
        initialUserAuvoId={createTaskPrefill.auvoUserId}
        initialUserNome={createTaskPrefill.nome}
        onSuccess={() => {
          refetchLocal();
          // Além do refetch local, forçamos o refresh do queryClient para garantir sincronia em todos os componentes
          qc.invalidateQueries({ queryKey: ["agenda_semana"] });
          qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
        }}
      />

      <AgendaRelatorioDialog
        open={dialogRelatorioOpen}
        onOpenChange={setDialogRelatorioOpen}
        agendamentos={data?.agendamentos ?? []}
        veiculoDias={data?.veiculoDias ?? []}
      />
    </div>
  );
}
