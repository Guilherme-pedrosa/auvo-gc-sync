import { useState, useCallback, useMemo, useEffect } from "react";
import PhotoGallery from "@/components/financeiro/PhotoGallery";
import { useQuery } from "@tanstack/react-query";
import { isAfter, isEqual } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  FileText, Plus, GripVertical, Trash2, Edit2, Check, X, Filter, FileDown, Star,
  Pencil, Save, Sparkles, Brain, Loader2, MessageCircle, Send
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

export default function BudgetKanbanPage() {
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
  const [sortBy, setSortBy] = useState<"manual" | "data" | "cliente" | "tecnico" | "valor">("manual");
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSavingField, setIsSavingField] = useState(false);
  const [aiLoadingSection, setAiLoadingSection] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [resolvedEquipment, setResolvedEquipment] = useState<{ nome: string; id: string } | null>(null);
  const [isEquipmentLoading, setIsEquipmentLoading] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ["budget-kanban", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("budget-kanban", {
        body: {
          mode: "cache",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ApiResponse;
    },
    staleTime: Infinity, // Don't auto-refetch, use cache
  });

  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { data: syncData, error } = await supabase.functions.invoke("budget-kanban", {
        body: {
          mode: "sync",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });

      if (error) throw error;

      if (syncData?.success === false || syncData?.error) {
        toast.error(syncData?.error || "Erro na sincronização. Mantendo último estado.");
      } else {
        toast.success(`Sincronizado! ${syncData?.resumo?.total_tarefas_com_questionario ?? 0} tarefas atualizadas`);
      }
    } catch (e: any) {
      toast.warning(`Sincronização em processamento. Atualizando cache...`);
      console.warn("Erro/timeout no retorno do sync, tentando recarregar cache:", e?.message || e);
    } finally {
      setColumnsInitialized(false);
      await refetch();
      setTimeout(() => {
        setColumnsInitialized(false);
        refetch();
      }, 5000);
      setIsSyncing(false);
    }
  }, [dateRange, refetch]);

  // All unique clients
  const allClientes = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set(data.items.map((i) => i.cliente).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  // Initialize client selection when data loads
  useMemo(() => {
    if (allClientes.length > 0 && selectedClientes.size === 0 && allClientesSelected) {
      setSelectedClientes(new Set(allClientes));
    }
  }, [allClientes]);

  // Initialize columns from API data
  useMemo(() => {
    if (!data?.items || columnsInitialized) return;

    const hasFilledQuestionnaire = (item: KanbanItem) =>
      item.questionario_respostas.some(
        (r) => r.reply && r.reply.trim() !== "" && !r.reply.startsWith("http")
      );

    // If data came from cache with saved positions, use them
    const hasSavedPositions = data.from_cache && data.items.some((i: any) => i._coluna);

    if (hasSavedPositions) {
      const colMap: Record<string, KanbanItem[]> = {};
      for (const item of data.items) {
        let col = (item as any)._coluna || "a_fazer";
        const { _coluna, _posicao, ...cleanItem } = item as any;

        // Re-check: items in "a_fazer" without questionnaire should go to "falta_preenchimento"
        if (col === "a_fazer" && !cleanItem.orcamento_realizado && !cleanItem.os_realizada && !hasFilledQuestionnaire(cleanItem)) {
          col = "falta_preenchimento";
        }

        if (!colMap[col]) colMap[col] = [];
        colMap[col].push(cleanItem);
      }
      // Sort items within each column by saved position
      for (const col of Object.keys(colMap)) {
        colMap[col].sort((a: any, b: any) => ((a as any)._posicao || 0) - ((b as any)._posicao || 0));
      }

      // Use saved column order and titles
      const savedCols = data.custom_columns || [];
      const savedOrderMap = new Map(savedCols.map((cc) => [cc.id, cc]));

      // Build title mapping from saved data
      const defaultTitles: Record<string, string> = {
        falta_preenchimento: "⚠️ Falta Preenchimento",
        a_fazer: "📋 A Fazer",
        os_realizada: "🔧 OS Realizada",
      };

      // Start with saved column order
      const orderedIds: string[] = savedCols
        .sort((a, b) => a.order - b.order)
        .map((cc) => cc.id);

      // Add any columns from data that weren't in saved order (new columns from sync)
      for (const colId of Object.keys(colMap)) {
        if (!orderedIds.includes(colId)) orderedIds.push(colId);
      }

      // Ensure falta_preenchimento and a_fazer exist
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
      // Fresh data (from sync) — auto-assign columns
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

  // Unique technicians
  const tecnicos = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set(data.items.map((i) => i.tecnico).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  // Filtered clients for the filter dropdown
  const filteredClienteOptions = useMemo(() => {
    if (!filterClienteSearch) return allClientes;
    return allClientes.filter((c) =>
      c.toLowerCase().includes(filterClienteSearch.toLowerCase())
    );
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

  // Apply filters + sorting
  const filteredColumns = useMemo(() => {
    const sortFn = (a: KanbanItem, b: KanbanItem) => {
      if (sortBy === "data") return (a.data_tarefa || "").localeCompare(b.data_tarefa || "");
      if (sortBy === "cliente") return (a.cliente || "").localeCompare(b.cliente || "");
      if (sortBy === "tecnico") return (a.tecnico || "").localeCompare(b.tecnico || "");
      if (sortBy === "valor") {
        const va = parseFloat(a.gc_orcamento?.gc_valor_total || a.gc_os?.gc_valor_total || "0");
        const vb = parseFloat(b.gc_orcamento?.gc_valor_total || b.gc_os?.gc_valor_total || "0");
        return vb - va;
      }
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

  // Save positions + custom columns to DB
  const savePositions = useCallback((cols: KanbanColumn[]) => {
    const positions = cols.flatMap((col) =>
      col.items.map((item, idx) => ({
        auvo_task_id: item.auvo_task_id,
        coluna: col.id,
        posicao: idx,
      }))
    );
    // Save ALL columns order and titles (not just custom ones)
    const allColumnsOrder = cols.map((c, idx) => ({ id: c.id, title: c.title, order: idx }));

    // Fire and forget
    supabase.functions.invoke("budget-kanban", {
      body: { mode: "save_positions", positions, custom_columns: allColumnsOrder },
    }).catch((e) => console.warn("Erro ao salvar posições:", e));
  }, []);

  // Drag and drop (cards and columns)
  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;

    // Column reorder
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

    // Card reorder
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

  // Abbreviate long client names: keep first + last word with "..." in between
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

  // Extract specific questionnaire answers
  const getAnswer = (item: KanbanItem, keyword: string) => {
    return item.questionario_respostas
      .filter((r) => r.question.toLowerCase().includes(keyword.toLowerCase()) && r.reply && !r.reply.startsWith("http"))
      .map((r) => r.reply)
      .join("\n");
  };

  const normalizeText = (value: string) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const extractEquipmentFromCard = (item: KanbanItem) => {
    const textReplies = item.questionario_respostas.filter((r) => r.reply && !r.reply.startsWith("http"));

    const collectByQuestionKeywords = (keywords: string[]) => {
      const values = textReplies
        .filter((r) => {
          const q = normalizeText(r.question);
          return keywords.some((k) => q.includes(k));
        })
        .map((r) => String(r.reply || "").trim())
        .filter(Boolean);
      return [...new Set(values)].join(" | ");
    };

    let nome = collectByQuestionKeywords(["equip", "equipamento", "modelo", "maquina", "marca"]);
    let id = collectByQuestionKeywords(["patrimon", "serie", "serial", "tag", "placa", "id do equip", "id equipamento"]);

    const blob = `${item.orientacao || ""}\n${getAnswer(item, "descri") || ""}`;
    if (!nome) {
      const matchNome = blob.match(/(?:equipamento|modelo)\s*[:\-]\s*([^\n;]+)/i);
      if (matchNome?.[1]) nome = matchNome[1].trim();
    }
    if (!id) {
      const matchId = blob.match(/(?:patrim[oô]nio|s[eé]rie|serial|tag|placa|id(?: do)? equipamento)\s*[:#\-]\s*([^\n;]+)/i);
      if (matchId?.[1]) id = matchId[1].trim();
    }

    return { nome, id };
  };

  useEffect(() => {
    let cancelled = false;

    const resolveEquipment = async () => {
      if (!selectedCard) {
        setResolvedEquipment(null);
        setIsEquipmentLoading(false);
        return;
      }

      const local = extractEquipmentFromCard(selectedCard);
      setResolvedEquipment(local.nome || local.id ? local : null);

      if (local.nome && local.id) {
        setIsEquipmentLoading(false);
        return;
      }

      setIsEquipmentLoading(true);
      try {
        const { data: taskResp, error: taskErr } = await supabase.functions.invoke("auvo-task-update", {
          body: { action: "get", taskId: Number(selectedCard.auvo_task_id) },
        });
        if (taskErr) throw taskErr;

        const task = taskResp?.data?.result || taskResp?.result || {};
        const idsRaw = Array.isArray(task?.equipmentsId)
          ? task.equipmentsId
          : Array.isArray(task?.equipmentsID)
            ? task.equipmentsID
            : Array.isArray(task?.equipmentIds)
              ? task.equipmentIds
              : [];

        const equipmentIds = [...new Set(idsRaw.map((v: any) => String(v)).filter(Boolean))];
        const resolvedId = local.id || (equipmentIds.length ? equipmentIds.join(", ") : "");

        let resolvedNome = local.nome;
        if (!resolvedNome && equipmentIds.length) {
          for (const eqId of equipmentIds) {
            const { data: eqResp, error: eqErr } = await supabase.functions.invoke("auvo-task-update", {
              body: { action: "get-equipment", equipmentId: eqId },
            });
            if (eqErr) continue;
            const eq = eqResp?.data?.result || eqResp?.result || eqResp?.data || {};
            const eqName = String(eq?.description || eq?.name || eq?.identifier || eq?.model || "").trim();
            if (eqName) {
              resolvedNome = eqName;
              break;
            }
          }
        }

        if (!cancelled) {
          setResolvedEquipment(resolvedNome || resolvedId ? { nome: resolvedNome, id: resolvedId } : null);
        }
      } catch (error) {
        console.warn("[budget-kanban] Falha ao resolver equipamento:", error);
      } finally {
        if (!cancelled) setIsEquipmentLoading(false);
      }
    };

    resolveEquipment();

    return () => {
      cancelled = true;
    };
  }, [selectedCard]);

  // Save edited questionnaire field
  const handleSaveFieldEdit = useCallback(async (keyword: string, newValue: string) => {
    if (!selectedCard) return;
    setIsSavingField(true);
    try {
      const respostas = [...selectedCard.questionario_respostas];
      // Find and update matching responses
      const matchingIndices = respostas
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.question.toLowerCase().includes(keyword.toLowerCase()) && r.reply && !r.reply.startsWith("http"));
      
      if (matchingIndices.length === 0) { toast.error("Campo não encontrado"); setIsSavingField(false); return; }
      
      // If multiple lines were joined, split back; otherwise update first match
      const lines = newValue.split("\n");
      if (matchingIndices.length === 1 || lines.length <= 1) {
        respostas[matchingIndices[0].i] = { ...respostas[matchingIndices[0].i], reply: newValue };
      } else {
        matchingIndices.forEach(({ i }, idx) => {
          respostas[i] = { ...respostas[i], reply: lines[idx] ?? respostas[i].reply };
        });
      }

      const { error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "persist-central",
          rows: [{ auvo_task_id: selectedCard.auvo_task_id, questionario_respostas: respostas }],
        },
      });
      if (error) throw error;

      const updatedCard = { ...selectedCard, questionario_respostas: respostas };
      setSelectedCard(updatedCard);
      setColumns(prev => prev.map(col => ({
        ...col,
        items: col.items.map(item => item.auvo_task_id === selectedCard.auvo_task_id ? updatedCard : item),
      })));
      setEditingSection(null);
      setEditValue("");
      toast.success("Campo atualizado!");
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || ""));
    } finally {
      setIsSavingField(false);
    }
  }, [selectedCard]);

  // AI improve text
  const handleAiImprove = useCallback(async (keyword: string) => {
    if (!selectedCard) return;
    const currentText = getAnswer(selectedCard, keyword);
    if (!currentText) { toast.error("Sem texto para melhorar"); return; }
    setAiLoadingSection(keyword);
    try {
      const isObservacao = keyword.toLowerCase().includes("observ");
      
      // For observações, send full context (peças, fotos, equipamento) for richer improvement
      const body: any = {
        action: "improve",
        text: currentText,
        field: keyword,
      };

      if (isObservacao) {
        const fotos = selectedCard.questionario_respostas
          .filter((r) => r.reply && r.reply.startsWith("http"))
          .map((r) => r.reply);

        body.context = {
          orientacao: selectedCard.orientacao,
          pecas: getAnswer(selectedCard, "peças") || getAnswer(selectedCard, "material") || getAnswer(selectedCard, "peca") || "",
          fotos,
        };
      }

      const { data: result, error } = await supabase.functions.invoke("genspark-ai", { body });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      if (result?.result) {
        setEditingSection(keyword);
        setEditValue(result.result);
        toast.success("Texto melhorado pela IA! Revise e salve.");
      }
    } catch (e: any) {
      toast.error("Erro na IA: " + (e?.message || "Tente novamente"));
    } finally {
      setAiLoadingSection(null);
    }
  }, [selectedCard]);

  // AI technical analysis with GPT-5 vision (photos + text + context)
  const handleAiAnalysis = useCallback(async () => {
    if (!selectedCard) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
      // Collect photo URLs from questionnaire responses
      const fotos = selectedCard.questionario_respostas
        .filter((r) => r.reply && r.reply.startsWith("http"))
        .map((r) => r.reply);

      // Collect ALL text answers for full context
      const todasRespostas = selectedCard.questionario_respostas
        .filter((r) => r.reply && !r.reply.startsWith("http"))
        .map((r) => `${r.question}: ${r.reply}`)
        .join("\n");

      // Extract equipment identification from questionnaire
      const equipamento = getAnswer(selectedCard, "equip") || getAnswer(selectedCard, "modelo") || getAnswer(selectedCard, "máquina") || getAnswer(selectedCard, "maquina") || getAnswer(selectedCard, "marca") || "";
      const equipamentoId = getAnswer(selectedCard, "patrimôn") || getAnswer(selectedCard, "patrimon") || getAnswer(selectedCard, "serie") || getAnswer(selectedCard, "série") || getAnswer(selectedCard, "número de série") || getAnswer(selectedCard, "placa") || getAnswer(selectedCard, "tag") || getAnswer(selectedCard, "id do equip") || "";

      const { data: result, error } = await supabase.functions.invoke("genspark-ai", {
        body: {
          action: "analyze",
          context: {
            cliente: selectedCard.cliente,
            tecnico: selectedCard.tecnico,
            data_tarefa: selectedCard.data_tarefa,
            orientacao: selectedCard.orientacao,
            equipamento: equipamento,
            equipamento_id: equipamentoId,
            descricao: getAnswer(selectedCard, "descri") || "",
            pecas: getAnswer(selectedCard, "peças") || getAnswer(selectedCard, "material") || getAnswer(selectedCard, "peca") || "",
            servicos: getAnswer(selectedCard, "serviços") || getAnswer(selectedCard, "servico") || "",
            tempo: getAnswer(selectedCard, "horas") || getAnswer(selectedCard, "tempo") || "",
            observacoes: getAnswer(selectedCard, "observ") || "",
            gc_valor: selectedCard.gc_orcamento?.gc_valor_total || selectedCard.gc_os?.gc_valor_total || "",
            gc_situacao: selectedCard.gc_orcamento?.gc_situacao || selectedCard.gc_os?.gc_situacao || "",
            fotos,
            todas_respostas: todasRespostas,
          },
        },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setAiAnalysis(result?.result || "Sem resultado");
    } catch (e: any) {
      toast.error("Erro na análise: " + (e?.message || "Tente novamente"));
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedCard]);

  // AI Chat about this budget
  const handleChatSend = useCallback(async () => {
    if (!selectedCard || !chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setIsChatLoading(true);
    try {
      const todasRespostas = selectedCard.questionario_respostas
        .filter((r) => r.reply && !r.reply.startsWith("http"))
        .map((r) => `${r.question}: ${r.reply}`)
        .join("\n");

      // Collect photo URLs for vision context
      const fotos = selectedCard.questionario_respostas
        .filter((r) => r.reply && r.reply.startsWith("http"))
        .map((r) => r.reply);

      const equipamento = getAnswer(selectedCard, "equip") || getAnswer(selectedCard, "modelo") || getAnswer(selectedCard, "máquina") || getAnswer(selectedCard, "maquina") || getAnswer(selectedCard, "marca") || "";
      const equipamentoId = getAnswer(selectedCard, "patrimôn") || getAnswer(selectedCard, "patrimon") || getAnswer(selectedCard, "serie") || getAnswer(selectedCard, "série") || getAnswer(selectedCard, "número de série") || getAnswer(selectedCard, "placa") || getAnswer(selectedCard, "tag") || getAnswer(selectedCard, "id do equip") || "";

      const { data: result, error } = await supabase.functions.invoke("genspark-ai", {
        body: {
          action: "chat",
          context: {
            cliente: selectedCard.cliente,
            tecnico: selectedCard.tecnico,
            data_tarefa: selectedCard.data_tarefa,
            orientacao: selectedCard.orientacao,
            equipamento: equipamento,
            equipamento_id: equipamentoId,
            pecas: getAnswer(selectedCard, "peças") || getAnswer(selectedCard, "material") || getAnswer(selectedCard, "peca") || "",
            servicos: getAnswer(selectedCard, "serviços") || getAnswer(selectedCard, "servico") || "",
            observacoes: getAnswer(selectedCard, "observ") || "",
            todas_respostas: todasRespostas,
            fotos,
          },
          analysis: aiAnalysis || "",
          userMessage: userMsg,
          chatHistory: chatMessages,
        },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setChatMessages(prev => [...prev, { role: "assistant", content: result?.result || "Sem resposta" }]);
    } catch (e: any) {
      toast.error("Erro no chat: " + (e?.message || "Tente novamente"));
      setChatMessages(prev => [...prev, { role: "assistant", content: "Erro ao processar. Tente novamente." }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [selectedCard, chatInput, chatMessages, aiAnalysis]);

  const resumo = data?.resumo;
  // Orçamentos realizados breakdown: hoje, semana, mês
  const orcBreakdown = useMemo(() => {
    if (!data?.items) return { hoje: 0, semana: 0, mes: 0 };
    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let hoje = 0, semana = 0, mes = 0;
    for (const item of data.items) {
      if (!item.orcamento_realizado || !item.gc_orcamento?.gc_data) continue;
      const d = new Date(item.gc_orcamento.gc_data);
      if (format(d, "yyyy-MM-dd") === todayStr) hoje++;
      if (isAfter(d, weekStart) || isEqual(d, weekStart)) semana++;
      if (isAfter(d, monthStart) || isEqual(d, monthStart)) mes++;
    }
    return { hoje, semana, mes };
  }, [data]);

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
              <h1 className="text-xl font-bold text-foreground">Kanban de Orçamentos</h1>
              <p className="text-sm text-muted-foreground">
                Tarefas com questionário de peças → Orçamentos no GestãoClick
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
                      if (d) {
                        setDateRange((prev) => ({ ...prev, to: d }));
                        setColumnsInitialized(false);
                      }
                    }}
                    locale={ptBR}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isSyncing || isFetching}>
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

          {/* Multi-select client filter */}
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

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Ordenar por..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">🔀 Manual (arrastar)</SelectItem>
              <SelectItem value="data">📅 Data</SelectItem>
              <SelectItem value="cliente">👤 Cliente</SelectItem>
              <SelectItem value="tecnico">🔧 Técnico</SelectItem>
              <SelectItem value="valor">💰 Valor (maior)</SelectItem>
            </SelectContent>
          </Select>

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
                <span className="text-[10px] text-emerald-600 ml-1">
                  (hoje: {orcBreakdown.hoje} · sem: {orcBreakdown.semana} · mês: {orcBreakdown.mes})
                </span>
              </Badge>
            </div>
          )}
        </div>
      </div>

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
                        className={`flex-shrink-0 w-[360px] transition-shadow ${colSnapshot.isDragging ? "shadow-xl opacity-90" : ""}`}
                      >
                        <div className="bg-muted/50 rounded-lg border h-full">
                          {/* Column Header — drag handle */}
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

                          {/* Droppable Area for cards */}
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

                                            {/* GC Orçamento summary */}
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
                                                  <div
                                                    className="h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: item.gc_orcamento.gc_cor_situacao }}
                                                  />
                                                  <span className="text-[10px] text-emerald-700">
                                                    {item.gc_orcamento.gc_situacao}
                                                  </span>
                                                  {item.gc_orcamento.gc_data && (
                                                    <span className="text-[10px] text-emerald-600 ml-auto">
                                                      {new Date(item.gc_orcamento.gc_data).toLocaleDateString("pt-BR")}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                            {/* GC OS summary */}
                                            {item.gc_os && (
                                              <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-xs font-medium text-blue-800">
                                                    OS #{item.gc_os.gc_os_codigo}
                                                  </span>
                                                  <span className="text-xs font-bold text-blue-700">
                                                    R$ {parseFloat(item.gc_os.gc_valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                  </span>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1">
                                                  <div
                                                    className="h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: item.gc_os.gc_cor_situacao }}
                                                  />
                                                  <span className="text-[10px] text-blue-700">
                                                    {item.gc_os.gc_situacao}
                                                  </span>
                                                  {item.gc_os.gc_data && (
                                                    <span className="text-[10px] text-blue-600 ml-auto">
                                                      {new Date(item.gc_os.gc_data).toLocaleDateString("pt-BR")}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                            {/* Links */}
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                              <a
                                                href={item.auvo_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <ExternalLink className="h-3 w-3" />
                                                Auvo
                                              </a>
                                              {item.auvo_task_url && (
                                                <a
                                                  href={item.auvo_task_url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-orange-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <FileDown className="h-3 w-3" />
                                                  OS Digital
                                                </a>
                                              )}
                                              {item.auvo_survey_url && (
                                                <a
                                                  href={item.auvo_survey_url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-purple-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <Star className="h-3 w-3" />
                                                  Pesquisa
                                                </a>
                                              )}
                                              {item.gc_orcamento && (
                                                <a
                                                  href={item.gc_orcamento.gc_link}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <ExternalLink className="h-3 w-3" />
                                                  Orçamento GC
                                                </a>
                                              )}
                                              {item.gc_os && (
                                                <a
                                                  href={item.gc_os.gc_link}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <ExternalLink className="h-3 w-3" />
                                                  OS GC
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

                {/* Add Column */}
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
      <Dialog open={!!selectedCard} onOpenChange={(open) => { if (!open) { setSelectedCard(null); setAiAnalysis(null); setShowChat(false); setChatMessages([]); } }}>
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
                {/* Equipment identification */}
                {(() => {
                  const equipNome = getAnswer(selectedCard, "equip") || getAnswer(selectedCard, "modelo") || getAnswer(selectedCard, "máquina") || getAnswer(selectedCard, "maquina") || getAnswer(selectedCard, "marca") || "";
                  const equipId = getAnswer(selectedCard, "patrimôn") || getAnswer(selectedCard, "patrimon") || getAnswer(selectedCard, "serie") || getAnswer(selectedCard, "série") || getAnswer(selectedCard, "número de série") || getAnswer(selectedCard, "placa") || getAnswer(selectedCard, "tag") || getAnswer(selectedCard, "id do equip") || "";
                  if (!equipNome && !equipId) return null;
                  return (
                    <div className="bg-accent/50 border border-accent rounded-lg p-3 flex items-center gap-3">
                      <span className="text-lg">🔧</span>
                      <div className="text-sm">
                        {equipNome && <div><span className="text-muted-foreground">Equipamento:</span> <span className="font-semibold">{equipNome}</span></div>}
                        {equipId && <div><span className="text-muted-foreground">ID / Série:</span> <span className="font-mono font-semibold">{equipId}</span></div>}
                      </div>
                    </div>
                  );
                })()}

                {/* Basic info */}
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

                {/* Links */}
                <div className="flex gap-3 flex-wrap">
                  <a
                    href={selectedCard.auvo_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir no Auvo
                  </a>
                  {selectedCard.auvo_task_url && (
                    <a
                      href={selectedCard.auvo_task_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:underline font-medium"
                    >
                      <FileDown className="h-4 w-4" />
                      OS Digital
                    </a>
                  )}
                  {selectedCard.auvo_survey_url && (
                    <a
                      href={selectedCard.auvo_survey_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:underline font-medium"
                    >
                      <Star className="h-4 w-4" />
                      Pesquisa de Satisfação
                    </a>
                  )}
                  {selectedCard.gc_orcamento && (
                    <a
                      href={selectedCard.gc_orcamento.gc_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:underline font-medium"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Orçamento GC
                    </a>
                  )}
                  {selectedCard.gc_os && (
                    <a
                      href={selectedCard.gc_os.gc_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
                    >
                      <ExternalLink className="h-4 w-4" />
                      OS GC
                    </a>
                  )}
                </div>

                {/* GC Orçamento details */}
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
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: selectedCard.gc_orcamento.gc_cor_situacao }}
                        />
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

                {/* GC OS details */}
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
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: selectedCard.gc_os.gc_cor_situacao }}
                        />
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

                {/* AI Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                    onClick={handleAiAnalysis}
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    {isAnalyzing ? "Analisando..." : "Analisar com IA"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                    onClick={() => { setShowChat(!showChat); }}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Tirar Dúvidas
                  </Button>
                </div>

                {/* AI Chat Panel */}
                {showChat && (
                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm text-indigo-900 flex items-center gap-1.5">
                        <MessageCircle className="h-4 w-4" /> Conversar sobre este Orçamento
                      </h4>
                      <button type="button" className="text-indigo-400 hover:text-indigo-600 text-xs" onClick={() => { setShowChat(false); setChatMessages([]); }}>✕ Fechar</button>
                    </div>
                    {chatMessages.length > 0 && (
                      <div className="max-h-[300px] overflow-y-auto space-y-2">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`text-sm p-2.5 rounded-lg ${msg.role === "user" ? "bg-indigo-100 text-indigo-900 ml-6" : "bg-white text-foreground mr-6 border border-indigo-100"}`}>
                            <span className="font-semibold text-xs block mb-1">{msg.role === "user" ? "Você" : "IA WeDo"}</span>
                            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                          </div>
                        ))}
                        {isChatLoading && (
                          <div className="flex items-center gap-2 text-sm text-indigo-500 p-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando...
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Faça uma pergunta sobre este orçamento..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChatSend()}
                        className="text-sm"
                        disabled={isChatLoading}
                      />
                      <Button size="sm" className="gap-1 shrink-0" disabled={isChatLoading || !chatInput.trim()} onClick={handleChatSend}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* AI Analysis Result */}
                {aiAnalysis && (
                  <div className="p-4 rounded-lg bg-purple-50 border border-purple-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm text-purple-900 flex items-center gap-1.5">
                        <Brain className="h-4 w-4" /> Análise Técnica (IA)
                      </h4>
                      <button type="button" className="text-purple-400 hover:text-purple-600 text-xs" onClick={() => setAiAnalysis(null)}>✕ Fechar</button>
                    </div>
                    <div className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{aiAnalysis}</div>
                  </div>
                )}

                {/* Peças Necessárias */}
                {(() => {
                  const answer = getAnswer(selectedCard, "peças");
                  if (!answer) return null;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-foreground">🔧 Peças Necessárias</h4>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-purple-500 hover:text-purple-700 disabled:opacity-50"
                            title="Melhorar com IA"
                            disabled={aiLoadingSection === "peças"}
                            onClick={() => handleAiImprove("peças")}
                          >
                            {aiLoadingSection === "peças" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingSection("peças"); setEditValue(answer); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editingSection === "peças" ? (
                        <div className="space-y-1.5">
                          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm min-h-[80px]" autoFocus />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={isSavingField} onClick={() => handleSaveFieldEdit("peças", editValue)}>
                              <Save className="h-3 w-3" />{isSavingField ? "Salvando..." : "Salvar"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSection(null); setEditValue(""); }}>Cancelar</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{answer}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Serviços */}
                {(() => {
                  const answer = getAnswer(selectedCard, "serviços");
                  if (!answer) return null;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-foreground">⚙️ Serviços Necessários</h4>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-purple-500 hover:text-purple-700 disabled:opacity-50"
                            title="Melhorar com IA"
                            disabled={aiLoadingSection === "serviços"}
                            onClick={() => handleAiImprove("serviços")}
                          >
                            {aiLoadingSection === "serviços" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingSection("serviços"); setEditValue(answer); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editingSection === "serviços" ? (
                        <div className="space-y-1.5">
                          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm min-h-[80px]" autoFocus />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={isSavingField} onClick={() => handleSaveFieldEdit("serviços", editValue)}>
                              <Save className="h-3 w-3" />{isSavingField ? "Salvando..." : "Salvar"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSection(null); setEditValue(""); }}>Cancelar</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{answer}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Tempo */}
                {(() => {
                  const answer = getAnswer(selectedCard, "horas");
                  if (!answer) return null;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-foreground">⏱️ Tempo para Execução</h4>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-purple-500 hover:text-purple-700 disabled:opacity-50"
                            title="Melhorar com IA"
                            disabled={aiLoadingSection === "horas"}
                            onClick={() => handleAiImprove("horas")}
                          >
                            {aiLoadingSection === "horas" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingSection("horas"); setEditValue(answer); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editingSection === "horas" ? (
                        <div className="space-y-1.5">
                          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm min-h-[60px]" autoFocus />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={isSavingField} onClick={() => handleSaveFieldEdit("horas", editValue)}>
                              <Save className="h-3 w-3" />{isSavingField ? "Salvando..." : "Salvar"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSection(null); setEditValue(""); }}>Cancelar</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">{answer}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Observações */}
                {(() => {
                  const answer = getAnswer(selectedCard, "observ");
                  if (!answer) return null;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-foreground">📝 Observações</h4>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-purple-500 hover:text-purple-700 disabled:opacity-50"
                            title="Melhorar com IA"
                            disabled={aiLoadingSection === "observ"}
                            onClick={() => handleAiImprove("observ")}
                          >
                            {aiLoadingSection === "observ" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingSection("observ"); setEditValue(answer); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {editingSection === "observ" ? (
                        <div className="space-y-1.5">
                          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm min-h-[80px]" autoFocus />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={isSavingField} onClick={() => handleSaveFieldEdit("observ", editValue)}>
                              <Save className="h-3 w-3" />{isSavingField ? "Salvando..." : "Salvar"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSection(null); setEditValue(""); }}>Cancelar</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{answer}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Orientação */}
                {selectedCard.orientacao && (
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm text-foreground">📋 Orientação da Tarefa</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {selectedCard.orientacao}
                    </p>
                  </div>
                )}

                {/* Fotos */}
                <PhotoGallery images={selectedCard.questionario_respostas.filter((r) => r.reply.startsWith("http")).map((r) => r.reply)} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
