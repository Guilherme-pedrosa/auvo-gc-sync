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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, CalendarIcon, RefreshCw, ExternalLink,
  Filter, GripVertical, Check, X, Edit2, Trash2, Plus,
  Package, FileText, ClipboardList, MapPin, ArrowUpDown, ArrowDown, ArrowUp,
  UserCog, Save, Loader2, LayoutGrid, Navigation, AlertTriangle,
  Search,
} from "lucide-react";
import { Map as MapIcon } from "lucide-react";
import OSMapView from "@/components/financeiro/OSMapView";
import RouteCorridorFilter from "@/components/financeiro/RouteCorridorFilter";
import FlagFilterPopover from "@/components/financeiro/FlagFilterPopover";
import { format } from "date-fns";
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
  gc_os_tarefa_exec: string | null;
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

/** Normalize client name for comparison: lowercase, no accents, strip LTDA/ME/SA/EPP suffixes */
function normalizeClientName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(ltda|me|sa|epp|eireli|s\.a\.|s\/a)\.?\b/gi, "")
    .replace(/[.\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract meaningful tokens from a normalized name */
function getTokens(name: string): Set<string> {
  return new Set(name.split(" ").filter(t => t.length > 1));
}

/** Check if Auvo and GC client names diverge using token overlap */
function hasClientDivergence(item: OSItem): boolean {
  if (!item.cliente || !item.gc_os_cliente) return false;
  const a = normalizeClientName(item.cliente);
  const b = normalizeClientName(item.gc_os_cliente);
  if (!a || !b) return false;
  // Fast path: substring match
  if (a.includes(b) || b.includes(a)) return false;
  // Token-based: if ≥70% of the smaller set's tokens appear in the larger set, consider them the same
  const tokA = getTokens(a);
  const tokB = getTokens(b);
  const [smaller, larger] = tokA.size <= tokB.size ? [tokA, tokB] : [tokB, tokA];
  if (smaller.size === 0) return false;
  let overlap = 0;
  for (const t of smaller) {
    if (larger.has(t)) overlap++;
  }
  return (overlap / smaller.size) < 0.7;
}

export default function OSKanbanPage() {
  const navigate = useNavigate();
  const today = new Date();
  // Add 1 day buffer to ensure today is always included regardless of timezone
  const todayPlus1 = new Date(today);
  todayPlus1.setDate(todayPlus1.getDate() + 1);
  const [dateRange, setDateRange] = useState({
    from: new Date(today.getFullYear(), 0, 1),
    to: todayPlus1,
  });
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
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
  // City/flag filter (multi-select)
  const [selectedFlags, setSelectedFlags] = useState<Set<string>>(new Set());
  const [allFlagsSelected, setAllFlagsSelected] = useState(true);
  
  const [filterOnlyRoutes, setFilterOnlyRoutes] = useState(false);
  // Edit task state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCard, setEditingCard] = useState<OSItem | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editHour, setEditHour] = useState("08");
  const [editMinute, setEditMinute] = useState("00");
  const [editTecnicoId, setEditTecnicoId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [execTaskId, setExecTaskId] = useState<string | null>(null);
  const [execTaskUrl, setExecTaskUrl] = useState<string | null>(null);
  const [execTaskLoading, setExecTaskLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "map">("kanban");
  const [corridorFilterIds, setCorridorFilterIds] = useState<Set<string> | null>(null);
  const [corridorRoute, setCorridorRoute] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Default excluded situações — statuses considered "concluded" flows
  const DEFAULT_EXCLUDED_SITUACOES = [
    "EXECUTADO",
    "EXECUTADO - AGUARDANDO NEGOCIAÇÃO",
    "EXECUTADO - AGUARDANDO PAGAMENTO",
    "EXECUTADO - FECHADO CHAMADO",
    "EXECUTADO - FINANCEIRO SEPARADO",
    "EXECUTADO COM NOTA EMITIDA",
    "EXECUTADO EM GARANTIA",
    "EXECUTADO POR CONTRATO",
    "FINANCEIRO SEPARADO / BAIXA CIGAM",
    "IMP CIGAM FATURADO TOTAL",
  ];

  // GC Situação filter: stores EXCLUDED situações (inverted logic)
  // Version key forces all users to get new defaults when predefined exclusions change
  const FILTER_VERSION = "v2";
  const FILTER_KEY = `oskanban_excludedSituacoes_${FILTER_VERSION}`;
  const [excludedSituacoes, setExcludedSituacoes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    return new Set(DEFAULT_EXCLUDED_SITUACOES);
  });
  const [searchSituacao, setSearchSituacao] = useState("");

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
    staleTime: 1000 * 60 * 30,
  });

  // Fetch execution task ID from GC OS attributes (campo 73344)
  const fetchExecTaskId = useCallback(async (gcOsId: string): Promise<{ execTaskId: string | null; osTaskId: string | null }> => {
    try {
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body: { endpoint: `/api/ordens_servicos/${gcOsId}`, method: "GET" },
      });
      if (error) return { execTaskId: null, osTaskId: null };

      const osObj = data?.data?.data ?? data?.data ?? null;
      if (!osObj) return { execTaskId: null, osTaskId: null };

      const atributos: any[] = osObj.atributos || [];
      const findAttrValue = (attrId: string) => {
        const attr = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === attrId;
        });
        if (!attr) return null;
        const nested = attr?.atributo || attr;
        const valor = String(nested?.conteudo || nested?.valor || "").trim();
        return valor && /^\d+$/.test(valor) ? valor : null;
      };

      return {
        osTaskId: findAttrValue("73343"),
        execTaskId: findAttrValue("73344"),
      };
    } catch {
      return { execTaskId: null, osTaskId: null };
    }
  }, []);

  const openEditModal = useCallback(async (card: OSItem) => {
    setEditingCard(card);
    setExecTaskId(null);
    setExecTaskUrl(null);
    setExecTaskLoading(true);
    setEditDate(undefined);
    setEditHour("08");
    setEditMinute("00");

    // Fallback technician from card (will be replaced by execution task data if available)
    const currentTecnico = auvoUsers?.find((u) => u.name === card.tecnico || u.login === card.tecnico);
    setEditTecnicoId(currentTecnico ? String(currentTecnico.userID) : card.tecnico_id || "");
    setShowEditModal(true);

    if (card.gc_os_id) {
      const { execTaskId: fetchedExecTaskId, osTaskId } = await fetchExecTaskId(card.gc_os_id);

      if (!fetchedExecTaskId) {
        toast.warning("Tarefa de execução (73344) não encontrada nesta OS");
        setExecTaskLoading(false);
        return;
      }

      if (osTaskId && fetchedExecTaskId === osTaskId) {
        toast.error("A tarefa de execução (73344) está igual à tarefa OS (73343). Verifique os campos no GC.");
      }

      setExecTaskId(fetchedExecTaskId);

      // Load execution task data from Auvo (date + technician)
      const { data: taskData, error: taskError } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "get", taskId: Number(fetchedExecTaskId) },
      });

      if (!taskError) {
        const taskObj = taskData?.data?.result ?? taskData?.data ?? null;

        const rawTaskUrl =
          taskObj?.taskUrl ||
          taskObj?.taskURL ||
          taskObj?.task_url ||
          taskObj?.url ||
          taskObj?.link ||
          null;

        if (rawTaskUrl && /^https?:\/\//i.test(String(rawTaskUrl))) {
          setExecTaskUrl(String(rawTaskUrl));
        } else {
          setExecTaskUrl(`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${fetchedExecTaskId}`);
        }

        const rawTaskDate = taskObj?.taskDate || taskObj?.task_date || taskObj?.date || null;
        if (rawTaskDate) {
          const parsedDate = new Date(rawTaskDate);
          if (!isNaN(parsedDate.getTime())) {
            setEditDate(parsedDate);
            setEditHour(String(parsedDate.getHours()).padStart(2, "0"));
            setEditMinute(String(parsedDate.getMinutes()).padStart(2, "0"));
          }
        }
        const rawUserTo = taskObj?.idUserTo ?? taskObj?.id_user_to ?? null;
        if (rawUserTo) setEditTecnicoId(String(rawUserTo));
      }
    }

    setExecTaskLoading(false);
  }, [auvoUsers, fetchExecTaskId]);

  const handleEditSave = useCallback(async () => {
    if (!editingCard || !execTaskId) {
      toast.error("ID da tarefa de execução não disponível");
      return;
    }
    setEditSaving(true);
    try {
      const patches: { op: string; path: string; value: any }[] = [];
      if (editDate) {
        const h = editHour.padStart(2, "0");
        const m = editMinute.padStart(2, "0");
        patches.push({ op: "replace", path: "taskDate", value: format(editDate, `yyyy-MM-dd'T'${h}:${m}:00`) });
      }
      if (editTecnicoId) {
        patches.push({ op: "replace", path: "idUserTo", value: Number(editTecnicoId) });
      }
      if (patches.length === 0) {
        toast.warning("Nenhuma alteração para salvar");
        setEditSaving(false);
        return;
      }

      console.log(`[edit] Editando tarefa de EXECUÇÃO #${execTaskId} (OS ${editingCard.gc_os_codigo})`);
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(execTaskId), patches },
      });

      if (error) throw error;
      if (data?.status && data.status >= 400) {
        throw new Error(JSON.stringify(data?.data || "Erro ao atualizar tarefa"));
      }

      toast.success(`Tarefa de execução #${execTaskId} atualizada no Auvo!`);
      setShowEditModal(false);
      setEditingCard(null);
    } catch (err: any) {
      console.error("Erro ao editar tarefa Auvo:", err);
      toast.error(`Erro: ${err.message || "Falha ao atualizar"}`);
    } finally {
      setEditSaving(false);
    }
  }, [editingCard, editDate, editTecnicoId, execTaskId]);

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

  // All unique GC situações (from rawItems, before filtering)
  const allSituacoes = useMemo(() => {
    if (!rawItems) return [];
    const set = new Set(rawItems.map((i) => i.gc_os_situacao || "").filter(Boolean));
    return Array.from(set).sort();
  }, [rawItems]);

  const filteredSituacaoOptions = useMemo(() => {
    if (!searchSituacao) return allSituacoes;
    return allSituacoes.filter((s) => s.toLowerCase().includes(searchSituacao.toLowerCase()));
  }, [allSituacoes, searchSituacao]);

  // Persist excluded situações to localStorage
  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(Array.from(excludedSituacoes)));
  }, [excludedSituacoes]);

  // Filter by excluded situações
  const items = useMemo(() => {
    if (!rawItems) return [];
    return rawItems.filter((i) => {
      const sit = i.gc_os_situacao || "";
      if (excludedSituacoes.has(sit)) return false;
      return true;
    });
  }, [rawItems, excludedSituacoes]);

  // Build columns: OS with status "Agendada" go to a special first column
  // Rebuild every time items change (no columnsInitialized gate)
  useEffect(() => {
    if (!items.length) return;

    const agendadoItems: OSItem[] = [];
    const situacaoMap: Record<string, { items: OSItem[]; color: string; sitId: string; displayName: string }> = {};

    for (const item of items) {
      const statusAuvo = (item.status_auvo || "").toLowerCase();
      if (statusAuvo === "aberta" || statusAuvo.includes("agendad")) {
        agendadoItems.push(item);
        continue;
      }

      const sitRaw = item.gc_os_situacao || "Sem situação";
      // Normalize key to avoid duplicates from accents/whitespace differences
      const sitKey = sitRaw.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!situacaoMap[sitKey]) {
        situacaoMap[sitKey] = {
          items: [],
          color: item.gc_os_cor_situacao || "#6b7280",
          sitId: item.gc_os_situacao_id || "",
          displayName: sitRaw.trim(),
        };
      }
      situacaoMap[sitKey].items.push(item);
    }

    const osCols: KanbanColumn[] = Object.entries(situacaoMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sit, data]) => ({
        id: `sit_${data.sitId || sit.replace(/\s+/g, "_")}`,
        title: data.displayName,
        color: data.color,
        items: data.items,
      }));

    const agendadoCol: KanbanColumn = {
      id: "col_agendado",
      title: "📅 Agendado",
      color: "#3b82f6",
      items: agendadoItems,
    };

    setColumns([agendadoCol, ...osCols]);
  }, [items]);

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

      const { data, error } = await syncPromise;
      cancelled = true;
      progressTimers.forEach(clearTimeout);

      if (error) throw error;
      if (data?.success === false) {
        throw new Error(data?.error || "Sincronização retornou falha");
      }
      setSyncStatus("Atualizando dados...");
      toast.success("Sincronização concluída!");
      // columns rebuild automatically via useEffect on items change
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

  // Extract location info from address: { region: "Bairro, Cidade - UF", city: "Cidade" }
  type LocationInfo = { region: string; city: string };

  // Known cities dictionary for fallback extraction from client names
  const KNOWN_CITIES: { pattern: RegExp; city: string; uf: string }[] = useMemo(() => [
    { pattern: /GOI[AÂ]NIA/i, city: "Goiânia", uf: "GO" },
    { pattern: /AN[AÁ]POLIS/i, city: "Anápolis", uf: "GO" },
    { pattern: /APARECIDA\s+DE\s+GOI[AÂ]NIA/i, city: "Aparecida de Goiânia", uf: "GO" },
    { pattern: /SENADOR\s+CANEDO/i, city: "Senador Canedo", uf: "GO" },
    { pattern: /TRINDADE/i, city: "Trindade", uf: "GO" },
    { pattern: /CALDAS\s+NOVAS/i, city: "Caldas Novas", uf: "GO" },
    { pattern: /CATAL[AÃ]O/i, city: "Catalão", uf: "GO" },
    { pattern: /MINEIROS/i, city: "Mineiros", uf: "GO" },
    { pattern: /RIO\s+VERDE/i, city: "Rio Verde", uf: "GO" },
    { pattern: /JATA[IÍ]/i, city: "Jataí", uf: "GO" },
    { pattern: /ITUMBIARA/i, city: "Itumbiara", uf: "GO" },
    { pattern: /MARA\s+ROSA/i, city: "Mara Rosa", uf: "GO" },
    { pattern: /CAMPO\s+VERDE/i, city: "Campo Verde", uf: "MT" },
    { pattern: /BRAS[IÍ]LIA/i, city: "Brasília", uf: "DF" },
    { pattern: /UBERL[AÂ]NDIA/i, city: "Uberlândia", uf: "MG" },
    { pattern: /CHAPAD[AÃ]O/i, city: "Chapadão", uf: "GO" },
  ], []);

  const extractLocation = useCallback((
    endereco: string | null,
    orientacao?: string | null,
    cliente?: string | null,
    gcOsCliente?: string | null,
    descricao?: string | null,
  ): LocationInfo | null => {
    const tryExtract = (text: string): LocationInfo | null => {
      if (!text || /^https?:\/\//i.test(text) || text.length < 5) return null;

      // Character class for city/bairro names (letters, spaces, dots, apostrophes)
      const C = "[A-Za-zÀ-ú\\s.']";

      // CEP pattern: 5 digits optionally followed by hyphen + 3 digits
      const CEP = "\\d{5}(?:-?\\d{3})?";

      // Full pattern: "..., Bairro, Cidade - UF, CEP, ..." 
      const mFull = text.match(new RegExp(`,\\s*(${C}+?),\\s*(${C}+?)\\s*-\\s*([A-Z]{2})\\s*,?\\s*${CEP}`, "i"));
      if (mFull) {
        const bairro = mFull[1].trim();
        const cidade = mFull[2].trim();
        const uf = mFull[3].trim();
        if (cidade.length >= 3) {
          return { region: `${bairro}, ${cidade} - ${uf}`, city: cidade };
        }
      }

      // "BAIRRO, CIDADE, UF, CEP" (comma between city and UF)
      const mComma = text.match(new RegExp(`,\\s*(${C}+?),\\s*(${C}+?),\\s*([A-Z]{2})\\s*,\\s*[\\d.\\-]+`, "i"));
      if (mComma) {
        const bairro = mComma[1].trim();
        const cidade = mComma[2].trim();
        const uf = mComma[3].trim();
        if (cidade.length >= 3) {
          return { region: `${bairro}, ${cidade} - ${uf}`, city: cidade };
        }
      }

      // "CIDADE, UF, CEP" (no bairro, comma format)
      const mCityComma = text.match(new RegExp(`(?:^|,\\s*)(${C}{3,}?),\\s*([A-Z]{2})\\s*,\\s*[\\d.\\-]{5,}`, "i"));
      if (mCityComma && mCityComma[1].trim().length >= 3) {
        const cidade = mCityComma[1].trim();
        return { region: `${cidade} - ${mCityComma[2]}`, city: cidade };
      }

      // "Cidade - UF, CEP" (no bairro)
      const m1 = text.match(new RegExp(`,\\s*(${C}+?)\\s*-\\s*([A-Z]{2})\\s*,?\\s*${CEP}`, "i"));
      if (m1 && m1[1].trim().length >= 3) {
        const cidade = m1[1].trim();
        return { region: `${cidade} - ${m1[2]}`, city: cidade };
      }

      // "Cidade - UF" at end or ", Brasil"
      const m3 = text.match(new RegExp(`,\\s*(${C}+?)\\s*-\\s*([A-Z]{2})\\s*(?:,\\s*Brasil)?$`, "i"));
      if (m3 && m3[1].trim().length >= 3) {
        const cidade = m3[1].trim();
        return { region: `${cidade} - ${m3[2]}`, city: cidade };
      }

      // "Cidade - UF, Brasil" anywhere
      const m3b = text.match(new RegExp(`(${C}{3,}?)\\s*-\\s*([A-Z]{2})\\s*,\\s*Brasil`, "i"));
      if (m3b && m3b[1].trim().length >= 3) {
        const cidade = m3b[1].trim();
        return { region: `${cidade} - ${m3b[2]}`, city: cidade };
      }

      // "Cidade/UF" (common in ECOLAB)
      const m4 = text.match(new RegExp(`(${C}{3,})\\/([A-Z]{2})(?:\\s|$|,|\\n)`, "i"));
      if (m4 && m4[1].trim().length >= 3) {
        const cidade = m4[1].trim();
        return { region: `${cidade} - ${m4[2]}`, city: cidade };
      }

      // ENDEREÇO: line with CIDADE/UF
      const mEnd = text.match(new RegExp(`ENDERE[ÇC]O:\\s*[^\\n,]*,\\s*([^\\n,]+),\\s*(${C}+)\\/([A-Z]{2})`, "i"));
      if (mEnd) {
        const bairro = mEnd[1].trim();
        const cidade = mEnd[2].trim();
        const uf = mEnd[3].trim();
        if (cidade.length >= 3) {
          return { region: `${bairro}, ${cidade} - ${uf}`, city: cidade };
        }
      }

      return null;
    };

    // Known-cities fallback: scan all fields for known city names
    const tryKnownCities = (...texts: (string | null | undefined)[]): LocationInfo | null => {
      const combined = texts.filter(Boolean).join(" ");
      if (combined.length < 3) return null;
      for (const kc of KNOWN_CITIES) {
        if (kc.pattern.test(combined)) {
          return { region: `${kc.city} - ${kc.uf}`, city: kc.city };
        }
      }
      return null;
    };

    return (
      tryExtract(endereco || "") ||
      tryExtract(orientacao || "") ||
      tryExtract(cliente || "") ||
      tryExtract(gcOsCliente || "") ||
      tryExtract(descricao || "") ||
      tryKnownCities(endereco, orientacao, cliente, gcOsCliente, descricao)
    );
  }, [KNOWN_CITIES]);

  // locationMap: task ID → LocationInfo { region, city }
  const locationMap = useMemo(() => {
    const map = new Map<string, LocationInfo>();
    // First pass: extract from own fields
    for (const item of items) {
      const loc = extractLocation(item.endereco, item.orientacao, item.cliente, item.gc_os_cliente, item.descricao);
      if (loc) map.set(item.auvo_task_id, loc);
    }
    // Second pass: inherit city from another item with the same client name
    const clientCityCache = new Map<string, LocationInfo>();
    for (const [, loc] of map) {
      // Build cache of client→city from resolved items (skip if already cached)
    }
    for (const item of items) {
      if (map.has(item.auvo_task_id)) {
        // Cache this client's city using normalized name
        const clientKey = normalizeClientName(item.cliente);
        const gcKey = normalizeClientName(item.gc_os_cliente);
        const loc = map.get(item.auvo_task_id)!;
        if (clientKey && !clientCityCache.has(clientKey)) clientCityCache.set(clientKey, loc);
        if (gcKey && !clientCityCache.has(gcKey)) clientCityCache.set(gcKey, loc);
      }
    }
    for (const item of items) {
      if (!map.has(item.auvo_task_id)) {
        const clientKey = normalizeClientName(item.cliente);
        const gcClientKey = normalizeClientName(item.gc_os_cliente);
        const inherited = clientCityCache.get(clientKey) || clientCityCache.get(gcClientKey);
        if (inherited) {
          map.set(item.auvo_task_id, inherited);
        }
      }
    }
    return map;
  }, [items, extractLocation]);

  // cityMap for backward compat (flags, route grouping uses region)
  const cityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, loc] of locationMap) {
      map.set(id, loc.region);
    }
    return map;
  }, [locationMap]);

  // routeGroups: maps each task ID to route partners
  // Criteria: same CITY + same date OR same CITY + same client
  // (uses city for grouping since routes cross neighborhoods within same city)
  const routeGroups = useMemo(() => {
    const byDateCity = new Map<string, { label: string; taskIds: Set<string> }>();
    const byClientCity = new Map<string, { label: string; taskIds: Set<string> }>();

    for (const item of items) {
      const loc = locationMap.get(item.auvo_task_id);
      if (!loc) continue;
      const cityLow = loc.city.toLowerCase();
      const client = (item.cliente || item.gc_os_cliente || "").trim().toLowerCase();

      // Group by city + date
      if (item.data_tarefa) {
        const key = `date|${cityLow}|${item.data_tarefa}`;
        if (!byDateCity.has(key)) byDateCity.set(key, { label: `${loc.city} • ${item.data_tarefa}`, taskIds: new Set() });
        byDateCity.get(key)!.taskIds.add(item.auvo_task_id);
      }

      // Group by city + client
      if (client) {
        const key = `client|${cityLow}|${client}`;
        if (!byClientCity.has(key)) byClientCity.set(key, { label: `${loc.city} • ${item.cliente || item.gc_os_cliente || ""}`, taskIds: new Set() });
        byClientCity.get(key)!.taskIds.add(item.auvo_task_id);
      }
    }

    // Merge: for each task, collect all unique partners from both groupings
    const taskPartnerIds = new Map<string, Set<string>>();
    const taskLabels = new Map<string, string>();

    const processGroup = (groups: Map<string, { label: string; taskIds: Set<string> }>) => {
      for (const [, group] of groups) {
        if (group.taskIds.size < 2) continue;
        for (const id of group.taskIds) {
          if (!taskPartnerIds.has(id)) taskPartnerIds.set(id, new Set());
          if (!taskLabels.has(id)) taskLabels.set(id, group.label);
          for (const partnerId of group.taskIds) {
            taskPartnerIds.get(id)!.add(partnerId);
          }
        }
      }
    };

    processGroup(byDateCity);
    processGroup(byClientCity);

    // Build final map
    const taskToGroup = new Map<string, { city: string; label: string; partners: OSItem[] }>();
    for (const [taskId, partnerIds] of taskPartnerIds) {
      const loc = locationMap.get(taskId);
      const region = loc?.region || cityMap.get(taskId) || "";
      const partnerItems = items.filter((i) => partnerIds.has(i.auvo_task_id));
      taskToGroup.set(taskId, {
        city: region,
        label: taskLabels.get(taskId) || region,
        partners: partnerItems,
      });
    }
    return taskToGroup;
  }, [items, locationMap, cityMap]);

  // Color palette for city flags
  const FLAG_COLORS = [
    { bg: "#ef4444", text: "#fff" }, // red
    { bg: "#f97316", text: "#fff" }, // orange
    { bg: "#eab308", text: "#000" }, // yellow
    { bg: "#22c55e", text: "#fff" }, // green
    { bg: "#06b6d4", text: "#fff" }, // cyan
    { bg: "#3b82f6", text: "#fff" }, // blue
    { bg: "#8b5cf6", text: "#fff" }, // violet
    { bg: "#ec4899", text: "#fff" }, // pink
    { bg: "#14b8a6", text: "#fff" }, // teal
    { bg: "#f59e0b", text: "#000" }, // amber
    { bg: "#6366f1", text: "#fff" }, // indigo
    { bg: "#d946ef", text: "#fff" }, // fuchsia
  ];

  const allCities = useMemo(() => {
    const set = new Set<string>();
    for (const [, city] of cityMap) set.add(city);
    return Array.from(set).sort();
  }, [cityMap]);

  const cityColorMap = useMemo(() => {
    const map = new Map<string, { bg: string; text: string }>();
    allCities.forEach((city, i) => {
      map.set(city, FLAG_COLORS[i % FLAG_COLORS.length]);
    });
    return map;
  }, [allCities]);

  // Detect duplicate execution tasks (gc_os_tarefa_exec shared by 2+ OS)
  const execTaskDuplicates = useMemo(() => {
    const countByExec = new Map<string, string[]>(); // exec_task_id → [gc_os_codigo, ...]
    for (const item of items) {
      const exec = (item as any).gc_os_tarefa_exec;
      if (!exec) continue;
      if (!countByExec.has(exec)) countByExec.set(exec, []);
      countByExec.get(exec)!.push(item.gc_os_codigo || item.auvo_task_id);
    }
    // Only keep entries with 2+ OS
    const result = new Map<string, string[]>();
    for (const [exec, codes] of countByExec) {
      if (codes.length >= 2) result.set(exec, codes);
    }
    return result;
  }, [items]);

  // Count items per city
  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, city] of cityMap) {
      counts.set(city, (counts.get(city) || 0) + 1);
    }
    return counts;
  }, [cityMap]);

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
        // Flag filter
        if (!allFlagsSelected && selectedFlags.size > 0) {
          const city = cityMap.get(item.auvo_task_id);
          if (!city || !selectedFlags.has(city)) return false;
        }
        // Only routes filter
        if (filterOnlyRoutes) {
          if (!routeGroups.has(item.auvo_task_id)) return false;
        }
        // Corridor filter
        if (corridorFilterIds !== null) {
          if (!corridorFilterIds.has(item.auvo_task_id)) return false;
        }
        // Text search filter
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const fields = [
            item.auvo_task_id,
            item.gc_os_codigo,
            item.gc_orcamento_codigo,
            item.descricao,
            item.cliente,
            item.gc_os_cliente,
          ];
          if (!fields.some((f) => f && f.toLowerCase().includes(q))) return false;
        }
        return true;
      });
      const sortKey = columnSorts[col.id] || globalSort;
      filtered = sortItems(filtered, sortKey);
      return { ...col, items: filtered };
    });
  }, [columns, filterTecnico, allClientesSelected, selectedClientes, valorMin, valorMax, globalSort, columnSorts, sortItems, allFlagsSelected, selectedFlags, cityMap, filterOnlyRoutes, routeGroups, corridorFilterIds, searchQuery]);

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
                    onSelect={(d) => d && setDateRange((prev) => ({ ...prev, to: d }))}
                    locale={ptBR}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing || isFetching} className="min-w-[180px]">
              <RefreshCw className={`h-4 w-4 mr-2 flex-shrink-0 ${isSyncing ? "animate-spin" : ""}`} />
              <span className="truncate">{isSyncing ? syncStatus || "Sincronizando..." : "Sincronizar"}</span>
            </Button>
            <div className="flex items-center border rounded-md overflow-hidden">
              <Button
                variant={viewMode === "kanban" ? "default" : "ghost"}
                size="sm"
                className="rounded-none gap-1.5"
                onClick={() => setViewMode("kanban")}
              >
                <LayoutGrid className="h-4 w-4" /> Kanban
              </Button>
              <Button
                variant={viewMode === "map" ? "default" : "ghost"}
                size="sm"
                className="rounded-none gap-1.5"
                onClick={() => setViewMode("map")}
              >
                <MapIcon className="h-4 w-4" /> Mapa
              </Button>
            </div>
          </div>
        </div>

        {/* Filters + Summary */}
        <div className="flex items-center gap-4 mt-4 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar tarefa, OS, orçamento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-[260px] pl-8 text-xs"
            />
          </div>
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

          {/* Situação GC filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-3.5 w-3.5" />
                {excludedSituacoes.size === 0
                  ? `${allSituacoes.length} situações`
                  : `${allSituacoes.length - excludedSituacoes.size} situaç${(allSituacoes.length - excludedSituacoes.size) !== 1 ? "ões" : "ão"}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <div className="p-3 border-b">
                <Input
                  placeholder="Buscar situação..."
                  value={searchSituacao}
                  onChange={(e) => setSearchSituacao(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="p-2 border-b">
                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-accent rounded text-sm">
                  <Checkbox
                    checked={excludedSituacoes.size === 0}
                    onCheckedChange={(checked) => {
                      if (checked) setExcludedSituacoes(new Set());
                    }}
                  />
                  <span className="font-medium">Todas (padrão)</span>
                </label>
              </div>
              <ScrollArea className="h-[280px]">
                <div className="p-2 space-y-0.5">
                  {filteredSituacaoOptions.map((sit) => {
                    const corItem = rawItems?.find((i) => i.gc_os_situacao === sit);
                    const cor = corItem?.gc_os_cor_situacao || undefined;
                    const isChecked = !excludedSituacoes.has(sit);
                    return (
                      <label key={sit} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded text-sm">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => {
                            setExcludedSituacoes((prev) => {
                              const next = new Set(prev);
                              if (isChecked) next.add(sit);
                              else next.delete(sit);
                              return next;
                            });
                          }}
                        />
                        {cor && (
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
                        )}
                        <span className="truncate">{sit}</span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Flag filter */}
          <FlagFilterPopover
            allCities={allCities}
            cityColorMap={cityColorMap}
            cityCounts={cityCounts}
            selectedFlags={selectedFlags}
            allFlagsSelected={allFlagsSelected}
            filterOnlyRoutes={filterOnlyRoutes}
            onApply={(flags, allSelected, onlyRoutes) => {
              setSelectedFlags(flags);
              setAllFlagsSelected(allSelected);
              setFilterOnlyRoutes(onlyRoutes);
            }}
            onRoteirizar={() => setViewMode("map")}
          />

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

          {/* Route corridor filter */}
          <RouteCorridorFilter
            allCities={allCities}
            cityMap={cityMap}
            osItems={items.map((it) => ({
              auvo_task_id: it.auvo_task_id,
              gc_os_codigo: it.gc_os_codigo,
              cliente: it.gc_os_cliente || it.cliente,
              cidade: cityMap.get(it.auvo_task_id),
            }))}
            onFilterChange={setCorridorFilterIds}
            onShowMap={() => setViewMode("map")}
            onCorridorRouteChange={setCorridorRoute}
          />

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

      {/* Map View */}
      {!isLoading && viewMode === "map" && (
        <OSMapView
          items={(() => {
            let filtered = items;
            if (!allFlagsSelected && selectedFlags.size > 0) {
              filtered = filtered.filter((item) => {
                const city = cityMap.get(item.auvo_task_id);
                return city && selectedFlags.has(city);
              });
            }
            if (filterOnlyRoutes) {
              filtered = filtered.filter((item) => routeGroups.has(item.auvo_task_id));
            }
            if (corridorFilterIds !== null) {
              filtered = filtered.filter((item) => corridorFilterIds.has(item.auvo_task_id));
            }
            return filtered;
          })()}
          cityColorMap={cityColorMap}
          cityMap={cityMap}
          formatCurrency={formatCurrency}
          onSelectCard={(item) => setSelectedCard(item as any)}
          autoOptimize={!allFlagsSelected && selectedFlags.size > 0}
          corridorRoute={corridorRoute}
        />
      )}

      {/* Kanban Board */}
      {!isLoading && viewMode === "kanban" && (
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
                                  <Draggable key={`${item.auvo_task_id}-${item.gc_os_id || 'no-os'}`} draggableId={`${item.auvo_task_id}-${item.gc_os_id || 'no-os'}`} index={index}>
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
                                              {item.gc_os_codigo ? `OS ${item.gc_os_codigo}` : `T#${item.auvo_task_id}`}
                                            </span>
                                            <Badge variant="outline" className="text-[10px] h-5">
                                              {item.status_auvo || "—"}
                                            </Badge>
                                          </div>
                                          <p className="text-sm font-semibold text-foreground mt-1 truncate" title={item.cliente || item.gc_os_cliente || ""}>
                                            {abbreviateName(item.cliente || item.gc_os_cliente || "")}
                                          </p>
                                          {hasClientDivergence(item) && (
                                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-amber-600 dark:text-amber-400" title={`Auvo: ${item.cliente}\nGC: ${item.gc_os_cliente}`}>
                                              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                              <span className="truncate">Cliente GC diferente</span>
                                            </div>
                                          )}
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {item.tecnico || "—"} • {item.data_tarefa || "—"}
                                          </p>
                                          {/* Address preview */}
                                          {item.endereco && item.endereco.length > 5 && (
                                            <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate flex items-center gap-0.5" title={item.endereco}>
                                              <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                                              {item.endereco.length > 60 ? item.endereco.substring(0, 60) + "…" : item.endereco}
                                            </p>
                                          )}
                                          {/* Orientação preview */}
                                          {item.orientacao && (
                                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 italic">
                                              {item.orientacao.substring(0, 80)}{item.orientacao.length > 80 ? "…" : ""}
                                            </p>
                                          )}
                                          {/* City flag + Route flag */}
                                          {(() => {
                                            const city = cityMap.get(item.auvo_task_id);
                                            const routeGroup = routeGroups.get(item.auvo_task_id);
                                            const color = city ? cityColorMap.get(city) : null;
                                            return (city || routeGroup) ? (
                                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                {city && color && (
                                                  <span
                                                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold border"
                                                    style={{ backgroundColor: color.bg, color: color.text, borderColor: color.bg }}
                                                  >
                                                    🚩 {city}
                                                  </span>
                                                )}
                                                {routeGroup && (
                                                  <Popover>
                                                    <PopoverTrigger asChild>
                                                      <button
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="inline-flex"
                                                      >
                                                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold border cursor-pointer bg-foreground/10 hover:bg-foreground/20 transition-colors text-foreground border-foreground/20">
                                                          🔗 Rota ({routeGroup.partners.length})
                                                        </span>
                                                      </button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-[320px] p-0" align="start" onClick={(e) => e.stopPropagation()}>
                                                      <div className="px-3 py-2 border-b bg-muted">
                                                        <p className="text-sm font-semibold flex items-center gap-1.5">
                                                          <MapPin className="h-3.5 w-3.5" />
                                                          Rota: {routeGroup.city}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">{routeGroup.label} • {routeGroup.partners.length} atendimentos</p>
                                                      </div>
                                                      <ScrollArea className="max-h-[250px]">
                                                        <div className="p-2 space-y-1.5">
                                                          {routeGroup.partners.map((p) => {
                                                            const pCity = cityMap.get(p.auvo_task_id);
                                                            const pColor = pCity ? cityColorMap.get(pCity) : null;
                                                            return (
                                                              <div
                                                                key={p.auvo_task_id}
                                                                className={cn(
                                                                  "rounded border px-2.5 py-1.5 text-xs",
                                                                  p.auvo_task_id === item.auvo_task_id
                                                                    ? "bg-accent border-primary/30"
                                                                    : "bg-card"
                                                                )}
                                                              >
                                                                <div className="flex items-center justify-between">
                                                                  <div className="flex items-center gap-1.5">
                                                                    {pColor && (
                                                                      <span
                                                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                                        style={{ backgroundColor: pColor.bg }}
                                                                      />
                                                                    )}
                                                                    <span className="font-mono text-muted-foreground">
                                                                      {p.gc_os_codigo ? `OS ${p.gc_os_codigo}` : `T#${p.auvo_task_id}`}
                                                                    </span>
                                                                  </div>
                                                                  <span className="font-medium">
                                                                    {formatCurrency(Number(p.gc_os_valor_total) || 0)}
                                                                  </span>
                                                                </div>
                                                                <p className="font-medium truncate mt-0.5">{p.cliente || p.gc_os_cliente || "—"}</p>
                                                                <p className="text-muted-foreground">{p.tecnico || "—"} • {p.data_tarefa || "—"}</p>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      </ScrollArea>
                                                    </PopoverContent>
                                                  </Popover>
                                                )}
                                              </div>
                                            ) : null;
                                          })()}
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
                  <span className="text-muted-foreground text-xs">Cliente (Auvo)</span>
                  <p className="font-medium">{selectedCard.cliente || "—"}</p>
                  {selectedCard.gc_os_cliente && (
                    <p className="text-xs text-muted-foreground">GC: {selectedCard.gc_os_cliente}</p>
                  )}
                  {hasClientDivergence(selectedCard) && (
                    <div className="flex items-center gap-1 mt-1 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      <span className="text-[11px] text-amber-700 dark:text-amber-300">
                        Divergência: Auvo "{selectedCard.cliente}" ≠ GC "{selectedCard.gc_os_cliente}"
                      </span>
                    </div>
                  )}
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
                  <p className="text-sm flex-1">{selectedCard.endereco}</p>
                  <Button size="sm" variant="outline" className="flex-shrink-0 gap-1 h-7 text-xs" asChild>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedCard.endereco)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Navigation className="h-3 w-3" /> Maps
                    </a>
                  </Button>
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
                // GC returns nested: produtos[].produto, servicos[].servico
                const produtos: any[] = (osDetail?.produtos || []).map((p: any) => p?.produto || p);
                const servicos: any[] = (osDetail?.servicos || []).map((s: any) => s?.servico || s);
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
                              const nome = String(s.nome_servico || s.nome_produto || s.descricao || s.nome || s.detalhes || "—");
                              const codigo = String(s.servico_id || s.produto_id || s.codigo || s.referencia || "—");
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
                  <Edit2 className="h-3.5 w-3.5" /> Editar Agendamento
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
                  OS {editingCard.gc_os_codigo}
                </p>
                <p className="text-xs mt-1">
                  {execTaskLoading ? (
                    <span className="text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando tarefa de execução...</span>
                  ) : execTaskId ? (
                    <a href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${execTaskId}`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
                      ✓ Tarefa Execução #{execTaskId} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-destructive">⚠ Tarefa de execução não encontrada</span>
                  )}
                </p>
              </div>

              {/* Date picker */}
              <div className="space-y-2">
                <Label>Data da Tarefa de Execução</Label>
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

              {/* Time picker */}
              <div className="space-y-2">
                <Label>Horário</Label>
                <div className="flex items-center gap-2">
                  <Select value={editHour} onValueChange={setEditHour}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder="HH" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-lg font-bold text-muted-foreground">:</span>
                  <Select value={editMinute} onValueChange={setEditMinute}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder="MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {["00", "15", "30", "45"].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                <Button onClick={handleEditSave} disabled={editSaving || execTaskLoading || !execTaskId}>
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
