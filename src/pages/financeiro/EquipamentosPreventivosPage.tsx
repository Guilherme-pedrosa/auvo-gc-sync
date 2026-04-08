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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
};

type EquipTaskRel = {
  auvo_equipment_id: string;
  auvo_task_id: string;
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
};

type SyncWindow = {
  windowStart: string;
  windowEnd: string;
};

// ── Helpers ──
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
  const firstHalfEndBase = new Date(start.getFullYear(), start.getMonth(), 15);
  const secondHalfStartBase = new Date(start.getFullYear(), start.getMonth(), 16);
  const windows: SyncWindow[] = [];

  const recentStart = new Date(Math.max(start.getTime(), secondHalfStartBase.getTime()));
  if (recentStart.getTime() <= end.getTime()) {
    windows.push({
      windowStart: format(recentStart, "yyyy-MM-dd"),
      windowEnd: format(end, "yyyy-MM-dd"),
    });
  }

  const olderEnd = new Date(Math.min(end.getTime(), firstHalfEndBase.getTime()));
  if (start.getTime() <= olderEnd.getTime()) {
    windows.push({
      windowStart: format(start, "yyyy-MM-dd"),
      windowEnd: format(olderEnd, "yyyy-MM-dd"),
    });
  }

  return windows;
}

// ── Data fetching ──
async function fetchRawData(): Promise<{ equipamentos: EquipmentRaw[]; relations: EquipTaskRel[] }> {
  let equipamentos: EquipmentRaw[] = [];
  let eqFrom = 0;
  const EQ_PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("equipamentos_auvo")
      .select("id, auvo_equipment_id, nome, identificador, cliente, status, categoria, descricao, marca, marca_source, marca_manual_override")
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

  return { equipamentos, relations };
}

