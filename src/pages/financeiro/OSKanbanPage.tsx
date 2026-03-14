import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  ArrowLeft, CalendarIcon, RefreshCw, ExternalLink,
  Filter, GripVertical, Check, X, Edit2, Trash2, Plus,
  Package, FileText, ClipboardList, MapPin, ArrowUpDown, ArrowDown, ArrowUp,
  UserCog, Save, Loader2
} from "lucide-react";
import { format, startOfMonth, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";

type OSItem = {
  auvo_task_id: string;
  cliente: string;
  tecnico: string;
  tecnico_id: string | null;
  data_tarefa: string;
  status_auvo: string;
  pendencia: string | null;
  descricao: string | null;
  orientacao: string | null;
  endereco: string | null;
  auvo_task_url: string | null;
  auvo_link: string | null;
  auvo_survey_url: string | null;
  gc_os_id: string;
  gc_os_codigo: string;
  gc_os_cliente: string | null;
  gc_os_situacao: string;
  gc_os_situacao_id: string | null;
  gc_os_cor_situacao: string | null;
  gc_os_valor_total: number;
  gc_os_vendedor: string | null;
  gc_os_data: string | null;
  gc_os_link: string | null;
  gc_orcamento_id: string | null;
  gc_orcamento_codigo: string | null;
  gc_orc_situacao: string | null;
  gc_orc_cor_situacao: string | null;
  gc_orc_valor_total: number | null;
  gc_orc_vendedor: string | null;
  gc_orc_link: string | null;
  orcamento_realizado: boolean;
  os_realizada: boolean;
  check_in: boolean;
  check_out: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  duracao_decimal: number | null;
  questionario_preenchido: boolean;
  questionario_respostas: { question: string; reply: string }[] | null;
  _coluna?: string;
};

type KanbanColumn = {
  id: string;
  title: string;
  color: string;
  items: OSItem[];
};

export default function OSKanbanPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [dateRange, setDateRange] = useState({
    from: new Date(today.getFullYear(), 0, 1),
    to: today,
  });
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [columnsInitialized, setColumnsInitialized] = useState(false);
  const [filterTecnico, setFilterTecnico] = useState("todos");
  const [filterClienteSearch, setFilterClienteSearch] = useState("");
  const [selectedClientes, setSelectedClientes] = useState<Set<string>>(new Set());
  const [allClientesSelected, setAllClientesSelected] = useState(true);
  const [showClienteFilter, setShowClienteFilter] = useState(false);
  const [selectedCard, setSelectedCard] = useState<OSItem | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [osDetail, setOsDetail] = useState<any>(null);
  const [osDetailLoading, setOsDetailLoading] = useState(false);
  // Value range filter
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  // Global sort
  const [globalSort, setGlobalSort] = useState<string>("none");
  // Per-column sort
  const [columnSorts, setColumnSorts] = useState<Record<string, string>>({});
  // Edit task state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCard, setEditingCard] = useState<OSItem | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editTecnicoId, setEditTecnicoId] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Fetch Auvo users (technicians)
  const { data: auvoUsers } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-users" },
      });
      if (error) throw error;
      return (data?.data || []) as { userID: number; login: string; name: string }[];
    },
    staleTime: 1000 * 60 * 30, // 30 min cache
  });

  const openEditModal = useCallback((card: OSItem) => {
    setEditingCard(card);
    // Parse existing date
    if (card.data_tarefa) {
      try {
        const parsed = parse(card.data_tarefa, "yyyy-MM-dd", new Date());
        if (!isNaN(parsed.getTime())) setEditDate(parsed);
        else setEditDate(undefined);
      } catch { setEditDate(undefined); }
    } else {
      setEditDate(undefined);
    }
    // Try to match current technician
    const currentTecnico = auvoUsers?.find(u => u.name === card.tecnico || u.login === card.tecnico);
    setEditTecnicoId(currentTecnico ? String(currentTecnico.userID) : card.tecnico_id || "");
    setShowEditModal(true);
  }, [auvoUsers]);

  const handleEditSave = useCallback(async () => {
    if (!editingCard) return;
    setEditSaving(true);
    try {
      const patches: { op: string; path: string; value: any }[] = [];
      if (editDate) {
        patches.push({ op: "replace", path: "taskDate", value: format(editDate, "yyyy-MM-dd'T'08:00:00") });
      }
      if (editTecnicoId) {
        patches.push({ op: "replace", path: "idUserTo", value: Number(editTecnicoId) });
      }
      if (patches.length === 0) {
        toast.warning("Nenhuma alteração para salvar");
        setEditSaving(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(editingCard.auvo_task_id), patches },
      });

      if (error) throw error;
      if (data?.status && data.status >= 400) {
        throw new Error(JSON.stringify(data?.data || "Erro ao atualizar tarefa"));
      }

      toast.success("Tarefa atualizada no Auvo!");
      setShowEditModal(false);
      setEditingCard(null);
    } catch (err: any) {
      console.error("Erro ao editar tarefa Auvo:", err);
      toast.error(`Erro: ${err.message || "Falha ao atualizar"}`);
    } finally {
      setEditSaving(false);
    }
  }, [editingCard, editDate, editTecnicoId]);

  useEffect(() => {
    if (!selectedCard?.gc_os_id) {
      setOsDetail(null);
      return;
    }
    let cancelled = false;
    setOsDetailLoading(true);
    setOsDetail(null);

    supabase.functions
      .invoke("gc-proxy", {
        body: {
          endpoint: `/api/ordens_servicos/${selectedCard.gc_os_id}`,
          method: "GET",
        },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("Erro ao buscar detalhes da OS:", error);
          setOsDetailLoading(false);
          return;
        }
        const osObj = data?.data?.data ?? data?.data ?? null;
        console.log("GC OS Detail raw response:", JSON.stringify(data, null, 2));
        console.log("GC OS Detail parsed:", JSON.stringify(osObj, null, 2));
        setOsDetail(osObj);
        setOsDetailLoading(false);
      })
      .catch(() => {
        if (!cancelled) setOsDetailLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedCard?.gc_os_id]);

  const startStr = format(dateRange.from, "yyyy-MM-dd");
  const endStr = format(dateRange.to, "yyyy-MM-dd");

  // Query tarefas_central directly
  const { data: rawItems, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["os-kanban", startStr, endStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .not("gc_os_id", "is", null)
        .gte("data_tarefa", startStr)
        .lte("data_tarefa", endStr)
        .order("data_tarefa", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as OSItem[];
    },
    staleTime: 60_000,
  });

  // Filter out situations starting with "Executad" (case-insensitive)
  const items = useMemo(() => {
    if (!rawItems) return [];
    return rawItems.filter((i) => {
      const sit = (i.gc_os_situacao || "").toLowerCase();
      if (sit.startsWith("executad")) return false;
      if (sit.startsWith("imp cigam faturado total")) return false;
      return true;
    });
  }, [rawItems]);

  // Build columns from unique situations
  useMemo(() => {
    if (!items.length || columnsInitialized) return;

    const situacaoMap: Record<string, { items: OSItem[]; color: string; sitId: string }> = {};
    for (const item of items) {
      const sit = item.gc_os_situacao || "Sem situação";
      if (!situacaoMap[sit]) {
        situacaoMap[sit] = {
          items: [],
          color: item.gc_os_cor_situacao || "#6b7280",
          sitId: item.gc_os_situacao_id || "",
        };
      }
      situacaoMap[sit].items.push(item);
    }

    const cols: KanbanColumn[] = Object.entries(situacaoMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sit, data]) => ({
        id: `sit_${data.sitId || sit.replace(/\s+/g, "_")}`,
        title: sit,
        color: data.color,
        items: data.items,
      }));

    setColumns(cols);
    setColumnsInitialized(true);
  }, [items, columnsInitialized]);

  // Sync via central-sync with progress
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncStatus("Iniciando...");
    try {
      // Step 1: Start sync
      setSyncStatus("Buscando GC orçamentos e OS...");
      await new Promise((r) => setTimeout(r, 500));

      const syncPromise = supabase.functions.invoke("central-sync", {
        body: { start_date: startStr, end_date: endStr },
      });

      // Simulate progress stages while waiting
      const stages = [
        { label: "Buscando orçamentos GC...", delay: 3000 },
        { label: "Buscando OS GC...", delay: 5000 },
        { label: "Buscando tarefas Auvo...", delay: 8000 },
        { label: "Cruzando dados Auvo ↔ GC...", delay: 15000 },
        { label: "Salvando no banco...", delay: 25000 },
        { label: "Quase lá...", delay: 40000 },
      ];

      let cancelled = false;
      const progressTimers = stages.map((stage) =>
        setTimeout(() => {
          if (!cancelled) setSyncStatus(stage.label);
        }, stage.delay)
      );

      const { error } = await syncPromise;
      cancelled = true;
      progressTimers.forEach(clearTimeout);

      if (error) throw error;
      setSyncStatus("Atualizando dados...");
      toast.success("Sincronização concluída!");
      setColumnsInitialized(false);
      await refetch();
    } catch (e: any) {
      toast.error(`Erro: ${e?.message || "Falha na sincronização"}`);
    } finally {
      setIsSyncing(false);
      setSyncStatus("");
    }
  }, [startStr, endStr, refetch]);

  // Filters
  const allClientes = useMemo(() => {
    const set = new Set(items.map((i) => i.cliente || i.gc_os_cliente || "").filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  useEffect(() => {
    if (allClientes.length > 0 && selectedClientes.size === 0 && allClientesSelected) {
      setSelectedClientes(new Set(allClientes));
    }
  }, [allClientes]);

  const tecnicos = useMemo(() => {
    const set = new Set(items.map((i) => i.tecnico).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const filteredClienteOptions = useMemo(() => {
    if (!filterClienteSearch) return allClientes;
    return allClientes.filter((c) => c.toLowerCase().includes(filterClienteSearch.toLowerCase()));
  }, [allClientes, filterClienteSearch]);

  const toggleCliente = useCallback((cliente: string) => {
    setSelectedClientes((prev) => {
      const next = new Set(prev);
      if (next.has(cliente)) next.delete(cliente);
      else next.add(cliente);
      return next;
    });
    setAllClientesSelected(false);
  }, []);

  const toggleAllClientes = useCallback(() => {
    if (allClientesSelected) {
      setSelectedClientes(new Set());
      setAllClientesSelected(false);
    } else {
      setSelectedClientes(new Set(allClientes));
      setAllClientesSelected(true);
    }
  }, [allClientesSelected, allClientes]);

  // Sort helper for items
  const sortItems = useCallback((items: OSItem[], sortKey: string): OSItem[] => {
    if (sortKey === "none" || !sortKey) return items;
    const sorted = [...items];
    switch (sortKey) {
      case "valor_desc": return sorted.sort((a, b) => (Number(b.gc_os_valor_total) || 0) - (Number(a.gc_os_valor_total) || 0));
      case "valor_asc": return sorted.sort((a, b) => (Number(a.gc_os_valor_total) || 0) - (Number(b.gc_os_valor_total) || 0));
      case "data_desc": return sorted.sort((a, b) => (b.data_tarefa || "").localeCompare(a.data_tarefa || ""));
      case "data_asc": return sorted.sort((a, b) => (a.data_tarefa || "").localeCompare(b.data_tarefa || ""));
      case "cliente_freq": {
        const freq: Record<string, number> = {};
        sorted.forEach(i => { const c = i.cliente || i.gc_os_cliente || ""; freq[c] = (freq[c] || 0) + 1; });
        return sorted.sort((a, b) => (freq[b.cliente || b.gc_os_cliente || ""] || 0) - (freq[a.cliente || a.gc_os_cliente || ""] || 0));
      }
      case "cliente_az": return sorted.sort((a, b) => (a.cliente || a.gc_os_cliente || "").localeCompare(b.cliente || b.gc_os_cliente || ""));
      default: return sorted;
    }
  }, []);

  const filteredColumns = useMemo(() => {
    const minVal = valorMin ? Number(valorMin) : null;
    const maxVal = valorMax ? Number(valorMax) : null;
    return columns.map((col) => {
      let filtered = col.items.filter((item) => {
        const clientName = item.cliente || item.gc_os_cliente || "";
        if (filterTecnico !== "todos" && item.tecnico !== filterTecnico) return false;
        if (!allClientesSelected && selectedClientes.size > 0 && !selectedClientes.has(clientName)) return false;
        const val = Number(item.gc_os_valor_total) || 0;
        if (minVal !== null && val < minVal) return false;
        if (maxVal !== null && val > maxVal) return false;
        return true;
      });
      // Apply sort: column-level overrides global
      const sortKey = columnSorts[col.id] || globalSort;
      filtered = sortItems(filtered, sortKey);
      return { ...col, items: filtered };
    });
  }, [columns, filterTecnico, allClientesSelected, selectedClientes, valorMin, valorMax, globalSort, columnSorts, sortItems]);

  // Drag & drop
  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;

    if (type === "COLUMN") {
      if (source.index === destination.index) return;
      setColumns((prev) => {
        const newCols = [...prev];
        const [moved] = newCols.splice(source.index, 1);
        newCols.splice(destination.index, 0, moved);
        return newCols;
      });
      return;
    }

    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    setColumns((prev) => {
      const newCols = prev.map((c) => ({ ...c, items: [...c.items] }));
      const srcCol = newCols.find((c) => c.id === source.droppableId);
      const destCol = newCols.find((c) => c.id === destination.droppableId);
      if (!srcCol || !destCol) return prev;
      const [moved] = srcCol.items.splice(source.index, 1);
      destCol.items.splice(destination.index, 0, moved);
      return newCols;
    });
  }, []);

  // Summary
  const totalOS = items.length;
  const totalValor = items.reduce((sum, i) => sum + (Number(i.gc_os_valor_total) || 0), 0);

  const abbreviateName = (name: string, maxLen = 28) => {
    if (!name || name.length <= maxLen) return name || "—";
    const words = name.split(/\s+/);
    if (words.length <= 2) return name.substring(0, maxLen - 3) + "...";
    return `${words[0]} ... ${words[words.length - 1]}`;
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Kanban de OS por Situação</h1>
              <p className="text-sm text-muted-foreground">
                Todas as OS do GestãoClick agrupadas por situação (exceto executadas)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  {format(dateRange.from, "dd/MM/yy")} - {format(dateRange.to, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setDateRange({ from: range.from, to: range.to });
                      setColumnsInitialized(false);
                    }
                  }}
                  locale={ptBR}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing || isFetching} className="min-w-[180px]">
              <RefreshCw className={`h-4 w-4 mr-2 flex-shrink-0 ${isSyncing ? "animate-spin" : ""}`} />
              <span className="truncate">{isSyncing ? syncStatus || "Sincronizando..." : "Sincronizar"}</span>
            </Button>
          </div>
        </div>

        {/* Filters + Summary */}
        <div className="flex items-center gap-4 mt-4">
          <Select value={filterTecnico} onValueChange={setFilterTecnico}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Técnico" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os técnicos</SelectItem>
              {tecnicos.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={showClienteFilter} onOpenChange={setShowClienteFilter}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 min-w-[200px] justify-start">
                <Filter className="h-4 w-4" />
                {allClientesSelected
                  ? "Todos os clientes"
                  : `${selectedClientes.size} cliente${selectedClientes.size !== 1 ? "s" : ""}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] p-0" align="start">
              <div className="p-3 border-b">
                <Input
                  placeholder="Buscar cliente..."
                  value={filterClienteSearch}
                  onChange={(e) => setFilterClienteSearch(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="p-2 border-b">
                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-accent rounded text-sm">
                  <Checkbox checked={allClientesSelected} onCheckedChange={toggleAllClientes} />
                  <span className="font-medium">Selecionar todos</span>
                </label>
              </div>
              <ScrollArea className="h-[300px]">
                <div className="p-2 space-y-0.5">
                  {filteredClienteOptions.map((cliente) => (
                    <label key={cliente} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded text-sm">
                      <Checkbox checked={selectedClientes.has(cliente)} onCheckedChange={() => toggleCliente(cliente)} />
                      <span className="truncate">{cliente}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Value range filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                💰 Valor
                {(valorMin || valorMax) && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
                    {valorMin || "0"} - {valorMax || "∞"}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-3" align="start">
              <p className="text-sm font-medium mb-2">Faixa de valor (R$)</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Mín"
                  value={valorMin}
                  onChange={(e) => setValorMin(e.target.value)}
                  className="h-8 text-sm"
                />
                <span className="text-muted-foreground text-xs">até</span>
                <Input
                  type="number"
                  placeholder="Máx"
                  value={valorMax}
                  onChange={(e) => setValorMax(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              {(valorMin || valorMax) && (
                <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" onClick={() => { setValorMin(""); setValorMax(""); }}>
                  Limpar filtro de valor
                </Button>
              )}
            </PopoverContent>
          </Popover>

          {/* Global sort */}
          <Select value={globalSort} onValueChange={setGlobalSort}>
            <SelectTrigger className="w-[180px]">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Ordenar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem ordenação</SelectItem>
              <SelectItem value="valor_desc">Maior valor ↓</SelectItem>
              <SelectItem value="valor_asc">Menor valor ↑</SelectItem>
              <SelectItem value="data_desc">Mais recente ↓</SelectItem>
              <SelectItem value="data_asc">Mais antigo ↑</SelectItem>
              <SelectItem value="cliente_freq">Cliente + frequente</SelectItem>
              <SelectItem value="cliente_az">Cliente A-Z</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-3 ml-auto text-sm">
            <Badge variant="outline" className="gap-1">
              🔧 {totalOS} OS
            </Badge>
            <Badge variant="secondary" className="gap-1">
              💰 {formatCurrency(totalValor)}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              📊 {columns.length} situações
            </Badge>
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Carregando OS...
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {!isLoading && (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="board" type="COLUMN" direction="horizontal">
            {(boardProvided) => (
              <div
                ref={boardProvided.innerRef}
                {...boardProvided.droppableProps}
                className="flex gap-4 p-6 overflow-x-auto min-h-[calc(100vh-180px)]"
              >
                {filteredColumns.map((column, colIndex) => (
                  <Draggable key={column.id} draggableId={`col-${column.id}`} index={colIndex}>
                    {(colProvided, colSnapshot) => (
                      <div
                        ref={colProvided.innerRef}
                        {...colProvided.draggableProps}
                        className={`flex-shrink-0 w-[340px] transition-shadow ${colSnapshot.isDragging ? "shadow-xl opacity-90" : ""}`}
                      >
                        <div className="bg-muted/50 rounded-lg border h-full">
                          {/* Column Header */}
                          <div
                            {...colProvided.dragHandleProps}
                            className="flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing"
                          >
                            <div className="flex items-center gap-2">
                              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: column.color || "#6b7280" }}
                              />
                              <span className="font-semibold text-sm text-foreground truncate max-w-[220px]">
                                {column.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Select
                                value={columnSorts[column.id] || "none"}
                                onValueChange={(v) => setColumnSorts(prev => ({ ...prev, [column.id]: v }))}
                              >
                                <SelectTrigger className="h-6 w-6 p-0 border-0 bg-transparent [&>svg]:hidden">
                                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Padrão</SelectItem>
                                  <SelectItem value="valor_desc">Maior valor</SelectItem>
                                  <SelectItem value="valor_asc">Menor valor</SelectItem>
                                  <SelectItem value="data_desc">Mais recente</SelectItem>
                                  <SelectItem value="data_asc">Mais antigo</SelectItem>
                                  <SelectItem value="cliente_az">Cliente A-Z</SelectItem>
                                </SelectContent>
                              </Select>
                              <Badge variant="secondary" className="text-xs">{column.items.length}</Badge>
                            </div>
                          </div>

                          {/* Cards */}
                          <Droppable droppableId={column.id} type="CARD">
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`p-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto space-y-2 transition-colors ${
                                  snapshot.isDraggingOver ? "bg-accent/50" : ""
                                }`}
                              >
                                {column.items.map((item, index) => (
                                  <Draggable key={`${item.auvo_task_id}-${item.gc_os_id}`} draggableId={`${item.auvo_task_id}-${item.gc_os_id}`} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={`rounded-md border bg-card shadow-sm transition-shadow cursor-pointer ${
                                          snapshot.isDragging ? "shadow-lg ring-2 ring-primary/20" : "hover:shadow-md"
                                        }`}
                                        style={{
                                          ...provided.draggableProps.style,
                                          borderLeft: `4px solid ${column.color || "#6b7280"}`,
                                        }}
                                        onClick={() => setSelectedCard(item)}
                                      >
                                         <div className="px-3 py-2">
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs font-mono text-muted-foreground">
                                              OS {item.gc_os_codigo}
                                            </span>
                                            <Badge variant="outline" className="text-[10px] h-5">
                                              {item.status_auvo || "—"}
                                            </Badge>
                                          </div>
                                          <p className="text-sm font-semibold text-foreground mt-1 truncate" title={item.cliente || item.gc_os_cliente || ""}>
                                            {abbreviateName(item.cliente || item.gc_os_cliente || "")}
                                          </p>
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {item.tecnico || "—"} • {item.data_tarefa || "—"}
                                          </p>
                                          {/* Orientação preview */}
                                          {item.orientacao && (
                                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 italic">
                                              {item.orientacao.substring(0, 80)}{item.orientacao.length > 80 ? "…" : ""}
                                            </p>
                                          )}
                                          <div className="flex items-center justify-between mt-1.5">
                                            <span className="text-xs font-medium text-foreground">
                                              {formatCurrency(Number(item.gc_os_valor_total) || 0)}
                                            </span>
                                            <div className="flex items-center gap-1">
                                              {item.orcamento_realizado && (
                                                <Badge className="text-[9px] h-4 px-1 bg-emerald-600 text-white">
                                                  Orçamento
                                                </Badge>
                                              )}
                                              {item.pendencia && (
                                                <Badge variant="destructive" className="text-[9px] h-4 px-1">
                                                  Pendência
                                                </Badge>
                                              )}
                                              {item.check_in && !item.check_out && (
                                                <Badge className="text-[9px] h-4 px-1 bg-blue-500 text-white">
                                                  Em campo
                                                </Badge>
                                              )}
                                              {item.questionario_preenchido && (
                                                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                                  📋
                                                </Badge>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                            )}
                          </Droppable>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {boardProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>OS {selectedCard?.gc_os_codigo}</span>
              <Badge
                className="text-xs"
                style={{ backgroundColor: selectedCard?.gc_os_cor_situacao || undefined }}
              >
                {selectedCard?.gc_os_situacao}
              </Badge>
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Tarefa Auvo #{selectedCard?.auvo_task_id}
            </p>
          </DialogHeader>
          {selectedCard && (
            <div className="space-y-4">
              {/* Info principal */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Cliente</span>
                  <p className="font-medium">{selectedCard.cliente || selectedCard.gc_os_cliente || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Técnico / Vendedor GC</span>
                  <p className="font-medium">{selectedCard.tecnico || "—"}</p>
                  {selectedCard.gc_os_vendedor && (
                    <p className="text-xs text-muted-foreground">GC: {selectedCard.gc_os_vendedor}</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Data Tarefa</span>
                  <p className="font-medium">{selectedCard.data_tarefa || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Valor Total OS</span>
                  <p className="font-semibold text-foreground">{formatCurrency(Number(selectedCard.gc_os_valor_total) || 0)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Status Auvo</span>
                  <p className="font-medium">{selectedCard.status_auvo || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Horário (Check-in / Check-out)</span>
                  <p className="font-medium">
                    {selectedCard.check_in ? "✅" : "❌"} In
                    {selectedCard.hora_inicio ? ` ${selectedCard.hora_inicio}` : ""}
                    {" → "}
                    {selectedCard.check_out ? "✅" : "❌"} Out
                    {selectedCard.hora_fim ? ` ${selectedCard.hora_fim}` : ""}
                  </p>
                  {selectedCard.duracao_decimal != null && selectedCard.duracao_decimal > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Duração: {selectedCard.duracao_decimal.toFixed(1)}h
                    </p>
                  )}
                </div>
              </div>

              {/* Endereço */}
              {selectedCard.endereco && (
                <div className="flex items-start gap-2 bg-muted/50 rounded-md p-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{selectedCard.endereco}</p>
                </div>
              )}

              {/* Orientação / Peças da OS */}
              {selectedCard.orientacao && (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Orientação / Peças da OS</span>
                  </div>
                  <div className="p-3">
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                      {selectedCard.orientacao}
                    </pre>
                  </div>
                </div>
              )}

              {/* Produtos e Serviços da OS (do GestãoClick) */}
              {osDetailLoading && (
                <div className="border rounded-md p-4 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              )}
              {!osDetailLoading && osDetail && (() => {
                const produtos: any[] = osDetail?.produtos || [];
                const servicos: any[] = osDetail?.servicos || [];
                const hasItems = produtos.length > 0 || servicos.length > 0;

                // Financial summary from GC detail
                const valorProdutos = Number(osDetail?.valor_produtos || osDetail?.total_produtos || 0);
                const valorServicos = Number(osDetail?.valor_servicos || osDetail?.total_servicos || 0);
                const valorDesconto = Number(osDetail?.desconto || osDetail?.valor_desconto || 0);
                const valorTotal = Number(osDetail?.valor_total || selectedCard.gc_os_valor_total || 0);

                return (
                  <>
                    {/* Resumo financeiro */}
                    <div className="border rounded-md">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                        <span className="text-sm font-semibold">💰 Resumo Financeiro</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 p-3 text-sm">
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Produtos</span>
                          <p className="font-semibold">{formatCurrency(valorProdutos)}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Serviços</span>
                          <p className="font-semibold">{formatCurrency(valorServicos)}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Desconto</span>
                          <p className="font-semibold text-destructive">
                            {valorDesconto > 0 ? `-${formatCurrency(valorDesconto)}` : "—"}
                          </p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Total</span>
                          <p className="font-bold text-foreground">{formatCurrency(valorTotal)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Tabela de Produtos */}
                    {produtos.length > 0 && (
                      <div className="border rounded-md">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Produtos ({produtos.length})</span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Código</TableHead>
                              <TableHead className="text-xs">Descrição</TableHead>
                              <TableHead className="text-xs text-right">Qtd</TableHead>
                              <TableHead className="text-xs text-right">Unit.</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {produtos.map((p: any, i: number) => {
                              const qtd = Number(p.quantidade || p.qtd || 1);
                              const unitario = Number(p.valor_venda || p.valor_unitario || p.preco || p.valor || 0);
                              const total = Number(p.valor_total || p.subtotal || qtd * unitario);
                              const nome = String(p.nome_produto || p.descricao || p.nome || p.detalhes || "—");
                              const codigo = String(p.produto_id || p.codigo || p.referencia || "—");
                              return (
                                <TableRow key={i}>
                                  <TableCell className="text-xs font-mono py-1.5">
                                    {codigo}
                                  </TableCell>
                                  <TableCell className="text-xs py-1.5 max-w-[200px] truncate" title={nome}>
                                    {nome}
                                  </TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {/* Tabela de Serviços */}
                    {servicos.length > 0 && (
                      <div className="border rounded-md">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                          <ClipboardList className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Serviços ({servicos.length})</span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Código</TableHead>
                              <TableHead className="text-xs">Descrição</TableHead>
                              <TableHead className="text-xs text-right">Qtd</TableHead>
                              <TableHead className="text-xs text-right">Unit.</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {servicos.map((s: any, i: number) => {
                              const qtd = Number(s.quantidade || s.qtd || 1);
                              const unitario = Number(s.valor_venda || s.valor_unitario || s.preco || s.valor || 0);
                              const total = Number(s.valor_total || s.subtotal || qtd * unitario);
                              const nome = String(s.nome_produto || s.descricao || s.nome || s.detalhes || "—");
                              const codigo = String(s.produto_id || s.codigo || s.referencia || "—");
                              return (
                                <TableRow key={i}>
                                  <TableCell className="text-xs font-mono py-1.5">
                                    {codigo}
                                  </TableCell>
                                  <TableCell className="text-xs py-1.5 max-w-[200px] truncate" title={nome}>
                                    {nome}
                                  </TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {!hasItems && (
                      <div className="border rounded-md p-3 text-sm text-muted-foreground text-center">
                        Nenhum produto ou serviço cadastrado nesta OS
                      </div>
                    )}
                  </>
                );
              })()}

              {selectedCard.orcamento_realizado && selectedCard.gc_orcamento_codigo && (
                <div className="border rounded-md border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-300">
                    <FileText className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Orçamento #{selectedCard.gc_orcamento_codigo}
                    </span>
                    <Badge className="ml-auto text-[10px]" style={{ backgroundColor: selectedCard.gc_orc_cor_situacao || undefined }}>
                      {selectedCard.gc_orc_situacao || "—"}
                    </Badge>
                  </div>
                  <div className="p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Valor</span>
                      <p className="font-medium">{formatCurrency(Number(selectedCard.gc_orc_valor_total) || 0)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Vendedor</span>
                      <p className="font-medium">{selectedCard.gc_orc_vendedor || "—"}</p>
                    </div>
                  </div>
                  {selectedCard.gc_orc_link && (
                    <div className="px-3 pb-3">
                      <Button size="sm" variant="outline" asChild>
                        <a href={selectedCard.gc_orc_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                          <ExternalLink className="h-3.5 w-3.5" /> Ver Orçamento no GC
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Questionário */}
              {selectedCard.questionario_preenchido && selectedCard.questionario_respostas && (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Questionário Preenchido</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {(Array.isArray(selectedCard.questionario_respostas) ? selectedCard.questionario_respostas : [])
                      .filter((r) => r.reply && !r.reply.startsWith("http"))
                      .map((r, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-muted-foreground text-xs">{r.question}</span>
                          <p className="font-medium">{r.reply}</p>
                        </div>
                      ))}
                    {/* Show photos */}
                    {(() => {
                      const photos = (Array.isArray(selectedCard.questionario_respostas) ? selectedCard.questionario_respostas : [])
                        .filter((r) => r.reply && r.reply.startsWith("http"));
                      if (photos.length === 0) return null;
                      return (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">Fotos</span>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {photos.map((r, i) => (
                              <a key={i} href={r.reply} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={r.reply}
                                  alt={r.question}
                                  className="h-16 w-16 object-cover rounded border hover:ring-2 ring-primary"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Pendência */}
              {selectedCard.pendencia && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
                  <span className="text-sm font-medium text-destructive">⚠️ Pendência:</span>
                  <p className="text-sm mt-1">{selectedCard.pendencia}</p>
                </div>
              )}

              {/* Links + Edit */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="default" className="gap-1" onClick={() => { setSelectedCard(null); openEditModal(selectedCard); }}>
                  <Edit2 className="h-3.5 w-3.5" /> Editar Data/Técnico
                </Button>
                {selectedCard.gc_os_link && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.gc_os_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> OS no GestãoClick
                    </a>
                  </Button>
                )}
                {(selectedCard.auvo_task_url || selectedCard.auvo_link) && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.auvo_task_url || selectedCard.auvo_link || "#"} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> Tarefa Auvo
                    </a>
                  </Button>
                )}
                {selectedCard.auvo_survey_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.auvo_survey_url} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> Formulário
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Task Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Editar Tarefa Auvo
            </DialogTitle>
          </DialogHeader>
          {editingCard && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-md p-3 text-sm">
                <p className="font-medium">{editingCard.cliente || editingCard.gc_os_cliente || "—"}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  OS {editingCard.gc_os_codigo} • Tarefa #{editingCard.auvo_task_id}
                </p>
              </div>

              {/* Date picker */}
              <div className="space-y-2">
                <Label>Data da Tarefa</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !editDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editDate ? format(editDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editDate}
                      onSelect={setEditDate}
                      locale={ptBR}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Technician select */}
              <div className="space-y-2">
                <Label>Técnico</Label>
                <Select value={editTecnicoId} onValueChange={setEditTecnicoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar técnico" />
                  </SelectTrigger>
                  <SelectContent>
                    {auvoUsers?.map((user) => (
                      <SelectItem key={user.userID} value={String(user.userID)}>
                        {user.name || user.login}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Save */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancelar</Button>
                <Button onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
