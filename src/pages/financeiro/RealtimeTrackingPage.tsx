import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw, CalendarIcon, MapPin, Clock, User,
  CheckCircle2, PlayCircle, CalendarClock, AlertTriangle,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { format, addDays, subDays, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type TaskItem = {
  taskId: string;
  cliente: string;
  endereco: string;
  status: string;
  atrasada: boolean;
  horaInicio: string;
  horaFim: string;
  data: string;
  checkIn: boolean;
  checkOut: boolean;
  pendencia: string;
  descricao: string;
  duration: string;
  gcOsCodigo: string;
  gcOsValor: string;
};

type TecnicoGroup = {
  id: string;
  nome: string;
  tarefas: TaskItem[];
  resumo: {
    total: number;
    finalizadas: number;
    emAndamento: number;
    agendadas: number;
    atrasadas: number;
  };
};

type TrackingData = {
  data: string;
  total_tarefas: number;
  total_tecnicos: number;
  total_atrasadas: number;
  tecnicos: TecnicoGroup[];
};

const statusIcon: Record<string, { icon: typeof CheckCircle2; class: string }> = {
  "Finalizada": { icon: CheckCircle2, class: "text-emerald-600" },
  "Em andamento": { icon: PlayCircle, class: "text-blue-600" },
  "Agendada": { icon: CalendarClock, class: "text-amber-600" },
  "Cancelada": { icon: AlertTriangle, class: "text-red-500" },
};

const statusBarColor: Record<string, string> = {
  "Finalizada": "bg-emerald-500",
  "Em andamento": "bg-blue-500",
  "Agendada": "bg-amber-400",
  "Cancelada": "bg-red-400",
};

export default function RealtimeTrackingPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["realtime-tracking", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("realtime-tracking", {
        body: { date: dateStr },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as TrackingData;
    },
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const goDay = (dir: number) => setSelectedDate((d) => (dir > 0 ? addDays(d, 1) : subDays(d, 1)));

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Agenda de Técnicos</h1>
            <p className="text-xs text-muted-foreground">
              Acompanhamento em tempo real — Auvo
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Date nav */}
            <div className="flex items-center border rounded-lg overflow-hidden h-8">
              <button onClick={() => goDay(-1)} className="px-2 h-full hover:bg-muted transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="px-3 h-full text-xs font-medium hover:bg-muted transition-colors flex items-center gap-1.5 border-x">
                    <CalendarIcon className="h-3 w-3" />
                    {isToday(selectedDate) ? "Hoje" : format(selectedDate, "dd MMM", { locale: ptBR })}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} locale={ptBR} />
                </PopoverContent>
              </Popover>
              <button onClick={() => goDay(1)} className="px-2 h-full hover:bg-muted transition-colors">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {isToday(selectedDate) && (
              <Badge variant="outline" className="text-[10px] h-6 bg-blue-50 text-blue-700 border-blue-200">
                🔴 AO VIVO
              </Badge>
            )}

            <Button variant="outline" size="sm" onClick={() => { refetch(); toast.info("Atualizando..."); }} disabled={isFetching} className="h-8 text-xs">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.tecnicos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
          <CalendarClock className="h-8 w-8" />
          <p className="text-sm">Nenhuma tarefa para {format(selectedDate, "dd/MM/yyyy")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {/* Summary strip */}
          <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <strong>{data.total_tecnicos}</strong> técnicos
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <strong>{data.total_tarefas}</strong> tarefas
            </span>
            <span className="flex items-center gap-1.5">
              <PlayCircle className="h-3.5 w-3.5 text-blue-500" />
              <strong className="text-blue-600">{data.tecnicos.reduce((s, t) => s + t.resumo.emAndamento, 0)}</strong> em andamento
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <strong className="text-emerald-600">{data.tecnicos.reduce((s, t) => s + t.resumo.finalizadas, 0)}</strong> finalizadas
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
              <strong className="text-amber-600">{data.tecnicos.reduce((s, t) => s + t.resumo.agendadas, 0)}</strong> agendadas
            </span>
            {(data.total_atrasadas || 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                <strong className="text-red-600">{data.total_atrasadas}</strong> atrasada(s)
              </span>
            )}
          </div>

          {/* Agenda grid — horizontal scroll of technician columns */}
          <ScrollArea className="h-[calc(100vh-10rem)]">
            <div className="p-4 grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(data.tecnicos.length, 5)}, minmax(280px, 1fr))` }}>
              {data.tecnicos.map((tech) => {
                const hasActive = tech.resumo.emAndamento > 0;
                const progress = tech.resumo.total > 0
                  ? Math.round(((tech.resumo.finalizadas) / tech.resumo.total) * 100)
                  : 0;

                return (
                  <div key={tech.id} className="flex flex-col">
                    {/* Technician header */}
                    <div className={`rounded-t-lg border border-b-0 px-4 py-3 ${
                      hasActive ? "bg-blue-50 border-blue-200" : "bg-card"
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                          hasActive
                            ? "bg-blue-500 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {tech.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{tech.nome}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{tech.resumo.total} tarefa(s)</span>
                            {hasActive && (
                              <span className="text-[10px] text-blue-600 font-medium animate-pulse">● Ativo</span>
                            )}
                            {tech.resumo.atrasadas > 0 && (
                              <Badge variant="destructive" className="text-[9px] h-4 px-1.5">
                                {tech.resumo.atrasadas} atrasada(s)
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Mini progress */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{progress}%</span>
                      </div>
                    </div>

                    {/* Task timeline */}
                    <div className={`rounded-b-lg border px-3 py-2 flex-1 space-y-1.5 ${
                      hasActive ? "border-blue-200" : ""
                    }`}>
                      {tech.tarefas.map((task, idx) => {
                        const isLate = task.atrasada;
                        const cfg = isLate
                          ? { icon: AlertTriangle, class: "text-red-600" }
                          : (statusIcon[task.status] || statusIcon["Agendada"]);
                        const Icon = cfg.icon;
                        const barColor = isLate ? "bg-red-500" : (statusBarColor[task.status] || "bg-muted");

                        return (
                          <div key={task.taskId || idx} className={`relative flex gap-2.5 group ${isLate ? "bg-red-50/50 -mx-1 px-1 rounded" : ""}`}>
                            {/* Timeline line */}
                            <div className="flex flex-col items-center pt-1">
                              <div className={`h-2.5 w-2.5 rounded-full ${barColor} ring-2 ring-background flex-shrink-0`} />
                              {idx < tech.tarefas.length - 1 && (
                                <div className="w-px flex-1 bg-border mt-1" />
                              )}
                            </div>

                            {/* Task card */}
                            <div className={`flex-1 pb-3 min-w-0`}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Icon className={`h-3 w-3 flex-shrink-0 ${cfg.class}`} />
                                <span className={`text-[10px] font-medium ${cfg.class}`}>
                                  {isLate ? "⚠ Atrasada" : task.status}
                                </span>
                                {task.horaInicio && (
                                  <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
                                    <Clock className="h-2.5 w-2.5" />
                                    {task.horaInicio}{task.horaFim ? ` - ${task.horaFim}` : ""}
                                  </span>
                                )}
                              </div>
                              <p className="font-medium text-xs text-foreground truncate">
                                {task.cliente || "Sem cliente identificado"}
                              </p>
                              {task.gcOsCodigo && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
                                    OS {task.gcOsCodigo}
                                  </Badge>
                                  {task.gcOsValor && task.gcOsValor !== "0" && (
                                    <span className="text-[10px] font-semibold text-emerald-600">
                                      R$ {parseFloat(task.gcOsValor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              )}
                              {task.descricao && (
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-tight">
                                  {task.descricao}
                                </p>
                              )}
                              {task.endereco && (
                                <p className="text-[10px] text-muted-foreground mt-1 flex items-start gap-1">
                                  <MapPin className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                                  <span className="truncate">{task.endereco}</span>
                                </p>
                              )}
                              {task.pendencia && task.pendencia.toLowerCase() !== "nenhuma" && task.pendencia !== "0" && (
                                <Badge variant="destructive" className="text-[9px] h-4 mt-1">
                                  ⚠ Pendência
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* If more than 5, second row */}
            {data.tecnicos.length > 5 && (
              <div className="px-4 pb-4 grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(data.tecnicos.length - 5, 5)}, minmax(280px, 1fr))` }}>
                {/* Already rendered above via single grid, but we need to handle overflow */}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
