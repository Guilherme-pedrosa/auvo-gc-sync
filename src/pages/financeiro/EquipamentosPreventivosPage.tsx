import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { addMonths, format, differenceInDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft, ExternalLink, RefreshCw, Search, AlertTriangle,
  CheckCircle2, Clock, Flame, Loader2, SlidersHorizontal,
  ArrowUpDown, Download, ListFilter, Pencil, Check, X, CalendarDays,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FileText, Users, Sparkles } from "lucide-react";
import { Plus } from "lucide-react";
import CriarTarefaAuvoDialog from "./CriarTarefaAuvoDialog";
import ImportarPlanoExcelDialog from "./ImportarPlanoExcelDialog";
import RevisarTiposIADialog from "./RevisarTiposIADialog";
import GerarPlanoPreventivasDialog from "./GerarPlanoPreventivasDialog";

// ── Types ──
type EquipmentRaw = {
  id: string;
  auvo_equipment_id: string | null;
  nome: string;
  identificador: string | null;
  cliente: string | null;
  status: string | null;
  categoria: string | null;
  descricao: string | null;
  marca: string | null;
  marca_source: string | null;
  marca_manual_override: boolean | null;
  tipo_id: string | null;
  override_horas_por_tecnico: number | null;
  override_qtd_tecnicos: number | null;
  override_periodicidade: string | null;
  proxima_data: string | null;
  periodicidade_meses_plano: number | null;
};

type EquipTaskRel = {
  auvo_equipment_id: string;
  auvo_task_id: string;
  auvo_task_url?: string | null;
  auvo_task_type_id: string | null;
  auvo_task_type_description: string | null;
  status_auvo: string | null;
  data_tarefa: string | null;
  data_conclusao: string | null;
  cliente: string | null;
  tecnico: string | null;
  auvo_link: string | null;
  source: string | null;
};

type EquipmentRow = {
  id: string;
  auvo_equipment_id: string | null;
  nome: string;
  identificador: string | null;
  cliente: string | null;
  equipStatus: string | null;
  marca: string | null;
  marca_source: string | null;
  ultima_data: string | null;
  ultimo_tecnico: string | null;
  ultimo_link: string | null;
  dias_desde: number | null;
  tipo_tarefa: string | null;
  total_tarefas: number;
  // Última intervenção de qualquer tipo (não filtrada por preventiva)
  ultima_intervencao_data: string | null;
  ultima_intervencao_tecnico: string | null;
  ultima_intervencao_link: string | null;
  ultima_intervencao_tipo: string | null;
  tipo_id: string | null;
  override_horas_por_tecnico: number | null;
  override_qtd_tecnicos: number | null;
  override_periodicidade: string | null;
  proxima_data?: string | null;
  proxima_data_calculada?: boolean;
  periodicidade_meses_plano?: number | null;
  ultima_execucao_task_id?: string | null;
};

type SyncWindow = {
  windowStart: string;
  windowEnd: string;
};