function buildEquipmentRows(
  equipamentos: EquipmentRaw[],
  relations: EquipTaskRel[],
  tipoTarefaFilter: string
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

    if (tipoTarefaFilter !== "todos") {
      eqTasks = eqTasks.filter(t => t.auvo_task_type_id === tipoTarefaFilter);
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
      ultimo_link: lastTask?.auvo_link || null,
      dias_desde: dias,
      tipo_tarefa: lastTask?.auvo_task_type_description || null,
      total_tarefas: completedTasks.length,
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
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [marcaFilter, setMarcaFilter] = useState<string>("todos");
  const [clienteFilter, setClienteFilter] = useState<string>("todos");
  const [tipoTarefaFilter, setTipoTarefaFilter] = useState<string>("todos");
  const [sortField, setSortField] = useState<SortField>("dias");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [editingMarcaId, setEditingMarcaId] = useState<string | null>(null);
  const [editingMarcaValue, setEditingMarcaValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;

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
    try {
      toast.info("Fase 1: Sincronizando catálogo + marcas...");
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

      let totalRelUpserted = 0;
      let totalWithEquipLinks = 0;
      let windowsCovered = 0;

      for (const monthWindow of buildMonthlySyncWindows(syncStartDate, syncEndDate)) {
        toast.info(`Fase 2: Analisando ${monthWindow.windowStart.substring(0, 7)}...`);

        const { data: previewData, error: previewError } = await supabase.functions.invoke("equipment-sync", {
          body: { phase: "2-count", startDate: monthWindow.windowStart, endDate: monthWindow.windowEnd },
        });

        if (previewError) {
          console.error(`Phase 2 count error for ${monthWindow.windowStart}:`, previewError);
        }

        const monthTaskCount = previewData?.phase2_equipment_tasks?.total_tasks_in_window || 0;
        const windowsToProcess = !previewError && monthTaskCount > 300
          ? splitSyncWindowByFortnight(monthWindow)
          : [monthWindow];

        if (!previewError && monthTaskCount > 300 && windowsToProcess.length > 1) {
          toast.info(`${monthWindow.windowStart.substring(0, 7)} excedeu 300 tarefas; dividindo em quinzenas.`);
        }

        for (const syncWindow of windowsToProcess) {
          toast.info(`Fase 2: Vínculos ${syncWindow.windowStart} → ${syncWindow.windowEnd}...`);

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
            totalRelUpserted += p2?.relationship_rows_upserted || 0;
            totalWithEquipLinks += p2?.tasks_with_equipment_links || 0;
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

    if (statusFilter !== "todos") {
      result = result.filter((e) => {
        const info = getStatusInfo(e.dias_desde);
        return info.label.toLowerCase() === statusFilter;
      });
    }

    if (marcaFilter !== "todos") {
      if (marcaFilter === "__sem_marca__") {
        result = result.filter((e) => !e.marca);
      } else {
        result = result.filter((e) => e.marca === marcaFilter);
      }
    }

    if (clienteFilter !== "todos") {
      result = result.filter((e) => e.cliente === clienteFilter);
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
  }, [equipments, search, statusFilter, marcaFilter, clienteFilter, sortField, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  // Reset to page 1 when filters change
  const filterKey = `${search}|${statusFilter}|${marcaFilter}|${clienteFilter}|${tipoTarefaFilter}|${sortField}|${sortDir}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    if (currentPage !== 1) setCurrentPage(1);
  }

  const stats = useMemo(() => {
    const emDia = equipments.filter((e) => e.dias_desde !== null && e.dias_desde <= 90).length;
    const atencao = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 90 && e.dias_desde <= 120).length;
    const vencido = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 120).length;
    const semRegistro = equipments.filter((e) => e.dias_desde === null).length;
    return { emDia, atencao, vencido, semRegistro, total: equipments.length };
  }, [equipments]);

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
    const header = "Status,Marca,Equipamento,Identificador,Cliente,Última Intervenção,Técnico,Dias,Tipo Tarefa,Total Tarefas\n";
    const rows = filtered.map((eq) => {
      const info = getStatusInfo(eq.dias_desde);
      return [
        info.label,
        `"${eq.marca || "Não identificada"}"`,
        `"${eq.nome}"`,
        eq.identificador || "",
        `"${eq.cliente || ""}"`,
        eq.ultima_data ? format(parseISO(eq.ultima_data), "dd/MM/yyyy") : "",
        `"${eq.ultimo_tecnico || ""}"`,
        eq.dias_desde ?? "",
        `"${eq.tipo_tarefa || ""}"`,
        eq.total_tarefas,
      ].join(",");
    }).join("\n");

    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipamentos-preventivos-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFilters = [
    marcaFilter !== "todos" && `Marca: ${marcaFilter === "__sem_marca__" ? "Não identificada" : marcaFilter}`,
    tipoTarefaFilter !== "todos" && `Tipo tarefa: ${tiposTarefa.find(t => t.id === tipoTarefaFilter)?.desc || tipoTarefaFilter}`,
  ].filter(Boolean);

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
          <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-3 py-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={syncStartDate}
              onChange={(e) => setSyncStartDate(e.target.value)}
              className="h-7 w-[130px] text-xs"
              disabled={syncing}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={syncEndDate}
              onChange={(e) => setSyncEndDate(e.target.value)}
              className="h-7 w-[130px] text-xs"
              disabled={syncing}
            />
          </div>
          <Button onClick={handleSync} disabled={syncing || isFetching} size="sm">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sincronizar
          </Button>
        </div>
      </div>

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

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="em dia">🟢 Em dia</SelectItem>
            <SelectItem value="atenção">🟡 Atenção</SelectItem>
            <SelectItem value="vencido">🔴 Vencido</SelectItem>
            <SelectItem value="sem registro">⏳ Sem histórico</SelectItem>
          </SelectContent>
        </Select>

        <Select value={marcaFilter} onValueChange={setMarcaFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Marca" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as marcas</SelectItem>
            <SelectItem value="__sem_marca__">⚠️ Não identificada</SelectItem>
            {marcasUnicas.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={clienteFilter} onValueChange={setClienteFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tipoTarefaFilter} onValueChange={setTipoTarefaFilter}>
          <SelectTrigger className="w-[220px]">
            <ListFilter className="h-4 w-4 mr-1" />
            <SelectValue placeholder="Tipo de Tarefa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos de tarefa</SelectItem>
            {tiposTarefa.map((tt) => (
              <SelectItem key={tt.id} value={tt.id}>{tt.desc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Active filters banner */}
      {activeFilters.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-blue-600" />
          <span className="text-sm text-blue-800 dark:text-blue-300">
            Filtros ativos: <strong>{activeFilters.join(" · ")}</strong>
            — mostrando {filtered.length} de {equipments.length}
          </span>
          <Button variant="ghost" size="sm" onClick={() => { setMarcaFilter("todos"); setTipoTarefaFilter("todos"); }} className="ml-auto text-xs">
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
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
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
                          <span className={cn("text-sm", info.color)}>
                            {format(parseISO(eq.ultima_data), "dd/MM/yyyy", { locale: ptBR })}
                          </span>
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
    </div>
  );
}
