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
  Filter, GripVertical, Check, X, Edit2, Trash2, Plus
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  auvo_task_url: string | null;
  auvo_link: string | null;
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
  check_in: boolean;
  check_out: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
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
    from: startOfMonth(today),
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
      return (data || []) as OSItem[];
    },
    staleTime: 60_000,
  });

  // Filter out situations starting with "Executad" (case-insensitive)
  const items = useMemo(() => {
    if (!rawItems) return [];
    return rawItems.filter(
      (i) => i.gc_os_situacao && !i.gc_os_situacao.toLowerCase().startsWith("executad")
    );
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

  useMemo(() => {
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

  const filteredColumns = useMemo(() => {
    return columns.map((col) => ({
      ...col,
      items: col.items.filter((item) => {
        const clientName = item.cliente || item.gc_os_cliente || "";
        if (filterTecnico !== "todos" && item.tecnico !== filterTecnico) return false;
        if (!allClientesSelected && !selectedClientes.has(clientName)) return false;
        return true;
      }),
    }));
  }, [columns, filterTecnico, allClientesSelected, selectedClientes]);

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
                            <Badge variant="secondary" className="text-xs">{column.items.length}</Badge>
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
                                          <div className="flex items-center justify-between mt-1.5">
                                            <span className="text-xs font-medium text-foreground">
                                              {formatCurrency(Number(item.gc_os_valor_total) || 0)}
                                            </span>
                                            <div className="flex items-center gap-1">
                                              {item.pendencia && (
                                                <Badge variant="destructive" className="text-[9px] h-4 px-1">
                                                  Pendência
                                                </Badge>
                                              )}
                                              {item.check_in && !item.check_out && (
                                                <Badge className="text-[9px] h-4 px-1 bg-blue-500">
                                                  Em campo
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

      {/* Card Detail Dialog */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>OS {selectedCard?.gc_os_codigo}</span>
              <span className="text-sm font-normal text-muted-foreground">
                (Tarefa #{selectedCard?.auvo_task_id})
              </span>
            </DialogTitle>
          </DialogHeader>
          {selectedCard && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Cliente</span>
                  <p className="font-medium">{selectedCard.cliente || selectedCard.gc_os_cliente || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Técnico</span>
                  <p className="font-medium">{selectedCard.tecnico || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Data</span>
                  <p className="font-medium">{selectedCard.data_tarefa || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Valor Total</span>
                  <p className="font-medium">{formatCurrency(Number(selectedCard.gc_os_valor_total) || 0)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Situação OS</span>
                  <p className="font-medium">{selectedCard.gc_os_situacao}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Vendedor</span>
                  <p className="font-medium">{selectedCard.gc_os_vendedor || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status Auvo</span>
                  <p className="font-medium">{selectedCard.status_auvo || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Horário</span>
                  <p className="font-medium">
                    {selectedCard.hora_inicio || "—"} → {selectedCard.hora_fim || "—"}
                  </p>
                </div>
              </div>

              {selectedCard.pendencia && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
                  <span className="text-sm font-medium text-destructive">Pendência:</span>
                  <p className="text-sm mt-1">{selectedCard.pendencia}</p>
                </div>
              )}

              {selectedCard.descricao && (
                <div>
                  <span className="text-sm text-muted-foreground">Descrição</span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{selectedCard.descricao}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {selectedCard.gc_os_link && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.gc_os_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> GestãoClick
                    </a>
                  </Button>
                )}
                {(selectedCard.auvo_task_url || selectedCard.auvo_link) && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.auvo_task_url || selectedCard.auvo_link || "#"} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> Auvo
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