// ── Helpers ──
function normalizeClienteName(name: string | null | undefined): string {
  return (name || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
    .replace(/[.\-\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function periodicidadeToMeses(per: string | null | undefined): number {
  switch ((per || "").toUpperCase()) {
    case "MENSAL": return 1;
    case "BIMESTRAL": return 2;
    case "TRIMESTRAL": return 3;
    case "SEMESTRAL": return 6;
    case "ANUAL": return 12;
    default: return 3;
  }
}

function periodicidadeToMesesOrNull(per: string | null | undefined): number | null {
  const normalized = (per || "").toUpperCase().trim();
  if (!normalized || normalized === "FILA") return null;
  return periodicidadeToMeses(normalized);
}

function toPositiveMonthCount(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function calcularProximaPreventiva(ultimaData: string | null | undefined, meses: number | null): string | null {
  if (!ultimaData || !meses) return null;
  try {
    return format(addMonths(parseISO(ultimaData), meses), "yyyy-MM-dd");
  } catch {
    return null;
  }
}

function getStatusInfo(dias: number | null) {
  if (dias === null) return { label: "Sem registro", color: "text-muted-foreground", bg: "bg-muted", icon: Clock };
  if (dias <= 90) return { label: "Em dia", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", icon: CheckCircle2 };
  if (dias <= 120) return { label: "Atenção", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", icon: AlertTriangle };
  return { label: "Vencido", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", icon: Flame };
}

function buildMonthlySyncWindows(startDate: string, endDate: string): SyncWindow[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const months: SyncWindow[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor.getTime() <= end.getTime()) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

    months.push({
      windowStart: format(monthStart.getTime() < start.getTime() ? start : monthStart, "yyyy-MM-dd"),
      windowEnd: format(monthEnd.getTime() > end.getTime() ? end : monthEnd, "yyyy-MM-dd"),
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months.reverse();
}

const PREVENTIVA_TASK_TYPE_IDS = new Set(["180175", "180176"]);

function isPreventivaTaskType(id: string | null | undefined): id is string {
  return !!id && PREVENTIVA_TASK_TYPE_IDS.has(String(id));
}

function getPreventivaTaskTypeIds(tipoTarefaFilter: string[]): string[] {
  const selectedPreventiveTypes = tipoTarefaFilter.filter(isPreventivaTaskType);
  return selectedPreventiveTypes.length > 0
    ? selectedPreventiveTypes
    : Array.from(PREVENTIVA_TASK_TYPE_IDS);
}

function splitSyncWindowByFortnight(window: SyncWindow): SyncWindow[] {
  const start = new Date(`${window.windowStart}T00:00:00`);
  const end = new Date(`${window.windowEnd}T00:00:00`);
  const windows: SyncWindow[] = [];

  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setDate(cursor.getDate() + 5)) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 4);
    windows.push({
      windowStart: format(chunkStart, "yyyy-MM-dd"),
      windowEnd: format(chunkEnd.getTime() > end.getTime() ? end : chunkEnd, "yyyy-MM-dd"),
    });
  }

  return windows.reverse();
}

function splitSyncWindowByDay(window: SyncWindow): SyncWindow[] {
  const start = new Date(`${window.windowStart}T00:00:00`);
  const end = new Date(`${window.windowEnd}T00:00:00`);
  const windows: SyncWindow[] = [];

  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setDate(cursor.getDate() + 1)) {
    windows.push({ windowStart: format(cursor, "yyyy-MM-dd"), windowEnd: format(cursor, "yyyy-MM-dd") });
  }

  return windows.reverse();
}

// ── Data fetching ──
async function fetchRawData(): Promise<{ equipamentos: EquipmentRaw[]; relations: EquipTaskRel[] }> {
  let equipamentos: EquipmentRaw[] = [];
  let eqFrom = 0;
  const EQ_PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("equipamentos_auvo")
      .select("id, auvo_equipment_id, nome, identificador, cliente, status, categoria, descricao, marca, marca_source, marca_manual_override, tipo_id, override_horas_por_tecnico, override_qtd_tecnicos, override_periodicidade")
      .eq("status", "Ativo")
      .order("nome")
      .range(eqFrom, eqFrom + EQ_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    equipamentos.push(...(data as EquipmentRaw[]));
    if (data.length < EQ_PAGE) break;
    eqFrom += EQ_PAGE;
  }

  // Guarda defensiva: nunca incluir equipamento inativo na lista de preventivas
  equipamentos = equipamentos.filter((e) => (e.status || "").toLowerCase() === "ativo");

  let relations: EquipTaskRel[] = [];
  let relFrom = 0;
  const REL_PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("equipamento_tarefas_auvo")
      .select("auvo_equipment_id, auvo_task_id, auvo_task_type_id, auvo_task_type_description, status_auvo, data_tarefa, data_conclusao, cliente, tecnico, auvo_link, source")
      .order("data_conclusao", { ascending: false, nullsFirst: false })
      .range(relFrom, relFrom + REL_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    relations.push(...(data as EquipTaskRel[]));
    if (data.length < REL_PAGE) break;
    relFrom += REL_PAGE;
  }

  const taskIds = Array.from(new Set(relations.map((r) => r.auvo_task_id).filter(Boolean)));
  if (taskIds.length > 0) {
    const urlByTaskId = new Map<string, string>();
    for (let i = 0; i < taskIds.length; i += 500) {
      const chunk = taskIds.slice(i, i + 500);
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, auvo_task_url")
        .in("auvo_task_id", chunk);
      if (error) throw error;
      for (const row of data || []) {
        const url = String(row.auvo_task_url || "").trim();
        if (url) urlByTaskId.set(String(row.auvo_task_id), url);
      }
    }
    relations = relations.map((rel) => ({
      ...rel,
      auvo_task_url: urlByTaskId.get(String(rel.auvo_task_id)) || null,
    }));
  }

  return { equipamentos, relations };
}

async function fetchPlanoProximas(): Promise<Map<string, {
  proxima_data: string | null;
  periodicidade_meses: number | null;
  ultima_execucao_data: string | null;
  ultima_execucao_task_id: string | null;
}>> {
  const map = new Map<string, {
    proxima_data: string | null;
    periodicidade_meses: number | null;
    ultima_execucao_data: string | null;
    ultima_execucao_task_id: string | null;
  }>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("plano_preventivo_item")
      .select("equipamento_auvo_id, proxima_data, periodicidade_meses, ultima_execucao_data, ultima_execucao_task_id, ativo")
      .eq("ativo", true)
      .not("equipamento_auvo_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as any[]) {
      const key = String(row.equipamento_auvo_id);
      const prev = map.get(key);
      const shouldUseNext = !prev || (row.proxima_data && (!prev.proxima_data || row.proxima_data < prev.proxima_data));
      const shouldUseLast = !prev || (row.ultima_execucao_data && (!prev.ultima_execucao_data || row.ultima_execucao_data > prev.ultima_execucao_data));
      map.set(key, {
        proxima_data: shouldUseNext ? row.proxima_data : prev.proxima_data,
        periodicidade_meses: shouldUseNext ? row.periodicidade_meses : prev.periodicidade_meses,
        ultima_execucao_data: shouldUseLast ? row.ultima_execucao_data : prev.ultima_execucao_data,
        ultima_execucao_task_id: shouldUseLast ? row.ultima_execucao_task_id : prev.ultima_execucao_task_id,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

function getTaskDigitalLink(task: Pick<EquipTaskRel, "auvo_task_url" | "auvo_link"> | null | undefined): string | null {
  return task?.auvo_task_url || task?.auvo_link || null;
}

function buildEquipmentRows(
  equipamentos: EquipmentRaw[],
  relations: EquipTaskRel[],
  tipoTarefaFilter: string[]
): EquipmentRow[] {
  const relByEquipment = new Map<string, EquipTaskRel[]>();
  for (const rel of relations) {
    if (!relByEquipment.has(rel.auvo_equipment_id)) {
      relByEquipment.set(rel.auvo_equipment_id, []);
    }
    relByEquipment.get(rel.auvo_equipment_id)!.push(rel);
  }

  return equipamentos.map((eq) => {
    const eqId = eq.auvo_equipment_id || "";
    const allEqTasks = relByEquipment.get(eqId) || [];

    // Última intervenção: respeita o filtro de Tipo de Tarefa (qualquer tipo se vazio)
    const filterSet = new Set(tipoTarefaFilter.map(String));
    const intervTasks = filterSet.size > 0
      ? allEqTasks.filter(t => t.auvo_task_type_id && filterSet.has(String(t.auvo_task_type_id)))
      : allEqTasks;
    const allCompleted = intervTasks.filter(t =>
      t.status_auvo === "Finalizada" && (t.data_conclusao || t.data_tarefa)
    ).sort((a, b) => {
      const dateA = a.data_conclusao || a.data_tarefa || "";
      const dateB = b.data_conclusao || b.data_tarefa || "";
      return dateB.localeCompare(dateA);
    });
    const lastAnyTask = allCompleted[0] || null;
    const ultimaIntervencaoData = lastAnyTask ? (lastAnyTask.data_conclusao || lastAnyTask.data_tarefa) : null;

    // Última preventiva: estritamente os tipos de preventiva (independente do filtro)
    const taskTypeIds = Array.from(PREVENTIVA_TASK_TYPE_IDS);
    const preventiveTasks = allEqTasks.filter(t => t.auvo_task_type_id && taskTypeIds.includes(String(t.auvo_task_type_id)));

    const completedTasks = preventiveTasks.filter(t =>
      t.status_auvo === "Finalizada" && (t.data_conclusao || t.data_tarefa)
    );

    completedTasks.sort((a, b) => {
      const dateA = a.data_conclusao || a.data_tarefa || "";
      const dateB = b.data_conclusao || b.data_tarefa || "";
      return dateB.localeCompare(dateA);
    });

    const lastTask = completedTasks[0] || null;
    const ultimaData = lastTask ? (lastTask.data_conclusao || lastTask.data_tarefa) : null;
    const dias = ultimaData ? differenceInDays(new Date(), parseISO(ultimaData)) : null;

    return {
      id: eq.id,
      auvo_equipment_id: eq.auvo_equipment_id,
      nome: eq.nome,
      identificador: eq.identificador,
      cliente: eq.cliente,
      equipStatus: eq.status,
      marca: eq.marca,
      marca_source: eq.marca_source,
      ultima_data: ultimaData,
      ultimo_tecnico: lastTask?.tecnico || null,
      ultimo_link: getTaskDigitalLink(lastTask),
      dias_desde: dias,
      tipo_tarefa: lastTask?.auvo_task_type_description || null,
      total_tarefas: completedTasks.length,
      ultima_intervencao_data: ultimaIntervencaoData,
      ultima_intervencao_tecnico: lastAnyTask?.tecnico || null,
      ultima_intervencao_link: getTaskDigitalLink(lastAnyTask),
      ultima_intervencao_tipo: lastAnyTask?.auvo_task_type_description || null,
      tipo_id: eq.tipo_id,
      override_horas_por_tecnico: eq.override_horas_por_tecnico,
      override_qtd_tecnicos: eq.override_qtd_tecnicos,
      override_periodicidade: eq.override_periodicidade,
      proxima_data: null,
      proxima_data_calculada: false,
      periodicidade_meses_plano: null,
      ultima_execucao_task_id: null,
    };
  }).sort((a, b) => {
    if (a.dias_desde === null && b.dias_desde === null) return 0;
    if (a.dias_desde === null) return -1;
    if (b.dias_desde === null) return 1;
    return b.dias_desde - a.dias_desde;
  });
}

// ── Component ──
type SortField = "nome" | "cliente" | "dias" | "marca";
type SortDir = "asc" | "desc";

export default function EquipamentosPreventivosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [marcaFilter, setMarcaFilter] = useState<string[]>([]);
  const [clienteFilter, setClienteFilter] = useState<string[]>([]);
  const [tipoTarefaFilter, setTipoTarefaFilter] = useState<string[]>([]);
  const [tipoEquipFilter, setTipoEquipFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>("dias");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [editingMarcaId, setEditingMarcaId] = useState<string | null>(null);
  const [editingMarcaValue, setEditingMarcaValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [proximaMesFilter, setProximaMesFilter] = useState<string[]>([]); // [] = todos; valores: "YYYY-MM" | "atrasado" | "sem_plano"
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfScope, setPdfScope] = useState<"selecionados" | "filtrados" | "feitos" | "atrasados" | "atencao_vencido" | "sem_registro">("filtrados");
  const [criarTarefaEq, setCriarTarefaEq] = useState<EquipmentRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [revisarIaOpen, setRevisarIaOpen] = useState(false);
  const [gerarOpen, setGerarOpen] = useState(false);

  // Sync date range — defaults to last 1 month
  const defaultSyncStart = format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), "yyyy-MM-dd");
  const defaultSyncEnd = format(new Date(), "yyyy-MM-dd");
  const [syncStartDate, setSyncStartDate] = useState(defaultSyncStart);
  const [syncEndDate, setSyncEndDate] = useState(defaultSyncEnd);

  const { data: rawData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["equipamentos-preventivos-raw", "v2-only-ativos"],
    queryFn: fetchRawData,
    staleTime: 5 * 60 * 1000,
  });

  const { data: gruposData } = useQuery({
    queryKey: ["preventivos-grupos"],
    queryFn: async () => {
      const [{ data: grupos }, { data: membros }] = await Promise.all([
        supabase.from("grupos_clientes").select("id, nome").order("nome"),
        supabase.from("grupo_cliente_membros").select("grupo_id, cliente_nome"),
      ]);
      return { grupos: grupos ?? [], membros: membros ?? [] };
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: tiposEquip = [] } = useQuery({
    queryKey: ["tipos_equipamento_simple"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tipos_equipamento")
        .select("id, nome, horas_por_tecnico, qtd_tecnicos, periodicidade")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data as Array<{ id: string; nome: string; horas_por_tecnico: number; qtd_tecnicos: number; periodicidade: string }>;
    },
    staleTime: 30 * 1000,
  });

  const { data: planoProximas } = useQuery({
    queryKey: ["plano-proximas-by-eq"],
    queryFn: fetchPlanoProximas,
    staleTime: 5 * 60 * 1000,
  });

  const tipoById = useMemo(() => {
    const m = new Map<string, typeof tiposEquip[number]>();
    for (const t of tiposEquip) m.set(t.id, t);
    return m;
  }, [tiposEquip]);

  const handleSavePlano = useCallback(async (eqId: string, patch: {
    tipo_id?: string | null;
    override_horas_por_tecnico?: number | null;
    override_qtd_tecnicos?: number | null;
    override_periodicidade?: string | null;
  }) => {
    // Optimistic update: patch only the edited equipment in the cache
    // (the raw query loads thousands of rows, so invalidate-and-refetch is slow).
    const queryKey = ["equipamentos-preventivos-raw", "v2-only-ativos"];
    const prev = queryClient.getQueryData<any>(queryKey);
    if (prev?.equipamentos) {
      queryClient.setQueryData(queryKey, {
        ...prev,
        equipamentos: prev.equipamentos.map((e: any) =>
          e.id === eqId ? { ...e, ...patch } : e
        ),
      });
    }
    const { error } = await (supabase as any)
      .from("equipamentos_auvo")
      .update(patch)
      .eq("id", eqId);
    if (error) {
      // Roll back on failure
      if (prev) queryClient.setQueryData(queryKey, prev);
      toast.error("Erro ao salvar plano: " + error.message);
    } else {
      toast.success("Plano atualizado");
    }
  }, [queryClient]);

  // ── Edição em massa do tipo de equipamento ──
  const [bulkTipoOpen, setBulkTipoOpen] = useState(false);
  const [bulkTipoValue, setBulkTipoValue] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const handleBulkSaveTipo = useCallback(async (tipoId: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkSaving(true);

    const queryKey = ["equipamentos-preventivos-raw", "v2-only-ativos"];
    const prev = queryClient.getQueryData<any>(queryKey);
    if (prev?.equipamentos) {
      const idSet = new Set(ids);
      queryClient.setQueryData(queryKey, {
        ...prev,
        equipamentos: prev.equipamentos.map((e: any) =>
          idSet.has(e.id) ? { ...e, tipo_id: tipoId } : e
        ),
      });
    }

    const { error } = await (supabase as any)
      .from("equipamentos_auvo")
      .update({ tipo_id: tipoId })
      .in("id", ids);

    setBulkSaving(false);
    if (error) {
      if (prev) queryClient.setQueryData(queryKey, prev);
      toast.error("Erro ao atualizar tipo em massa: " + error.message);
      return;
    }
    toast.success(`Tipo atualizado em ${ids.length} equipamento(s)`);
    setBulkTipoOpen(false);
    setBulkTipoValue("");
    setSelectedIds(new Set());
  }, [queryClient, selectedIds]);

  const grupoClienteMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const grupos = gruposData?.grupos ?? [];
    const membros = gruposData?.membros ?? [];
    for (const g of grupos) {
      const set = new Set<string>(
        membros
          .filter((m: any) => m.grupo_id === g.id)
          .map((m: any) => normalizeClienteName(m.cliente_nome))
      );
      map.set(g.id, set);
    }
    return map;
  }, [gruposData]);

  const handleSaveProxima = useCallback(async (eq: EquipmentRow, novaData: string | null) => {
    const proximasKey = ["plano-proximas-by-eq"];
    const prevMap = queryClient.getQueryData<Map<string, any>>(proximasKey);

    if (prevMap) {
      const next = new Map(prevMap);
      const cur = next.get(eq.id) || {
        proxima_data: null,
        periodicidade_meses: null,
        ultima_execucao_data: null,
        ultima_execucao_task_id: null,
      };
      next.set(eq.id, { ...cur, proxima_data: novaData });
      queryClient.setQueryData(proximasKey, next);
    }

    try {
      const { data: updated, error: updErr } = await (supabase as any)
        .from("plano_preventivo_item")
        .update({ proxima_data: novaData })
        .eq("equipamento_auvo_id", eq.id)
        .eq("ativo", true)
        .select("id");
      if (updErr) throw updErr;

      if (!updated || updated.length === 0) {
        const clienteNorm = normalizeClienteName(eq.cliente);
        let grupoId: string | null = null;
        for (const [gid, set] of grupoClienteMap.entries()) {
          if (set.has(clienteNorm)) { grupoId = gid; break; }
        }
        if (!grupoId) {
          throw new Error("Cliente sem grupo cadastrado — adicione o cliente a um grupo antes.");
        }
        const tipo = eq.tipo_id ? tipoById.get(eq.tipo_id) : null;
        const per = eq.override_periodicidade ?? tipo?.periodicidade ?? "TRIMESTRAL";
        const perMeses = periodicidadeToMeses(per);
        const ht = Number(eq.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? 0);
        const qtd = Number(eq.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? 1);
        const horasTotal = ht * qtd;
        const anoRef = novaData
          ? new Date(novaData).getUTCFullYear()
          : new Date().getUTCFullYear();
        const { error: insErr } = await (supabase as any)
          .from("plano_preventivo_item")
          .insert({
            grupo_id: grupoId,
            ano_referencia: anoRef,
            equipamento_nome: eq.nome,
            equipamento_auvo_id: eq.id,
            match_confianca: "manual",
            periodicidade: per,
            periodicidade_meses: perMeses,
            horas_total: horasTotal,
            meses_planejados: [],
            proxima_data: novaData,
            ativo: true,
          });
        if (insErr) throw insErr;
      }

      toast.success(novaData ? "Próxima preventiva definida" : "Próxima preventiva removida");
    } catch (e: any) {
      if (prevMap) queryClient.setQueryData(proximasKey, prevMap);
      toast.error("Erro ao salvar: " + (e?.message || String(e)));
    }
  }, [queryClient, grupoClienteMap, tipoById]);

  const tiposTarefa = useMemo(() => {
    const rels = rawData?.relations ?? [];
    if (rels.length === 0) return [];
    const map = new Map<string, string>();
    for (const r of rels) {
      if (r.auvo_task_type_id && r.auvo_task_type_description) {
        map.set(r.auvo_task_type_id, r.auvo_task_type_description);
      }
    }
    return Array.from(map.entries())
      .map(([id, desc]) => ({ id, desc }))
      .sort((a, b) => a.desc.localeCompare(b.desc));
  }, [rawData?.relations]);

  const equipments = useMemo(() => {
    if (!rawData) return [];
    const rows = buildEquipmentRows(rawData.equipamentos, rawData.relations ?? [], tipoTarefaFilter);
    const taskById = new Map<string, EquipTaskRel>();
    for (const task of rawData.relations ?? []) {
      if (task.auvo_task_id) taskById.set(String(task.auvo_task_id), task);
    }
    for (const r of rows) {
      const p = planoProximas?.get(r.id);
      if (p) {
        r.proxima_data = p.proxima_data;
        r.proxima_data_calculada = false;
        r.periodicidade_meses_plano = toPositiveMonthCount(p.periodicidade_meses);
        r.ultima_execucao_task_id = p.ultima_execucao_task_id;

        const planoLastTask = p.ultima_execucao_task_id ? taskById.get(String(p.ultima_execucao_task_id)) : null;
        if (p.ultima_execucao_data && planoLastTask && isPreventivaTaskType(planoLastTask.auvo_task_type_id)) {
          const task = planoLastTask;
          r.ultima_data = p.ultima_execucao_data;
          r.dias_desde = differenceInDays(new Date(), parseISO(p.ultima_execucao_data));
          r.ultimo_tecnico = task?.tecnico || r.ultimo_tecnico;
          r.ultimo_link = getTaskDigitalLink(task) || r.ultimo_link;
          r.tipo_tarefa = task?.auvo_task_type_description || r.tipo_tarefa || "Preventiva";
        }
      }

      const tipo = r.tipo_id ? tipoById.get(r.tipo_id) : null;
      const mesesPorPlano = periodicidadeToMesesOrNull(r.override_periodicidade ?? tipo?.periodicidade) ?? r.periodicidade_meses_plano;
      if (mesesPorPlano) r.periodicidade_meses_plano = mesesPorPlano;

      const calculada = calcularProximaPreventiva(r.ultima_data, mesesPorPlano);
      if (calculada) {
        r.proxima_data = calculada;
        r.proxima_data_calculada = true;
      }
    }
    return rows;
  }, [rawData, tipoTarefaFilter, planoProximas, tipoById]);

  // Predicate aplicado pelos filtros, permitindo excluir um filtro específico
  // (usado para opções em cascata estilo Excel: cada dropdown mostra apenas
  // valores presentes no resultado dos demais filtros)
  type FilterKey =
    | "search"
    | "status"
    | "marca"
    | "cliente"
    | "tipoEquip"
    | "grupo"
    | "proximaMes"
    | "periodo";
  const passesFilters = useCallback(
    (e: typeof equipments[number], exclude: Set<FilterKey> = new Set()) => {
      if (!exclude.has("search") && search.trim()) {
        const q = search.toLowerCase();
        const ok =
          e.nome.toLowerCase().includes(q) ||
          (e.cliente || "").toLowerCase().includes(q) ||
          (e.identificador || "").toLowerCase().includes(q) ||
          (e.ultimo_tecnico || "").toLowerCase().includes(q) ||
          (e.marca || "").toLowerCase().includes(q);
        if (!ok) return false;
      }
      if (!exclude.has("status") && statusFilter.length > 0) {
        const info = getStatusInfo(e.dias_desde);
        if (!statusFilter.includes(info.label.toLowerCase())) return false;
      }
      if (!exclude.has("marca") && marcaFilter.length > 0) {
        if (marcaFilter.includes("__sem_marca__") && !e.marca) {
          // ok
        } else if (!(e.marca && marcaFilter.includes(e.marca))) {
          return false;
        }
      }
      if (!exclude.has("cliente") && clienteFilter.length > 0) {
        if (!e.cliente || !clienteFilter.includes(e.cliente)) return false;
      }
      if (!exclude.has("tipoEquip") && tipoEquipFilter.length > 0) {
        const wantSemTipo = tipoEquipFilter.includes("__sem_tipo__");
        if (wantSemTipo && !e.tipo_id) {
          // ok
        } else if (!(e.tipo_id && tipoEquipFilter.includes(e.tipo_id))) {
          return false;
        }
      }
      if (!exclude.has("grupo") && grupoFilter !== "todos") {
        const members = grupoClienteMap.get(grupoFilter) || new Set<string>();
        if (!e.cliente || !members.has(normalizeClienteName(e.cliente))) return false;
      }
      if (!exclude.has("proximaMes") && proximaMesFilter.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const wantSemPlano = proximaMesFilter.includes("sem_plano");
        const wantAtrasado = proximaMesFilter.includes("atrasado");
        const meses = proximaMesFilter.filter((v) => v !== "sem_plano" && v !== "atrasado");
        let ok = false;
        if (wantSemPlano && !e.proxima_data) ok = true;
        if (!ok && e.proxima_data) {
          const d = e.proxima_data.slice(0, 10);
          if (wantAtrasado && d < todayStr) ok = true;
          if (!ok && meses.includes(d.slice(0, 7))) ok = true;
        }
        if (!ok) return false;
      }
      if (!exclude.has("periodo") && syncStartDate && syncEndDate) {
        if (e.ultima_data) {
          const d = e.ultima_data.slice(0, 10);
          if (!(d >= syncStartDate && d <= syncEndDate)) return false;
        }
      }
      return true;
    },
    [search, statusFilter, marcaFilter, clienteFilter, tipoEquipFilter, grupoFilter, grupoClienteMap, proximaMesFilter, syncStartDate, syncEndDate]
  );

  // Opções em cascata: para cada filtro, considera o universo já reduzido pelos OUTROS filtros
  const marcasUnicas = useMemo(() => {
    const set = new Set<string>();
    equipments.forEach((eq) => {
      if (eq.marca && passesFilters(eq, new Set(["marca"]))) set.add(eq.marca);
    });
    return Array.from(set).sort();
  }, [equipments, passesFilters]);

  const clientes = useMemo(() => {
    const s = new Set<string>();
    equipments.forEach((eq) => {
      if (eq.cliente && passesFilters(eq, new Set(["cliente"]))) s.add(eq.cliente);
    });
    return Array.from(s).sort();
  }, [equipments, passesFilters]);

  const tiposEquipDisponiveis = useMemo(() => {
    const ids = new Set<string>();
    let hasSemTipo = false;
    equipments.forEach((eq) => {
      if (!passesFilters(eq, new Set(["tipoEquip"]))) return;
      if (eq.tipo_id) ids.add(eq.tipo_id);
      else hasSemTipo = true;
    });
    return { ids, hasSemTipo };
  }, [equipments, passesFilters]);

  const gruposDisponiveis = useMemo(() => {
    const ids = new Set<string>();
    equipments.forEach((eq) => {
      if (!passesFilters(eq, new Set(["grupo"]))) return;
      if (!eq.cliente) return;
      const norm = normalizeClienteName(eq.cliente);
      for (const [gid, set] of grupoClienteMap.entries()) {
        if (set.has(norm)) ids.add(gid);
      }
    });
    return ids;
  }, [equipments, passesFilters, grupoClienteMap]);

  const statusDisponiveis = useMemo(() => {
    const set = new Set<string>();
    equipments.forEach((eq) => {
      if (!passesFilters(eq, new Set(["status"]))) return;
      set.add(getStatusInfo(eq.dias_desde).label.toLowerCase());
    });
    return set;
  }, [equipments, passesFilters]);

  const proxMesDisponiveis = useMemo(() => {
    const meses = new Set<string>();
    let hasSemPlano = false;
    let hasAtrasado = false;
    const todayStr = new Date().toISOString().slice(0, 10);
    equipments.forEach((eq) => {
      if (!passesFilters(eq, new Set(["proximaMes"]))) return;
      if (!eq.proxima_data) { hasSemPlano = true; return; }
      const d = eq.proxima_data.slice(0, 10);
      if (d < todayStr) hasAtrasado = true;
      meses.add(d.slice(0, 7));
    });
    return { meses, hasSemPlano, hasAtrasado };
  }, [equipments, passesFilters]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncProgress({ current: 0, total: 1, label: "Fase 1: Catálogo + marcas..." });
    try {
      const { data: d1, error: e1 } = await supabase.functions.invoke("equipment-sync", {
        body: { phase: "1" },
      });
      if (e1) throw e1;
      const p1 = d1?.phase1_equipment_catalog;
      toast.success(`Catálogo: ${p1?.upserted || 0} equip. | Marcas: ${p1?.brands_detected || 0} detectadas`);

      const validEquipmentIds = Array.from(new Set(
        Array.isArray(p1?.valid_equipment_ids)
          ? p1.valid_equipment_ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          : (rawData?.equipamentos ?? [])
              .map((equipment) => equipment.auvo_equipment_id)
              .filter((id): id is string => Boolean(id))
      ));

      const monthlyWindows = buildMonthlySyncWindows(syncStartDate, syncEndDate);
      const totalMonths = monthlyWindows.length;
      setSyncProgress({ current: 1, total: 2, label: `Fase 2: processando ${totalMonths} mês(es) no servidor...` });

      const windows = monthlyWindows.map((m) => ({ startDate: m.windowStart, endDate: m.windowEnd }));
      const { data: dB, error: eB } = await supabase.functions.invoke("equipment-sync", {
        body: { phase: "2-batch", windows, validEquipmentIds },
      });
      if (eB) throw eB;
      const pB = dB?.phase2_equipment_tasks;
      const totalRelUpserted = pB?.relationship_rows_upserted || 0;
      const totalWithEquipLinks = pB?.tasks_with_equipment_links || 0;
      const windowsCovered = pB?.windows_processed || 0;
      toast.success(`Vínculos: ${totalRelUpserted} relações em ${windowsCovered} janelas (${totalWithEquipLinks} tarefas com equipamento)`);
      refetch();
    } catch (err: any) {
      toast.error("Erro na sincronização: " + (err.message || "desconhecido"));
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [rawData?.equipamentos, refetch, syncStartDate, syncEndDate]);

  const handleSaveMarca = useCallback(async (eqId: string, newMarca: string) => {
    const trimmed = newMarca.trim() || null;
    const { error } = await supabase
      .from("equipamentos_auvo")
      .update({
        marca: trimmed,
        marca_source: trimmed ? "manual" : null,
        marca_manual_override: !!trimmed,
      })
      .eq("id", eqId);

    if (error) {
      toast.error("Erro ao salvar marca: " + error.message);
    } else {
      toast.success("Marca atualizada");
      queryClient.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw", "v2-only-ativos"] });
    }
    setEditingMarcaId(null);
  }, [queryClient]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "dias" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let result = equipments;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          (e.cliente || "").toLowerCase().includes(q) ||
          (e.identificador || "").toLowerCase().includes(q) ||
          (e.ultimo_tecnico || "").toLowerCase().includes(q) ||
          (e.marca || "").toLowerCase().includes(q)
      );
    }

    if (statusFilter.length > 0) {
      result = result.filter((e) => {
        const info = getStatusInfo(e.dias_desde);
        return statusFilter.includes(info.label.toLowerCase());
      });
    }

    if (marcaFilter.length > 0) {
      result = result.filter((e) => {
        if (marcaFilter.includes("__sem_marca__") && !e.marca) return true;
        return e.marca ? marcaFilter.includes(e.marca) : false;
      });
    }

    if (clienteFilter.length > 0) {
      result = result.filter((e) => e.cliente && clienteFilter.includes(e.cliente));
    }

    if (tipoEquipFilter.length > 0) {
      const wantSemTipo = tipoEquipFilter.includes("__sem_tipo__");
      result = result.filter((e) => {
        if (wantSemTipo && !e.tipo_id) return true;
        return e.tipo_id ? tipoEquipFilter.includes(e.tipo_id) : false;
      });
    }

    if (grupoFilter !== "todos") {
      const members = grupoClienteMap.get(grupoFilter) || new Set<string>();
      result = result.filter((e) => e.cliente && members.has(normalizeClienteName(e.cliente)));
    }

    // Filtro por mês(es) da próxima preventiva (plano) - multi-seleção
    if (proximaMesFilter.length > 0) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const wantSemPlano = proximaMesFilter.includes("sem_plano");
      const wantAtrasado = proximaMesFilter.includes("atrasado");
      const meses = proximaMesFilter.filter((v) => v !== "sem_plano" && v !== "atrasado");
      result = result.filter((e) => {
        if (wantSemPlano && !e.proxima_data) return true;
        if (!e.proxima_data) return false;
        const d = e.proxima_data.slice(0, 10);
        if (wantAtrasado && d < todayStr) return true;
        if (meses.includes(d.slice(0, 7))) return true;
        return false;
      });
    }

    // Filtro por período (data da última intervenção)
    if (syncStartDate && syncEndDate) {
      result = result.filter((e) => {
        // Mantém equipamentos sem registro de preventiva visíveis
        if (!e.ultima_data) return true;
        const d = e.ultima_data.slice(0, 10);
        return d >= syncStartDate && d <= syncEndDate;
      });
    }

    result = [...result].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "nome":
          return dir * a.nome.localeCompare(b.nome);
        case "cliente":
          return dir * (a.cliente || "").localeCompare(b.cliente || "");
        case "marca":
          return dir * (a.marca || "zzz").localeCompare(b.marca || "zzz");
        case "dias":
        default:
          if (a.dias_desde === null && b.dias_desde === null) return 0;
          if (a.dias_desde === null) return -dir;
          if (b.dias_desde === null) return dir;
          return dir * (a.dias_desde - b.dias_desde);
      }
    });

    return result;
  }, [equipments, search, statusFilter, marcaFilter, clienteFilter, tipoEquipFilter, grupoFilter, grupoClienteMap, sortField, sortDir, syncStartDate, syncEndDate, proximaMesFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  // Reset to page 1 when filters change
  const filterKey = `${search}|${statusFilter.join(",")}|${marcaFilter.join(",")}|${clienteFilter.join(",")}|${tipoEquipFilter.join(",")}|${grupoFilter}|${tipoTarefaFilter.join(",")}|${sortField}|${sortDir}|${syncStartDate}|${syncEndDate}|${proximaMesFilter.join(",")}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    if (currentPage !== 1) setCurrentPage(1);
  }

  const stats = useMemo(() => {
    const emDia = filtered.filter((e) => e.dias_desde !== null && e.dias_desde <= 90).length;
    const atencao = filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 90 && e.dias_desde <= 120).length;
    const vencido = filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 120).length;
    const semRegistro = filtered.filter((e) => e.dias_desde === null).length;
    return { emDia, atencao, vencido, semRegistro, total: filtered.length };
  }, [filtered]);

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => toggleSort(field)}
      className="h-auto p-0 hover:bg-transparent font-semibold"
    >
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  const handleExportCsv = () => {
    const escCsv = (v: string | number | null | undefined): string => {
      const s = String(v ?? "");
      if (s.includes('"') || s.includes(";") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    // Força o Excel a tratar como texto (evita notação científica em IDs longos)
    const escCsvText = (v: string | number | null | undefined): string => {
      const s = String(v ?? "");
      if (!s) return "";
      return `="${s.replace(/"/g, '""')}"`;
    };

    const sep = ";";
    // Mapa cliente normalizado -> nome do grupo
    const clienteGrupoNome = new Map<string, string>();
    for (const g of (gruposData?.grupos ?? []) as Array<{ id: string; nome: string }>) {
      const members = grupoClienteMap.get(g.id);
      if (!members) continue;
      for (const c of members) clienteGrupoNome.set(c, g.nome);
    }

    const headers = [
      "Status",
      "Grupo",
      "Cliente",
      "Marca",
      "Equipamento",
      "Identificador",
      "Tipo de Equipamento",
      "Periodicidade (plano)",
      "Periodicidade (meses)",
      "HT por Técnico (plano)",
      "Qtd Técnicos (plano)",
      "Última Preventiva",
      "Técnico Última Preventiva",
      "Tipo Tarefa Preventiva",
      "Dias desde última preventiva",
      "Última Intervenção (qualquer tipo)",
      "Técnico Última Intervenção",
      "Tipo Última Intervenção",
      "Próxima Preventiva",
      "Próxima Calculada?",
      "Total Tarefas",
    ];
    const lines: string[] = [headers.join(sep)];

    for (const eq of filtered) {
      const info = getStatusInfo(eq.dias_desde);
      const tipo = eq.tipo_id ? tipoById.get(eq.tipo_id) : null;
      const periodicidade = eq.override_periodicidade ?? tipo?.periodicidade ?? "";
      const periodicidadeMeses = eq.periodicidade_meses_plano ?? (periodicidade ? periodicidadeToMesesOrNull(periodicidade) : null);
      const ht = eq.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? null;
      const qtd = eq.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? null;
      const grupoNome = eq.cliente ? (clienteGrupoNome.get(normalizeClienteName(eq.cliente)) || "") : "";

      lines.push([
        escCsv(info.label),
        escCsv(grupoNome),
        escCsv(eq.cliente),
        escCsv(eq.marca || "Não identificada"),
        escCsv(eq.nome),
        escCsvText(eq.identificador),
        escCsv(tipo?.nome || "Sem tipo"),
        escCsv(periodicidade),
        periodicidadeMeses != null ? String(periodicidadeMeses) : "",
        ht != null ? String(ht) : "",
        qtd != null ? String(qtd) : "",
        eq.ultima_data ? format(parseISO(eq.ultima_data), "dd/MM/yyyy") : "",
        escCsv(eq.ultimo_tecnico),
        escCsv(eq.tipo_tarefa),
        eq.dias_desde != null ? String(eq.dias_desde) : "",
        eq.ultima_intervencao_data ? format(parseISO(eq.ultima_intervencao_data), "dd/MM/yyyy") : "",
        escCsv(eq.ultima_intervencao_tecnico),
        escCsv(eq.ultima_intervencao_tipo),
        eq.proxima_data ? format(parseISO(eq.proxima_data), "dd/MM/yyyy") : "",
        eq.proxima_data ? (eq.proxima_data_calculada ? "Sim" : "Não") : "",
        String(eq.total_tarefas ?? 0),
      ].join(sep));
    }

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipamentos-preventivos-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFilters = [
    marcaFilter.length > 0 && `Marcas: ${marcaFilter.length}`,
    clienteFilter.length > 0 && `Clientes: ${clienteFilter.length}`,
    tipoTarefaFilter.length > 0 && `Tipos tarefa: ${tipoTarefaFilter.length}`,
    tipoEquipFilter.length > 0 && `Tipos equip.: ${tipoEquipFilter.length}`,
    grupoFilter !== "todos" && `Grupo: ${(gruposData?.grupos ?? []).find((g: any) => g.id === grupoFilter)?.nome || "—"}`,
    (syncStartDate && syncEndDate) && `Período: ${format(parseISO(syncStartDate), "dd/MM/yyyy")} → ${format(parseISO(syncEndDate), "dd/MM/yyyy")}`,
    proximaMesFilter.length > 0 && `Próx. preventiva: ${
      proximaMesFilter.map((v) =>
        v === "atrasado" ? "Atrasadas"
        : v === "sem_plano" ? "Sem plano"
        : format(parseISO(`${v}-01`), "MMM/yyyy", { locale: ptBR })
      ).join(", ")
    }`,
  ].filter(Boolean);

  const handleGeneratePdf = useCallback(() => {
    // Resolve target equipment list per scope
    let target: EquipmentRow[] = [];
    let scopeLabel = "";
    switch (pdfScope) {
      case "selecionados":
        target = filtered.filter((e) => selectedIds.has(e.id));
        scopeLabel = "Apenas selecionados";
        break;
      case "atrasados":
        target = filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 120);
        scopeLabel = "Atrasados (vencidos)";
        break;
      case "atencao_vencido":
        target = filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 90);
        scopeLabel = "Atenção + Vencidos";
        break;
      case "feitos":
        target = filtered.filter((e) => e.ultima_data !== null);
        scopeLabel = "Com intervenção registrada";
        break;
      case "sem_registro":
        target = filtered.filter((e) => e.dias_desde === null);
        scopeLabel = "Sem histórico";
        break;
      case "filtrados":
      default:
        target = filtered;
        scopeLabel = "Tudo (filtrado)";
    }

    if (target.length === 0) {
      toast.error("Nenhum equipamento no escopo selecionado");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Laudo de Preventiva de Equipamentos", 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Escopo: ${scopeLabel}`, 40, 58);
    doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageW - 40, 58, { align: "right" });

    const filterLine = activeFilters.length > 0 ? `Filtros: ${activeFilters.join(" · ")}` : "Sem filtros adicionais";
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(filterLine, 40, 74, { maxWidth: pageW - 80 });
    doc.setTextColor(0);

    // Summary grouped by client
    const byCliente = new Map<string, EquipmentRow[]>();
    for (const e of target) {
      const key = e.cliente || "— Sem cliente —";
      if (!byCliente.has(key)) byCliente.set(key, []);
      byCliente.get(key)!.push(e);
    }
    const clientesOrdenados = Array.from(byCliente.keys()).sort((a, b) => a.localeCompare(b, "pt-BR"));

    let cursorY = 90;
    for (const cliente of clientesOrdenados) {
      const rows = byCliente.get(cliente)!;
      if (cursorY > pageH - 80) { doc.addPage(); cursorY = 40; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(37, 99, 235);
      doc.setTextColor(255);
      doc.rect(40, cursorY - 4, pageW - 80, 20, "F");
      doc.text(`${cliente}  —  ${rows.length} equipamento(s)`, 50, cursorY + 10);
      doc.setTextColor(0);
      doc.setFont("helvetica", "normal");
      autoTable(doc, {
        startY: cursorY + 20,
        head: [["Status", "Marca", "Equipamento", "Identificador", "Última", "Técnico", "Dias", "Tarefas"]],
        body: rows.map((e) => {
          const info = getStatusInfo(e.dias_desde);
          return [
            info.label,
            e.marca || "—",
            e.nome,
            e.identificador || "—",
            e.ultima_data ? format(parseISO(e.ultima_data), "dd/MM/yyyy") : "—",
            e.ultimo_tecnico || "—",
            e.dias_desde !== null ? `${e.dias_desde}d` : "—",
            String(e.total_tarefas),
          ];
        }),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
        columnStyles: {
          4: { textColor: [37, 99, 235], fontStyle: "bold" },
          6: { halign: "right" },
          7: { halign: "right" },
        },
        didDrawCell: (data: any) => {
          if (data.section !== "body") return;
          const e = rows[data.row.index];
          if (!e || !e.ultimo_link) return;
          if (data.column.index === 4) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: e.ultimo_link });
          }
        },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 16;
    }

    // Detail per equipment: tasks done
    const relByEq = new Map<string, EquipTaskRel[]>();
    for (const r of rawData?.relations ?? []) {
      if (!relByEq.has(r.auvo_equipment_id)) relByEq.set(r.auvo_equipment_id, []);
      relByEq.get(r.auvo_equipment_id)!.push(r);
    }

    for (const eq of target) {
      doc.addPage();
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(eq.nome, 40, 40, { maxWidth: pageW - 80 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const info = getStatusInfo(eq.dias_desde);
      doc.text(
        `Cliente: ${eq.cliente || "—"}  ·  Marca: ${eq.marca || "—"}  ·  Identificador: ${eq.identificador || "—"}  ·  Status: ${info.label}${eq.dias_desde !== null ? ` (${eq.dias_desde}d)` : ""}`,
        40, 58, { maxWidth: pageW - 80 }
      );

      let tasks = (relByEq.get(eq.auvo_equipment_id || "") || [])
        .filter((t) => t.status_auvo === "Finalizada" && (t.data_conclusao || t.data_tarefa));
      const preventiveTypeIds = getPreventivaTaskTypeIds(tipoTarefaFilter);
      tasks = tasks.filter((t) => t.auvo_task_type_id && preventiveTypeIds.includes(String(t.auvo_task_type_id)));
      tasks.sort((a, b) => {
        const da = a.data_conclusao || a.data_tarefa || "";
        const db = b.data_conclusao || b.data_tarefa || "";
        return db.localeCompare(da);
      });

      if (tasks.length === 0) {
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text("Nenhuma intervenção finalizada registrada.", 40, 90);
        doc.setTextColor(0);
        continue;
      }

      autoTable(doc, {
        startY: 78,
        head: [["Data", "Tipo de tarefa", "Técnico", "Cliente (tarefa)", "Status", "Relatório"]],
        body: tasks.map((t) => [
          (t.data_conclusao || t.data_tarefa) ? format(parseISO((t.data_conclusao || t.data_tarefa) as string), "dd/MM/yyyy") : "—",
          t.auvo_task_type_description || "—",
          t.tecnico || "—",
          t.cliente || "—",
          t.status_auvo || "—",
          getTaskDigitalLink(t) ? "Abrir relatório" : "—",
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
        columnStyles: { 0: { textColor: [37, 99, 235] }, 5: { halign: "center", textColor: [37, 99, 235], fontStyle: "bold" } },
        didDrawCell: (data: any) => {
          if (data.section !== "body") return;
          const t = tasks[data.row.index];
          const link = getTaskDigitalLink(t);
          if (!t || !link) return;
          if (data.column.index === 0 || data.column.index === 5) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: link });
          }
        },
      });
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Página ${i} de ${pages}`, pageW - 40, pageH - 20, { align: "right" });
    }

    doc.save(`laudo-preventiva-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    setPdfDialogOpen(false);
    toast.success(`Laudo gerado com ${target.length} equipamento(s)`);
  }, [pdfScope, filtered, selectedIds, rawData?.relations, tipoTarefaFilter, activeFilters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Preventiva de Equipamentos</h1>
            <p className="text-sm text-muted-foreground">
              Monitoramento do ciclo de manutenção — vínculos nativos Auvo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPdfDialogOpen(true)} disabled={equipments.length === 0}>
            <FileText className="h-4 w-4 mr-1" /> Laudo PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="h-4 w-4 mr-1 rotate-180" /> Importar plano (Excel)
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRevisarIaOpen(true)} className="border-violet-300 text-violet-700 hover:bg-violet-50">
            <Sparkles className="h-4 w-4 mr-1" /> Revisar tipos (IA)
          </Button>
          <Button variant="outline" size="sm" onClick={() => setGerarOpen(true)} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
            <Sparkles className="h-4 w-4 mr-1" /> Gerar plano de preventivas
          </Button>
          <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-3 py-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 w-[120px] text-xs font-normal justify-start" disabled={syncing}>
                  {syncStartDate ? format(parseISO(syncStartDate), "dd/MM/yyyy") : "Início"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={syncStartDate ? parseISO(syncStartDate) : undefined}
                  onSelect={(d) => d && setSyncStartDate(format(d, "yyyy-MM-dd"))}
                  initialFocus
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">→</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 w-[120px] text-xs font-normal justify-start" disabled={syncing}>
                  {syncEndDate ? format(parseISO(syncEndDate), "dd/MM/yyyy") : "Fim"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={syncEndDate ? parseISO(syncEndDate) : undefined}
                  onSelect={(d) => d && setSyncEndDate(format(d, "yyyy-MM-dd"))}
                  initialFocus
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <Button onClick={handleSync} disabled={syncing || isFetching} size="sm">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sincronizar
          </Button>
        </div>
      </div>

      {/* Sync progress bar */}
      {syncProgress && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {syncProgress.label}
            </span>
            <span className="text-muted-foreground">
              {Math.round((syncProgress.current / syncProgress.total) * 100)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.max(5, (syncProgress.current / syncProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Em dia", value: stats.emDia, color: "text-emerald-700 dark:text-emerald-400" },
          { label: "Atenção", value: stats.atencao, color: "text-amber-700 dark:text-amber-400" },
          { label: "Vencido", value: stats.vencido, color: "text-red-700 dark:text-red-400" },
          { label: "Sem histórico", value: stats.semRegistro, color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
            <div className={cn("text-2xl font-bold", s.color)}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar equipamento, cliente, marca..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <SearchableSelect
          multiple
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "em dia", label: "🟢 Em dia" },
            { value: "atenção", label: "🟡 Atenção" },
            { value: "vencido", label: "🔴 Vencido" },
            { value: "sem registro", label: "⏳ Sem histórico" },
          ].filter((o) => statusFilter.includes(o.value) || statusDisponiveis.has(o.value))}
          placeholder="Status"
          searchPlaceholder="Buscar status..."
          className="w-[150px]"
          icon={<SlidersHorizontal className="h-4 w-4" />}
        />

        <SearchableSelect
          multiple
          value={marcaFilter}
          onValueChange={setMarcaFilter}
          options={[
            ...(marcaFilter.includes("__sem_marca__") || equipments.some((e) => !e.marca && passesFilters(e, new Set(["marca"])))
              ? [{ value: "__sem_marca__", label: "⚠️ Não identificada" }]
              : []),
            ...marcasUnicas.map((m) => ({ value: m, label: m })),
            ...marcaFilter.filter((v) => v !== "__sem_marca__" && !marcasUnicas.includes(v)).map((v) => ({ value: v, label: v })),
          ]}
          placeholder="Marca"
          searchPlaceholder="Buscar marca..."
          className="w-[180px]"
        />

        <SearchableSelect
          multiple
          value={clienteFilter}
          onValueChange={setClienteFilter}
          options={Array.from(new Set([...clientes, ...clienteFilter])).sort().map((c) => ({ value: c, label: c }))}
          placeholder="Cliente"
          searchPlaceholder="Buscar cliente..."
          className="w-[200px]"
        />

        <SearchableSelect
          value={grupoFilter}
          onValueChange={setGrupoFilter}
          options={[
            { value: "todos", label: "Todos os grupos" },
            ...((gruposData?.grupos ?? [])
              .filter((g: any) => g.id === grupoFilter || gruposDisponiveis.has(g.id))
              .map((g: any) => ({ value: g.id, label: g.nome }))),
          ]}
          placeholder="Grupo"
          searchPlaceholder="Buscar grupo..."
          className="w-[200px]"
          icon={<Users className="h-4 w-4" />}
        />

        <SearchableSelect
          multiple
          value={tipoTarefaFilter}
          onValueChange={setTipoTarefaFilter}
          options={tiposTarefa.map((tt) => ({ value: tt.id, label: tt.desc }))}
          placeholder="Tipo de Tarefa"
          searchPlaceholder="Buscar tipo..."
          className="w-[220px]"
          icon={<ListFilter className="h-4 w-4" />}
        />

        <SearchableSelect
          multiple
          value={tipoEquipFilter}
          onValueChange={setTipoEquipFilter}
          options={[
            ...(tipoEquipFilter.includes("__sem_tipo__") || tiposEquipDisponiveis.hasSemTipo
              ? [{ value: "__sem_tipo__", label: "⏳ Sem tipo" }]
              : []),
            ...tiposEquip
              .filter((t) => tipoEquipFilter.includes(t.id) || tiposEquipDisponiveis.ids.has(t.id))
              .map((t) => ({ value: t.id, label: t.nome })),
          ]}
          placeholder="Tipo de Equipamento"
          searchPlaceholder="Buscar tipo..."
          className="w-[240px]"
          icon={<ListFilter className="h-4 w-4" />}
        />

        <SearchableSelect
          multiple
          value={proximaMesFilter}
          onValueChange={setProximaMesFilter}
          options={(() => {
            const now = new Date();
            const months: { value: string; label: string }[] = [];
            // 2 months back through 12 months ahead
            for (let i = -2; i <= 12; i++) {
              const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
              const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              const label = format(d, "MMM/yyyy", { locale: ptBR });
              months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
            }
            const base: { value: string; label: string }[] = [];
            if (proximaMesFilter.includes("atrasado") || proxMesDisponiveis.hasAtrasado)
              base.push({ value: "atrasado", label: "🔴 Atrasadas" });
            if (proximaMesFilter.includes("sem_plano") || proxMesDisponiveis.hasSemPlano)
              base.push({ value: "sem_plano", label: "⏳ Sem plano" });
            const mesesFiltered = months.filter(
              (m) => proximaMesFilter.includes(m.value) || proxMesDisponiveis.meses.has(m.value)
            );
            // inclui meses fora da janela padrão mas que estão presentes nos dados/seleção
            const extras = Array.from(proxMesDisponiveis.meses)
              .filter((v) => !months.some((m) => m.value === v))
              .sort()
              .map((v) => ({ value: v, label: v }));
            return [...base, ...mesesFiltered, ...extras];
          })()}
          placeholder="Próx. preventiva (mês)"
          searchPlaceholder="Buscar mês..."
          className="w-[200px]"
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </div>

      {/* Active filters banner */}
      {activeFilters.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-blue-600" />
          <span className="text-sm text-blue-800 dark:text-blue-300">
            Filtros ativos: <strong>{activeFilters.join(" · ")}</strong>
            — mostrando {filtered.length} de {equipments.length}
          </span>
          <Button variant="ghost" size="sm" onClick={() => { setMarcaFilter([]); setClienteFilter([]); setTipoTarefaFilter([]); setTipoEquipFilter([]); setStatusFilter([]); setGrupoFilter("todos"); setProximaMesFilter([]); }} className="ml-auto text-xs">
            Limpar filtros
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <Checkbox checked aria-label="Selecionados" />
          <span className="text-sm text-amber-900 dark:text-amber-200">
            <strong>{selectedIds.size}</strong> equipamento(s) selecionado(s)
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allFiltered = new Set(filtered.map((e) => e.id));
              setSelectedIds(allFiltered);
            }}
          >
            Selecionar todos ({filtered.length})
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => { setBulkTipoValue(""); setBulkTipoOpen(true); }}
          >
            <Pencil className="h-4 w-4 mr-1" /> Alterar tipo em massa
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedIds(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Dialog: alterar tipo em massa */}
      <Dialog open={bulkTipoOpen} onOpenChange={setBulkTipoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar tipo de {selectedIds.size} equipamento(s)</DialogTitle>
            <DialogDescription>
              O tipo selecionado será aplicado a todos os equipamentos marcados.
              Os valores de HT, qtd. de técnicos e periodicidade passam a vir do tipo
              (overrides individuais permanecem).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs mb-2 block">Tipo de equipamento</Label>
            <SearchableSelect
              value={bulkTipoValue}
              onValueChange={setBulkTipoValue}
              options={tiposEquip.map((t) => ({
                value: t.id,
                label: `${t.nome} · ${t.periodicidade}`,
              }))}
              placeholder="Selecione o tipo..."
              searchPlaceholder="Buscar tipo..."
              className="w-full"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTipoOpen(false)} disabled={bulkSaving}>
              Cancelar
            </Button>
            <Button
              onClick={() => handleBulkSaveTipo(bulkTipoValue)}
              disabled={!bulkTipoValue || bulkSaving}
            >
              {bulkSaving ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Aplicando...</>) : "Aplicar a todos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Carregando equipamentos...</span>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={paginatedItems.length > 0 && paginatedItems.every((e) => selectedIds.has(e.id))}
                    onCheckedChange={(v) => {
                      const next = new Set(selectedIds);
                      if (v) paginatedItems.forEach((e) => next.add(e.id));
                      else paginatedItems.forEach((e) => next.delete(e.id));
                      setSelectedIds(next);
                    }}
                    aria-label="Selecionar página"
                  />
                </TableHead>
                <TableHead className="w-10">Status</TableHead>
                <TableHead><SortButton field="marca">Marca</SortButton></TableHead>
                <TableHead><SortButton field="nome">Equipamento</SortButton></TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead><SortButton field="cliente">Cliente</SortButton></TableHead>
                <TableHead>Plano (tipo · HT · period.)</TableHead>
                <TableHead className="text-center">HT prev.</TableHead>
                <TableHead>Última Intervenção</TableHead>
                <TableHead>Última Preventiva</TableHead>
                <TableHead>Próxima Preventiva</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-right"><SortButton field="dias">Dias</SortButton></TableHead>
                <TableHead className="text-center">Tarefas</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                    Nenhum equipamento encontrado
                  </TableCell>
                </TableRow>
              ) : (
              paginatedItems.map((eq) => {
                  const info = getStatusInfo(eq.dias_desde);
                  const Icon = info.icon;
                  const isEditing = editingMarcaId === eq.id;

                  return (
                    <TableRow key={eq.id} className={cn(info.bg)}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(eq.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedIds);
                            if (v) next.add(eq.id); else next.delete(eq.id);
                            setSelectedIds(next);
                          }}
                          aria-label="Selecionar"
                        />
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger>
                            <Icon className={cn("h-5 w-5", info.color)} />
                          </TooltipTrigger>
                          <TooltipContent>{info.label}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="min-w-[120px]">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editingMarcaValue}
                              onChange={(e) => setEditingMarcaValue(e.target.value)}
                              className="h-7 text-xs w-[100px]"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveMarca(eq.id, editingMarcaValue);
                                if (e.key === "Escape") setEditingMarcaId(null);
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleSaveMarca(eq.id, editingMarcaValue)}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingMarcaId(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            {eq.marca ? (
                              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                {eq.marca}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Não identificada</span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                setEditingMarcaId(eq.id);
                                setEditingMarcaValue(eq.marca || "");
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium max-w-[280px] truncate" title={eq.nome}>
                        {eq.auvo_equipment_id ? (
                          <a
                            href={`https://app2.auvo.com.br/gerenciarEquipamentos/equipamento/${eq.auvo_equipment_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {eq.nome}
                          </a>
                        ) : eq.nome}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {eq.identificador || "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={eq.cliente || ""}>
                        {eq.cliente || "—"}
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        <PlanoCell
                          eq={eq}
                          tipos={tiposEquip}
                          tipoById={tipoById}
                          onSave={(patch) => handleSavePlano(eq.id, patch)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <HtCell
                          eq={eq}
                          tipoById={tipoById}
                          onSave={(htOverride) => handleSavePlano(eq.id, { override_horas_por_tecnico: htOverride })}
                        />
                      </TableCell>
                      <TableCell>
                        {eq.ultima_intervencao_data ? (
                          eq.ultima_intervencao_link ? (
                            <a
                              href={eq.ultima_intervencao_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium hover:underline text-foreground"
                              title={eq.ultima_intervencao_tipo || ""}
                            >
                              {format(parseISO(eq.ultima_intervencao_data), "dd/MM/yyyy", { locale: ptBR })}
                            </a>
                          ) : (
                            <span className="text-sm" title={eq.ultima_intervencao_tipo || ""}>
                              {format(parseISO(eq.ultima_intervencao_data), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {eq.ultima_intervencao_tipo && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={eq.ultima_intervencao_tipo}>
                            {eq.ultima_intervencao_tipo}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {eq.ultima_data ? (
                          eq.ultimo_link ? (
                            <a
                              href={eq.ultimo_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn("text-sm font-medium hover:underline", info.color)}
                            >
                              {format(parseISO(eq.ultima_data), "dd/MM/yyyy", { locale: ptBR })}
                            </a>
                          ) : (
                            <span className={cn("text-sm", info.color)}>
                              {format(parseISO(eq.ultima_data), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem histórico</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ProximaCell eq={eq} onSave={(d) => handleSaveProxima(eq, d)} />
                      </TableCell>
                      <TableCell className="text-sm">{eq.ultimo_tecnico || "—"}</TableCell>
                      <TableCell className="text-right">
                        {eq.dias_desde !== null ? (
                          <span className={cn("font-semibold", info.color)}>{eq.dias_desde}d</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{eq.total_tarefas}</Badge>
                      </TableCell>
                      <TableCell>
                        {eq.ultimo_link && (
                          <a href={eq.ultimo_link} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                          </a>
                        )}
                        {eq.auvo_equipment_id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 ml-1"
                                onClick={() => setCriarTarefaEq(eq)}
                              >
                                <Plus className="h-4 w-4 text-primary" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Criar tarefa no Auvo</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-xs text-muted-foreground text-right">
        Mostrando {((safeCurrentPage - 1) * PAGE_SIZE) + 1}–{Math.min(safeCurrentPage * PAGE_SIZE, filtered.length)} de {filtered.length} equipamentos
        {filtered.length < equipments.length && ` (${equipments.length} total)`}
        {" · "}Fonte: vínculo nativo Auvo
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <Button variant="outline" size="sm" disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(safeCurrentPage - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 2)
            .reduce<(number | string)[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1]) > 1) acc.push(`…${idx}`);
              acc.push(p);
              return acc;
            }, [])
            .map((p) =>
              typeof p === "string" ? (
                <span key={p} className="px-1 text-xs text-muted-foreground">…</span>
              ) : (
                <Button
                  key={p}
                  variant={p === safeCurrentPage ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0 text-xs"
                  onClick={() => setCurrentPage(p)}
                >
                  {p}
                </Button>
              )
            )}
          <Button variant="outline" size="sm" disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(safeCurrentPage + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Laudo PDF</DialogTitle>
            <DialogDescription>
              Escolha quais equipamentos incluir no laudo. Cada equipamento terá uma página com as intervenções finalizadas.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={pdfScope} onValueChange={(v) => setPdfScope(v as any)} className="space-y-2">
            {[
              { v: "selecionados", l: `Apenas selecionados (${selectedIds.size})` },
              { v: "filtrados", l: `Tudo o que está na tela (filtrado) — ${filtered.length}` },
              { v: "feitos", l: `Tudo o que foi feito (com intervenção registrada) — ${filtered.filter((e) => e.ultima_data !== null).length}` },
              { v: "atrasados", l: `Atrasados / Vencidos (>120d) — ${filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 120).length}` },
              { v: "atencao_vencido", l: `Atenção + Vencidos (>90d) — ${filtered.filter((e) => e.dias_desde !== null && e.dias_desde > 90).length}` },
              { v: "sem_registro", l: `Sem histórico — ${filtered.filter((e) => e.dias_desde === null).length}` },
            ].map((opt) => (
              <div key={opt.v} className="flex items-center gap-2">
                <RadioGroupItem value={opt.v} id={`pdf-${opt.v}`} />
                <Label htmlFor={`pdf-${opt.v}`} className="text-sm font-normal cursor-pointer">{opt.l}</Label>
              </div>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleGeneratePdf}>
              <FileText className="h-4 w-4 mr-1" /> Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {criarTarefaEq && (
        <CriarTarefaAuvoDialog
          open={!!criarTarefaEq}
          onOpenChange={(v) => { if (!v) setCriarTarefaEq(null); }}
          equipamento={{
            id: criarTarefaEq.id,
            nome: criarTarefaEq.nome,
            cliente: criarTarefaEq.cliente,
            auvo_equipment_id: criarTarefaEq.auvo_equipment_id,
            proxima_data: criarTarefaEq.proxima_data,
            htHoras: (() => {
              const tipo = criarTarefaEq.tipo_id ? tipoById.get(criarTarefaEq.tipo_id) : null;
              const h = criarTarefaEq.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? null;
              return h != null ? Number(h) : null;
            })(),
          }}
          onCreated={() => {
            // Sincronização posterior puxa a tarefa para o banco; nada a fazer agora
          }}
        />
      )}
      <ImportarPlanoExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        grupos={gruposData?.grupos ?? []}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ["preventiva-equipamentos"] });
        }}
      />
      <RevisarTiposIADialog
        open={revisarIaOpen}
        onOpenChange={setRevisarIaOpen}
        grupos={gruposData?.grupos ?? []}
        clientes={Array.from(new Set(equipments.map((e) => e.cliente).filter(Boolean))).sort()}
        selectedIds={Array.from(selectedIds)}
        onApplied={() => {
          queryClient.invalidateQueries({ queryKey: ["preventiva-equipamentos"] });
        }}
      />
      <GerarPlanoPreventivasDialog
        open={gerarOpen}
        onOpenChange={setGerarOpen}
        grupos={gruposData?.grupos ?? []}
        clientes={Array.from(new Set(equipments.map((e) => e.cliente).filter(Boolean))).sort() as string[]}
      />
    </div>
  );
}

// ── PlanoCell: edição inline do tipo + overrides de HT/qtd/periodicidade ──
const PERIODICIDADES = ["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL", "FILA"];

type PlanoCellProps = {
  eq: EquipmentRow;
  tipos: Array<{ id: string; nome: string; horas_por_tecnico: number; qtd_tecnicos: number; periodicidade: string }>;
  tipoById: Map<string, { id: string; nome: string; horas_por_tecnico: number; qtd_tecnicos: number; periodicidade: string }>;
  onSave: (patch: {
    tipo_id?: string | null;
    override_horas_por_tecnico?: number | null;
    override_qtd_tecnicos?: number | null;
    override_periodicidade?: string | null;
  }) => Promise<void> | void;
};

function PlanoCell({ eq, tipos, tipoById, onSave }: PlanoCellProps) {
  const [open, setOpen] = useState(false);
  const tipo = eq.tipo_id ? tipoById.get(eq.tipo_id) : null;
  const htResolved = eq.override_horas_por_tecnico ?? tipo?.horas_por_tecnico ?? null;
  const qtdResolved = eq.override_qtd_tecnicos ?? tipo?.qtd_tecnicos ?? null;
  const perResolved = eq.override_periodicidade ?? tipo?.periodicidade ?? null;

  const [tipoSel, setTipoSel] = useState<string>(eq.tipo_id ?? "");
  const [htStr, setHtStr] = useState<string>(htResolved != null ? String(htResolved) : "");
  const [qtdStr, setQtdStr] = useState<string>(qtdResolved != null ? String(qtdResolved) : "");
  const [perSel, setPerSel] = useState<string>(perResolved ?? "");
  const [saving, setSaving] = useState(false);

  const tipoOptions = useMemo(
    () => [
      { value: "__none__", label: "— Sem tipo —" },
      ...tipos.map((t) => ({
        value: t.id,
        label: `${t.nome} · ${Number(t.horas_por_tecnico).toFixed(2)}h × ${t.qtd_tecnicos} · ${t.periodicidade}`,
      })),
    ],
    [tipos]
  );

  const reset = () => {
    const t = eq.tipo_id ? tipoById.get(eq.tipo_id) : null;
    setTipoSel(eq.tipo_id ?? "");
    setHtStr(String(eq.override_horas_por_tecnico ?? t?.horas_por_tecnico ?? ""));
    setQtdStr(String(eq.override_qtd_tecnicos ?? t?.qtd_tecnicos ?? ""));
    setPerSel(eq.override_periodicidade ?? t?.periodicidade ?? "");
  };

  // Quando o usuário troca o Tipo, preenche os campos com os padrões do tipo (editáveis depois).
  const handleTipoChange = (newTipoId: string) => {
    setTipoSel(newTipoId);
    if (!newTipoId) {
      setHtStr(""); setQtdStr(""); setPerSel("");
      return;
    }
    const t = tipoById.get(newTipoId);
    if (t) {
      setHtStr(String(t.horas_por_tecnico ?? ""));
      setQtdStr(String(t.qtd_tecnicos ?? ""));
      setPerSel(t.periodicidade ?? "");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const t = tipoSel ? tipoById.get(tipoSel) : null;
      const htNum = htStr.trim() === "" ? null : Number(htStr);
      const qtdNum = qtdStr.trim() === "" ? null : Math.max(1, Number(qtdStr));
      // Se o valor bate com o padrão do tipo, grava null (= usa o padrão); caso contrário, vira override.
      const htOverride = t && htNum != null && Number(t.horas_por_tecnico) === htNum ? null : htNum;
      const qtdOverride = t && qtdNum != null && Number(t.qtd_tecnicos) === qtdNum ? null : qtdNum;
      const perOverride = t && perSel && t.periodicidade === perSel ? null : (perSel || null);
      await onSave({
        tipo_id: tipoSel || null,
        override_horas_por_tecnico: htOverride,
        override_qtd_tecnicos: qtdOverride,
        override_periodicidade: perOverride,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <PopoverTrigger asChild>
        <button className="w-full text-left text-xs space-y-0.5 hover:bg-muted/50 rounded px-1.5 py-1 transition-colors">
          {tipo ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{tipo.nome}</Badge>
              {eq.override_horas_por_tecnico != null && (
                <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700">override</Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground italic">Sem tipo · clique para definir</span>
          )}
          {(htResolved != null || perResolved) && (
            <div className="text-[10px] text-muted-foreground">
              {htResolved != null && <span>{Number(htResolved).toFixed(2)}h × {qtdResolved ?? 1}</span>}
              {perResolved && <span> · {perResolved}</span>}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <div>
          <Label className="text-xs">Tipo ({tipos.length} cadastrados)</Label>
          <SearchableSelect
            options={tipoOptions}
            value={tipoSel || "__none__"}
            onValueChange={(v) => handleTipoChange(v === "__none__" ? "" : v)}
            placeholder="— Selecionar tipo —"
            searchPlaceholder="Pesquisar tipo..."
            emptyText="Nenhum tipo encontrado"
            className="h-8 text-xs w-full"
          />
        </div>
        <div className="text-[10px] text-muted-foreground">
          Os campos abaixo vêm do tipo. Edite só se este equipamento for exceção (vira <strong>override</strong> automaticamente).
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Horas/téc</Label>
            <Input type="number" step="0.25" value={htStr} onChange={(e) => setHtStr(e.target.value)} className="h-8 text-xs" placeholder={tipo ? `${tipo.horas_por_tecnico}` : ""} />
          </div>
          <div>
            <Label className="text-xs">Qtd téc</Label>
            <Input type="number" min={1} value={qtdStr} onChange={(e) => setQtdStr(e.target.value)} className="h-8 text-xs" placeholder={tipo ? `${tipo.qtd_tecnicos}` : ""} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Periodicidade</Label>
          <Select value={perSel || "__none__"} onValueChange={(v) => setPerSel(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tipo ? tipo.periodicidade : "— padrão —"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs italic">— usar padrão do tipo —</SelectItem>
              {PERIODICIDADES.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── HtCell: edição inline do tempo de preventiva (horas por técnico) ──
function HtCell({
  eq,
  tipoById,
  onSave,
}: {
  eq: EquipmentRow;
  tipoById: Map<string, { id: string; nome: string; horas_por_tecnico: number; qtd_tecnicos: number; periodicidade: string }>;
  onSave: (htOverride: number | null) => Promise<void> | void;
}) {
  const tipo = eq.tipo_id ? tipoById.get(eq.tipo_id) : null;
  const tipoHt = tipo?.horas_por_tecnico != null ? Number(tipo.horas_por_tecnico) : null;
  const resolved = eq.override_horas_por_tecnico != null
    ? Number(eq.override_horas_por_tecnico)
    : tipoHt;
  const isOverride = eq.override_horas_por_tecnico != null;

  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(resolved != null ? String(resolved) : "");
  const [saving, setSaving] = useState(false);

  const reset = () => setVal(resolved != null ? String(resolved) : "");

  const fmt = (h: number | null) => {
    if (h == null || !Number.isFinite(h)) return "—";
    const mins = Math.round(h * 60);
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    if (hh > 0 && mm > 0) return `${hh}h${String(mm).padStart(2, "0")}`;
    if (hh > 0) return `${hh}h`;
    return `${mm}min`;
  };

  const save = async () => {
    const num = val.trim() === "" ? null : Number(val.replace(",", "."));
    if (num != null && (!Number.isFinite(num) || num <= 0)) {
      toast.error("Informe um valor em horas maior que zero");
      return;
    }
    // If equals tipo default, clear override
    const override = num != null && tipoHt != null && Math.abs(num - tipoHt) < 0.001 ? null : num;
    setSaving(true);
    try {
      await onSave(override);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <PopoverTrigger asChild>
        <button className="w-full hover:bg-muted/50 rounded px-1.5 py-1 transition-colors text-center">
          <span className={cn("text-xs font-medium", isOverride && "text-amber-700 dark:text-amber-400")}>
            {fmt(resolved)}
          </span>
          {isOverride && <div className="text-[9px] text-muted-foreground">manual</div>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-3" align="start">
        <div>
          <Label className="text-xs">Tempo de preventiva (horas)</Label>
          <Input
            type="number"
            step="0.25"
            min="0"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={tipoHt != null ? String(tipoHt) : "ex.: 2.5"}
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Equivalente: {fmt(val.trim() === "" ? null : Number(val.replace(",", ".")))}
            {tipoHt != null && <> · padrão do tipo: {fmt(tipoHt)}</>}
          </p>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              setSaving(true);
              try { await onSave(null); setOpen(false); } finally { setSaving(false); }
            }}
            disabled={saving || !isOverride}
            className="text-xs text-muted-foreground"
          >
            Usar padrão
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── ProximaCell: edição inline da próxima preventiva (sem precisar de histórico) ──
function ProximaCell({ eq, onSave }: { eq: EquipmentRow; onSave: (d: string | null) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(eq.proxima_data ? eq.proxima_data.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  const reset = () => setVal(eq.proxima_data ? eq.proxima_data.slice(0, 10) : "");

  const handleSave = async (novo: string | null) => {
    setSaving(true);
    try {
      await onSave(novo);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const trigger = eq.proxima_data ? (() => {
    const dt = parseISO(eq.proxima_data!);
    const diasAte = differenceInDays(dt, new Date());
    const cls = diasAte < 0
      ? "text-red-700 dark:text-red-400 font-semibold"
      : diasAte <= 30
        ? "text-amber-700 dark:text-amber-400 font-medium"
        : "text-emerald-700 dark:text-emerald-400";
    return (
      <div className="flex flex-col text-left">
        <span className={cn("text-sm", cls)}>{format(dt, "dd/MM/yyyy", { locale: ptBR })}</span>
        <span className="text-[10px] text-muted-foreground">
          {eq.proxima_data_calculada ? "calculada · " : ""}
          {diasAte < 0 ? `${Math.abs(diasAte)}d atrasada` : `em ${diasAte}d`}
          {eq.periodicidade_meses_plano ? ` · a cada ${eq.periodicidade_meses_plano}m` : ""}
        </span>
      </div>
    );
  })() : (
    <span className="text-xs text-muted-foreground italic">Definir data</span>
  );

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <PopoverTrigger asChild>
        <button className="w-full text-left hover:bg-muted/50 rounded px-1.5 py-1 transition-colors">
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div>
          <Label className="text-xs">Próxima preventiva</Label>
          <Input
            type="date"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Se ainda não houver plano para este equipamento, ele será criado automaticamente.
          </p>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSave(null)}
            disabled={saving || !eq.proxima_data}
            className="text-xs text-muted-foreground"
          >
            Limpar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={() => handleSave(val || null)} disabled={saving || !val}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
