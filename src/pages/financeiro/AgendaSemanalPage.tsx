import { useState, useMemo, useCallback, DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Loader2, ExternalLink, MapPin, Clock, AlertTriangle, Pencil, Save, X
} from "lucide-react";
import { format, addDays, startOfWeek, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  "Agendada": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "A caminho": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Iniciada": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Finalizada": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Não Executada": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getWeekStart(refDate: Date): Date {
  return startOfWeek(refDate, { weekStartsOn: 1 });
}

export default function AgendaSemanalPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(1);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [selectedTarefa, setSelectedTarefa] = useState<Tarefa | null>(null);

  const weekStart = useMemo(() => {
    const today = new Date();
    const base = getWeekStart(today);
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const queryKey = ["agenda-semanal", format(weekStart, "yyyy-MM-dd")];

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
      const startStr = format(weekStart, "yyyy-MM-dd");
      const endStr = format(addDays(weekStart, 5), "yyyy-MM-dd");
      const { data, error } = await supabase.functions.invoke("auvo-agenda", {
        body: { startDate: startStr, endDate: endStr },
      });
      if (error) throw error;
      return (data?.data || []) as Tarefa[];
    },
    staleTime: 1000 * 60 * 2,
  });

  // All technicians: merge Auvo users + any from tasks
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

  // Daily OS totals
  const dayTotals = useMemo(() => {
    if (!tarefas) return weekDays.map(() => 0);
    return weekDays.map((wd) => {
      return tarefas
        .filter(t => t.data_tarefa && isSameDay(parseISO(t.data_tarefa), wd))
        .reduce((sum, t) => sum + (t.gc_os_valor_total ?? 0), 0);
    });
  }, [tarefas, weekDays]);

  const grid = useMemo(() => {
    if (!tarefas) return new Map<string, Tarefa[][]>();
    const result = new Map<string, Tarefa[][]>();
    for (const tec of tecnicos) {
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
  }, [tarefas, tecnicos, weekDays]);

  // --- Drag & Drop ---
  const handleDragStart = useCallback((e: DragEvent, tarefa: Tarefa) => {
    e.dataTransfer.setData("application/json", JSON.stringify({
      taskId: tarefa.auvo_task_id,
      fromTecnico: tarefa.tecnico,
      fromTecnicoId: tarefa.tecnico_id,
      fromDate: tarefa.data_tarefa,
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

    const { taskId, fromTecnico, fromDate } = JSON.parse(raw);
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

      if (!sameDay) {
        const newDateFormatted = format(weekDays[toDayIdx], "yyyy-MM-dd") + "T" + (taskResult.taskDate?.substring(11) || "08:00:00");
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
            ...((!sameTec && toTecId) ? { tecnico: toTecNome, tecnico_id: toTecId } : {}),
          };
        });
      });

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
                Agenda Semanal
              </h1>
              <p className="text-xs text-muted-foreground">
                {totalTarefas} tarefa{totalTarefas !== 1 ? "s" : ""} · {tecnicos.length} técnico{tecnicos.length !== 1 ? "s" : ""}
                {movingTaskId && <span className="ml-2 text-primary">⏳ Movendo tarefa...</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-lg px-1 py-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset((o) => o - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <button
                onClick={() => setWeekOffset(1)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  weekOffset === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Próx. Semana
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset((o) => o + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isFetching && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-2 text-sm text-muted-foreground text-center">
          {format(weekStart, "dd 'de' MMMM", { locale: ptBR })} — {format(addDays(weekStart, 5), "dd 'de' MMMM, yyyy", { locale: ptBR })}
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
            Nenhuma tarefa encontrada para esta semana
          </div>
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
                          "text-center px-2 py-2.5 text-xs font-semibold min-w-[140px]",
                          isToday ? "text-primary bg-primary/5" : "text-muted-foreground"
                        )}
                      >
                        <div>{format(day, "EEEE", { locale: ptBR })}</div>
                        <div className="text-[11px] font-normal mt-0.5">{format(day, "dd/MM")}</div>
                        {dayTotals[idx] > 0 && (
                          <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                            {formatCurrency(dayTotals[idx])}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tecnicos.map((tec) => {
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
                              "px-1.5 py-1.5 align-top transition-colors min-h-[60px]",
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
        onUpdate={async (taskId, newDate, newTecNome, newTecId) => {
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

            if (newDate && newDate !== oldDate) {
              const newDateFormatted = newDate + "T" + (taskResult.taskDate?.substring(11) || "08:00:00");
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

            queryClient.setQueryData(queryKey, (old: Tarefa[] | undefined) => {
              if (!old) return old;
              return old.map(t => {
                if (t.auvo_task_id !== taskId) return t;
                return {
                  ...t,
                  ...(newDate ? { data_tarefa: newDate } : {}),
                  ...(newTecId ? { tecnico: newTecNome, tecnico_id: newTecId } : {}),
                };
              });
            });

            // Update selected tarefa too
            setSelectedTarefa(prev => prev ? {
              ...prev,
              ...(newDate ? { data_tarefa: newDate } : {}),
              ...(newTecId ? { tecnico: newTecNome, tecnico_id: newTecId } : {}),
            } : null);

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
  const canDrag = tarefa.status_auvo === "Agendada";
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
      <div className="flex items-center justify-between mt-1 gap-1">
        {tarefa.hora_inicio && (
          <span className="text-muted-foreground">{tarefa.hora_inicio?.substring(0, 5)}</span>
        )}
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
  onUpdate: (taskId: string, newDate: string | null, newTecNome: string | null, newTecId: string | null) => Promise<void>;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTecId, setEditTecId] = useState("");

  if (!tarefa) return null;

  const statusClass = STATUS_COLORS[tarefa.status_auvo || ""] || "bg-muted text-muted-foreground";
  const auvoUrl = tarefa.auvo_link || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${tarefa.auvo_task_id}`;
  const canEdit = tarefa.status_auvo === "Agendada";

  const startEditing = () => {
    setEditDate(tarefa.data_tarefa || "");
    setEditTecId(tarefa.tecnico_id || "");
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
