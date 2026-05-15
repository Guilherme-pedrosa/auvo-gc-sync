import React, { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, AlertCircle, Ban, Clock, X, ShieldCheck, ShieldX, Pencil, Inbox, Siren } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { CalendarIcon, Search, Filter, Download, ChevronsUpDown, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExternalLink, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  data: any[];
  isLoading: boolean;
  allClientes: string[];
  allTecnicos: string[];
  allTiposTarefa: string[];
  grupos: any[];
  membros: any[];
  valorHoraConfigs: any[];
  dateFrom: Date;
  dateTo: Date;
  onDateFromChange: (d: Date) => void;
  onDateToChange: (d: Date) => void;
  equipamentoTaskMap?: Record<string, { nome: string; id_serie: string }>;
}

const CHART_COLORS = [
  "hsl(220, 70%, 50%)", "hsl(152, 60%, 40%)", "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)", "hsl(262, 60%, 55%)", "hsl(190, 70%, 45%)",
  "hsl(330, 65%, 50%)", "hsl(45, 85%, 50%)",
];

type AlertaTipo =
  | "negativo"
  | "curto"
  | "longo"
  | "excessivo"
  | "overlap"
  | "sem_janela"
  | "multi_periodo"
  | null;

type StatusRevisao = "faturavel" | "em_revisao" | "rejeitada";

const ALERTA_LABEL: Record<Exclude<AlertaTipo, null>, string> = {
  negativo: "Duração negativa",
  curto: "OS curta",
  longo: "OS longa",
  excessivo: "OS excessiva",
  overlap: "Sobreposição",
  sem_janela: "Sem janela de trabalho",
  multi_periodo: "Atravessa o período",
};

// Severidade: maior número = mais grave.
const ALERTA_SEVERIDADE: Record<Exclude<AlertaTipo, null>, number> = {
  excessivo: 6,
  negativo: 5,
  overlap: 4,
  sem_janela: 3,
  curto: 2,
  longo: 1,
  multi_periodo: 0,
};

