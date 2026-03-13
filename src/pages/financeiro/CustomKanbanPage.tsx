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
  ArrowLeft, CalendarIcon, RefreshCw, ExternalLink, ClipboardList,
  FileText, Plus, GripVertical, Trash2, Edit2, Check, X, Filter, FileDown, Star, ListChecks
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";

type GcDocData = {
  gc_orcamento_id?: string;
  gc_orcamento_codigo?: string;
  gc_os_id?: string;
  gc_os_codigo?: string;
  gc_cliente: string;
  gc_situacao: string;
  gc_situacao_id: string;
  gc_cor_situacao: string;
  gc_valor_total: string;
  gc_vendedor: string;
  gc_data: string;
  gc_link: string;
};

type KanbanItem = {
  auvo_task_id: string;
  auvo_link: string;
  auvo_task_url?: string;
  auvo_survey_url?: string;
  cliente: string;
  tecnico: string;
  data_tarefa: string;
  orientacao: string;
  status_auvo: string;
  questionario_respostas: { question: string; reply: string }[];
  orcamento_realizado: boolean;
  os_realizada: boolean;
  gc_orcamento: GcDocData | null;
  gc_os: GcDocData | null;
};

type KanbanColumn = {
  id: string;
  title: string;
  items: KanbanItem[];
};

type ApiResponse = {
  resumo: {
    periodo: { inicio: string; fim: string };
    total_tarefas_com_questionario: number;
    orcamentos_realizados: number;
    os_realizadas: number;
    pendentes: number;
  };
  items: (KanbanItem & { _coluna?: string; _posicao?: number })[];
  ultimo_sync?: string | null;
  custom_columns?: { id: string; title: string; order: number }[];
  from_cache?: boolean;
  error?: string;
};

type QuestionnaireOption = {
  id: string;
  description: string;
};

