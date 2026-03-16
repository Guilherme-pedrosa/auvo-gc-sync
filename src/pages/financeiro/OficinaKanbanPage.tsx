import { useState, useCallback, useMemo } from "react";
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
import {
  ArrowLeft, CalendarIcon, RefreshCw, ExternalLink,
  GripVertical, Filter, Wrench, Clock, Package, AlertTriangle, Link2, Save
} from "lucide-react";
import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";

type GcDocData = {
  gc_os_id?: string;
  gc_os_codigo?: string;
  gc_orcamento_id?: string;
  gc_orcamento_codigo?: string;
  gc_cliente: string;
  gc_situacao: string;
  gc_situacao_id: string;
  gc_cor_situacao: string;
  gc_valor_total: string;
  gc_vendedor: string;
  gc_data: string;
  gc_link: string;
};

type OficinaItem = {
  auvo_task_id: string;
  auvo_link: string;
  auvo_task_url?: string;
  os_task_id?: string | null;
  os_task_link?: string | null;
  equipamento_nome: string;
  equipamento_modelo: string;
  equipamento_serie: string;
  equipments_id: number[];
  cliente: string;
  tecnico: string;
  data_tarefa: string;
  data_entrada: string;
  dias_no_galpao: number;
  status_auvo: string;
  questionario_preenchido: boolean;
  questionario_respostas: { question: string; reply: string }[];
  gc_os: GcDocData | null;
  gc_orcamento: GcDocData | null;
  devolucao_preenchida?: boolean;
  devolucao_respostas?: { question: string; reply: string }[];
};

type KanbanColumn = {
  id: string;
  title: string;
  color: string;
  items: OficinaItem[];
};

const DEFAULT_COLUMNS: { id: string; title: string; color: string }[] = [
  { id: "entrada", title: "📥 Entrada", color: "hsl(var(--muted-foreground))" },
  { id: "aguardando_os", title: "⏳ Aguardando OS", color: "#f59e0b" },
  { id: "orcamento", title: "💰 Orçamento", color: "#8b5cf6" },
  { id: "aprovado", title: "✅ Aprovado", color: "#10b981" },
  { id: "pecas_solicitadas", title: "📦 Peças Solicitadas", color: "#3b82f6" },
  { id: "em_execucao", title: "🔧 Em Execução", color: "#f97316" },
  { id: "concluido", title: "🏁 Concluído", color: "#22c55e" },
  { id: "devolvido", title: "🔄 Devolvido", color: "#06b6d4" },
];

