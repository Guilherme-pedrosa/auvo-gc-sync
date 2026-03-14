import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, ExternalLink, CalendarDays
} from "lucide-react";
import { format, addDays, startOfWeek, endOfWeek, isWithinInterval, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Tarefa = {
  auvo_task_id: string;
  cliente: string | null;
  tecnico: string | null;
  tecnico_id: string | null;
  data_tarefa: string | null;
  status_auvo: string | null;
  descricao: string | null;
  endereco: string | null;
  auvo_task_url: string | null;
  auvo_link: string | null;
  gc_os_codigo: string | null;
  gc_os_situacao: string | null;
  gc_os_cor_situacao: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  "Agendada": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "A caminho": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Iniciada": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Finalizada": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Não Executada": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function getWeekStart(refDate: Date): Date {
  return startOfWeek(refDate, { weekStartsOn: 1 }); // Monday
}

export default function AgendaSemanalPage() {
  const navigate = useNavigate();
  const [weekOffset, setWeekOffset] = useState(1); // 1 = next week

  const weekStart = useMemo(() => {
    const today = new Date();
    const base = getWeekStart(today);
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon-Sat
  }, [weekStart]);

  const { data: tarefas, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["agenda-semanal", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const startStr = format(weekStart, "yyyy-MM-dd");
      const endStr = format(weekEnd, "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, cliente, tecnico, tecnico_id, data_tarefa, status_auvo, descricao, endereco, auvo_task_url, auvo_link, gc_os_codigo, gc_os_situacao, gc_os_cor_situacao, hora_inicio, hora_fim")
        .gte("data_tarefa", startStr)
        .lte("data_tarefa", endStr)
        .order("hora_inicio", { ascending: true });

      if (error) throw error;
      return (data || []) as Tarefa[];
    },
    staleTime: 1000 * 60 * 5,
  });

  // Group by technician
  const tecnicos = useMemo(() => {
    if (!tarefas) return [];
    const map = new Map<string, { nome: string; id: string | null }>();
    for (const t of tarefas) {
      const nome = t.tecnico || "Sem técnico";
      if (!map.has(nome)) map.set(nome, { nome, id: t.tecnico_id });
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [tarefas]);

  // Build grid: tecnico -> dayIndex -> tasks
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
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Week nav */}
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

        {/* Week label */}
        <div className="mt-2 text-sm text-muted-foreground text-center">
          {format(weekStart, "dd 'de' MMMM", { locale: ptBR })} — {format(addDays(weekStart, 5), "dd 'de' MMMM, yyyy", { locale: ptBR })}
        </div>
      </div>

      {/* Grid */}
      <ScrollArea className="flex-1">
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground w-40 sticky left-0 bg-muted/50 z-10">
                    Técnico
                  </th>
                  {weekDays.map((day) => {
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
                      {days.map((dayTasks, dayIdx) => (
                        <td key={dayIdx} className={cn("px-1.5 py-1.5 align-top", isSameDay(weekDays[dayIdx], new Date()) && "bg-primary/5")}>
                          <div className="space-y-1">
                            {dayTasks.map((tarefa) => (
                              <TaskCard key={tarefa.auvo_task_id} tarefa={tarefa} />
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function TaskCard({ tarefa }: { tarefa: Tarefa }) {
  const statusClass = STATUS_COLORS[tarefa.status_auvo || ""] || "bg-muted text-muted-foreground";
  const linkUrl = tarefa.auvo_link || tarefa.auvo_task_url || `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${tarefa.auvo_task_id}`;

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block rounded-md border border-border p-1.5 text-[11px] leading-tight transition-all hover:shadow-md hover:border-primary/30 cursor-pointer bg-card"
          )}
        >
          <div className="font-medium text-foreground truncate">{tarefa.cliente || "—"}</div>
          {tarefa.gc_os_codigo && (
            <div className="text-muted-foreground truncate">OS {tarefa.gc_os_codigo}</div>
          )}
          <div className="flex items-center justify-between mt-1 gap-1">
            {tarefa.hora_inicio && (
              <span className="text-muted-foreground">{tarefa.hora_inicio?.substring(0, 5)}</span>
            )}
            <span className={cn("px-1 py-0.5 rounded text-[10px] font-medium leading-none", statusClass)}>
              {tarefa.status_auvo || "—"}
            </span>
          </div>
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div className="font-semibold">{tarefa.cliente || "Sem cliente"}</div>
          {tarefa.descricao && <div className="text-muted-foreground">{tarefa.descricao}</div>}
          {tarefa.endereco && <div className="text-muted-foreground">📍 {tarefa.endereco}</div>}
          {tarefa.hora_inicio && tarefa.hora_fim && (
            <div>🕐 {tarefa.hora_inicio?.substring(0, 5)} – {tarefa.hora_fim?.substring(0, 5)}</div>
          )}
          {tarefa.gc_os_situacao && <div>OS: {tarefa.gc_os_situacao}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
