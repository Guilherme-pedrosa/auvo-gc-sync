import { useState, useMemo, useCallback, useEffect, DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Loader2, ExternalLink, MapPin, Clock, AlertTriangle, Pencil, Save, X, Filter
} from "lucide-react";
import { format, addDays, startOfWeek, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import LastSyncBadge from "@/components/LastSyncBadge";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Tarefa = {
  auvo_task_id: string;
  cliente: string | null;
  tecnico: string | null;
  tecnico_id: string | null;
  data_tarefa: string | null;
  status_auvo: string | null;
  descricao: string | null;
  endereco: string | null;
  auvo_link: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  duracao_decimal: number | null;
  check_in: boolean;
  check_out: boolean;
  gc_os_valor_total: number | null;
  gc_orc_valor_total: number | null;
  gc_os_situacao: string | null;
  gc_os_codigo: string | null;
  gc_os_link: string | null;
  gc_orc_situacao: string | null;
  gc_orcamento_codigo: string | null;
  gc_orc_link: string | null;
  pendencia: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  "Agendada": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Aberta": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "A caminho": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Iniciada": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Em andamento": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Finalizada": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Não Executada": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "Cancelada": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getWeekStart(refDate: Date): Date {
  return startOfWeek(refDate, { weekStartsOn: 1 });
}

type ViewMode = "dia" | "semana" | "mes";

export default function AgendaSemanalPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("semana");
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [selectedTarefa, setSelectedTarefa] = useState<Tarefa | null>(null);
  const [isRefreshingFromApi, setIsRefreshingFromApi] = useState(false);
  const [selectedTecnicos, setSelectedTecnicos] = useState<Set<string> | null>(() => {
    try {
      const saved = localStorage.getItem("agenda_selectedTecnicos");
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        return arr.length > 0 ? new Set(arr) : null;
      }
    } catch { /* ignore */ }
    return null;
  });

  const selectedDay = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);

  const weekStart = useMemo(() => {
    const today = new Date();
    return addDays(today, weekOffset * 7);
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  // For day view, we query for that single day; for week view, the week range
  const queryStartDate = viewMode === "dia" ? format(selectedDay, "yyyy-MM-dd") : format(weekStart, "yyyy-MM-dd");
  const queryEndDate = viewMode === "dia" ? format(selectedDay, "yyyy-MM-dd") : format(addDays(weekStart, 5), "yyyy-MM-dd");
  const queryKey = ["agenda-semanal", queryStartDate, queryEndDate];

  // Fetch all Auvo users (technicians)
  const { data: allUsers } = useQuery({
    queryKey: ["auvo-all-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-users" },
      });
      if (error) throw error;
      return (data?.data || []) as Array<{ userID: number; name: string; login: string }>;
    },
    staleTime: 1000 * 60 * 10,
  });

  const { data: tarefas, isLoading, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("tarefas_central")
        .select(
          "auvo_task_id, cliente, tecnico, tecnico_id, data_tarefa, status_auvo, " +
          "orientacao, endereco, auvo_link, hora_inicio, hora_fim, duracao_decimal, check_in, check_out, " +
          "gc_os_valor_total, gc_orc_valor_total, gc_os_situacao, gc_os_codigo, gc_os_link, " +
          "gc_orc_situacao, gc_orcamento_codigo, gc_orc_link, pendencia"
        )
        .gte("data_tarefa", queryStartDate)
        .lte("data_tarefa", queryEndDate)
        .order("data_tarefa", { ascending: true });

      if (error) throw error;

      // Map orientacao -> descricao for component compatibility
      return (rows || []).map((r: any) => ({
        ...r,
        descricao: r.orientacao || r.descricao || null,
      })) as Tarefa[];
    },
    staleTime: 1000 * 60 * 5,
  });

  // Refresh from live API (Auvo + GC) and update cache
  const refreshFromApi = useCallback(async () => {
    setIsRefreshingFromApi(true);
    try {
      const startStr = queryStartDate;
      const endStr = queryEndDate;
      const { data, error } = await supabase.functions.invoke("auvo-agenda", {
        body: { startDate: startStr, endDate: endStr },
      });
      if (error) throw error;
      const apiTarefas = (data?.data || []) as Tarefa[];
      // Update react-query cache directly with fresh API data
      queryClient.setQueryData(queryKey, apiTarefas);

      // Persist to tarefas_central so values survive page reload
      const upsertRows = apiTarefas.map((t) => ({
        auvo_task_id: t.auvo_task_id,
        cliente: t.cliente,
        tecnico: t.tecnico,
        tecnico_id: t.tecnico_id,
        data_tarefa: t.data_tarefa,
        status_auvo: t.status_auvo,
        hora_inicio: t.hora_inicio,
        hora_fim: t.hora_fim,
        duracao_decimal: t.duracao_decimal,
        check_in: t.check_in,
        check_out: t.check_out,
        endereco: t.endereco,
        auvo_link: t.auvo_link,
        orientacao: t.descricao,
        gc_os_codigo: t.gc_os_codigo,
        gc_os_situacao: t.gc_os_situacao,
        gc_os_valor_total: t.gc_os_valor_total,
        gc_os_link: t.gc_os_link,
        gc_orcamento_codigo: t.gc_orcamento_codigo,
        gc_orc_situacao: t.gc_orc_situacao,
        gc_orc_valor_total: t.gc_orc_valor_total,
        gc_orc_link: t.gc_orc_link,
        pendencia: t.pendencia,
        atualizado_em: new Date().toISOString(),
      }));

      if (upsertRows.length > 0) {
        const { error: persistError } = await supabase.functions.invoke("auvo-task-update", {
          body: { action: "persist-central", rows: upsertRows },
        });
        if (persistError) throw persistError;
      }

      toast.success(`${apiTarefas.length} tarefas atualizadas da API`);
      // Refresh the last-sync badge
      queryClient.invalidateQueries({ queryKey: ["last-sync-timestamp"] });
    } catch (err: any) {
      console.error("[agenda] Erro ao atualizar da API:", err);
      toast.error(`Erro ao atualizar: ${err.message}`);
    } finally {
      setIsRefreshingFromApi(false);
    }
  }, [queryStartDate, queryEndDate, queryClient, queryKey]);

  const tecnicos = useMemo(() => {
    const map = new Map<string, { nome: string; id: string | null }>();
    // Add all Auvo users first
    if (allUsers) {
      for (const u of allUsers) {
        const nome = String(u.name || u.login || "").trim();
        const id = String(u.userID || "");
        if (nome && nome !== "Sem técnico") {
          map.set(nome, { nome, id });
        }
      }
    }
    // Also add any from tasks (in case of mismatches)
    if (tarefas) {
      for (const t of tarefas) {
        const nome = t.tecnico || "Sem técnico";
        if (!map.has(nome)) map.set(nome, { nome, id: t.tecnico_id });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [tarefas, allUsers]);

  // Persist filter to localStorage (only when tecnicos are loaded)
  useEffect(() => {
    if (selectedTecnicos && selectedTecnicos.size > 0) {
      localStorage.setItem("agenda_selectedTecnicos", JSON.stringify([...selectedTecnicos]));
    } else if (selectedTecnicos === null && tecnicos.length > 0) {
      localStorage.removeItem("agenda_selectedTecnicos");
    }
  }, [selectedTecnicos, tecnicos.length]);

  const dayTotals = useMemo(() => {
    if (!tarefas) return weekDays.map(() => 0);
    return weekDays.map((wd) => {
      return tarefas
        .filter(t => t.data_tarefa && isSameDay(parseISO(t.data_tarefa), wd))
        .reduce((sum, t) => sum + (t.gc_os_valor_total ?? 0), 0);
    });
  }, [tarefas, weekDays]);

  // Filtered technicians
  const filteredTecnicos = useMemo(() => {
    if (!selectedTecnicos) return tecnicos;
    return tecnicos.filter(t => selectedTecnicos.has(t.nome));
  }, [tecnicos, selectedTecnicos]);

  const grid = useMemo(() => {
    if (!tarefas) return new Map<string, Tarefa[][]>();
    const result = new Map<string, Tarefa[][]>();
    for (const tec of filteredTecnicos) {
      const days: Tarefa[][] = weekDays.map(() => []);
      const tecTarefas = tarefas.filter((t) => (t.tecnico || "Sem técnico") === tec.nome);
      for (const tarefa of tecTarefas) {
        if (!tarefa.data_tarefa) continue;
        const d = parseISO(tarefa.data_tarefa);
        const idx = weekDays.findIndex((wd) => isSameDay(wd, d));
        if (idx >= 0) days[idx].push(tarefa);
      }
      result.set(tec.nome, days);
    }
    return result;
  }, [tarefas, filteredTecnicos, weekDays]);

  // --- Drag & Drop ---
  const handleDragStart = useCallback((e: DragEvent, tarefa: Tarefa) => {
    e.dataTransfer.setData("application/json", JSON.stringify({
      taskId: tarefa.auvo_task_id,
      fromTecnico: tarefa.tecnico,
      fromTecnicoId: tarefa.tecnico_id,
      fromDate: tarefa.data_tarefa,
      horaInicio: tarefa.hora_inicio,
    }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: DragEvent, cellKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCell(cellKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent, toTecNome: string, toTecId: string | null, toDayIdx: number) => {
    e.preventDefault();
    setDragOverCell(null);

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;

    const { taskId, fromTecnico, fromDate, horaInicio } = JSON.parse(raw);
    const newDate = format(weekDays[toDayIdx], "yyyy-MM-dd");
    const sameDay = fromDate === newDate;
    const sameTec = fromTecnico === toTecNome;

    if (sameDay && sameTec) return;

    setMovingTaskId(taskId);

    try {
      const { data: taskData } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "get", taskId: Number(taskId) },
      });

      const taskResult = taskData?.data?.result;
      if (!taskResult) throw new Error("Não foi possível obter dados da tarefa");

      const patches: Array<{ op: string; path: string; value: any }> = [];
      const fallbackTimeFromTask = String(taskResult.taskDate || "").substring(11, 19);
      const persistedHoraInicio = horaInicio || (fallbackTimeFromTask || null);

      if (!sameDay) {
        // Preserve existing time from the task
        const existingTime = persistedHoraInicio ? persistedHoraInicio.substring(0, 5) + ":00" : "08:00:00";
        const newDateFormatted = format(weekDays[toDayIdx], "yyyy-MM-dd") + "T" + existingTime;
        patches.push({ op: "replace", path: "/taskDate", value: newDateFormatted });
      }

      if (!sameTec && toTecId) {
        patches.push({ op: "replace", path: "/idUserTo", value: Number(toTecId) });
      }

      if (patches.length === 0) { setMovingTaskId(null); return; }

      const { data: patchResult, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(taskId), patches },
      });

      if (error) throw error;
      if (patchResult?.status && patchResult.status >= 400) {
        throw new Error(patchResult?.data?.message || `Erro ${patchResult.status}`);
      }

      queryClient.setQueryData(queryKey, (old: Tarefa[] | undefined) => {
        if (!old) return old;
        return old.map(t => {
          if (t.auvo_task_id !== taskId) return t;
          return {
            ...t,
            data_tarefa: newDate,
            hora_inicio: persistedHoraInicio,
            ...((!sameTec && toTecId) ? { tecnico: toTecNome, tecnico_id: toTecId } : {}),
          };
        });
      });

      const { error: persistError } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "persist-central",
          row: {
            auvo_task_id: taskId,
            data_tarefa: newDate,
            hora_inicio: persistedHoraInicio,
            ...((!sameTec && toTecId) ? { tecnico: toTecNome, tecnico_id: toTecId } : {}),
          },
        },
      });
      if (persistError) throw persistError;

      const changes: string[] = [];
      if (!sameDay) changes.push(`data → ${format(weekDays[toDayIdx], "dd/MM")}`);
      if (!sameTec) changes.push(`técnico → ${toTecNome}`);
      toast.success(`Tarefa atualizada: ${changes.join(", ")}`);
    } catch (err: any) {
      console.error("[agenda] Erro ao mover tarefa:", err);
      toast.error(`Erro ao mover tarefa: ${err.message}`);
    } finally {
      setMovingTaskId(null);
    }
  }, [weekDays, queryClient, queryKey]);

  const totalTarefas = tarefas?.length || 0;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Agenda {viewMode === "dia" ? "Diária" : viewMode === "semana" ? "Semanal" : "Mensal"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {totalTarefas} tarefa{totalTarefas !== 1 ? "s" : ""} · {tecnicos.length} técnico{tecnicos.length !== 1 ? "s" : ""}
                {movingTaskId && <span className="ml-2 text-primary">⏳ Movendo tarefa...</span>}
                <LastSyncBadge className="ml-3" />
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-lg px-1 py-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                if (viewMode === "dia") setDayOffset(o => o - 1);
                else setWeekOffset(o => o - 1);
              }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <button
                onClick={() => { setWeekOffset(0); setDayOffset(0); }}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  (viewMode === "dia" ? dayOffset === 0 : weekOffset === 0) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Hoje
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                if (viewMode === "dia") setDayOffset(o => o + 1);
                else setWeekOffset(o => o + 1);
              }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center bg-muted rounded-lg px-0.5 py-0.5">
              {(["dia", "semana", "mes"] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize",
                    viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "dia" ? "Dia" : mode === "semana" ? "Semana" : "Mês"}
                </button>
              ))}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="relative">
                  <Filter className="h-3.5 w-3.5 mr-1" />
                  Técnicos
                  {selectedTecnicos && (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                      {selectedTecnicos.size}/{tecnicos.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-muted-foreground">Filtrar técnicos</span>
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => setSelectedTecnicos(null)}
                  >
                    Todos
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {tecnicos.map(t => {
                    const checked = !selectedTecnicos || selectedTecnicos.has(t.nome);
                    return (
                      <label key={t.nome} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => {
                            setSelectedTecnicos(prev => {
                              const set = new Set(prev || tecnicos.map(x => x.nome));
                              if (val) set.add(t.nome);
                              else set.delete(t.nome);
                              if (tecnicos.length > 0 && set.size >= tecnicos.length) return null;
                              return set;
                            });
                          }}
                        />
                        {t.nome}
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" onClick={refreshFromApi} disabled={isRefreshingFromApi || isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", (isRefreshingFromApi || isFetching) && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-2 text-sm text-muted-foreground text-center">
          {viewMode === "dia"
            ? format(selectedDay, "EEEE, dd 'de' MMMM, yyyy", { locale: ptBR })
            : `${format(weekStart, "dd 'de' MMMM", { locale: ptBR })} — ${format(addDays(weekStart, 5), "dd 'de' MMMM, yyyy", { locale: ptBR })}`
          }
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : tecnicos.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Nenhuma tarefa encontrada
          </div>
        ) : viewMode === "dia" ? (
          <DayView
            tarefas={tarefas || []}
            filteredTecnicos={filteredTecnicos}
            selectedDay={selectedDay}
            onTaskClick={setSelectedTarefa}
            onDayDrop={async (taskId, toTecNome, toTecId, newHour) => {
              setMovingTaskId(taskId);
              try {
                const newDate = format(selectedDay, "yyyy-MM-dd");
                const oldTarefa = (tarefas || []).find(t => t.auvo_task_id === taskId);
                if (!oldTarefa) throw new Error("Tarefa não encontrada para mover");

                const oldStartMin = parseTimeToMinutes(oldTarefa.hora_inicio);
                const minute = oldStartMin >= 0 ? oldStartMin % 60 : 0;
                const durationMin = getTaskDurationMinutes(oldTarefa);
                const newStartMin = (newHour * 60) + minute;
                const newEndMin = newStartMin + durationMin;

                const updatedHoraInicio = `${minutesToTime(newStartMin)}:00`;
                const updatedHoraFim = `${minutesToTime(newEndMin)}:00`;

                const patches: Array<{ op: string; path: string; value: any }> = [];
                patches.push({ op: "replace", path: "/taskDate", value: `${newDate}T${minutesToTime(newStartMin)}:00` });

                const sameTec = oldTarefa.tecnico === toTecNome;
                if (!sameTec && toTecId) {
                  patches.push({ op: "replace", path: "/idUserTo", value: Number(toTecId) });
                }

                const { data: patchResult, error } = await supabase.functions.invoke("auvo-task-update", {
                  body: { action: "edit", taskId: Number(taskId), patches },
                });
                if (error) throw error;
                if (patchResult?.status && patchResult.status >= 400) throw new Error(patchResult?.data?.message || `Erro ${patchResult.status}`);

                queryClient.setQueryData(queryKey, (old: Tarefa[] | undefined) => {
                  if (!old) return old;
                  return old.map(t => t.auvo_task_id !== taskId ? t : {
                    ...t,
                    data_tarefa: newDate,
                    hora_inicio: updatedHoraInicio,
                    hora_fim: updatedHoraFim,
                    ...(!sameTec && toTecId ? { tecnico: toTecNome, tecnico_id: toTecId } : {}),
                  });
                });

                await supabase.functions.invoke("auvo-task-update", {
                  body: { action: "persist-central", row: {
                    auvo_task_id: taskId,
                    data_tarefa: newDate,
                    hora_inicio: updatedHoraInicio,
                    hora_fim: updatedHoraFim,
                    duracao_decimal: oldTarefa.duracao_decimal,
                    ...(!sameTec && toTecId ? { tecnico: toTecNome, tecnico_id: toTecId } : {}),
                  }},
                });

                const changes: string[] = [`horário → ${minutesToTime(newStartMin)}`];
                if (!sameTec) changes.push(`técnico → ${toTecNome}`);
                toast.success(`Tarefa atualizada: ${changes.join(", ")}`);
              } catch (err: any) {
                toast.error(`Erro ao mover: ${err.message}`);
              } finally {
                setMovingTaskId(null);
              }
            }}
            movingTaskId={movingTaskId}
          />
        ) : (
          <div className="overflow-x-auto overflow-y-auto flex-1">
            <table className="w-full border-collapse min-w-[1200px]">
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground w-40 sticky left-0 bg-muted/50 z-30">
                    Técnico
                  </th>
                  {weekDays.map((day, idx) => {
                    const isToday = isSameDay(day, new Date());
                    return (
                      <th
                        key={day.toISOString()}
                        className={cn(
                          "text-center px-2 py-2.5 text-xs font-semibold min-w-[140px] border-r border-border last:border-r-0",
                          isToday ? "text-primary bg-primary/5" : "text-muted-foreground"
                        )}
                      >
                        <div>{format(day, "EEEE", { locale: ptBR })}</div>
                        <div className="text-[11px] font-normal mt-0.5">{format(day, "dd/MM")}</div>
                        <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                          {formatCurrency(dayTotals[idx])}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredTecnicos.map((tec) => {
                  const days = grid.get(tec.nome) || [];
                  const totalTec = days.reduce((acc, d) => acc + d.length, 0);
                  return (
                    <tr key={tec.nome} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 sticky left-0 bg-card z-10 border-r border-border">
                        <div className="font-medium text-sm text-foreground">{tec.nome}</div>
                        <div className="text-[11px] text-muted-foreground">{totalTec} tarefa{totalTec !== 1 ? "s" : ""}</div>
                      </td>
                      {days.map((dayTasks, dayIdx) => {
                        const cellKey = `${tec.nome}::${dayIdx}`;
                        const isOver = dragOverCell === cellKey;
                        return (
                          <td
                            key={dayIdx}
                            className={cn(
                              "px-1.5 py-1.5 align-top transition-colors min-h-[60px] border-r border-border last:border-r-0",
                              isSameDay(weekDays[dayIdx], new Date()) && "bg-primary/5",
                              isOver && "bg-primary/15 ring-2 ring-inset ring-primary/40 rounded"
                            )}
                            onDragOver={(e) => handleDragOver(e, cellKey)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, tec.nome, tec.id, dayIdx)}
                          >
                            <div className="space-y-1 min-h-[40px]">
                              {dayTasks.map((tarefa) => (
                                <TaskCard
                                  key={tarefa.auvo_task_id}
                                  tarefa={tarefa}
                                  onDragStart={handleDragStart}
                                  isMoving={movingTaskId === tarefa.auvo_task_id}
                                  onClick={() => setSelectedTarefa(tarefa)}
                                />
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <TaskDetailDialog
        tarefa={selectedTarefa}
        onClose={() => setSelectedTarefa(null)}
        tecnicos={tecnicos}
        onUpdate={async (taskId, newDate, newTecNome, newTecId, newHour, newMinute) => {
          setMovingTaskId(taskId);
          try {
            const { data: taskData } = await supabase.functions.invoke("auvo-task-update", {
              body: { action: "get", taskId: Number(taskId) },
            });
            const taskResult = taskData?.data?.result;
            if (!taskResult) throw new Error("Não foi possível obter dados da tarefa");

            const patches: Array<{ op: string; path: string; value: any }> = [];
            const oldDate = selectedTarefa?.data_tarefa;
            const oldTec = selectedTarefa?.tecnico;

            // Build date+time
            const dateToUse = newDate || oldDate || format(new Date(), "yyyy-MM-dd");
            const hasTimeChange = newHour !== undefined && newMinute !== undefined;
            const hasDateChange = newDate && newDate !== oldDate;

            if (hasDateChange || hasTimeChange) {
              const h = (newHour ?? "08").padStart(2, "0");
              const m = (newMinute ?? "00").padStart(2, "0");
              const newDateFormatted = dateToUse + `T${h}:${m}:00`;
              patches.push({ op: "replace", path: "/taskDate", value: newDateFormatted });
            }

            if (newTecId && newTecNome !== oldTec) {
              patches.push({ op: "replace", path: "/idUserTo", value: Number(newTecId) });
            }

            if (patches.length === 0) { setMovingTaskId(null); return; }

            const { data: patchResult, error } = await supabase.functions.invoke("auvo-task-update", {
              body: { action: "edit", taskId: Number(taskId), patches },
            });
            if (error) throw error;
            if (patchResult?.status && patchResult.status >= 400) {
              throw new Error(patchResult?.data?.message || `Erro ${patchResult.status}`);
            }

            const updatedHoraInicio = `${(newHour ?? "08").padStart(2, "0")}:${(newMinute ?? "00").padStart(2, "0")}:00`;

            queryClient.setQueryData(queryKey, (old: Tarefa[] | undefined) => {
              if (!old) return old;
              return old.map(t => {
                if (t.auvo_task_id !== taskId) return t;
                return {
                  ...t,
                  ...(newDate ? { data_tarefa: newDate } : {}),
                  ...(newTecId ? { tecnico: newTecNome, tecnico_id: newTecId } : {}),
                  hora_inicio: updatedHoraInicio,
                };
              });
            });

            setSelectedTarefa(prev => prev ? {
              ...prev,
              ...(newDate ? { data_tarefa: newDate } : {}),
              ...(newTecId ? { tecnico: newTecNome, tecnico_id: newTecId } : {}),
              hora_inicio: updatedHoraInicio,
            } : null);

            const { error: persistError } = await supabase.functions.invoke("auvo-task-update", {
              body: {
                action: "persist-central",
                row: {
                  auvo_task_id: taskId,
                  data_tarefa: newDate || oldDate,
                  hora_inicio: updatedHoraInicio,
                  ...(newTecId ? { tecnico: newTecNome, tecnico_id: newTecId } : {}),
                },
              },
            });
            if (persistError) throw persistError;

            toast.success("Tarefa atualizada no Auvo!");
          } catch (err: any) {
            console.error("[agenda] Erro ao editar tarefa:", err);
            toast.error(`Erro: ${err.message}`);
          } finally {
            setMovingTaskId(null);
          }
        }}
        isSaving={!!movingTaskId}
      />
    </div>
  );
}
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 06:00 to 20:00
const HOUR_COL_WIDTH = 140;
const TEC_COL_WIDTH = 160;

function parseTimeToMinutes(timeStr: string | null | undefined): number {
  if (!timeStr) return -1;
  const h = parseInt(timeStr.substring(0, 2), 10);
  const m = parseInt(timeStr.substring(3, 5), 10);
  return isNaN(h) ? -1 : h * 60 + (isNaN(m) ? 0 : m);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getTaskDurationMinutes(tarefa: Tarefa): number {
  const startMin = parseTimeToMinutes(tarefa.hora_inicio);
  const endMin = parseTimeToMinutes(tarefa.hora_fim);
  if (startMin >= 0 && endMin > startMin) return endMin - startMin;

  const duracaoDecimal = Number(tarefa.duracao_decimal || 0);
  if (duracaoDecimal > 0) return Math.max(30, Math.round(duracaoDecimal * 60));

  return 60;
}

function DayView({
  tarefas,
  filteredTecnicos,
  selectedDay,
  onTaskClick,
  onDayDrop,
  onResize,
  movingTaskId,
}: {
  tarefas: Tarefa[];
  filteredTecnicos: { nome: string; id: string | null }[];
  selectedDay: Date;
  onTaskClick: (t: Tarefa) => void;
  onDayDrop: (taskId: string, toTecNome: string, toTecId: string | null, newHour: number) => void;
  onResize: (taskId: string, newEndMinutes: number) => void;
  movingTaskId: string | null;
}) {
  const dayStr = format(selectedDay, "yyyy-MM-dd");
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  // Resize state
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ taskId: string; startX: number; origWidthPct: number; origEndMin: number; startMin: number } | null>(null);
  const [resizeDelta, setResizeDelta] = useState<Record<string, number>>({}); // taskId -> new endMin override

  const tecTasks = useMemo(() => {
    const result = new Map<string, Tarefa[]>();
    for (const tec of filteredTecnicos) result.set(tec.nome, []);
    const dayTarefas = tarefas.filter(t => t.data_tarefa === dayStr);
    for (const t of dayTarefas) {
      const tecNome = t.tecnico || "Sem técnico";
      const arr = result.get(tecNome);
      if (arr) arr.push(t);
    }
    return result;
  }, [tarefas, filteredTecnicos, dayStr]);

  const gridStartMin = HOURS[0] * 60;
  const gridEndMin = (HOURS[HOURS.length - 1] + 1) * 60;
  const totalMin = gridEndMin - gridStartMin;

  return (
    <div className="overflow-auto flex-1">
      <div style={{ minWidth: `${TEC_COL_WIDTH + HOURS.length * HOUR_COL_WIDTH}px` }}>
        {/* Header: hour labels */}
        <div className="flex sticky top-0 z-20 bg-muted/80 backdrop-blur border-b border-border">
          <div className="flex-shrink-0 px-3 py-2 text-xs font-semibold text-muted-foreground border-r border-border" style={{ width: TEC_COL_WIDTH }}>
            Técnico
          </div>
          {HOURS.map(hour => (
            <div key={hour} className="text-center py-2 text-xs font-medium text-muted-foreground border-r border-border last:border-r-0" style={{ width: HOUR_COL_WIDTH, minWidth: HOUR_COL_WIDTH }}>
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Rows: one per technician */}
        {filteredTecnicos.map(tec => {
          const tasks = tecTasks.get(tec.nome) || [];
          const totalValor = tasks.reduce((sum, t) => sum + (t.gc_os_valor_total ?? 0), 0);
          return (
            <div key={tec.nome} className="flex border-b border-border hover:bg-muted/20 transition-colors" style={{ minHeight: 80 }}>
              <div className="flex-shrink-0 px-3 py-2 border-r border-border bg-card sticky left-0 z-10" style={{ width: TEC_COL_WIDTH }}>
                <div className="font-medium text-sm text-foreground truncate">{tec.nome}</div>
                <div className="text-[10px] text-muted-foreground">{tasks.length} tarefa{tasks.length !== 1 ? "s" : ""}</div>
                {totalValor > 0 && (
                  <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(totalValor)}</div>
                )}
              </div>
              <div className="flex-1 relative" style={{ width: HOURS.length * HOUR_COL_WIDTH }}>
                {/* Drop zone grid */}
                <div className="flex absolute inset-0">
                  {HOURS.map(hour => {
                    const cellKey = `${tec.nome}::${hour}`;
                    return (
                      <div
                        key={hour}
                        className={cn("border-r border-border last:border-r-0 transition-colors", dragOverCell === cellKey && "bg-primary/15 ring-2 ring-inset ring-primary/40")}
                        style={{ width: HOUR_COL_WIDTH, minWidth: HOUR_COL_WIDTH }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverCell(cellKey); }}
                        onDragLeave={() => setDragOverCell(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverCell(null);
                          const raw = e.dataTransfer.getData("application/json");
                          if (!raw) return;
                          const { taskId } = JSON.parse(raw);
                          onDayDrop(taskId, tec.nome, tec.id, hour);
                        }}
                      />
                    );
                  })}
                </div>
                {/* Task cards positioned absolutely spanning start→end */}
                {tasks.map(tarefa => {
                  const startMin = parseTimeToMinutes(tarefa.hora_inicio);
                  const durationMin = getTaskDurationMinutes(tarefa);
                  const effStart = startMin >= 0 ? startMin : gridStartMin;
                  const effEnd = effStart + durationMin;
                  const cStart = Math.max(effStart, gridStartMin);
                  const cEnd = Math.min(effEnd, gridEndMin);
                  const leftPct = ((cStart - gridStartMin) / totalMin) * 100;
                  const widthPct = ((cEnd - cStart) / totalMin) * 100;
                  const displayEnd = minutesToTime(effEnd);
                  const statusClass = STATUS_COLORS[tarefa.status_auvo || ""] || "bg-muted text-muted-foreground";
                  const canDrag = tarefa.status_auvo === "Agendada" || tarefa.status_auvo === "Aberta";
                  const isMoving = movingTaskId === tarefa.auvo_task_id;
                  return (
                    <div
                      key={tarefa.auvo_task_id}
                      draggable={canDrag}
                      onDragStart={canDrag ? (e) => {
                        e.dataTransfer.setData("application/json", JSON.stringify({
                          taskId: tarefa.auvo_task_id, fromTecnico: tarefa.tecnico, fromTecnicoId: tarefa.tecnico_id, fromDate: tarefa.data_tarefa, horaInicio: tarefa.hora_inicio,
                        }));
                        e.dataTransfer.effectAllowed = "move";
                      } : undefined}
                      onClick={() => onTaskClick(tarefa)}
                      className={cn(
                        "absolute top-1 bottom-1 rounded-md border border-border p-1.5 text-[11px] leading-tight bg-card cursor-pointer overflow-hidden z-10 transition-all",
                        canDrag && "hover:shadow-md hover:border-primary/30 active:cursor-grabbing",
                        !canDrag && "opacity-80",
                        isMoving && "opacity-50 ring-2 ring-primary animate-pulse"
                      )}
                      style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 3)}%` }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        {tarefa.hora_inicio && (
                          <span className="text-[10px] font-semibold text-primary flex items-center gap-0.5 whitespace-nowrap">
                            <Clock className="h-2.5 w-2.5" />
                            {tarefa.hora_inicio?.substring(0, 5)}
                            {`–${(tarefa.hora_fim?.substring(0, 5) || displayEnd)}`}
                          </span>
                        )}
                      </div>
                      <div className="font-medium text-foreground truncate">{tarefa.cliente || "—"}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        T#{tarefa.auvo_task_id}
                        {tarefa.gc_os_codigo && <> · OS #{tarefa.gc_os_codigo}</>}
                      </div>
                      {tarefa.gc_os_valor_total != null && (
                        <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(tarefa.gc_os_valor_total)}</div>
                      )}
                      <div className="flex items-center justify-end mt-0.5">
                        <span className={cn("px-1 py-0.5 rounded text-[9px] font-medium leading-none", statusClass)}>{tarefa.status_auvo || "—"}</span>
                      </div>
                      {isMoving && (
                        <div className="flex items-center gap-1 mt-0.5 text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="text-[10px]">Movendo...</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function TaskCard({
  tarefa,
  onDragStart,
  isMoving,
  onClick,
}: {
  tarefa: Tarefa;
  onDragStart: (e: DragEvent<HTMLDivElement>, tarefa: Tarefa) => void;
  isMoving: boolean;
  onClick: () => void;
}) {
  const statusClass = STATUS_COLORS[tarefa.status_auvo || ""] || "bg-muted text-muted-foreground";
  const canDrag = tarefa.status_auvo === "Agendada" || tarefa.status_auvo === "Aberta";
  const valor = tarefa.gc_os_valor_total ?? tarefa.gc_orc_valor_total;

  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? (e) => onDragStart(e, tarefa) : undefined}
      onClick={onClick}
      className={cn(
        "rounded-md border border-border p-1.5 text-[11px] leading-tight transition-all bg-card cursor-pointer",
        canDrag && "hover:shadow-md hover:border-primary/30 active:cursor-grabbing",
        !canDrag && "opacity-80",
        isMoving && "opacity-50 ring-2 ring-primary animate-pulse"
      )}
    >
      <div className="flex items-center gap-1">
        {tarefa.hora_inicio && (
          <span className="text-[10px] font-semibold text-primary flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {tarefa.hora_inicio?.substring(0, 5)}
            {tarefa.hora_fim && `–${tarefa.hora_fim?.substring(0, 5)}`}
          </span>
        )}
      </div>
      <div className="font-medium text-foreground truncate">{tarefa.cliente || "—"}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        <span>T#{tarefa.auvo_task_id}</span>
        {tarefa.gc_os_codigo && (
          <>
            <span className="mx-0.5">·</span>
            <span>OS #{tarefa.gc_os_codigo}</span>
          </>
        )}
        {tarefa.gc_os_valor_total != null && (
          <span className="ml-1 font-semibold text-emerald-700 dark:text-emerald-400">
            {formatCurrency(tarefa.gc_os_valor_total)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-end mt-1">
        <span className={cn("px-1 py-0.5 rounded text-[10px] font-medium leading-none", statusClass)}>
          {tarefa.status_auvo || "—"}
        </span>
      </div>
      {isMoving && (
        <div className="flex items-center gap-1 mt-1 text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-[10px]">Movendo...</span>
        </div>
      )}
    </div>
  );
}

function TaskDetailDialog({
  tarefa,
  onClose,
  tecnicos,
  onUpdate,
  isSaving,
}: {
  tarefa: Tarefa | null;
  onClose: () => void;
  tecnicos: { nome: string; id: string | null }[];
  onUpdate: (taskId: string, newDate: string | null, newTecNome: string | null, newTecId: string | null, newHour?: string, newMinute?: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTecId, setEditTecId] = useState("");
  const [editHour, setEditHour] = useState("08");
  const [editMinute, setEditMinute] = useState("00");

  if (!tarefa) return null;

  const statusClass = STATUS_COLORS[tarefa.status_auvo || ""] || "bg-muted text-muted-foreground";
  const auvoUrl = tarefa.auvo_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${tarefa.auvo_task_id}`;
  const canEdit = tarefa.status_auvo === "Agendada" || tarefa.status_auvo === "Aberta";

  const startEditing = () => {
    setEditDate(tarefa.data_tarefa || "");
    setEditTecId(tarefa.tecnico_id || "");
    const hi = tarefa.hora_inicio || "";
    setEditHour(hi.substring(0, 2) || "08");
    setEditMinute(hi.substring(3, 5) || "00");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    const newTec = tecnicos.find(t => t.id === editTecId);
    await onUpdate(
      tarefa.auvo_task_id,
      editDate !== tarefa.data_tarefa ? editDate : null,
      newTec ? newTec.nome : null,
      editTecId !== tarefa.tecnico_id ? editTecId : null,
      editHour,
      editMinute,
    );
    setEditing(false);
  };

  return (
    <Dialog open={!!tarefa} onOpenChange={(open) => { if (!open) { setEditing(false); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{tarefa.cliente || "Sem cliente"}</DialogTitle>
          <div className="text-xs text-muted-foreground">Tarefa #{tarefa.auvo_task_id}</div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status & Date */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn(statusClass, "border-0")}>
              {tarefa.status_auvo || "—"}
            </Badge>
            {!editing && tarefa.data_tarefa && (
              <Badge variant="secondary">
                {format(parseISO(tarefa.data_tarefa), "EEEE, dd/MM", { locale: ptBR })}
              </Badge>
            )}
            {tarefa.check_in && <Badge variant="secondary">✅ Check-in</Badge>}
          </div>

          {/* Editable fields */}
          {editing ? (
            <div className="space-y-3 bg-muted/50 rounded-lg p-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Data</label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Horário</label>
                <div className="flex items-center gap-1">
                  <Select value={editHour} onValueChange={setEditHour}>
                    <SelectTrigger className="h-8 text-sm w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map(h => (
                        <SelectItem key={h} value={h}>{h}h</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground font-bold">:</span>
                  <Select value={editMinute} onValueChange={setEditMinute}>
                    <SelectTrigger className="h-8 text-sm w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["00", "15", "30", "45"].map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Técnico</label>
                <Select value={editTecId} onValueChange={setEditTecId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Selecionar técnico" />
                  </SelectTrigger>
                  <SelectContent>
                    {tecnicos.map(t => (
                      <SelectItem key={t.id || t.nome} value={t.id || t.nome}>
                        {t.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={isSaving} className="flex-1">
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">Técnico:</span>{" "}
                <span className="font-medium text-foreground">{tarefa.tecnico || "—"}</span>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={startEditing} className="h-7 px-2 text-xs">
                  <Pencil className="h-3 w-3 mr-1" />
                  Editar
                </Button>
              )}
            </div>
          )}

          {/* Time */}
          {tarefa.hora_inicio && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {tarefa.hora_inicio?.substring(0, 5)}
              {tarefa.hora_fim && ` – ${tarefa.hora_fim?.substring(0, 5)}`}
            </div>
          )}

          {/* Address */}
          {tarefa.endereco && (
            <div className="flex items-start gap-2 text-sm text-foreground">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <span>{tarefa.endereco}</span>
            </div>
          )}

          {/* Description */}
          {tarefa.descricao && (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-2">
              {tarefa.descricao}
            </div>
          )}

          {/* Pendência */}
          {tarefa.pendencia && (
            <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{tarefa.pendencia}</span>
            </div>
          )}

          <Separator />

          {/* GC Values */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase">OS</div>
              {tarefa.gc_os_codigo ? (
                <>
                  <div className="text-sm font-medium text-foreground">
                    {tarefa.gc_os_link ? (
                      <a href={tarefa.gc_os_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        #{tarefa.gc_os_codigo}
                      </a>
                    ) : `#${tarefa.gc_os_codigo}`}
                  </div>
                  {tarefa.gc_os_situacao && <div className="text-[11px] text-muted-foreground">{tarefa.gc_os_situacao}</div>}
                  {tarefa.gc_os_valor_total != null && (
                    <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(tarefa.gc_os_valor_total)}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">—</div>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase">Orçamento</div>
              {tarefa.gc_orcamento_codigo ? (
                <>
                  <div className="text-sm font-medium text-foreground">
                    {tarefa.gc_orc_link ? (
                      <a href={tarefa.gc_orc_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        #{tarefa.gc_orcamento_codigo}
                      </a>
                    ) : `#${tarefa.gc_orcamento_codigo}`}
                  </div>
                  {tarefa.gc_orc_situacao && <div className="text-[11px] text-muted-foreground">{tarefa.gc_orc_situacao}</div>}
                  {tarefa.gc_orc_valor_total != null && (
                    <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(tarefa.gc_orc_valor_total)}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">—</div>
              )}
            </div>
          </div>

          {/* Links */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild className="flex-1">
              <a href={auvoUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Ver no Auvo
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
