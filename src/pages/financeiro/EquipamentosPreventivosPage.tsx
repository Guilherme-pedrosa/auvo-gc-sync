import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays, parseISO } from "date-fns";
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
import { FileText, Users } from "lucide-react";

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
  tipo_id: string | null;
  override_horas_por_tecnico: number | null;
  override_qtd_tecnicos: number | null;
  override_periodicidade: string | null;
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
    let eqTasks = relByEquipment.get(eqId) || [];

    if (tipoTarefaFilter.length > 0) {
      eqTasks = eqTasks.filter(t => t.auvo_task_type_id && tipoTarefaFilter.includes(t.auvo_task_type_id));
    }

    const completedTasks = eqTasks.filter(t =>
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
      tipo_id: eq.tipo_id,
      override_horas_por_tecnico: eq.override_horas_por_tecnico,
      override_qtd_tecnicos: eq.override_qtd_tecnicos,
      override_periodicidade: eq.override_periodicidade,
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
  const [sortField, setSortField] = useState<SortField>("dias");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [editingMarcaId, setEditingMarcaId] = useState<string | null>(null);
  const [editingMarcaValue, setEditingMarcaValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfScope, setPdfScope] = useState<"selecionados" | "filtrados" | "feitos" | "atrasados" | "atencao_vencido" | "sem_registro">("filtrados");

  // Sync date range — defaults to last 1 month
  const defaultSyncStart = format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), "yyyy-MM-dd");
  const defaultSyncEnd = format(new Date(), "yyyy-MM-dd");
  const [syncStartDate, setSyncStartDate] = useState(defaultSyncStart);
  const [syncEndDate, setSyncEndDate] = useState(defaultSyncEnd);

  const { data: rawData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["equipamentos-preventivos-raw"],
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
    staleTime: 10 * 60 * 1000,
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
    const { error } = await (supabase as any)
      .from("equipamentos_auvo")
      .update(patch)
      .eq("id", eqId);
    if (error) {
      toast.error("Erro ao salvar plano: " + error.message);
    } else {
      toast.success("Plano atualizado");
      queryClient.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw"] });
    }
  }, [queryClient]);

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
    return buildEquipmentRows(rawData.equipamentos, rawData.relations ?? [], tipoTarefaFilter);
  }, [rawData, tipoTarefaFilter]);

  const marcasUnicas = useMemo(() => {
    const set = new Set<string>();
    equipments.forEach(eq => { if (eq.marca) set.add(eq.marca); });
    return Array.from(set).sort();
  }, [equipments]);

  const clientes = useMemo(() => {
    const s = new Set(equipments.map((e) => e.cliente).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [equipments]);

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
      let totalRelUpserted = 0;
      let totalWithEquipLinks = 0;
      let windowsCovered = 0;
      let monthIndex = 0;

      for (const monthWindow of monthlyWindows) {
        monthIndex++;
        const monthLabel = monthWindow.windowStart.substring(0, 7);
        setSyncProgress({ current: monthIndex, total: totalMonths, label: `Fase 2: ${monthLabel} (${monthIndex}/${totalMonths})` });

        const { data: previewData, error: previewError } = await supabase.functions.invoke("equipment-sync", {
          body: { phase: "2-count", startDate: monthWindow.windowStart, endDate: monthWindow.windowEnd },
        });

        if (previewError) {
          console.error(`Phase 2 count error for ${monthWindow.windowStart}:`, previewError);
        }

        const monthTaskCount = previewData?.phase2_equipment_tasks?.total_tasks_in_window || 0;
        const windowsToProcess = !previewError && monthTaskCount > 150
          ? splitSyncWindowByDay(monthWindow)
          : [monthWindow];

        if (!previewError && monthTaskCount > 150 && windowsToProcess.length > 1) {
          setSyncProgress({ current: monthIndex, total: totalMonths, label: `Fase 2: ${monthLabel} — dividindo (${monthTaskCount} tarefas)` });
        }

        for (const syncWindow of windowsToProcess) {
          const { data: d2, error: e2 } = await supabase.functions.invoke("equipment-sync", {
            body: {
              phase: "2",
              startDate: syncWindow.windowStart,
              endDate: syncWindow.windowEnd,
              validEquipmentIds,
            },
          });

          if (e2) {
            console.error(`Phase 2 error for ${syncWindow.windowStart}:`, e2);
          } else {
            const p2 = d2?.phase2_equipment_tasks;
            if (d2?.should_split) {
              toast.warning(`Janela ${syncWindow.windowStart} → ${syncWindow.windowEnd} ainda está grande; será refeita em partes menores.`);
              for (const tinyWindow of splitSyncWindowByDay(syncWindow)) {
                const { data: tinyData, error: tinyError } = await supabase.functions.invoke("equipment-sync", {
                  body: { phase: "2", startDate: tinyWindow.windowStart, endDate: tinyWindow.windowEnd, validEquipmentIds },
                });
                if (tinyError) console.error(`Phase 2 tiny error for ${tinyWindow.windowStart}:`, tinyError);
                const tinyP2 = tinyData?.phase2_equipment_tasks;
                totalRelUpserted += tinyP2?.relationship_rows_upserted || 0;
                totalWithEquipLinks += tinyP2?.tasks_with_equipment_links || 0;
              }
            } else {
              totalRelUpserted += p2?.relationship_rows_upserted || 0;
              totalWithEquipLinks += p2?.tasks_with_equipment_links || 0;
            }
          }

          windowsCovered++;
        }
      }

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
      queryClient.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw"] });
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

    if (grupoFilter !== "todos") {
      const members = grupoClienteMap.get(grupoFilter) || new Set<string>();
      result = result.filter((e) => e.cliente && members.has(normalizeClienteName(e.cliente)));
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
  }, [equipments, search, statusFilter, marcaFilter, clienteFilter, grupoFilter, grupoClienteMap, sortField, sortDir, syncStartDate, syncEndDate]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  // Reset to page 1 when filters change
  const filterKey = `${search}|${statusFilter.join(",")}|${marcaFilter.join(",")}|${clienteFilter.join(",")}|${grupoFilter}|${tipoTarefaFilter.join(",")}|${sortField}|${sortDir}|${syncStartDate}|${syncEndDate}`;
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

    const sep = ";";
    const headers = ["Status", "Marca", "Equipamento", "Identificador", "Cliente", "Última Intervenção", "Técnico", "Dias desde última", "Tipo Tarefa", "Total Tarefas"];
    const lines: string[] = [headers.join(sep)];

    for (const eq of filtered) {
      const info = getStatusInfo(eq.dias_desde);
      lines.push([
        escCsv(info.label),
        escCsv(eq.marca || "Não identificada"),
        escCsv(eq.nome),
        escCsv(eq.identificador),
        escCsv(eq.cliente),
        eq.ultima_data ? format(parseISO(eq.ultima_data), "dd/MM/yyyy") : "",
        escCsv(eq.ultimo_tecnico),
        eq.dias_desde != null ? String(eq.dias_desde) : "",
        escCsv(eq.tipo_tarefa),
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
    grupoFilter !== "todos" && `Grupo: ${(gruposData?.grupos ?? []).find((g: any) => g.id === grupoFilter)?.nome || "—"}`,
    (syncStartDate && syncEndDate) && `Período: ${format(parseISO(syncStartDate), "dd/MM/yyyy")} → ${format(parseISO(syncEndDate), "dd/MM/yyyy")}`,
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
      if (tipoTarefaFilter.length > 0) {
        tasks = tasks.filter((t) => t.auvo_task_type_id && tipoTarefaFilter.includes(t.auvo_task_type_id));
      }
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
          ]}
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
            { value: "__sem_marca__", label: "⚠️ Não identificada" },
            ...marcasUnicas.map((m) => ({ value: m, label: m })),
          ]}
          placeholder="Marca"
          searchPlaceholder="Buscar marca..."
          className="w-[180px]"
        />

        <SearchableSelect
          multiple
          value={clienteFilter}
          onValueChange={setClienteFilter}
          options={clientes.map((c) => ({ value: c, label: c }))}
          placeholder="Cliente"
          searchPlaceholder="Buscar cliente..."
          className="w-[200px]"
        />

        <SearchableSelect
          value={grupoFilter}
          onValueChange={setGrupoFilter}
          options={[
            { value: "todos", label: "Todos os grupos" },
            ...((gruposData?.grupos ?? []).map((g: any) => ({ value: g.id, label: g.nome }))),
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
      </div>

      {/* Active filters banner */}
      {activeFilters.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-blue-600" />
          <span className="text-sm text-blue-800 dark:text-blue-300">
            Filtros ativos: <strong>{activeFilters.join(" · ")}</strong>
            — mostrando {filtered.length} de {equipments.length}
          </span>
          <Button variant="ghost" size="sm" onClick={() => { setMarcaFilter([]); setClienteFilter([]); setTipoTarefaFilter([]); setStatusFilter([]); setGrupoFilter("todos"); }} className="ml-auto text-xs">
            Limpar filtros
          </Button>
        </div>
      )}

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
                <TableHead>Última Intervenção</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-right"><SortButton field="dias">Dias</SortButton></TableHead>
                <TableHead className="text-center">Tarefas</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
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
    </div>
  );
}