const piorAlerta = (lst: AlertaTipo[]): AlertaTipo => {
  let best: AlertaTipo = null;
  let bestScore = -1;
  for (const a of lst) {
    if (!a) continue;
    const s = ALERTA_SEVERIDADE[a];
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return best;
};

export default function HorasTrabalhadasTab({
  data, isLoading, allClientes, allTecnicos, allTiposTarefa,
  grupos, membros, valorHoraConfigs,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  equipamentoTaskMap = {},
}: Props) {
  const queryClient = useQueryClient();
  const [filterTecnico, setFilterTecnico] = useState("todos");
  const [filterCliente, setFilterCliente] = useState("todos");
  const [filterGrupo, setFilterGrupo] = useState("todos");
  const [grupoOpen, setGrupoOpen] = useState(false);
  // Tipo de Tarefa (multi-select por task_type_id, persistente em localStorage).
  // null = "todos marcados" (default na primeira visita).
  const TIPOS_STORAGE_KEY = "horas-trabalhadas-tipos-filtro";
  const [tiposSelecionados, setTiposSelecionados] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(TIPOS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(String));
      }
    } catch {}
    return null;
  });
  useEffect(() => {
    try {
      if (tiposSelecionados === null) {
        localStorage.removeItem(TIPOS_STORAGE_KEY);
      } else {
        localStorage.setItem(TIPOS_STORAGE_KEY, JSON.stringify(Array.from(tiposSelecionados)));
      }
    } catch {}
  }, [tiposSelecionados]);
  const tipoIncluido = (id: string): boolean => {
    if (tiposSelecionados === null) return true;
    return tiposSelecionados.has(id);
  };
  const [clienteModal, setClienteModal] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<AlertaTipo>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [rejectedModalOpen, setRejectedModalOpen] = useState(false);
  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);

  // ── Config de limites de alerta (tabela alertas_horas_config) ──
  const { data: alertasConfig } = useQuery({
    queryKey: ["alertas-horas-config"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("alertas_horas_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      return (
        data || {
          limite_minimo_minutos: 45,
          limite_maximo_horas: 8,
          limite_excessivo_horas: 12,
          detectar_overlap_tecnico: true,
          detectar_horas_negativas: true,
          curta_requer_revisao: true,
          longa_requer_revisao: false,
          excessiva_requer_revisao: true,
          negativa_requer_revisao: true,
          overlap_requer_revisao: true,
          sem_janela_requer_revisao: true,
        }
      );
    },
    staleTime: 60_000,
  });

  // Decisões já tomadas por OS (auvo_task_id → registro de revisão)
  const { data: revisoesMap } = useQuery({
    queryKey: ["os-revisao"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("os_revisao").select("*");
      return new Map<string, any>((data || []).map((r: any) => [String(r.auvo_task_id), r]));
    },
    staleTime: 30_000,
  });

  // Full duration as recorded by Auvo (already deducts pauses).
  const getTaskHoras = (t: any): number => {
    return Number(t.duracao_decimal) || 0;
  };

  // ── Período helpers (rateio por janela de trabalho) ──────────────
  const periodoStart = useMemo(
    () => new Date(format(dateFrom, "yyyy-MM-dd") + "T00:00:00"),
    [dateFrom],
  );
  const periodoEnd = useMemo(
    () => new Date(format(dateTo, "yyyy-MM-dd") + "T23:59:59"),
    [dateTo],
  );

  const obterInicioTask = (t: any): Date | null => {
    if (t.check_in_iso) {
      const d = new Date(t.check_in_iso);
      if (!isNaN(d.getTime())) return d;
    }
    if (t.data_tarefa && t.hora_inicio) {
      const d = new Date(`${t.data_tarefa}T${t.hora_inicio}`);
      if (!isNaN(d.getTime())) return d;
    }
    if (t.data_tarefa) {
      const d = new Date(`${t.data_tarefa}T00:00:00`);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };

  const obterFimTask = (t: any, cap: Date): Date | null => {
    if (t.check_out_iso) {
      const d = new Date(t.check_out_iso);
      if (!isNaN(d.getTime())) return d;
    }
    if (t.data_conclusao && t.hora_fim) {
      const d = new Date(`${t.data_conclusao}T${t.hora_fim}`);
      if (!isNaN(d.getTime())) return d;
    }
    if (t.status_auvo !== "Finalizada" && (Number(t.duracao_decimal) || 0) > 0) {
      const now = new Date();
      return new Date(Math.min(now.getTime(), cap.getTime()));
    }
    return null;
  };

  const getTaskHorasNoPeriodo = (t: any): number => {
    const dur = Number(t.duracao_decimal) || 0;
    if (dur <= 0) return 0;
    const tsInicio = obterInicioTask(t);
    const tsFim = obterFimTask(t, periodoEnd);
    if (!tsInicio || !tsFim || tsFim <= tsInicio) return dur;
    if (tsInicio >= periodoStart && tsFim <= periodoEnd) return dur;
    if (tsFim < periodoStart || tsInicio > periodoEnd) return 0;
    const janelaMs = tsFim.getTime() - tsInicio.getTime();
    const interStart = Math.max(tsInicio.getTime(), periodoStart.getTime());
    const interEnd = Math.min(tsFim.getTime(), periodoEnd.getTime());
    const interMs = Math.max(0, interEnd - interStart);
    const proporcao = janelaMs > 0 ? interMs / janelaMs : 1;
    return Number((dur * proporcao).toFixed(4));
  };

  const atravessaPeriodo = (t: any): boolean => {
    const tsInicio = obterInicioTask(t);
    const tsFim = obterFimTask(t, periodoEnd);
    if (!tsInicio || !tsFim) return false;
    return tsInicio < periodoStart || tsFim > periodoEnd;
  };

  const rateioPercent = (t: any): number => {
    const dur = Number(t.duracao_decimal) || 0;
    if (dur <= 0) return 100;
    const horas = getTaskHorasNoPeriodo(t);
    if (horas <= 0) return 0;
    return Math.round((horas / dur) * 100);
  };

  const isExcessiveTask = (horas: number) => horas > 12;

  // Normalize client name for matching (strip LTDA, ME, SA, EPP, EIRELI, etc.)
  const normalizeName = (name: string) =>
    name
      .toUpperCase()
      .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
      .replace(/[.\-\/]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const getTipoLabel = (tipo: string | null | undefined) => {
    const normalized = (tipo || "").replace(/\s+/g, " ").trim();
    return normalized || "Sem tipo";
  };

  const getTipoKey = (tipo: string | null | undefined) => {
    return getTipoLabel(tipo)
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  };

  // Resolve group members
  const grupoClienteMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of grupos) {
      const ms = membros.filter((m: any) => m.grupo_id === g.id).map((m: any) => m.cliente_nome);
      map.set(g.id, ms);
    }
    return map;
  }, [grupos, membros]);

  // Holiday helper — Brazilian fixed national holidays. Treats holidays as FDS for billing.
  const isFeriadoBR = (dateStr: string): boolean => {
    if (!dateStr) return false;
    const md = dateStr.slice(5, 10); // mm-dd
    return ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"].includes(md);
  };

  // Filter data by intersection of [check_in, check_out] with the period.
  // Status is irrelevant — what matters is whether work happened in the window.
  const filtered = useMemo(() => {
    // Defensive dedup by auvo_task_id.
    const byId = new Map<string, any>();
    for (const t of data) {
      if (!t?.auvo_task_id) continue;
      const existing = byId.get(t.auvo_task_id);
      if (!existing || (t.atualizado_em || "") > (existing.atualizado_em || "")) {
        byId.set(t.auvo_task_id, t);
      }
    }
    const dedupedData = Array.from(byId.values());

    return dedupedData.filter((t) => {
      const dur = Number(t.duracao_decimal) || 0;
      if (dur <= 0) return false;

      const tsInicio = obterInicioTask(t);
      const tsFim = obterFimTask(t, periodoEnd);

      // Sem janela computável → mantém para a Caixa de Revisão sinalizar.
      if (tsInicio && tsFim) {
        if (tsFim < periodoStart) return false;
        if (tsInicio > periodoEnd) return false;
      }

      if (filterTecnico !== "todos" && t.tecnico !== filterTecnico) return false;

      const cliente = t.cliente || t.gc_os_cliente || "";
      if (filterCliente !== "todos" && cliente !== filterCliente) return false;

      if (filterGrupo !== "todos") {
        const grupoClientes = grupoClienteMap.get(filterGrupo) || [];
        const clienteAuvo = normalizeName(t.cliente || "");
        const clienteGc = normalizeName(t.gc_os_cliente || "");
        const matched = grupoClientes.some((gc: string) => {
          const nGc = normalizeName(gc);
          return nGc === clienteAuvo || nGc === clienteGc;
        });
        if (!matched) return false;
      }

      const taskTypeKey = String(t.task_type_id ?? "").trim() || "SEM_ID";
      if (!tipoIncluido(taskTypeKey)) return false;

      return true;
    });
  }, [
    data, periodoStart, periodoEnd, filterTecnico, filterCliente,
    filterGrupo, tiposSelecionados, grupoClienteMap,
  ]);

  // When filtering by group, resolve which side (Auvo or GC) matched the group
  // so the display name comes from the group member, not the unrelated other side.
  const resolveDisplayCliente = (t: any): string => {
    if (filterGrupo !== "todos") {
      const grupoClientes = grupoClienteMap.get(filterGrupo) || [];
      const clienteAuvo = t.cliente || "";
      const clienteGc = t.gc_os_cliente || "";
      const nAuvo = normalizeName(clienteAuvo);
      const nGc = normalizeName(clienteGc);
      // Prefer the side that strictly matches a group member
      const auvoIsMember = grupoClientes.some((gc: string) => normalizeName(gc) === nAuvo);
      const gcIsMember = grupoClientes.some((gc: string) => normalizeName(gc) === nGc);
      if (auvoIsMember) return clienteAuvo;
      if (gcIsMember) return clienteGc;
    }
    return t.cliente || t.gc_os_cliente || "Sem cliente";
  };

  // Build hourly config lookup — returns the full config row so callers can read
  // valor_hora_fds / taxa_fixa_emergencial / task_types_emergenciais.
  const getHourlyConfig = (tecnico: string, clienteAuvo: string, clienteGc?: string): any | null => {
    for (const nome of [clienteAuvo, clienteGc].filter(Boolean)) {
      const directConfig = valorHoraConfigs.find(
        (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "cliente" && c.referencia_nome === nome
      );
      if (directConfig) return directConfig;
    }
    for (const g of grupos) {
      const gClientes = grupoClienteMap.get(g.id) || [];
      const nAuvo = normalizeName(clienteAuvo);
      const nGc = normalizeName(clienteGc || "");
      const isInGroup = gClientes.some((gc: string) => {
        const n = normalizeName(gc);
        return n === nAuvo || n === nGc || (nAuvo && n.includes(nAuvo)) || (nAuvo && nAuvo.includes(n));
      });
      if (isInGroup) {
        const groupConfig = valorHoraConfigs.find(
          (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "grupo" && c.grupo_id === g.id
        );
        if (groupConfig) return groupConfig;
      }
    }
    return null;
  };

  // Calculate task value applying FDS/holiday rate and emergencial flat fee.
  const getTaskValor = (
    t: any,
    tecnico: string,
    horasOverride?: number,
    dateRefOverride?: string | null,
  ): number => {
    const horas = horasOverride != null ? horasOverride : getTaskHoras(t);
    const cliente = t.cliente || t.gc_os_cliente || "";
    const clienteGc = t.gc_os_cliente || "";
    const cfg = getHourlyConfig(tecnico, cliente, clienteGc);
    if (!cfg) return 0;

    // 1. FDS / feriado: usa data de INÍCIO da janela (a hora foi trabalhada nesse dia)
    const dateRef =
      dateRefOverride
      || (obterInicioTask(t)?.toISOString().slice(0, 10))
      || t.data_tarefa
      || t.data_conclusao;
    let isFds = false;
    if (dateRef) {
      const dow = new Date(dateRef + "T12:00:00").getDay();
      isFds = dow === 0 || dow === 6 || isFeriadoBR(dateRef);
    }
    const rate = isFds && cfg.valor_hora_fds != null && Number(cfg.valor_hora_fds) > 0
      ? Number(cfg.valor_hora_fds)
      : Number(cfg.valor_hora || 0);

    // 2. Emergencial detectado por taskType do Auvo configurado em task_types_emergenciais.
    //    Regra: MAX(taxa_fixa, horas × rate). Garante o piso da taxa fixa
    //    quando a OS é curta, e mantém o valor por hora quando excede.
    const taskTypeIds = String(cfg.task_types_emergenciais || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const taskTypeId = String(t.task_type_id ?? t.taskType ?? "").trim();
    const isEmergencial = taskTypeIds.length > 0 && taskTypeIds.includes(taskTypeId);

    const valorPorHora = horas * rate;
    if (isEmergencial && cfg.aplica_taxa_emergencial) {
      const taxaFixa = Number(cfg.taxa_fixa_emergencial || 0);
      return Math.max(taxaFixa, valorPorHora);
    }
    return valorPorHora;
  };

  // Detect emergencial task: type id configured in task_types_emergenciais
  // for this technician/client/group. Independent of value calculation so the UI
  // can flag it visually even when aplica_taxa_emergencial is off.
  const isTaskEmergencial = (t: any, tecnico: string): boolean => {
    const cliente = t.cliente || t.gc_os_cliente || "";
    const clienteGc = t.gc_os_cliente || "";
    const cfg = getHourlyConfig(tecnico, cliente, clienteGc);
    if (!cfg) return false;
    const ids = String(cfg.task_types_emergenciais || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return false;
    const taskTypeId = String(t.task_type_id ?? t.taskType ?? "").trim();
    return ids.includes(taskTypeId);
  };

  // Summary by technician
  type TaskDetail = {
    auvo_task_id: string;
    descricao: string;
    orientacao: string;
    pendencia: string;
    hora_inicio: string;
    hora_fim: string;
    horas: number;
    deslocamento: number;
    data_tarefa: string;
    data_conclusao: string;
    valor: number;
    tecnico: string;
    equipamento: string;
    equipamento_id_serie: string;
    auvo_link: string;        // app2.auvo.com.br/relatorioTarefas/DetalheTarefa/{id} — RELATÓRIO da tarefa
    auvo_task_url: string;    // app.auvo.com.br/informacoes/tarefa/{uuid} — tela da tarefa no app
    auvo_survey_url: string;  // pesquisa de satisfação (uso secundário)
    status_auvo: string;
    cliente_gc: string;
    gc_os_codigo: string;
    gc_os_link: string;
    gc_orcamento_codigo: string;
    gc_orc_link: string;
    cliente: string;
    statusRevisao: StatusRevisao;
    horasOriginais: number;
    valorPotencial: number;
    emergencial: boolean;
    revisao: any | null;
  };
  type ClienteData = {
    horas: number; deslocamento: number; tarefas: number; valor: number;
    horasEmRevisao: number; valorEmRevisao: number; tarefasEmRevisao: number;
    horasRejeitado: number; valorRejeitado: number; tarefasRejeitado: number;
    tipos: Map<string, number>; tasks: TaskDetail[];
  };

  // ── Detecção de alertas (independe de revisão) ────────────────────
  const tasksWithAlertas = useMemo(() => {
    const result = new Map<string, AlertaTipo[]>();
    const limMin = (alertasConfig?.limite_minimo_minutos ?? 45) / 60;
    const limMax = Number(alertasConfig?.limite_maximo_horas ?? 8);
    const limExc = Number(alertasConfig?.limite_excessivo_horas ?? 12);
    // Overlap REMOVIDO permanentemente — não gera alerta, badge nem bloqueio.
    const detectarNegativas = alertasConfig?.detectar_horas_negativas !== false;

    for (const t of filtered) {
      const alertas: AlertaTipo[] = [];
      const horas = getTaskHoras(t);

      if (detectarNegativas && horas < 0) {
        alertas.push("negativo");
      } else if (horas > 0 && horas < limMin) {
        alertas.push("curto");
      } else if (horas >= limMax && horas < limExc) {
        alertas.push("longo");
      } else if (horas >= limExc) {
        alertas.push("excessivo");
      }

      // "sem janela" = não conseguimos determinar [início, fim] reais
      const tsIni = obterInicioTask(t);
      const tsFim = obterFimTask(t, periodoEnd);
      if ((!tsIni || !tsFim || tsFim <= tsIni) && horas > 0) {
        alertas.push("sem_janela");
      }

      if (atravessaPeriodo(t)) alertas.push("multi_periodo");

      result.set(String(t.auvo_task_id || ""), alertas);
    }
    return result;
  }, [filtered, alertasConfig]);

  // ── Status de revisão (decisão humana ou regra automática) ────────
  const getStatusRevisao = (alertas: AlertaTipo[], revisao: any): StatusRevisao => {
    if (revisao?.status_revisao === "aprovada" || revisao?.status_revisao === "ajustada") return "faturavel";
    if (revisao?.status_revisao === "rejeitada") return "rejeitada";
    const exigeRevisao = alertas.some((a) => {
      if (a === "curto" && alertasConfig?.curta_requer_revisao) return true;
      if (a === "longo" && alertasConfig?.longa_requer_revisao) return true;
      if (a === "excessivo" && alertasConfig?.excessiva_requer_revisao) return true;
      if (a === "negativo" && alertasConfig?.negativa_requer_revisao) return true;
      // "overlap" desativado por regra de negócio — não bloqueia faturamento.
      // "sem_janela" (sem checkout / sem hora_fim) NÃO bloqueia faturamento.
      // Regra de negócio: horas trabalhadas devem ser cobradas mesmo sem checkout.
      // O alerta continua visível como informação, mas não joga a OS para Em Revisão.
      return false;
    });
    return exigeRevisao ? "em_revisao" : "faturavel";
  };

  const tecnicoSummary = useMemo(() => {
    const map = new Map<string, {
      tecnico: string;
      horas: number; deslocamento: number; tarefas: number; valor: number;
      horasEmRevisao: number; valorEmRevisao: number; tarefasEmRevisao: number;
      horasRejeitado: number; valorRejeitado: number; tarefasRejeitado: number;
      byCliente: Map<string, ClienteData>;
    }>();

    for (const t of filtered) {
      const tec = t.tecnico || "Desconhecido";
      const cliente = resolveDisplayCliente(t);
      const taskId = String(t.auvo_task_id || "");
      const alertas = tasksWithAlertas.get(taskId) || [];
      const revisao = revisoesMap?.get(taskId) || null;
      const status = getStatusRevisao(alertas, revisao);

      // Horas faturáveis = duração da Auvo PRO-RATEADA pela janela do período
      const horasOriginais = getTaskHorasNoPeriodo(t);
      const tsIniRef = obterInicioTask(t);
      const dataRefPeriodo = tsIniRef ? tsIniRef.toISOString().slice(0, 10) : (t.data_tarefa || t.data_conclusao);
      const horasEfetivas =
        revisao?.status_revisao === "ajustada" && revisao.horas_ajustadas != null
          ? Number(revisao.horas_ajustadas)
          : horasOriginais;
      const valorEfetivo = getTaskValor(t, tec, horasEfetivas, dataRefPeriodo);
      const valorPotencial = getTaskValor(t, tec, horasOriginais, dataRefPeriodo);
      const deslocamento = Number(t.duracao_deslocamento) || 0;

      let entry = map.get(tec);
      if (!entry) {
        entry = {
          tecnico: tec, horas: 0, deslocamento: 0, tarefas: 0, valor: 0,
          horasEmRevisao: 0, valorEmRevisao: 0, tarefasEmRevisao: 0,
          horasRejeitado: 0, valorRejeitado: 0, tarefasRejeitado: 0,
          byCliente: new Map(),
        };
        map.set(tec, entry);
      }
      let clienteEntry = entry.byCliente.get(cliente);
      if (!clienteEntry) {
        clienteEntry = {
          horas: 0, deslocamento: 0, tarefas: 0, valor: 0,
          horasEmRevisao: 0, valorEmRevisao: 0, tarefasEmRevisao: 0,
          horasRejeitado: 0, valorRejeitado: 0, tarefasRejeitado: 0,
          tipos: new Map(), tasks: [],
        };
        entry.byCliente.set(cliente, clienteEntry);
      }

      // Deslocamento sempre conta (não é faturado pela hora trabalhada)
      entry.deslocamento += deslocamento;
      clienteEntry.deslocamento += deslocamento;

      if (status === "faturavel") {
        entry.horas += horasEfetivas;
        entry.tarefas++;
        entry.valor += valorEfetivo;
        clienteEntry.horas += horasEfetivas;
        clienteEntry.tarefas++;
        clienteEntry.valor += valorEfetivo;
        const tipo = getTipoLabel(t.descricao);
        clienteEntry.tipos.set(tipo, (clienteEntry.tipos.get(tipo) || 0) + horasEfetivas);
      } else if (status === "em_revisao") {
        entry.horasEmRevisao += horasOriginais;
        entry.valorEmRevisao += valorPotencial;
        entry.tarefasEmRevisao++;
        clienteEntry.horasEmRevisao += horasOriginais;
        clienteEntry.valorEmRevisao += valorPotencial;
        clienteEntry.tarefasEmRevisao++;
      } else {
        entry.horasRejeitado += horasOriginais;
        entry.valorRejeitado += valorPotencial;
        entry.tarefasRejeitado++;
        clienteEntry.horasRejeitado += horasOriginais;
        clienteEntry.valorRejeitado += valorPotencial;
        clienteEntry.tarefasRejeitado++;
      }

      clienteEntry.tasks.push({
        auvo_task_id: taskId,
        descricao: getTipoLabel(t.descricao),
        orientacao: t.orientacao || "",
        pendencia: t.pendencia || "",
        hora_inicio: t.hora_inicio || "",
        hora_fim: t.hora_fim || "",
        horas: status === "faturavel" ? horasEfetivas : horasOriginais,
        deslocamento,
        data_tarefa: t.data_tarefa || "",
        data_conclusao: t.data_conclusao || "",
        // Detalhe sempre mostra o valor real calculado (não zerar em revisão/rejeitada).
        // O bloqueio de faturamento é representado nos cards do topo, não zerando linhas.
        valor: status === "faturavel" ? valorEfetivo : valorPotencial,
        tecnico: tec,
        equipamento: t.equipamento_nome || equipamentoTaskMap[t.auvo_task_id]?.nome || "",
        equipamento_id_serie:
          t.equipamento_id_serie || equipamentoTaskMap[t.auvo_task_id]?.id_serie || "",
        auvo_link: t.auvo_link || "",
        auvo_task_url: t.auvo_task_url || "",
        auvo_survey_url: t.auvo_survey_url || "",
        status_auvo: t.status_auvo || "",
        cliente_gc: t.gc_os_cliente || "",
        gc_os_codigo: t.gc_os_codigo || "",
        gc_os_link: t.gc_os_link || "",
        cliente,
        statusRevisao: status,
        horasOriginais,
        valorPotencial,
        emergencial: isTaskEmergencial(t, tec),
        revisao,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [filtered, valorHoraConfigs, grupos, grupoClienteMap, filterGrupo, equipamentoTaskMap, tasksWithAlertas, revisoesMap, alertasConfig]);

  // Summary by client (across all technicians)
  const clienteSummary = useMemo(() => {
    const map = new Map<string, {
      cliente: string;
      horas: number; deslocamento: number; tarefas: number; valor: number;
      horasEmRevisao: number; valorEmRevisao: number; tarefasEmRevisao: number;
      horasRejeitado: number; valorRejeitado: number; tarefasRejeitado: number;
      tecnicos: Set<string>; tasks: TaskDetail[];
    }>();
    for (const tec of tecnicoSummary) {
      for (const [cliente, cd] of tec.byCliente) {
        let entry = map.get(cliente);
        if (!entry) {
          entry = {
            cliente, horas: 0, deslocamento: 0, tarefas: 0, valor: 0,
            horasEmRevisao: 0, valorEmRevisao: 0, tarefasEmRevisao: 0,
            horasRejeitado: 0, valorRejeitado: 0, tarefasRejeitado: 0,
            tecnicos: new Set(), tasks: [],
          };
          map.set(cliente, entry);
        }
        entry.horas += cd.horas;
        entry.deslocamento += cd.deslocamento;
        entry.tarefas += cd.tarefas;
        entry.valor += cd.valor;
        entry.horasEmRevisao += cd.horasEmRevisao;
        entry.valorEmRevisao += cd.valorEmRevisao;
        entry.tarefasEmRevisao += cd.tarefasEmRevisao;
        entry.horasRejeitado += cd.horasRejeitado;
        entry.valorRejeitado += cd.valorRejeitado;
        entry.tarefasRejeitado += cd.tarefasRejeitado;
        entry.tecnicos.add(tec.tecnico);
        entry.tasks.push(...cd.tasks);
      }
    }
    for (const e of map.values()) {
      e.tasks.sort((a, b) =>
        Number(isExcessiveTask(b.horas)) - Number(isExcessiveTask(a.horas)) ||
        (a.data_tarefa || a.data_conclusao || "").localeCompare(b.data_tarefa || b.data_conclusao || "") ||
        (a.hora_inicio || "").localeCompare(b.hora_inicio || "")
      );
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [tecnicoSummary]);

  const clienteSelecionado = useMemo(
    () => (clienteModal ? clienteSummary.find((c) => c.cliente === clienteModal) : null),
    [clienteModal, clienteSummary]
  );

  // Contadores por tipo + lista plana de alertas para cards e exports
  const alertCounts = useMemo(() => {
    const counts: Record<Exclude<AlertaTipo, null>, number> = {
      negativo: 0, curto: 0, longo: 0, excessivo: 0, overlap: 0, sem_janela: 0, multi_periodo: 0,
    };
    const seenByType = new Map<string, Set<string>>();
    for (const [id, alerts] of tasksWithAlertas) {
      for (const a of alerts) {
        if (!a) continue;
        let s = seenByType.get(a);
        if (!s) { s = new Set(); seenByType.set(a, s); }
        if (s.has(id)) continue;
        s.add(id);
        counts[a]++;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total };
  }, [tasksWithAlertas]);

  const alertaTooltip = (a: AlertaTipo, t: TaskDetail): string => {
    if (!a) return "";
    const limMin = alertasConfig?.limite_minimo_minutos ?? 45;
    const limMax = alertasConfig?.limite_maximo_horas ?? 8;
    const limExc = alertasConfig?.limite_excessivo_horas ?? 12;
    switch (a) {
      case "curto":
        return `OS abaixo do tempo mínimo de ${limMin} min — verificar checkout precoce`;
      case "longo":
        return `OS acima de ${limMax}h — possível checkout esquecido`;
      case "excessivo":
        return `OS acima de ${limExc}h — apontamento provavelmente incorreto`;
      case "negativo":
        return "Duração negativa — bug de apontamento (checkout antes do check-in)";
      case "overlap":
        return `Sobreposição de horário: técnico ${t.tecnico} em outra OS no mesmo intervalo`;
      case "sem_janela":
        return `Status '${t.status_auvo}' com horas registradas — técnico não fechou a OS`;
      default:
        return "";
    }
  };

  const alertaIcone = (a: AlertaTipo): JSX.Element | null => {
    if (!a) return null;
    if (a === "curto") return <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />;
    if (a === "longo") return <Clock className="h-3.5 w-3.5 text-blue-600" />;
    if (a === "excessivo" || a === "overlap") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    if (a === "negativo") return <Ban className="h-3.5 w-3.5 text-destructive" />;
    if (a === "sem_janela") return <Clock className="h-3.5 w-3.5 text-destructive" />;
    return null;
  };

  const rowAlertClass = (a: AlertaTipo): string => {
    if (a === "excessivo" || a === "negativo" || a === "overlap") return "bg-destructive/10";
    if (a === "sem_janela") return "bg-destructive/5";
    if (a === "curto") return "bg-yellow-100/50 dark:bg-yellow-900/20";
    if (a === "longo") return "bg-blue-100/50 dark:bg-blue-900/20";
    return "";
  };

  const taskMatchesAlertFilter = (taskId: string): boolean => {
    if (!alertFilter) return true;
    const lst = tasksWithAlertas.get(taskId) || [];
    return lst.includes(alertFilter);
  };

  // Totais incluem tarefas em revisão (continuam sinalizadas no card "Em Revisão",
  // mas somam ao total — regra de negócio: faturamos mesmo o que está em revisão).
  // Rejeitado segue fora.
  const totalHoras = useMemo(
    () => tecnicoSummary.reduce((s, t) => s + t.horas + t.horasEmRevisao, 0),
    [tecnicoSummary],
  );
  const totalDeslocamento = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.deslocamento, 0), [tecnicoSummary]);
  const totalValor = useMemo(
    () => tecnicoSummary.reduce((s, t) => s + t.valor + t.valorEmRevisao, 0),
    [tecnicoSummary],
  );
  const totalTarefas = useMemo(
    () => tecnicoSummary.reduce((s, t) => s + t.tarefas + t.tarefasEmRevisao, 0),
    [tecnicoSummary],
  );
  const totalEmRevisao = useMemo(() => tecnicoSummary.reduce((acc, t) => ({
    horas: acc.horas + t.horasEmRevisao, valor: acc.valor + t.valorEmRevisao, tarefas: acc.tarefas + t.tarefasEmRevisao,
  }), { horas: 0, valor: 0, tarefas: 0 }), [tecnicoSummary]);
  const totalRejeitado = useMemo(() => tecnicoSummary.reduce((acc, t) => ({
    horas: acc.horas + t.horasRejeitado, valor: acc.valor + t.valorRejeitado, tarefas: acc.tarefas + t.tarefasRejeitado,
  }), { horas: 0, valor: 0, tarefas: 0 }), [tecnicoSummary]);

  // Visitas emergenciais (qualquer status de revisão; usa valorPotencial p/ não esconder em revisão)
  const totalEmergencial = useMemo(() => {
    const seen = new Set<string>();
    let tarefas = 0, horas = 0, valor = 0;
    for (const tec of tecnicoSummary) {
      for (const cd of tec.byCliente.values()) {
        for (const tk of cd.tasks) {
          if (!tk.emergencial) continue;
          if (seen.has(tk.auvo_task_id)) continue;
          seen.add(tk.auvo_task_id);
          tarefas++;
          horas += tk.horasOriginais;
          valor += tk.statusRevisao === "faturavel" ? tk.valor : tk.valorPotencial;
        }
      }
    }
    return { tarefas, horas, valor };
  }, [tecnicoSummary]);

  // Lista plana de OS em revisão (para o modal)
  const osEmRevisao = useMemo(() => {
    const out: TaskDetail[] = [];
    for (const c of clienteSummary) for (const t of c.tasks) if (t.statusRevisao === "em_revisao") out.push(t);
    out.sort((a, b) => {
      const aA = tasksWithAlertas.get(a.auvo_task_id) || [];
      const bA = tasksWithAlertas.get(b.auvo_task_id) || [];
      const aS = Math.max(0, ...aA.filter(Boolean).map((x) => ALERTA_SEVERIDADE[x as Exclude<AlertaTipo, null>]));
      const bS = Math.max(0, ...bA.filter(Boolean).map((x) => ALERTA_SEVERIDADE[x as Exclude<AlertaTipo, null>]));
      return bS - aS;
    });
    return out;
  }, [clienteSummary, tasksWithAlertas]);

  const osRejeitadas = useMemo(() => {
    const out: TaskDetail[] = [];
    for (const c of clienteSummary) for (const t of c.tasks) if (t.statusRevisao === "rejeitada") out.push(t);
    out.sort((a, b) => (b.data_tarefa || "").localeCompare(a.data_tarefa || ""));
    return out;
  }, [clienteSummary]);

  // Persistir uma decisão de revisão
  const persistRevisao = async (
    task: TaskDetail,
    status: "aprovada" | "rejeitada" | "ajustada",
    justificativa: string,
    horasAjustadas?: number,
  ) => {
    if ((status === "rejeitada" || status === "ajustada") && !justificativa.trim()) {
      toast.error("Justificativa obrigatória para Rejeitar/Ajustar");
      return false;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const decididoPor = user?.email || user?.id || "desconhecido";
    const alertas = (tasksWithAlertas.get(task.auvo_task_id) || []).filter(Boolean);
    const payload: any = {
      auvo_task_id: task.auvo_task_id,
      status_revisao: status,
      alertas_motivo: JSON.stringify(alertas),
      horas_originais: task.horasOriginais,
      horas_ajustadas: status === "ajustada" ? Number(horasAjustadas) : null,
      justificativa: justificativa.trim() || null,
      decidido_por: decididoPor,
      decidido_em: new Date().toISOString(),
    };
    const { error } = await (supabase as any)
      .from("os_revisao")
      .upsert(payload, { onConflict: "auvo_task_id" });
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    toast.success(
      status === "aprovada" ? "OS aprovada — somou ao faturável"
      : status === "rejeitada" ? "OS rejeitada — fora do faturável"
      : "OS ajustada e aprovada"
    );
    queryClient.invalidateQueries({ queryKey: ["os-revisao"] });
    return true;
  };

  // Revoga uma decisão de revisão (DELETE em os_revisao). A OS volta ao
  // estado calculado: vai para "Em Revisão" se ainda tem alertas, ou
  // para "Faturável" se não tem.
  const revogarRevisao = async (task: TaskDetail) => {
    const { error } = await (supabase as any)
      .from("os_revisao")
      .delete()
      .eq("auvo_task_id", task.auvo_task_id);
    if (error) { toast.error("Erro ao revogar: " + error.message); return false; }
    toast.success("Rejeição revogada");
    queryClient.invalidateQueries({ queryKey: ["os-revisao"] });
    return true;
  };

  // Re-sincroniza UMA OS direto do Auvo (modo single da edge function)
  const sincronizarOsDoAuvo = async (task: TaskDetail) => {
    setSyncingTaskId(task.auvo_task_id);
    try {
      const { data, error } = await supabase.functions.invoke("horas-trabalhadas-fetch", {
        body: { mode: "single", taskId: task.auvo_task_id },
      });
      if (error || !data?.ok) {
        toast.error("Falha ao sincronizar: " + (data?.error || error?.message || "erro desconhecido"));
        return;
      }
      const a = data.alteracoes || {};
      const partes: string[] = [];
      if (a.horas_anteriores !== a.horas_atuais) {
        partes.push(`horas: ${(a.horas_anteriores ?? 0).toFixed(2)}h → ${(a.horas_atuais ?? 0).toFixed(2)}h`);
      }
      if (a.status_anterior !== a.status_atual) {
        partes.push(`status: ${a.status_anterior || "—"} → ${a.status_atual || "—"}`);
      }
      toast.success(`OS ${task.auvo_task_id} sincronizada${partes.length ? ` — ${partes.join(" · ")}` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["relatorios-horas-trabalhadas"] });
      queryClient.invalidateQueries({ queryKey: ["os-revisao"] });
    } finally {
      setSyncingTaskId(null);
    }
  };

  // Chart data
  const chartData = useMemo(() =>
    tecnicoSummary.map((t) => ({
      name: t.tecnico.split(" ")[0],
      horas: Math.round(t.horas * 100) / 100,
    })),
  [tecnicoSummary]);

  const [expanded, setExpanded] = useState<string | null>(null);

  // Detect negative-duration tasks
  const negativeTasks = useMemo(() => {
    return filtered.filter((t) => getTaskHoras(t) < 0).map((t) => ({
      id: t.auvo_task_id,
      cliente: t.cliente || t.gc_os_cliente || "?",
      horas: getTaskHoras(t),
    }));
  }, [filtered]);

  // Tipos de tarefa disponíveis no dataset atual (pré-filtro de tipo),
  // agrupados por task_type_id com nome amigável e contagem de OS.
  const tiposDisponiveis = useMemo(() => {
    // Dedup por auvo_task_id para casar com a fonte do filtered.
    const byId = new Map<string, any>();
    for (const t of data) {
      if (!t?.auvo_task_id) continue;
      const existing = byId.get(t.auvo_task_id);
      if (!existing || (t.atualizado_em || "") > (existing.atualizado_em || "")) {
        byId.set(t.auvo_task_id, t);
      }
    }
    const tiposMap = new Map<string, { id: string; nome: string; qtd: number }>();
    for (const t of byId.values()) {
      const id = String(t.task_type_id ?? "").trim() || "SEM_ID";
      const nomeBruto = (t.descricao || "").toString().trim();
      const nome = nomeBruto || (id === "SEM_ID" ? "Sem tipo definido" : `Tipo ${id}`);
      const atual = tiposMap.get(id);
      if (atual) {
        atual.qtd += 1;
        // Mantém o nome mais comum / primeiro não-vazio.
        if (!atual.nome || atual.nome.startsWith("Tipo ")) atual.nome = nome;
      } else {
        tiposMap.set(id, { id, nome, qtd: 1 });
      }
    }
    return Array.from(tiposMap.values()).sort((a, b) => b.qtd - a.qtd);
  }, [data]);

  const fmtBRL = (v: number) => v > 0 ? "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const periodoStr = `${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}`;

    // ── Header ──
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Relatório de Horas Trabalhadas", 14, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${periodoStr}`, 14, 28);

    // ── Resumo Geral ──
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo Geral", 14, 40);

    autoTable(doc, {
      startY: 44,
      head: [["Horas Trabalhadas", "Horas Deslocamento", "Tarefas", "Técnicos", "Valor Total"]],
      body: [[
        `${totalHoras.toFixed(1)}h`,
        `${totalDeslocamento.toFixed(1)}h`,
        String(totalTarefas),
        String(tecnicoSummary.length),
        fmtBRL(totalValor),
      ]],
      styles: { fontSize: 9, halign: "center" },
      headStyles: { fillColor: [37, 99, 235], halign: "center" },
      theme: "grid",
    });

    let curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Resumo por Cliente ──
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo por Cliente", 14, curY);
    curY += 4;

    const clienteRows = clienteSummary.map((c) => [
      c.cliente,
      String(c.tarefas),
      `${c.horas.toFixed(1)}h`,
      `${c.deslocamento.toFixed(1)}h`,
      String(c.tecnicos.size),
      fmtBRL(c.valor),
    ]);
    clienteRows.push([
      "TOTAL",
      String(totalTarefas),
      `${totalHoras.toFixed(1)}h`,
      `${totalDeslocamento.toFixed(1)}h`,
      "",
      fmtBRL(totalValor),
    ]);

    autoTable(doc, {
      startY: curY,
      head: [["Cliente", "Tarefas", "Horas", "Desloc.", "Técnicos", "Valor"]],
      body: clienteRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 0: { cellWidth: 55 }, 5: { halign: "right" } },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === clienteRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [230, 237, 250];
        }
      },
    });

    curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Inconsistências ──
    {
      const incBody = (Object.keys(alertCounts.counts) as Array<Exclude<AlertaTipo, null>>)
        .filter((k) => k !== "curto" && k !== "longo" && alertCounts.counts[k] > 0)
        .sort((a, b) => ALERTA_SEVERIDADE[b] - ALERTA_SEVERIDADE[a])
        .map((k) => [ALERTA_LABEL[k], String(alertCounts.counts[k])]);
      if (incBody.length > 0) {
        if (curY > 230) { doc.addPage(); curY = 20; }
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Inconsistências detectadas", 14, curY);
        curY += 4;
        autoTable(doc, {
          startY: curY,
          head: [["Tipo", "OS afetadas"]],
          body: incBody,
          styles: { fontSize: 9 },
          headStyles: { fillColor: [234, 179, 8] },
          columnStyles: { 1: { halign: "right", cellWidth: 30 } },
        });
        curY = (doc as any).lastAutoTable.finalY + 4;
        doc.setFontSize(8);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(120);
        doc.text("Detalhamento por OS disponível na aba 'Inconsistências' do export Excel.", 14, curY);
        doc.setTextColor(0);
        doc.setFont("helvetica", "normal");
        curY += 10;
      }
    }

    // ── Resumo por Técnico ──
    if (curY > 240) { doc.addPage(); curY = 20; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo por Técnico", 14, curY);
    curY += 4;

    const tecRows = tecnicoSummary.map((t) => [
      t.tecnico,
      String(t.tarefas),
      `${t.horas.toFixed(1)}h`,
      `${t.deslocamento.toFixed(1)}h`,
      fmtBRL(t.valor),
    ]);
    tecRows.push([
      "TOTAL",
      String(totalTarefas),
      `${totalHoras.toFixed(1)}h`,
      `${totalDeslocamento.toFixed(1)}h`,
      fmtBRL(totalValor),
    ]);

    autoTable(doc, {
      startY: curY,
      head: [["Técnico", "Tarefas", "Horas", "Desloc.", "Valor"]],
      body: tecRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 4: { halign: "right" } },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === tecRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [230, 237, 250];
        }
      },
    });

    curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Detalhamento Técnico × Cliente ──
    if (curY > 240) { doc.addPage(); curY = 20; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhamento por Técnico e Cliente", 14, curY);
    curY += 4;

    const detailRows: any[] = [];
    for (const tec of tecnicoSummary) {
      for (const [cliente, cd] of Array.from(tec.byCliente.entries()).sort(([, a], [, b]) => b.valor - a.valor)) {
        detailRows.push([
          tec.tecnico,
          cliente,
          String(cd.tarefas),
          `${cd.horas.toFixed(2)}h`,
          `${cd.deslocamento.toFixed(2)}h`,
          fmtBRL(cd.valor),
        ]);
      }
    }

    autoTable(doc, {
      startY: curY,
      head: [["Técnico", "Cliente", "Tarefas", "Horas", "Desloc.", "Valor"]],
      body: detailRows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 50 }, 5: { halign: "right" } },
    });

    // ── Detalhe por OS (todas as ordens, agrupadas por cliente) ──
    doc.addPage("a4", "landscape");
    const pageWLand = doc.internal.pageSize.getWidth();
    curY = 18;
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhe Completo por Ordem de Serviço", 14, curY);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${periodoStr}`, 14, curY + 6);
    curY += 14;

    for (const c of clienteSummary) {
      // Header do cliente
      if (curY > 180) { doc.addPage("a4", "landscape"); curY = 18; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(230, 237, 250);
      doc.rect(14, curY - 4, pageWLand - 28, 7, "F");
      doc.text(`${c.cliente}  ·  ${c.tarefas} OS  ·  ${c.horas.toFixed(1)}h  ·  ${fmtBRL(c.valor)}`, 16, curY + 1);
      curY += 6;

      const osRows = c.tasks.map((t) => [
        t.data_tarefa || t.data_conclusao,
        `#${t.auvo_task_id}`,
        t.tecnico,
        t.descricao,
        t.equipamento || "—",
        t.hora_inicio && t.hora_fim ? `${t.hora_inicio}–${t.hora_fim}` : (t.hora_inicio || "—"),
        `${t.horas.toFixed(2)}h`,
        t.deslocamento > 0 ? `${t.deslocamento.toFixed(2)}h` : "—",
        fmtBRL(t.valor),
      ]);

      autoTable(doc, {
        startY: curY,
        head: [["Data", "ID", "Técnico", "Tipo de Tarefa", "Equipamento", "Horário", "Horas", "Desloc.", "Valor"]],
        body: osRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 22 }, 1: { cellWidth: 18 }, 2: { cellWidth: 35 },
          3: { cellWidth: 55 }, 4: { cellWidth: 55 },
          5: { cellWidth: 24 }, 6: { cellWidth: 18, halign: "right" },
          7: { cellWidth: 18, halign: "right" }, 8: { halign: "right" },
        },
        margin: { left: 14, right: 14 },
      });

      curY = (doc as any).lastAutoTable.finalY + 8;
    }

    // ── Footer ──
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(130);
      const w = doc.internal.pageSize.getWidth();
      doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")} · Página ${i}/${pages}`, w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });
      doc.setTextColor(0);
    }

    doc.save(`horas-trabalhadas-${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}.pdf`);
  };

  // ── Excel export: Resumo Cliente | Detalhe OS | Resumo Técnico ──
  const handleExportExcel = () => {
    const periodoStr = `${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}`;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Resumo por Cliente
    const resumoClienteRows: any[] = [
      ["Relatório de Horas Trabalhadas — Resumo por Cliente"],
      [`Período: ${periodoStr}`],
      [],
      ["Cliente", "Tarefas", "Horas", "Deslocamento (h)", "Técnicos", "Valor (R$)"],
      ...clienteSummary.map((c) => [
        c.cliente,
        c.tarefas,
        Number(c.horas.toFixed(2)),
        Number(c.deslocamento.toFixed(2)),
        c.tecnicos.size,
        Number(c.valor.toFixed(2)),
      ]),
      ["TOTAL", totalTarefas, Number(totalHoras.toFixed(2)), Number(totalDeslocamento.toFixed(2)), tecnicoSummary.length, Number(totalValor.toFixed(2))],
    ];
    const wsCli = XLSX.utils.aoa_to_sheet(resumoClienteRows);
    wsCli["!cols"] = [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsCli, "Resumo Cliente");

    // Sheet 2: Detalhe por OS (todas as ordens)
    const detalheHeader = [
      "Cliente", "Cliente GC", "Data Conclusão", "Data Tarefa", "ID Tarefa", "Cód. OS GC",
      "Técnico", "Tipo de Tarefa", "Equipamento", "ID/Série",
      "Status Auvo", "Alertas", "Início", "Fim", "Horas", "Deslocamento (h)", "Valor (R$)",
      "Orientação", "Pendência", "Relatório Auvo", "Tarefa Auvo", "Pesquisa Satisfação", "Link OS GC",
    ];
    const detalheRows: any[] = [
      ["Detalhe Completo por OS"],
      [`Período: ${periodoStr}`],
      [],
      detalheHeader,
    ];
    for (const c of clienteSummary) {
      for (const t of c.tasks) {
        const alerts = (tasksWithAlertas.get(t.auvo_task_id) || []).filter(Boolean) as Exclude<AlertaTipo, null>[];
        const alertasStr = alerts.map((a) => ALERTA_LABEL[a]).join(", ");
        detalheRows.push([
          c.cliente,
          t.cliente_gc,
          t.data_conclusao,
          t.data_tarefa,
          t.auvo_task_id,
          t.gc_os_codigo,
          t.tecnico,
          t.descricao,
          t.equipamento,
          t.equipamento_id_serie,
          t.status_auvo,
          alertasStr,
          t.hora_inicio,
          t.hora_fim,
          Number(t.horas.toFixed(2)),
          Number(t.deslocamento.toFixed(2)),
          Number(t.valor.toFixed(2)),
          t.orientacao,
          t.pendencia,
          t.auvo_link,
          t.auvo_task_url,
          t.auvo_survey_url,
          t.gc_os_link,
        ]);
      }
    }
    const wsDet = XLSX.utils.aoa_to_sheet(detalheRows);
    wsDet["!cols"] = [
      { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 22 }, { wch: 28 }, { wch: 30 }, { wch: 16 },
      { wch: 14 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
      { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDet, "Detalhe OS");

    // Sheet 3: Resumo por Técnico
    const tecRows: any[] = [
      ["Resumo por Técnico"],
      [`Período: ${periodoStr}`],
      [],
      ["Técnico", "Tarefas", "Horas", "Deslocamento (h)", "Valor (R$)"],
      ...tecnicoSummary.map((t) => [
        t.tecnico,
        t.tarefas,
        Number(t.horas.toFixed(2)),
        Number(t.deslocamento.toFixed(2)),
        Number(t.valor.toFixed(2)),
      ]),
      ["TOTAL", totalTarefas, Number(totalHoras.toFixed(2)), Number(totalDeslocamento.toFixed(2)), Number(totalValor.toFixed(2))],
    ];
    const wsTec = XLSX.utils.aoa_to_sheet(tecRows);
    wsTec["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsTec, "Resumo Técnico");

    // (Aba "OS Pendentes" removida — toda OS com hora trabalhada é faturada
    //  e OS suspeitas vão para a aba "OS em Revisão" / Caixa de Revisão.)

    // Sheet: Inconsistências (apenas OS com algum alerta)
    {
      const incHeader = [
        "Gravidade", "Alertas", "Cliente", "Técnico", "Data",
        "ID Tarefa", "Cód. OS GC", "Horas", "Status Auvo",
        "Link Auvo", "Link OS GC",
      ];
      const flat: { sev: number; t: TaskDetail; alerts: Exclude<AlertaTipo, null>[]; cliente: string }[] = [];
      for (const c of clienteSummary) {
        for (const t of c.tasks) {
          const alerts = ((tasksWithAlertas.get(t.auvo_task_id) || []).filter(Boolean) as Exclude<AlertaTipo, null>[])
            .filter((a) => a !== "curto" && a !== "longo");
          if (alerts.length === 0) continue;
          const sev = Math.max(...alerts.map((a) => ALERTA_SEVERIDADE[a]));
          flat.push({ sev, t, alerts, cliente: c.cliente });
        }
      }
      if (flat.length === 0) {
        // sem inconsistências reais — não cria a aba
      } else {
      const incRows: any[] = [
        ["Inconsistências detectadas — OS com algum alerta no período"],
        [`Período: ${periodoStr}`],
        [],
        incHeader,
      ];
      flat.sort((a, b) => b.sev - a.sev);
      for (const r of flat) {
        const pa = piorAlerta(r.alerts);
        incRows.push([
          pa ? ALERTA_LABEL[pa] : "",
          r.alerts.map((a) => ALERTA_LABEL[a]).join(", "),
          r.cliente,
          r.t.tecnico,
          r.t.data_tarefa || r.t.data_conclusao,
          r.t.auvo_task_id,
          r.t.gc_os_codigo,
          Number(r.t.horas.toFixed(2)),
          r.t.status_auvo,
          r.t.auvo_link || r.t.auvo_task_url || "",
          r.t.gc_os_link || "",
        ]);
      }
      const wsInc = XLSX.utils.aoa_to_sheet(incRows);
      wsInc["!cols"] = [
        { wch: 16 }, { wch: 36 }, { wch: 30 }, { wch: 22 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 },
        { wch: 40 }, { wch: 40 },
      ];
      XLSX.utils.book_append_sheet(wb, wsInc, "Inconsistências");
      }
    }

    XLSX.writeFile(wb, `horas-trabalhadas-${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}.xlsx`);
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Date range */}
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px] justify-start text-xs">
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {format(dateFrom, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50 bg-popover pointer-events-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(d) => d && onDateFromChange(d)}
                    locale={ptBR}
                    initialFocus
                    defaultMonth={dateFrom}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px] justify-start text-xs">
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {format(dateTo, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50 bg-popover pointer-events-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(d) => d && onDateToChange(d)}
                    locale={ptBR}
                    initialFocus
                    defaultMonth={dateTo}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Technician filter */}
            <div className="space-y-1">
              <Label className="text-xs">Técnico</Label>
              <Select value={filterTecnico} onValueChange={setFilterTecnico}>
                <SelectTrigger className="w-[160px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {allTecnicos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Client filter */}
            <div className="space-y-1">
              <Label className="text-xs">Cliente</Label>
              <Select value={filterCliente} onValueChange={setFilterCliente}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {allClientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Group filter - searchable */}
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Popover open={grupoOpen} onOpenChange={setGrupoOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[200px] h-9 justify-between text-xs font-normal">
                    {filterGrupo === "todos"
                      ? "Todos"
                      : grupos.find((g: any) => g.id === filterGrupo)?.nome || "Todos"}
                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar grupo..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>Nenhum grupo.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="todos"
                          onSelect={() => { setFilterGrupo("todos"); setGrupoOpen(false); }}
                          className="text-xs"
                        >
                          <Check className={cn("mr-2 h-3 w-3", filterGrupo === "todos" ? "opacity-100" : "opacity-0")} />
                          Todos
                        </CommandItem>
                        {grupos.map((g: any) => (
                          <CommandItem
                            key={g.id}
                            value={g.nome}
                            onSelect={() => { setFilterGrupo(g.id); setGrupoOpen(false); }}
                            className="text-xs"
                          >
                            <Check className={cn("mr-2 h-3 w-3", filterGrupo === g.id ? "opacity-100" : "opacity-0")} />
                            {g.nome}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Task type filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Tipos de Tarefa
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    {tiposSelecionados === null
                      ? `${tiposDisponiveis.length}/${tiposDisponiveis.length}`
                      : `${tiposSelecionados.size}/${tiposDisponiveis.length}`}
                  </Badge>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="start">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Tipos de Tarefa</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setTiposSelecionados(null)}
                    >
                      Todos
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setTiposSelecionados(new Set())}
                    >
                      Nenhum
                    </Button>
                  </div>
                </div>
                <div className="border-t -mx-3 mb-2" />
                <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                  {tiposDisponiveis.map((t) => {
                    const checked = tipoIncluido(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-muted rounded px-2 py-1"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setTiposSelecionados((prev) => {
                              const base = prev === null
                                ? new Set(tiposDisponiveis.map((x) => x.id))
                                : new Set(prev);
                              if (v) base.add(t.id);
                              else base.delete(t.id);
                              return base;
                            });
                          }}
                        />
                        <span className="text-sm flex-1 truncate" title={t.nome}>
                          {t.nome}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{t.qtd}</span>
                      </label>
                    );
                  })}
                  {tiposDisponiveis.length === 0 && (
                    <div className="text-xs text-muted-foreground px-2 py-3 text-center">
                      Nenhum tipo no período.
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}>
              <FileText className="h-3.5 w-3.5" />
              Exportar PDF
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportExcel}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exportar Excel
            </Button>

            {/* Toggle 'Apenas finalizadas' removido — regra única: faturar
                hora trabalhada no período, independente de status. */}
          </div>
        </CardContent>
      </Card>

      {/* Chip de filtro de alerta ativo */}
      {alertFilter && (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="gap-1.5">
            Filtrado por: {ALERTA_LABEL[alertFilter]}
            <button
              onClick={() => setAlertFilter(null)}
              className="hover:text-destructive ml-0.5"
              title="Limpar filtro"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
          <span className="text-muted-foreground">
            Detalhes filtrados — totais e gráficos não são afetados.
          </span>
        </div>
      )}

      {/* Card de inconsistências detectadas */}
      {alertCounts.total > 0 && (
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Inconsistências detectadas no período
              <Badge variant="secondary" className="ml-1">{alertCounts.total}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              {(Object.keys(alertCounts.counts) as Array<Exclude<AlertaTipo, null>>).map((k) => {
                const n = alertCounts.counts[k];
                if (n === 0) return null;
                const isRed = k === "excessivo" || k === "negativo" || k === "overlap" || k === "sem_janela";
                const colorCls =
                  k === "curto" ? "border-yellow-500 hover:bg-yellow-100/50 dark:hover:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100"
                  : k === "longo" ? "border-blue-500 hover:bg-blue-100/50 dark:hover:bg-blue-900/20 text-blue-900 dark:text-blue-100"
                  : "border-destructive hover:bg-destructive/10 text-destructive";
                const isActive = alertFilter === k;
                return (
                  <button
                    key={k}
                    onClick={() => setAlertFilter(isActive ? null : k)}
                    className={cn(
                      "border rounded-md px-3 py-2 flex items-center justify-between gap-2 transition-colors text-left",
                      colorCls,
                      isActive && "ring-2 ring-offset-1 ring-current"
                    )}
                    title={`Clique para filtrar apenas OS com '${ALERTA_LABEL[k]}'`}
                  >
                    <span className="flex items-center gap-1.5">
                      {alertaIcone(k)}
                      {ALERTA_LABEL[k]}
                    </span>
                    <span className="font-bold">{n}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Horas Trabalhadas</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{totalHoras.toFixed(1)}h</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-600">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Faturável Aprovado
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{totalTarefas} OS · {totalHoras.toFixed(1)}h</p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            "border-l-4 border-l-yellow-500",
            totalEmRevisao.tarefas > 0 && "cursor-pointer hover:bg-muted/50 transition-colors",
          )}
          onClick={() => { if (totalEmRevisao.tarefas > 0) setReviewModalOpen(true); }}
        >
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Em Revisão
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {totalEmRevisao.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{totalEmRevisao.tarefas} OS · {totalEmRevisao.horas.toFixed(1)}h</p>
            {totalEmRevisao.tarefas > 0 && (
              <p className="text-[10px] text-yellow-700 dark:text-yellow-300 mt-2 flex items-center gap-1">
                <Inbox className="h-3 w-3" /> Clique para revisar
              </p>
            )}
          </CardContent>
        </Card>
        <Card
          className={cn(
            "border-l-4 border-l-destructive",
            totalRejeitado.tarefas > 0 && "cursor-pointer hover:bg-muted/50 transition-colors",
          )}
          onClick={() => { if (totalRejeitado.tarefas > 0) setRejectedModalOpen(true); }}
        >
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <ShieldX className="h-4 w-4 text-destructive" />
              Rejeitado
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {totalRejeitado.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{totalRejeitado.tarefas} OS · {totalRejeitado.horas.toFixed(1)}h</p>
            {totalRejeitado.tarefas > 0 && (
              <p className="text-[10px] text-destructive mt-2 flex items-center gap-1">
                <Inbox className="h-3 w-3" /> Clique para gerenciar
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Siren className="h-4 w-4 text-orange-600" />
              Visitas Emergenciais
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {totalEmergencial.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalEmergencial.tarefas} OS · {totalEmergencial.horas.toFixed(1)}h
            </p>
            {totalEmergencial.tarefas === 0 && (
              <p className="text-[10px] text-muted-foreground mt-2">
                Nenhuma no período
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Warning for negative durations */}
      {negativeTasks.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>⚠️ {negativeTasks.length} tarefa(s) com duração negativa</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="text-xs mb-2">
              Essas tarefas vieram do Auvo com horas negativas e estão distorcendo os totais. Corrija no Auvo:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {negativeTasks.map((t) => (
                <Badge key={t.id} variant="destructive" className="text-[10px] font-mono">
                  #{t.id} · {t.cliente} · {t.horas.toFixed(1)}h
                </Badge>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Horas por Técnico</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RechartsTooltip
                  formatter={(value: number) => [`${value}h`, "Horas"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="horas" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Summary by Client */}
      {clienteSummary.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Resumo por Cliente</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-center">Tarefas</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Desloc.</TableHead>
                  <TableHead className="text-center">Técnicos</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clienteSummary.map((c) => (
                  <TableRow
                    key={c.cliente}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setClienteModal(c.cliente)}
                  >
                    <TableCell className="font-medium text-sm text-primary hover:underline">
                      {c.cliente}
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{c.tarefas}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">{c.horas.toFixed(1)}h</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{c.deslocamento > 0 ? `${c.deslocamento.toFixed(1)}h` : "—"}</TableCell>
                    <TableCell className="text-center text-sm">{c.tecnicos.size}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {c.valor > 0 ? c.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-center"><Badge>{totalTarefas}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{totalHoras.toFixed(1)}h</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{totalDeslocamento.toFixed(1)}h</TableCell>
                  <TableCell className="text-center">{tecnicoSummary.length}</TableCell>
                  <TableCell className="text-right">
                    {totalValor > 0 ? totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-center">Tarefas</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Deslocamento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tecnicoSummary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhuma tarefa encontrada no período
                  </TableCell>
                </TableRow>
              ) : (
                tecnicoSummary.map((tec) => (
                  <React.Fragment key={tec.tecnico}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpanded(expanded === tec.tecnico ? null : tec.tecnico)}
                    >
                      <TableCell className="font-medium">{tec.tecnico}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{tec.tarefas}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{tec.horas.toFixed(2)}h</TableCell>
                      <TableCell className="text-right text-muted-foreground">{tec.deslocamento > 0 ? `${tec.deslocamento.toFixed(2)}h` : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {tec.valor > 0 ? tec.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </TableCell>
                    </TableRow>
                    {expanded === tec.tecnico && (
                      <TableRow>
                          <TableCell colSpan={6} className="p-0">
                          <div className="bg-muted/30 px-6 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Cliente</TableHead>
                                  <TableHead className="text-xs">Tarefas (ID · Horário)</TableHead>
                                  <TableHead className="text-xs text-center">Qtd</TableHead>
                                  <TableHead className="text-xs text-right">Horas</TableHead>
                                  <TableHead className="text-xs text-right">Desloc.</TableHead>
                                  <TableHead className="text-xs text-right">Valor</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {Array.from(tec.byCliente.entries())
                                  .sort(([, a], [, b]) => b.horas - a.horas)
                                  .map(([cliente, cd]) => (
                                    <TableRow key={cliente} className="text-xs align-top">
                                      <TableCell className="font-medium">{cliente}</TableCell>
                                      <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                          {cd.tasks
                                            .filter((task) => taskMatchesAlertFilter(task.auvo_task_id))
                                            .sort((a, b) => a.data_tarefa.localeCompare(b.data_tarefa) || a.hora_inicio.localeCompare(b.hora_inicio))
                                            .map((task, idx) => {
                                              const alerts = tasksWithAlertas.get(task.auvo_task_id) || [];
                                              const pa = piorAlerta(alerts);
                                              const isRed = pa === "excessivo" || pa === "negativo" || pa === "overlap" || pa === "sem_janela";
                                              return (
                                                <span key={idx} className="inline-flex items-center gap-1">
                                                {task.emergencial && (
                                                  <Badge
                                                    variant="outline"
                                                    className="text-[9px] font-bold gap-0.5 border-orange-500 text-orange-700 dark:text-orange-300 bg-orange-100/60 dark:bg-orange-900/30"
                                                    title="Visita emergencial"
                                                  >
                                                    <Siren className="h-2.5 w-2.5" />
                                                    EMERG
                                                  </Badge>
                                                )}
                                                <Badge
                                                  variant={isRed ? "destructive" : "outline"}
                                                  className={cn(
                                                    "text-[9px] font-mono gap-1",
                                                    pa === "curto" && "border-yellow-500 text-yellow-900 dark:text-yellow-100 bg-yellow-100/50 dark:bg-yellow-900/20",
                                                    pa === "longo" && "border-blue-500 text-blue-900 dark:text-blue-100 bg-blue-100/50 dark:bg-blue-900/20",
                                                    task.horas < 0 && "animate-pulse"
                                                  )}
                                                  title={pa ? alertaTooltip(pa, task) : undefined}
                                                >
                                                  {alertaIcone(pa)}
                                                  #{task.auvo_task_id}
                                                  {task.hora_inicio && task.hora_fim
                                                    ? ` ${task.hora_inicio}–${task.hora_fim}`
                                                    : task.hora_inicio
                                                    ? ` ${task.hora_inicio}`
                                                    : ""}
                                                  {" · "}{task.horas.toFixed(1)}h
                                                </Badge>
                                                </span>
                                              );
                                            })}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center">{cd.tarefas}</TableCell>
                                      <TableCell className={cn("text-right font-medium", cd.horas < 0 && "text-destructive font-bold")}>{cd.horas.toFixed(2)}h</TableCell>
                                      <TableCell className="text-right text-muted-foreground text-xs">{cd.deslocamento > 0 ? `${cd.deslocamento.toFixed(2)}h` : "—"}</TableCell>
                                      <TableCell className="text-right font-medium">
                                        {cd.valor > 0 ? cd.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modal: Detalhe de OS por Cliente */}
      <Dialog open={!!clienteModal} onOpenChange={(open) => !open && setClienteModal(null)}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">{clienteSelecionado?.cliente}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-3 text-xs">
              <span><strong>{clienteSelecionado?.tarefas}</strong> OS</span>
              <span><strong>{clienteSelecionado?.horas.toFixed(1)}h</strong> trabalhadas</span>
              <span><strong>{clienteSelecionado?.deslocamento.toFixed(1)}h</strong> deslocamento</span>
              <span><strong>{clienteSelecionado?.tecnicos.size}</strong> técnico(s)</span>
              <span className="text-foreground">
                <strong>
                  {(clienteSelecionado?.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </strong>
              </span>
              <span className="text-muted-foreground">
                · {format(dateFrom, "dd/MM/yyyy")} a {format(dateTo, "dd/MM/yyyy")}
              </span>
            </DialogDescription>
            {(clienteSelecionado?.tasks.some((t) => isExcessiveTask(t.horas))) && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="destructive" className="text-[10px]">
                  Horas excessivas no topo
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  Tarefas com mais de 12h foram destacadas para facilitar a conferência.
                </span>
              </div>
            )}
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <Table className="min-w-[1200px]">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Técnico</TableHead>
                  <TableHead className="text-xs">Tipo de Tarefa</TableHead>
                  <TableHead className="text-xs">Equipamento</TableHead>
                  <TableHead className="text-xs">Horário</TableHead>
                  <TableHead className="text-xs text-right">Horas</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                  <TableHead className="text-xs text-center">Auvo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clienteSelecionado?.tasks
                  .filter((t) => taskMatchesAlertFilter(t.auvo_task_id))
                  .map((t, idx) => {
                  const alerts = tasksWithAlertas.get(t.auvo_task_id) || [];
                  const pa = piorAlerta(alerts);
                  return (
                  <TableRow key={`${t.auvo_task_id}-${idx}`} className={cn("text-xs", rowAlertClass(pa))}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {(t.data_tarefa || t.data_conclusao)
                        ? format(new Date((t.data_tarefa || t.data_conclusao) + "T12:00:00"), "dd/MM/yy")
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono">#{t.auvo_task_id}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {t.emergencial && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-bold gap-0.5 border-orange-500 text-orange-700 dark:text-orange-300 bg-orange-100/60 dark:bg-orange-900/30"
                            title="Visita emergencial"
                          >
                            <Siren className="h-2.5 w-2.5" />
                            EMERG
                          </Badge>
                        )}
                        <span>{t.tecnico}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="font-medium truncate" title={t.descricao}>{t.descricao}</div>
                      {t.orientacao && (
                        <div className="text-[10px] text-muted-foreground truncate" title={t.orientacao}>
                          {t.orientacao}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate" title={t.equipamento}>{t.equipamento || "—"}</div>
                      {t.equipamento_id_serie && (
                        <div className="text-[10px] text-muted-foreground font-mono">{t.equipamento_id_serie}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {t.hora_inicio && t.hora_fim ? `${t.hora_inicio}–${t.hora_fim}` : (t.hora_inicio || "—")}
                    </TableCell>
                    <TableCell className={cn("text-right font-medium", (pa === "excessivo" || pa === "negativo" || pa === "overlap" || pa === "sem_janela") && "text-destructive")}>
                      <div className="flex items-center justify-end gap-1.5">
                        {alerts.filter(Boolean).map((a) => (
                          <span
                            key={a as string}
                            title={alertaTooltip(a, t)}
                            className="inline-flex"
                          >
                            {alertaIcone(a)}
                          </span>
                        ))}
                        <span>{t.horas.toFixed(2)}h</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {t.valor > 0 ? t.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {t.auvo_task_url && (
                          <a
                            href={t.auvo_task_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir tarefa no Auvo"
                            className="text-primary hover:underline inline-flex items-center gap-1 text-[11px] font-medium"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Relatório
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Modal: Caixa de Revisão (Em Revisão) */}
      <ReviewBoxDialog
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        kind="em_revisao"
        tasks={osEmRevisao}
        tasksWithAlertas={tasksWithAlertas}
        syncingTaskId={syncingTaskId}
        onApprove={(t, j) => persistRevisao(t, "aprovada", j)}
        onAdjust={(t, j, h) => persistRevisao(t, "ajustada", j, h)}
        onReject={(t, j) => persistRevisao(t, "rejeitada", j)}
        onSync={sincronizarOsDoAuvo}
      />

      {/* Modal: OS Rejeitadas */}
      <ReviewBoxDialog
        open={rejectedModalOpen}
        onClose={() => setRejectedModalOpen(false)}
        kind="rejeitada"
        tasks={osRejeitadas}
        tasksWithAlertas={tasksWithAlertas}
        syncingTaskId={syncingTaskId}
        onApprove={(t, j) => persistRevisao(t, "aprovada", j)}
        onRevoke={(t) => revogarRevisao(t)}
        onSync={sincronizarOsDoAuvo}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Caixa de Revisão — modal compartilhado para "Em Revisão" e "Rejeitadas"
// ────────────────────────────────────────────────────────────────────
function ReviewBoxDialog(props: {
  open: boolean;
  onClose: () => void;
  kind: "em_revisao" | "rejeitada";
  tasks: any[];
  tasksWithAlertas: Map<string, AlertaTipo[]>;
  syncingTaskId: string | null;
  onApprove: (t: any, justificativa: string) => Promise<boolean | void>;
  onAdjust?: (t: any, justificativa: string, horas: number) => Promise<boolean | void>;
  onReject?: (t: any, justificativa: string) => Promise<boolean | void>;
  onRevoke?: (t: any) => Promise<boolean | void>;
  onSync: (t: any) => Promise<void>;
}) {
  const { open, onClose, kind, tasks, tasksWithAlertas, syncingTaskId, onApprove, onAdjust, onReject, onRevoke, onSync } = props;
  const [filterTec, setFilterTec] = useState("todos");
  const [filterCli, setFilterCli] = useState("todos");
  const [filterAlerta, setFilterAlerta] = useState<AlertaTipo>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"approve" | "adjust" | "reject" | "revoke" | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [horasAjuste, setHorasAjuste] = useState("");

  const allTec = useMemo(() => Array.from(new Set(tasks.map((t: any) => t.tecnico).filter(Boolean))).sort(), [tasks]);
  const allCli = useMemo(() => Array.from(new Set(tasks.map((t: any) => t.cliente).filter(Boolean))).sort(), [tasks]);
  const allAlertaTipos = useMemo(() => {
    const s = new Set<AlertaTipo>();
    for (const t of tasks) (tasksWithAlertas.get(t.auvo_task_id) || []).forEach((a) => a && s.add(a));
    return Array.from(s);
  }, [tasks, tasksWithAlertas]);

  const filtered = useMemo(() => tasks.filter((t: any) => {
    if (filterTec !== "todos" && t.tecnico !== filterTec) return false;
    if (filterCli !== "todos" && t.cliente !== filterCli) return false;
    if (filterAlerta) {
      const lst = tasksWithAlertas.get(t.auvo_task_id) || [];
      if (!lst.includes(filterAlerta)) return false;
    }
    return true;
  }), [tasks, filterTec, filterCli, filterAlerta, tasksWithAlertas]);

  const totalValor = useMemo(() => filtered.reduce((s: number, t: any) => s + (t.valorPotencial || 0), 0), [filtered]);

  const resetAction = () => {
    setActionTaskId(null); setActionMode(null);
    setJustificativa(""); setHorasAjuste("");
  };

  const handleConfirmAction = async (t: any) => {
    if (actionMode === "approve") await onApprove(t, justificativa);
    else if (actionMode === "adjust" && onAdjust) await onAdjust(t, justificativa, Number(horasAjuste));
    else if (actionMode === "reject" && onReject) await onReject(t, justificativa);
    else if (actionMode === "revoke" && onRevoke) await onRevoke(t);
    resetAction();
  };

  const titulo = kind === "em_revisao" ? "OS em Revisão" : "OS Rejeitadas";
  const subtitulo = kind === "em_revisao"
    ? `${filtered.length} OS pendentes — ${totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} bloqueados`
    : `${filtered.length} OS rejeitadas — ${totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} descartados`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {kind === "em_revisao" ? <AlertTriangle className="h-4 w-4 text-yellow-600" /> : <ShieldX className="h-4 w-4 text-destructive" />}
            {titulo}
          </DialogTitle>
          <DialogDescription className="text-xs">{subtitulo}</DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 items-end pb-2 border-b">
          <div>
            <Label className="text-[10px] uppercase">Técnico</Label>
            <Select value={filterTec} onValueChange={setFilterTec}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {allTec.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase">Cliente</Label>
            <Select value={filterCli} onValueChange={setFilterCli}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {allCli.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase">Alerta</Label>
            <Select value={filterAlerta || "todos"} onValueChange={(v) => setFilterAlerta(v === "todos" ? null : (v as AlertaTipo))}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {allAlertaTipos.map((a) => <SelectItem key={a as string} value={a as string}>{ALERTA_LABEL[a as Exclude<AlertaTipo, null>]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-auto -mx-6 px-6 border-t">
          <Table className="min-w-[1100px]">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="text-xs">Gravidade</TableHead>
                <TableHead className="text-xs">Alertas</TableHead>
                <TableHead className="text-xs">Cliente</TableHead>
                <TableHead className="text-xs">Técnico</TableHead>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs">ID Tarefa</TableHead>
                <TableHead className="text-xs text-right">Horas</TableHead>
                <TableHead className="text-xs text-right">Valor potencial</TableHead>
                <TableHead className="text-xs">Status atual</TableHead>
                <TableHead className="text-xs">Justificativa</TableHead>
                <TableHead className="text-xs">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground text-sm">Nenhuma OS</TableCell></TableRow>
              ) : filtered.map((t: any) => {
                const alerts = (tasksWithAlertas.get(t.auvo_task_id) || []).filter(Boolean) as Exclude<AlertaTipo, null>[];
                const pior: AlertaTipo = alerts.length
                  ? alerts.reduce((b, a) => (ALERTA_SEVERIDADE[a] > ALERTA_SEVERIDADE[b]) ? a : b, alerts[0])
                  : null;
                const isAct = actionTaskId === t.auvo_task_id;
                const rev = t.revisao;
                return (
                  <React.Fragment key={t.auvo_task_id}>
                    <TableRow className="text-xs align-top">
                      <TableCell>
                        {pior && (
                          <Badge variant={(pior === "excessivo" || pior === "negativo" || pior === "overlap" || pior === "sem_janela") ? "destructive" : "outline"} className="text-[9px]">
                            {ALERTA_LABEL[pior]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {alerts.map((a) => (
                            <Badge key={a} variant="outline" className="text-[9px]">{ALERTA_LABEL[a]}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={t.cliente}>{t.cliente}</TableCell>
                      <TableCell className="max-w-[140px] truncate" title={t.tecnico}>{t.tecnico}</TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {(t.data_tarefa || t.data_conclusao)
                          ? format(new Date((t.data_tarefa || t.data_conclusao) + "T12:00:00"), "dd/MM/yy")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => window.open(`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${t.auvo_task_id}`, "_blank")}
                          className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                          title="Abrir no Auvo"
                        >
                          #{t.auvo_task_id}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono">{(t.horasOriginais ?? t.horas).toFixed(2)}h</TableCell>
                      <TableCell className={cn("text-right font-medium", kind === "rejeitada" && "text-muted-foreground")}>
                        {(t.valorPotencial || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </TableCell>
                      <TableCell className="text-[10px]">
                        {kind === "em_revisao" && "Pendente"}
                        {kind === "rejeitada" && rev && (
                          <>
                            <div className="font-medium text-destructive">Rejeitada {rev.decidido_em ? format(new Date(rev.decidido_em), "dd/MM") : ""}</div>
                            {rev.decidido_por && <div className="text-muted-foreground">por {rev.decidido_por}</div>}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] text-[10px] truncate" title={rev?.justificativa || ""}>
                        {rev?.justificativa || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {kind === "em_revisao" && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                onClick={() => { setActionTaskId(t.auvo_task_id); setActionMode("approve"); setJustificativa(""); }}>
                                <ShieldCheck className="h-3 w-3" /> Aprovar
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-yellow-600 text-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-950"
                                onClick={() => { setActionTaskId(t.auvo_task_id); setActionMode("adjust"); setJustificativa(""); setHorasAjuste(String(t.horasOriginais ?? t.horas ?? "")); }}>
                                <Pencil className="h-3 w-3" /> Ajustar
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-destructive text-destructive hover:bg-destructive/10"
                                onClick={() => { setActionTaskId(t.auvo_task_id); setActionMode("reject"); setJustificativa(""); }}>
                                <ShieldX className="h-3 w-3" /> Rejeitar
                              </Button>
                            </>
                          )}
                          {kind === "rejeitada" && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-blue-600 text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                                onClick={() => { setActionTaskId(t.auvo_task_id); setActionMode("revoke"); setJustificativa(""); }}>
                                Revogar rejeição
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                onClick={() => { setActionTaskId(t.auvo_task_id); setActionMode("approve"); setJustificativa(""); }}>
                                <ShieldCheck className="h-3 w-3" /> Aprovar mesmo assim
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                            disabled={syncingTaskId === t.auvo_task_id}
                            onClick={() => onSync(t)}>
                            <Clock className={cn("h-3 w-3", syncingTaskId === t.auvo_task_id && "animate-spin")} /> Sincronizar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isAct && (
                      <TableRow>
                        <TableCell colSpan={11} className="bg-muted/40 p-3">
                          <div className="flex flex-col gap-2">
                            <div className="text-xs font-medium">
                              {actionMode === "approve" && "Aprovar OS — justificativa opcional"}
                              {actionMode === "adjust" && "Ajustar horas — justificativa obrigatória"}
                              {actionMode === "reject" && "Rejeitar OS — justificativa obrigatória"}
                              {actionMode === "revoke" && "Revogar rejeição — confirme"}
                            </div>
                            {actionMode === "adjust" && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Novas horas:</Label>
                                <Input type="number" step="0.01" min="0" value={horasAjuste}
                                  onChange={(e) => setHorasAjuste(e.target.value)} className="h-8 w-32 text-xs" />
                              </div>
                            )}
                            {actionMode !== "revoke" && (
                              <Textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
                                placeholder="Justificativa..." className="text-xs min-h-[60px]" />
                            )}
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7 text-xs" onClick={() => handleConfirmAction(t)}>Confirmar</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetAction}>Cancelar</Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="text-[11px] text-muted-foreground pt-2 border-t flex items-center justify-between">
          <span>Mostrando {filtered.length} de {tasks.length} OS</span>
          <span>Role para ver mais ↕</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