export default function OficinaKanbanPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [dateRange, setDateRange] = useState({
    from: startOfMonth(subMonths(today, 2)),
    to: today,
  });
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [columnsInitialized, setColumnsInitialized] = useState(false);
  const [filterTecnico, setFilterTecnico] = useState("todos");
  const [filterClienteSearch, setFilterClienteSearch] = useState("");
  const [selectedClientes, setSelectedClientes] = useState<Set<string>>(new Set());
  const [allClientesSelected, setAllClientesSelected] = useState(true);
  const [showClienteFilter, setShowClienteFilter] = useState(false);
  const [selectedCard, setSelectedCard] = useState<OficinaItem | null>(null);
  const [sortBy, setSortBy] = useState<"manual" | "data" | "cliente" | "tecnico" | "dias">("manual");
  const [isSyncing, setIsSyncing] = useState(false);
  const [manualOsTaskId, setManualOsTaskId] = useState("");
  const [manualGcOsCode, setManualGcOsCode] = useState("");
  const [manualGcOrcCode, setManualGcOrcCode] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["oficina-kanban", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("oficina-kanban", {
        body: {
          mode: "cache",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
  });

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { data: syncData, error } = await supabase.functions.invoke("oficina-kanban", {
        body: {
          mode: "sync",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      if (error) throw error;
      if (syncData?.error) {
        toast.error(syncData.error);
      } else {
        toast.success(`Sincronizado! ${syncData?.total ?? 0} equipamentos atualizados`);
      }
    } catch (e: any) {
      toast.warning("Sincronização em processamento...");
      console.warn("Erro sync oficina:", e?.message);
    } finally {
      setColumnsInitialized(false);
      await refetch();
      setTimeout(() => { setColumnsInitialized(false); refetch(); }, 5000);
      setIsSyncing(false);
    }
  }, [dateRange, refetch]);

  const handleSaveManualLink = useCallback(async () => {
    if (!selectedCard) return;
    if (!manualOsTaskId && !manualGcOsCode && !manualGcOrcCode) {
      toast.error("Preencha pelo menos um campo para vincular");
      return;
    }
    setIsSavingLink(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("oficina-kanban", {
        body: {
          mode: "save_manual_link",
          auvo_task_id: selectedCard.auvo_task_id,
          os_task_id: manualOsTaskId || null,
          gc_os_code: manualGcOsCode || null,
          gc_orc_code: manualGcOrcCode || null,
        },
      });
      if (error) throw error;
      if (result?.ok) {
        toast.success("Vínculo salvo com sucesso!");
        // Update local card data
        if (result.dados) {
          setSelectedCard(result.dados);
          setColumns(prev => prev.map(col => ({
            ...col,
            items: col.items.map(item =>
              item.auvo_task_id === selectedCard.auvo_task_id ? { ...item, ...result.dados } : item
            ),
          })));
        }
        setManualOsTaskId("");
        setManualGcOsCode("");
        setManualGcOrcCode("");
      } else {
        toast.error(result?.error || "Erro ao salvar vínculo");
      }
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || ""));
    } finally {
      setIsSavingLink(false);
    }
  }, [selectedCard, manualOsTaskId, manualGcOsCode, manualGcOrcCode]);

  const allClientes = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set((data.items as OficinaItem[]).map((i) => i.cliente).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  useMemo(() => {
    if (allClientes.length > 0 && selectedClientes.size === 0 && allClientesSelected) {
      setSelectedClientes(new Set(allClientes));
    }
  }, [allClientes]);

  // Initialize columns from data
  useMemo(() => {
    if (!data?.items || columnsInitialized) return;

    const items = data.items as (OficinaItem & { _coluna?: string; _posicao?: number })[];
    const hasSavedPositions = data.from_cache && items.some((i) => i._coluna);

    if (hasSavedPositions) {
      const colMap: Record<string, OficinaItem[]> = {};
      for (const item of items) {
        const col = item._coluna || "entrada";
        const { _coluna, _posicao, ...cleanItem } = item as any;
        if (!colMap[col]) colMap[col] = [];
        colMap[col].push(cleanItem);
      }
      // Sort by saved position
      for (const col of Object.keys(colMap)) {
        colMap[col].sort((a: any, b: any) => ((a as any)._posicao || 0) - ((b as any)._posicao || 0));
      }

      const savedCols: { id: string; title: string; order: number }[] = data.custom_columns || [];
      const savedOrderMap = new Map(savedCols.map((cc) => [cc.id, cc]));

      const orderedIds: string[] = savedCols.length > 0
        ? [...savedCols].sort((a, b) => a.order - b.order).map((cc) => cc.id)
        : DEFAULT_COLUMNS.map((c) => c.id);

      // Add any columns from data not in saved order
      for (const colId of Object.keys(colMap)) {
        if (!orderedIds.includes(colId)) orderedIds.push(colId);
      }

      // Ensure all default columns exist
      for (const dc of DEFAULT_COLUMNS) {
        if (!orderedIds.includes(dc.id)) orderedIds.push(dc.id);
      }

      const defaultMap = new Map(DEFAULT_COLUMNS.map((c) => [c.id, c]));

      const cols: KanbanColumn[] = orderedIds.map((colId) => ({
        id: colId,
        title: savedOrderMap.get(colId)?.title || defaultMap.get(colId)?.title || colId,
        color: defaultMap.get(colId)?.color || "#6b7280",
        items: colMap[colId] || [],
      }));

      setColumns(cols);
    } else {
      // Fresh: auto-assign
      const colMap: Record<string, OficinaItem[]> = {};
      for (const dc of DEFAULT_COLUMNS) colMap[dc.id] = [];

      for (const item of items) {
        const { _coluna, _posicao, ...cleanItem } = item as any;
        // Simple auto-assign based on data
        let col = "entrada";
        if (cleanItem.gc_os) {
          const sit = (cleanItem.gc_os.gc_situacao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (sit.includes("conclu") || sit.includes("finaliz") || sit.includes("entregue")) col = "concluido";
          else if (sit.includes("execu")) col = "em_execucao";
          else if (sit.includes("peca") || sit.includes("material") || sit.includes("solicit")) col = "pecas_solicitadas";
          else col = "em_execucao";
        } else if (cleanItem.gc_orcamento) {
          const orcSit = (cleanItem.gc_orcamento.gc_situacao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (orcSit.includes("aprov") && !orcSit.includes("aguardando")) col = "aprovado";
          else col = "orcamento";
        } else if (cleanItem.questionario_preenchido) {
          col = "aguardando_os";
        }
        // Return form overrides everything
        if (cleanItem.devolucao_preenchida) col = "devolvido";
        if (!colMap[col]) colMap[col] = [];
        colMap[col].push(cleanItem);
      }

      setColumns(DEFAULT_COLUMNS.map((dc) => ({
        ...dc,
        items: colMap[dc.id] || [],
      })));
    }

    setColumnsInitialized(true);
  }, [data, columnsInitialized]);

  const tecnicos = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set((data.items as OficinaItem[]).map((i) => i.tecnico).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

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

  const filteredColumns = useMemo(() => {
    const sortFn = (a: OficinaItem, b: OficinaItem) => {
      if (sortBy === "data") return (a.data_tarefa || "").localeCompare(b.data_tarefa || "");
      if (sortBy === "cliente") return (a.cliente || "").localeCompare(b.cliente || "");
      if (sortBy === "tecnico") return (a.tecnico || "").localeCompare(b.tecnico || "");
      if (sortBy === "dias") return (b.dias_no_galpao || 0) - (a.dias_no_galpao || 0);
      return 0;
    };
    return columns.map((col) => {
      const items = col.items.filter((item) => {
        if (filterTecnico !== "todos" && item.tecnico !== filterTecnico) return false;
        if (!allClientesSelected && !selectedClientes.has(item.cliente)) return false;
        return true;
      });
      return { ...col, items: sortBy === "manual" ? items : [...items].sort(sortFn) };
    });
  }, [columns, filterTecnico, allClientesSelected, selectedClientes, sortBy]);

  const savePositions = useCallback((cols: KanbanColumn[]) => {
    const positions = cols.flatMap((col) =>
      col.items.map((item, idx) => ({
        auvo_task_id: item.auvo_task_id,
        coluna: col.id,
        posicao: idx,
      }))
    );
    const allColumnsOrder = cols.map((c, idx) => ({ id: c.id, title: c.title, order: idx }));
    supabase.functions.invoke("oficina-kanban", {
      body: { mode: "save_positions", positions, custom_columns: allColumnsOrder },
    }).catch((e) => console.warn("Erro ao salvar posições oficina:", e));
  }, []);

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;

    if (type === "COLUMN") {
      if (source.index === destination.index) return;
      setColumns((prev) => {
        const newCols = [...prev];
        const [moved] = newCols.splice(source.index, 1);
        newCols.splice(destination.index, 0, moved);
        savePositions(newCols);
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
      savePositions(newCols);
      return newCols;
    });
  }, [savePositions]);

  const abbreviateName = (name: string, maxLen = 28) => {
    if (name.length <= maxLen) return name;
    const words = name.split(/\s+/);
    if (words.length <= 2) return name.substring(0, maxLen - 3) + "...";
    return `${words[0]} ... ${words[words.length - 1]}`;
  };

  const totalItems = columns.reduce((sum, col) => sum + col.items.length, 0);
  const totByCol = columns.reduce<Record<string, number>>((acc, col) => {
    acc[col.id] = col.items.length;
    return acc;
  }, {});

  const getDiasColor = (dias: number) => {
    if (dias <= 7) return "text-emerald-600";
    if (dias <= 15) return "text-amber-600";
    if (dias <= 30) return "text-orange-600";
    return "text-destructive font-bold";
  };

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
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Kanban de Oficina
              </h1>
              <p className="text-sm text-muted-foreground">
                Controle de equipamentos em reparo no galpão
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {format(dateRange.from, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.from}
                    onSelect={(d) => d && setDateRange((prev) => ({ ...prev, from: d }))}
                    locale={ptBR}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">→</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {format(dateRange.to, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.to}
                    onSelect={(d) => {
                      if (d) { setDateRange((prev) => ({ ...prev, to: d })); setColumnsInitialized(false); }
                    }}
                    locale={ptBR}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setColumnsInitialized(false); handleSync(); }} disabled={isSyncing || isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Sincronizando..." : "Sincronizar APIs"}
            </Button>
            {data?.ultimo_sync && (
              <span className="text-xs text-muted-foreground">
                Último sync: {new Date(data.ultimo_sync).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
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
                    <label
                      key={cliente}
                      className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded text-sm"
                    >
                      <Checkbox checked={selectedClientes.has(cliente)} onCheckedChange={() => toggleCliente(cliente)} />
                      <span className="truncate">{cliente}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Ordenar por..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">🔀 Manual (arrastar)</SelectItem>
              <SelectItem value="data">📅 Data de entrada</SelectItem>
              <SelectItem value="cliente">👤 Cliente</SelectItem>
              <SelectItem value="tecnico">🔧 Técnico</SelectItem>
              <SelectItem value="dias">⏰ Dias no galpão (maior)</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-3 ml-auto text-sm">
            <Badge variant="outline" className="gap-1">
              <Package className="h-3 w-3" />
              {totalItems} equipamentos
            </Badge>
            {(totByCol["entrada"] || 0) > 0 && (
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 border-amber-300">
                📥 {totByCol["entrada"]} na entrada
              </Badge>
            )}
            {(totByCol["concluido"] || 0) > 0 && (
              <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-300">
                🏁 {totByCol["concluido"]} concluídos
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Carregando equipamentos da oficina...
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
                            <div className="flex items-center gap-1.5">
                              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                              <span className="font-semibold text-sm text-foreground">{column.title}</span>
                            </div>
                            <Badge variant="secondary" className="text-xs">{column.items.length}</Badge>
                          </div>

                          {/* Droppable Area */}
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
                                  <Draggable key={item.auvo_task_id} draggableId={item.auvo_task_id} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={`rounded-md border bg-card shadow-sm transition-shadow cursor-pointer ${
                                          snapshot.isDragging ? "shadow-lg ring-2 ring-primary/20" : "hover:shadow-md"
                                        }`}
                                        onClick={() => { setSelectedCard(item); setManualOsTaskId(""); setManualGcOsCode(""); setManualGcOrcCode(""); }}
                                      >
                                        <div className="px-3 py-2 space-y-1.5">
                                          {/* Equipment name */}
                                          <div className="flex items-start justify-between gap-1">
                                            <p className="text-sm font-semibold text-foreground truncate flex-1" title={item.equipamento_nome}>
                                              {abbreviateName(item.equipamento_nome)}
                                            </p>
                                            <div className={`flex items-center gap-0.5 text-[10px] shrink-0 ${getDiasColor(item.dias_no_galpao)}`}>
                                              <Clock className="h-3 w-3" />
                                              {item.dias_no_galpao}d
                                            </div>
                                          </div>

                                          {/* Client */}
                                          <p className="text-xs text-muted-foreground truncate" title={item.cliente}>
                                            {abbreviateName(item.cliente, 35)}
                                          </p>

                                          {/* Modelo / Série */}
                                          {(item.equipamento_modelo || item.equipamento_serie) && (
                                            <p className="text-[10px] text-muted-foreground/70">
                                              {item.equipamento_modelo && `Mod: ${item.equipamento_modelo}`}
                                              {item.equipamento_modelo && item.equipamento_serie && " • "}
                                              {item.equipamento_serie && `S/N: ${item.equipamento_serie}`}
                                            </p>
                                          )}

                                          {/* Técnico + Data */}
                                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                            <span>{item.tecnico}</span>
                                            <span>{item.data_entrada && new Date(item.data_entrada + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                                          </div>

                                          {/* GC Orçamento */}
                                          {item.gc_orcamento && (
                                            <div className="p-1.5 rounded bg-violet-50 border border-violet-200">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-medium text-violet-800">
                                                  Orç. #{item.gc_orcamento.gc_orcamento_codigo}
                                                </span>
                                                <span className="text-[10px] font-bold text-violet-700">
                                                  R$ {parseFloat(item.gc_orcamento.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1 mt-0.5">
                                                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.gc_orcamento.gc_cor_situacao }} />
                                                <span className="text-[9px] text-violet-600">{item.gc_orcamento.gc_situacao}</span>
                                              </div>
                                            </div>
                                          )}

                                          {/* GC OS */}
                                          {item.gc_os && (
                                            <div className="p-1.5 rounded bg-blue-50 border border-blue-200">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-medium text-blue-800">
                                                  OS #{item.gc_os.gc_os_codigo}
                                                </span>
                                                <span className="text-[10px] font-bold text-blue-700">
                                                  R$ {parseFloat(item.gc_os.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1 mt-0.5">
                                                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.gc_os.gc_cor_situacao }} />
                                                <span className="text-[9px] text-blue-600">{item.gc_os.gc_situacao}</span>
                                              </div>
                                            </div>
                                          )}

                                          {/* Alert for long stays */}
                                          {item.dias_no_galpao > 30 && (
                                            <div className="flex items-center gap-1 text-[10px] text-destructive">
                                              <AlertTriangle className="h-3 w-3" />
                                              Mais de 30 dias no galpão
                                            </div>
                                          )}

                                          {/* Links */}
                                          <div className="flex items-center gap-2 pt-1">
                                            <a
                                              href={item.auvo_link}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <ExternalLink className="h-2.5 w-2.5" />
                                              Auvo
                                            </a>
                                            {item.gc_orcamento && (
                                              <a
                                                href={item.gc_orcamento.gc_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-0.5 text-[10px] text-violet-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <ExternalLink className="h-2.5 w-2.5" />
                                                Orçamento
                                              </a>
                                            )}
                                            {item.gc_os && (
                                              <a
                                                href={item.gc_os.gc_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <ExternalLink className="h-2.5 w-2.5" />
                                                OS
                                              </a>
                                            )}
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

      {/* Card Detail Dialog */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedCard && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-4">
                  <span className="truncate">{selectedCard.equipamento_nome}</span>
                  <Badge variant="outline">{selectedCard.status_auvo}</Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Cliente:</span>
                    <span className="ml-2 font-medium">{selectedCard.cliente}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Técnico:</span>
                    <span className="ml-2">{selectedCard.tecnico}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Data de entrada:</span>
                    <span className="ml-2">{selectedCard.data_entrada && new Date(selectedCard.data_entrada + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dias no galpão:</span>
                    <span className={`ml-2 font-bold ${getDiasColor(selectedCard.dias_no_galpao)}`}>
                      {selectedCard.dias_no_galpao} dias
                    </span>
                  </div>
                  {selectedCard.equipamento_modelo && (
                    <div>
                      <span className="text-muted-foreground">Modelo:</span>
                      <span className="ml-2">{selectedCard.equipamento_modelo}</span>
                    </div>
                  )}
                  {selectedCard.equipamento_serie && (
                    <div>
                      <span className="text-muted-foreground">Nº Série:</span>
                      <span className="ml-2 font-mono">{selectedCard.equipamento_serie}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Tarefa Auvo:</span>
                    <span className="ml-2 font-mono">#{selectedCard.auvo_task_id}</span>
                  </div>
                  {selectedCard.equipments_id && selectedCard.equipments_id.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">ID Equipamento:</span>
                      <span className="ml-2 font-mono">{selectedCard.equipments_id.join(", ")}</span>
                    </div>
                  )}
                </div>

                {/* Links */}
                <div className="flex gap-3 flex-wrap">
                  <a href={selectedCard.auvo_link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium">
                    <ExternalLink className="h-4 w-4" /> Entrada Auvo
                  </a>
                  {selectedCard.os_task_link && (
                    <a href={selectedCard.os_task_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:underline font-medium">
                      <ExternalLink className="h-4 w-4" /> Tarefa OS Auvo
                    </a>
                  )}
                  {selectedCard.gc_orcamento && (
                    <a href={selectedCard.gc_orcamento.gc_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline font-medium">
                      <ExternalLink className="h-4 w-4" /> Orçamento GC
                    </a>
                  )}
                  {selectedCard.gc_os && (
                    <a href={selectedCard.gc_os.gc_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium">
                      <ExternalLink className="h-4 w-4" /> OS GC
                    </a>
                  )}
                </div>

                {/* Manual Link Section — shown when no equipment ID */}
                {(!selectedCard.equipments_id || selectedCard.equipments_id.length === 0) && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
                    <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      Vincular manualmente (sem ID equipamento)
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {!selectedCard.os_task_id && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground whitespace-nowrap w-28">Tarefa OS Auvo:</label>
                          <Input
                            placeholder="Ex: 70970640"
                            value={manualOsTaskId}
                            onChange={(e) => setManualOsTaskId(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                      {!selectedCard.gc_os && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground whitespace-nowrap w-28">Código OS GC:</label>
                          <Input
                            placeholder="Ex: OS-12345"
                            value={manualGcOsCode}
                            onChange={(e) => setManualGcOsCode(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                      {!selectedCard.gc_orcamento && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground whitespace-nowrap w-28">Código Orç. GC:</label>
                          <Input
                            placeholder="Ex: ORC-12345"
                            value={manualGcOrcCode}
                            onChange={(e) => setManualGcOrcCode(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveManualLink}
                      disabled={isSavingLink || (!manualOsTaskId && !manualGcOsCode && !manualGcOrcCode)}
                      className="w-full gap-2"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {isSavingLink ? "Salvando..." : "Salvar vínculo"}
                    </Button>
                  </div>
                )}
                {selectedCard.gc_orcamento && (
                  <div className="p-3 rounded-lg bg-violet-50 border border-violet-200 space-y-2">
                    <h4 className="text-sm font-semibold text-violet-800">
                      Orçamento #{selectedCard.gc_orcamento.gc_orcamento_codigo}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>Situação: <span className="font-medium">{selectedCard.gc_orcamento.gc_situacao}</span></div>
                      <div>Valor: <span className="font-bold">R$ {parseFloat(selectedCard.gc_orcamento.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      <div>Vendedor: {selectedCard.gc_orcamento.gc_vendedor}</div>
                      {selectedCard.gc_orcamento.gc_data && (
                        <div>Data: {new Date(selectedCard.gc_orcamento.gc_data).toLocaleDateString("pt-BR")}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* GC OS */}
                {selectedCard.gc_os && (
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                    <h4 className="text-sm font-semibold text-blue-800">
                      OS #{selectedCard.gc_os.gc_os_codigo}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>Situação: <span className="font-medium">{selectedCard.gc_os.gc_situacao}</span></div>
                      <div>Valor: <span className="font-bold">R$ {parseFloat(selectedCard.gc_os.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></div>
                      <div>Vendedor: {selectedCard.gc_os.gc_vendedor}</div>
                      {selectedCard.gc_os.gc_data && (
                        <div>Data: {new Date(selectedCard.gc_os.gc_data).toLocaleDateString("pt-BR")}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Questionário Answers */}
                {selectedCard.questionario_respostas.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">Formulário de Entrada</h4>
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                      {selectedCard.questionario_respostas
                        .filter((r) => r.reply && r.reply.trim() !== "")
                        .map((r, i) => (
                          <div key={i} className="text-xs">
                            <span className="text-muted-foreground">{r.question}:</span>
                            {r.reply.startsWith("http") ? (
                              <a href={r.reply} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 hover:underline">
                                {r.reply.includes("image") || r.reply.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                                  <img src={r.reply} alt="" className="mt-1 max-h-40 rounded border" />
                                ) : "Ver anexo"}
                              </a>
                            ) : (
                              <span className="ml-1 font-medium">{r.reply}</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