export default function CustomKanbanPage() {
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
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState("");
  const [selectedCard, setSelectedCard] = useState<KanbanItem | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);

  // Questionnaire selection
  const [selectedQuestionnaires, setSelectedQuestionnaires] = useState<Set<string>>(new Set());
  const [showQuestionnaireSelector, setShowQuestionnaireSelector] = useState(false);
  const [questionnaireSearch, setQuestionnaireSearch] = useState("");
  const [isLoadingQuestionnaires, setIsLoadingQuestionnaires] = useState(false);
  const [availableQuestionnaires, setAvailableQuestionnaires] = useState<QuestionnaireOption[]>([]);

  const questionnaireIds = useMemo(() => Array.from(selectedQuestionnaires), [selectedQuestionnaires]);

  // Fetch available questionnaires
  const loadQuestionnaires = useCallback(async () => {
    setIsLoadingQuestionnaires(true);
    try {
      const { data, error } = await supabase.functions.invoke("kanban-custom", {
        body: {
          mode: "list_questionnaires",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      if (error) throw error;
      setAvailableQuestionnaires(data?.questionnaires || []);
    } catch (e: any) {
      toast.error("Erro ao carregar questionários: " + (e?.message || ""));
    } finally {
      setIsLoadingQuestionnaires(false);
    }
  }, [dateRange]);

  const filteredQuestionnaires = useMemo(() => {
    if (!questionnaireSearch) return availableQuestionnaires;
    const q = questionnaireSearch.toLowerCase();
    return availableQuestionnaires.filter((qr) =>
      qr.description.toLowerCase().includes(q) || qr.id.includes(q)
    );
  }, [availableQuestionnaires, questionnaireSearch]);

  const toggleQuestionnaire = useCallback((id: string) => {
    setSelectedQuestionnaires((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Fetch kanban data
  const { data, isLoading, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ["custom-kanban", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd"), questionnaireIds.join(",")],
    queryFn: async () => {
      if (questionnaireIds.length === 0) return { resumo: { periodo: { inicio: "", fim: "" }, total_tarefas_com_questionario: 0, orcamentos_realizados: 0, os_realizadas: 0, pendentes: 0 }, items: [], from_cache: true } as ApiResponse;
      const { data, error } = await supabase.functions.invoke("kanban-custom", {
        body: {
          mode: "cache",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
          questionnaire_ids: questionnaireIds,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ApiResponse;
    },
    staleTime: Infinity,
    enabled: questionnaireIds.length > 0,
  });

  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    if (questionnaireIds.length === 0) {
      toast.warning("Selecione pelo menos um questionário antes de sincronizar");
      return;
    }
    setIsSyncing(true);
    try {
      const { data: syncData, error } = await supabase.functions.invoke("kanban-custom", {
        body: {
          mode: "sync",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
          questionnaire_ids: questionnaireIds,
        },
      });

      if (error) throw error;

      if (syncData?.success === false || syncData?.error) {
        toast.error(syncData?.error || "Erro na sincronização.");
      } else {
        toast.success(`Sincronizado! ${syncData?.resumo?.total_tarefas_com_questionario ?? 0} tarefas atualizadas`);
      }
    } catch (e: any) {
      toast.warning(`Sincronização em processamento...`);
      console.warn("Erro sync:", e?.message || e);
    } finally {
      setColumnsInitialized(false);
      await refetch();
      setTimeout(() => {
        setColumnsInitialized(false);
        refetch();
      }, 5000);
      setIsSyncing(false);
    }
  }, [dateRange, refetch, questionnaireIds]);

  const tecnicos = useMemo(() => {
    if (!data?.items) return [];
    return Array.from(new Set(data.items.map((i) => i.tecnico).filter(Boolean))).sort();
  }, [data]);

  const allClientes = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set(data.items.map((i) => i.cliente).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  useMemo(() => {
    if (allClientes.length > 0 && selectedClientes.size === 0 && allClientesSelected) {
      setSelectedClientes(new Set(allClientes));
    }
  }, [allClientes]);

  // Initialize columns
  useMemo(() => {
    if (!data?.items || columnsInitialized) return;

    const hasFilledQuestionnaire = (item: KanbanItem) =>
      item.questionario_respostas.some(
        (r) => r.reply && r.reply.trim() !== "" && !r.reply.startsWith("http")
      );

    const hasSavedPositions = data.from_cache && data.items.some((i: any) => i._coluna);

    if (hasSavedPositions) {
      const colMap: Record<string, KanbanItem[]> = {};
      for (const item of data.items) {
        let col = (item as any)._coluna || "a_fazer";
        const { _coluna, _posicao, ...cleanItem } = item as any;

        if (col === "a_fazer" && !cleanItem.orcamento_realizado && !cleanItem.os_realizada && !hasFilledQuestionnaire(cleanItem)) {
          col = "falta_preenchimento";
        }

        if (!colMap[col]) colMap[col] = [];
        colMap[col].push(cleanItem);
      }
      for (const col of Object.keys(colMap)) {
        colMap[col].sort((a: any, b: any) => ((a as any)._posicao || 0) - ((b as any)._posicao || 0));
      }

      const savedCols = data.custom_columns || [];
      const savedOrderMap = new Map(savedCols.map((cc) => [cc.id, cc]));

      const defaultTitles: Record<string, string> = {
        falta_preenchimento: "⚠️ Falta Preenchimento",
        a_fazer: "📋 A Fazer",
        os_realizada: "🔧 OS Realizada",
      };

      const orderedIds: string[] = savedCols
        .sort((a, b) => a.order - b.order)
        .map((cc) => cc.id);

      for (const colId of Object.keys(colMap)) {
        if (!orderedIds.includes(colId)) orderedIds.push(colId);
      }

      if (!orderedIds.includes("falta_preenchimento")) orderedIds.unshift("falta_preenchimento");
      if (!orderedIds.includes("a_fazer")) {
        const fpIdx = orderedIds.indexOf("falta_preenchimento");
        orderedIds.splice(fpIdx + 1, 0, "a_fazer");
      }

      const cols: KanbanColumn[] = orderedIds
        .filter((colId) => (colMap[colId] && colMap[colId].length > 0) || savedOrderMap.has(colId) || colId === "falta_preenchimento" || colId === "a_fazer")
        .map((colId) => ({
          id: colId,
          title: savedOrderMap.get(colId)?.title || defaultTitles[colId] || (colId.startsWith("orc_") ? `💰 ${colId.replace("orc_", "").replace(/_/g, " ")}` : colId),
          items: colMap[colId] || [],
        }));

      setColumns(cols);
    } else {
      const faltaPreenchimento = data.items.filter(
        (i) => !i.orcamento_realizado && !i.os_realizada && !hasFilledQuestionnaire(i)
      );
      const aFazer = data.items.filter(
        (i) => !i.orcamento_realizado && !i.os_realizada && hasFilledQuestionnaire(i)
      );
      const osRealizada = data.items.filter((i) => i.os_realizada);
      const orcItems = data.items.filter((i) => i.orcamento_realizado && !i.os_realizada);

      const situacaoMap: Record<string, KanbanItem[]> = {};
      for (const item of orcItems) {
        const sit = item.gc_orcamento?.gc_situacao || "Sem situação";
        if (!situacaoMap[sit]) situacaoMap[sit] = [];
        situacaoMap[sit].push(item);
      }

      const orcColumns: KanbanColumn[] = Object.entries(situacaoMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sit, items]) => ({
          id: `orc_${sit.replace(/\s+/g, "_").toLowerCase()}`,
          title: `💰 ${sit}`,
          items,
        }));

      setColumns([
        { id: "falta_preenchimento", title: "⚠️ Falta Preenchimento", items: faltaPreenchimento },
        { id: "a_fazer", title: "📋 A Fazer", items: aFazer },
        { id: "os_realizada", title: "🔧 OS Realizada", items: osRealizada },
        ...orcColumns,
      ]);
    }

    setColumnsInitialized(true);
  }, [data, columnsInitialized]);

  const handleRefresh = useCallback(() => {
    setColumnsInitialized(false);
    setAllClientesSelected(true);
    setSelectedClientes(new Set());
    handleSync();
  }, [handleSync]);

  const savePositions = useCallback((cols: KanbanColumn[]) => {
    const positions = cols.flatMap((col) =>
      col.items.map((item, idx) => ({
        auvo_task_id: item.auvo_task_id,
        coluna: col.id,
        posicao: idx,
      }))
    );
    const allColumnsOrder = cols.map((c, idx) => ({ id: c.id, title: c.title, order: idx }));

    supabase.functions.invoke("kanban-custom", {
      body: { mode: "save_positions", positions, custom_columns: allColumnsOrder, questionnaire_ids: questionnaireIds },
    }).catch((e) => console.warn("Erro ao salvar posições:", e));
  }, [questionnaireIds]);

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
      const [movedItem] = srcCol.items.splice(source.index, 1);
      destCol.items.splice(destination.index, 0, movedItem);
      savePositions(newCols);
      return newCols;
    });
  }, [savePositions]);

  const addColumn = useCallback(() => {
    if (!newColumnTitle.trim()) return;
    const id = `custom_${Date.now()}`;
    setColumns((prev) => {
      const newCols = [...prev, { id, title: newColumnTitle.trim(), items: [] }];
      savePositions(newCols);
      return newCols;
    });
    setNewColumnTitle("");
    setShowAddColumn(false);
    toast.success(`Coluna "${newColumnTitle.trim()}" criada`);
  }, [newColumnTitle, savePositions]);

  const deleteColumn = useCallback((columnId: string) => {
    setColumns((prev) => {
      const col = prev.find((c) => c.id === columnId);
      if (!col) return prev;
      const newCols = prev
        .filter((c) => c.id !== columnId)
        .map((c) => c.id === "a_fazer" ? { ...c, items: [...c.items, ...col.items] } : c);
      savePositions(newCols);
      return newCols;
    });
  }, [savePositions]);

  const saveColumnRename = useCallback(() => {
    if (!editingColumnId || !editingColumnTitle.trim()) return;
    setColumns((prev) => {
      const newCols = prev.map((c) => c.id === editingColumnId ? { ...c, title: editingColumnTitle.trim() } : c);
      savePositions(newCols);
      return newCols;
    });
    setEditingColumnId(null);
  }, [editingColumnId, editingColumnTitle]);

  const abbreviateName = (name: string, maxLen = 30) => {
    if (name.length <= maxLen) return name;
    const words = name.split(/\s+/);
    if (words.length <= 2) return name.substring(0, maxLen - 3) + "...";
    const first = words[0];
    const last = words[words.length - 1];
    const abbrev = `${first} ... ${last}`;
    if (abbrev.length <= maxLen) return abbrev;
    return name.substring(0, maxLen - 3) + "...";
  };

  const getAnswer = (item: KanbanItem, keyword: string) => {
    return item.questionario_respostas
      .filter((r) => r.question.toLowerCase().includes(keyword.toLowerCase()) && r.reply && !r.reply.startsWith("http"))
      .map((r) => r.reply)
      .join("\n");
  };

  const filteredColumns = useMemo(() => {
    return columns.map((col) => ({
      ...col,
      items: col.items.filter((item) => {
        if (filterTecnico !== "todos" && item.tecnico !== filterTecnico) return false;
        if (!allClientesSelected && !selectedClientes.has(item.cliente)) return false;
        return true;
      }),
    }));
  }, [columns, filterTecnico, allClientesSelected, selectedClientes]);

  const toggleAllClientes = useCallback(() => {
    if (allClientesSelected) {
      setAllClientesSelected(false);
      setSelectedClientes(new Set());
    } else {
      setAllClientesSelected(true);
      setSelectedClientes(new Set(allClientes));
    }
  }, [allClientesSelected, allClientes]);

  const toggleCliente = useCallback((cliente: string) => {
    setSelectedClientes((prev) => {
      const next = new Set(prev);
      if (next.has(cliente)) next.delete(cliente);
      else next.add(cliente);
      setAllClientesSelected(next.size === allClientes.length);
      return next;
    });
  }, [allClientes]);

  const filteredClienteOptions = useMemo(() => {
    if (!filterClienteSearch) return allClientes;
    return allClientes.filter((c) => c.toLowerCase().includes(filterClienteSearch.toLowerCase()));
  }, [allClientes, filterClienteSearch]);

  const resumo = data?.resumo;

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
              <h1 className="text-xl font-bold text-foreground">Kanban Personalizado</h1>
              <p className="text-sm text-muted-foreground">
                Selecione questionários para filtrar tarefas do Auvo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Questionnaire Selector */}
            <Popover open={showQuestionnaireSelector} onOpenChange={(open) => {
              setShowQuestionnaireSelector(open);
              if (open && availableQuestionnaires.length === 0) loadQuestionnaires();
            }}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <ListChecks className="h-4 w-4" />
                  {selectedQuestionnaires.size === 0
                    ? "Selecionar questionários"
                    : `${selectedQuestionnaires.size} questionário${selectedQuestionnaires.size !== 1 ? "s" : ""}`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[450px] p-0" align="end">
                <div className="p-3 border-b">
                  <Input
                    placeholder="Buscar questionário..."
                    value={questionnaireSearch}
                    onChange={(e) => setQuestionnaireSearch(e.target.value)}
                    className="h-8"
                  />
                </div>
                {isLoadingQuestionnaires ? (
                  <div className="flex items-center justify-center p-6 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    Carregando questionários...
                  </div>
                ) : (
                  <ScrollArea className="h-[350px]">
                    <div className="p-2 space-y-0.5">
                      {filteredQuestionnaires.map((q) => (
                        <label
                          key={q.id}
                          className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-accent rounded text-sm"
                        >
                          <Checkbox
                            checked={selectedQuestionnaires.has(q.id)}
                            onCheckedChange={() => toggleQuestionnaire(q.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="block truncate font-medium">{q.description}</span>
                            <span className="block text-xs text-muted-foreground">ID: {q.id}</span>
                          </div>
                        </label>
                      ))}
                      {filteredQuestionnaires.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          {availableQuestionnaires.length === 0
                            ? "Nenhum questionário encontrado no período"
                            : "Nenhum resultado para a busca"}
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                )}
                <div className="p-2 border-t flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">
                    {availableQuestionnaires.length} questionários disponíveis
                  </span>
                  <Button size="sm" variant="outline" onClick={loadQuestionnaires} disabled={isLoadingQuestionnaires}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingQuestionnaires ? "animate-spin" : ""}`} />
                    Atualizar lista
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

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
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isSyncing || isFetching || questionnaireIds.length === 0}>
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
                  <Checkbox
                    checked={allClientesSelected}
                    onCheckedChange={toggleAllClientes}
                  />
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
                      <Checkbox
                        checked={selectedClientes.has(cliente)}
                        onCheckedChange={() => toggleCliente(cliente)}
                      />
                      <span className="truncate">{cliente}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {resumo && (
            <div className="flex items-center gap-4 ml-auto text-sm">
              <Badge variant="outline" className="gap-1">
                <ClipboardList className="h-3 w-3" />
                {resumo.total_tarefas_com_questionario} tarefas
              </Badge>
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 border-amber-300">
                <FileText className="h-3 w-3" />
                {resumo.pendentes} pendentes
              </Badge>
              <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-800 border-blue-300">
                🔧 {resumo.os_realizadas} OS
              </Badge>
              <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-300">
                <Check className="h-3 w-3" />
                {resumo.orcamentos_realizados} realizados
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {questionnaireIds.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
          <ListChecks className="h-12 w-12" />
          <p className="text-lg font-medium">Selecione um ou mais questionários para começar</p>
          <p className="text-sm">Clique em "Selecionar questionários" no canto superior direito</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Carregando tarefas e orçamentos...
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {!isLoading && questionnaireIds.length > 0 && (
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
                        className={`flex-shrink-0 w-[360px] transition-shadow ${colSnapshot.isDragging ? "shadow-xl opacity-90" : ""}`}
                      >
                        <div className="bg-muted/50 rounded-lg border h-full">
                          <div
                            {...colProvided.dragHandleProps}
                            className="flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing"
                          >
                            {editingColumnId === column.id ? (
                              <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                                <Input
                                  value={editingColumnTitle}
                                  onChange={(e) => setEditingColumnTitle(e.target.value)}
                                  className="h-7 text-sm"
                                  onKeyDown={(e) => e.key === "Enter" && saveColumnRename()}
                                  autoFocus
                                />
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveColumnRename}>
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingColumnId(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                                  <span className="font-semibold text-sm text-foreground">{column.title}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Badge variant="secondary" className="text-xs">{column.items.length}</Badge>
                                  <Button
                                    size="icon" variant="ghost" className="h-6 w-6"
                                    onClick={(e) => { e.stopPropagation(); setEditingColumnId(column.id); setEditingColumnTitle(column.title); }}
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  {column.id !== "a_fazer" && column.id !== "os_realizada" && !column.id.startsWith("orc_") && (
                                    <Button
                                      size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                                      onClick={(e) => { e.stopPropagation(); deleteColumn(column.id); }}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

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
                                        } ${item.orcamento_realizado ? "border-l-4 border-l-emerald-500" : item.os_realizada ? "border-l-4 border-l-blue-500" : "border-l-4 border-l-amber-400"}`}
                                        onClick={() => setSelectedCard(item)}
                                      >
                                        <div className="flex items-start gap-1 px-3 py-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-mono text-muted-foreground">#{item.auvo_task_id}</span>
                                              <Badge variant="outline" className="text-[10px] h-5">
                                                {item.status_auvo}
                                              </Badge>
                                            </div>
                                            <p className="text-sm font-semibold text-foreground mt-1 truncate" title={item.cliente}>
                                              {abbreviateName(item.cliente)}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                              {item.tecnico} • {item.data_tarefa}
                                            </p>

                                            {item.gc_orcamento && (
                                              <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-xs font-medium text-emerald-800">
                                                    Orç. #{item.gc_orcamento.gc_orcamento_codigo}
                                                  </span>
                                                  <span className="text-xs font-bold text-emerald-700">
                                                    R$ {parseFloat(item.gc_orcamento.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                  </span>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1">
                                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.gc_orcamento.gc_cor_situacao }} />
                                                  <span className="text-[10px] text-emerald-700">{item.gc_orcamento.gc_situacao}</span>
                                                </div>
                                              </div>
                                            )}

                                            {item.gc_os && (
                                              <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-xs font-medium text-blue-800">OS #{item.gc_os.gc_os_codigo}</span>
                                                  <span className="text-xs font-bold text-blue-700">
                                                    R$ {parseFloat(item.gc_os.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                  </span>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1">
                                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.gc_os.gc_cor_situacao }} />
                                                  <span className="text-[10px] text-blue-700">{item.gc_os.gc_situacao}</span>
                                                </div>
                                              </div>
                                            )}

                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                              <a href={item.auvo_link} target="_blank" rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}>
                                                <ExternalLink className="h-3 w-3" /> Auvo
                                              </a>
                                              {item.auvo_task_url && (
                                                <a href={item.auvo_task_url} target="_blank" rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-orange-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}>
                                                  <FileDown className="h-3 w-3" /> OS Digital
                                                </a>
                                              )}
                                              {item.auvo_survey_url && (
                                                <a href={item.auvo_survey_url} target="_blank" rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-purple-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}>
                                                  <Star className="h-3 w-3" /> Pesquisa
                                                </a>
                                              )}
                                              {item.gc_orcamento && (
                                                <a href={item.gc_orcamento.gc_link} target="_blank" rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}>
                                                  <ExternalLink className="h-3 w-3" /> Orçamento GC
                                                </a>
                                              )}
                                              {item.gc_os && (
                                                <a href={item.gc_os.gc_link} target="_blank" rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}>
                                                  <ExternalLink className="h-3 w-3" /> OS GC
                                                </a>
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

                <div className="flex-shrink-0 w-[300px]">
                  {showAddColumn ? (
                    <div className="bg-muted/50 rounded-lg border p-3 space-y-2">
                      <Input
                        value={newColumnTitle}
                        onChange={(e) => setNewColumnTitle(e.target.value)}
                        placeholder="Nome da coluna"
                        onKeyDown={(e) => e.key === "Enter" && addColumn()}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={addColumn}>Criar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowAddColumn(false)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full h-12 border-dashed text-muted-foreground"
                      onClick={() => setShowAddColumn(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Adicionar coluna
                    </Button>
                  )}
                </div>
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
                  <span className="truncate">{selectedCard.cliente}</span>
                  <Badge variant={selectedCard.orcamento_realizado ? "default" : selectedCard.os_realizada ? "outline" : "secondary"}>
                    {selectedCard.orcamento_realizado ? "Orçamento Realizado" : selectedCard.os_realizada ? "OS Realizada" : "Pendente"}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Tarefa Auvo:</span>
                    <span className="ml-2 font-mono">#{selectedCard.auvo_task_id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className="ml-2">{selectedCard.status_auvo}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Técnico:</span>
                    <span className="ml-2">{selectedCard.tecnico}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Data:</span>
                    <span className="ml-2">{selectedCard.data_tarefa}</span>
                  </div>
                </div>

                <div className="flex gap-3 flex-wrap">
                  <a href={selectedCard.auvo_link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium">
                    <ExternalLink className="h-4 w-4" /> Abrir no Auvo
                  </a>
                  {selectedCard.auvo_task_url && (
                    <a href={selectedCard.auvo_task_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:underline font-medium">
                      <FileDown className="h-4 w-4" /> OS Digital
                    </a>
                  )}
                  {selectedCard.auvo_survey_url && (
                    <a href={selectedCard.auvo_survey_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:underline font-medium">
                      <Star className="h-4 w-4" /> Pesquisa de Satisfação
                    </a>
                  )}
                  {selectedCard.gc_orcamento && (
                    <a href={selectedCard.gc_orcamento.gc_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:underline font-medium">
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

                {selectedCard.gc_orcamento && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                    <h4 className="font-semibold text-sm text-emerald-900">Orçamento GestãoClick</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-emerald-700">Código:</span>
                        <span className="ml-2 font-medium">#{selectedCard.gc_orcamento.gc_orcamento_codigo}</span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Valor:</span>
                        <span className="ml-2 font-bold">
                          R$ {parseFloat(selectedCard.gc_orcamento.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5">
                        <span className="text-emerald-700">Situação:</span>
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedCard.gc_orcamento.gc_cor_situacao }} />
                        <span className="font-medium">{selectedCard.gc_orcamento.gc_situacao}</span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Responsável:</span>
                        <span className="ml-2">{selectedCard.gc_orcamento.gc_vendedor}</span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Data:</span>
                        <span className="ml-2">{selectedCard.gc_orcamento.gc_data}</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedCard.gc_os && (
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                    <h4 className="font-semibold text-sm text-blue-900">Ordem de Serviço GestãoClick</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-blue-700">Código:</span>
                        <span className="ml-2 font-medium">#{selectedCard.gc_os.gc_os_codigo}</span>
                      </div>
                      <div>
                        <span className="text-blue-700">Valor:</span>
                        <span className="ml-2 font-bold">
                          R$ {parseFloat(selectedCard.gc_os.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5">
                        <span className="text-blue-700">Situação:</span>
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedCard.gc_os.gc_cor_situacao }} />
                        <span className="font-medium">{selectedCard.gc_os.gc_situacao}</span>
                      </div>
                      <div>
                        <span className="text-blue-700">Responsável:</span>
                        <span className="ml-2">{selectedCard.gc_os.gc_vendedor}</span>
                      </div>
                      <div>
                        <span className="text-blue-700">Data:</span>
                        <span className="ml-2">{selectedCard.gc_os.gc_data}</span>
                      </div>
                    </div>
                  </div>
                )}

                {getAnswer(selectedCard, "peças") && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">🔧 Peças Necessárias</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {getAnswer(selectedCard, "peças")}
                    </p>
                  </div>
                )}

                {getAnswer(selectedCard, "serviços") && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">⚙️ Serviços Necessários</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {getAnswer(selectedCard, "serviços")}
                    </p>
                  </div>
                )}

                {getAnswer(selectedCard, "horas") && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">⏱️ Tempo para Execução</h4>
                    <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                      {getAnswer(selectedCard, "horas")}
                    </p>
                  </div>
                )}

                {getAnswer(selectedCard, "observ") && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">📝 Observações</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {getAnswer(selectedCard, "observ")}
                    </p>
                  </div>
                )}

                {selectedCard.orientacao && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">📋 Orientação da Tarefa</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {selectedCard.orientacao}
                    </p>
                  </div>
                )}

                {selectedCard.questionario_respostas.some((r) => r.reply.startsWith("http")) && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">📷 Fotos</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedCard.questionario_respostas
                        .filter((r) => r.reply.startsWith("http"))
                        .map((r, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setExpandedPhoto(r.reply)}
                            className="block rounded-md overflow-hidden border hover:ring-2 ring-primary/30 transition-all cursor-zoom-in"
                          >
                            <img src={r.reply} alt={r.question} className="w-full h-24 object-cover" loading="lazy" />
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!expandedPhoto} onOpenChange={(open) => !open && setExpandedPhoto(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 flex items-center justify-center bg-black/95 border-none">
          {expandedPhoto && (
            <img src={expandedPhoto} alt="Foto ampliada" className="max-w-full max-h-[85vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
