import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  RefreshCw, CalendarIcon, MapPin, Clock, User, CheckCircle2,
  PlayCircle, CalendarClock, AlertTriangle, ChevronDown, ChevronUp
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type TaskItem = {
  taskId: string;
  cliente: string;
  endereco: string;
  status: string;
  horaInicio: string;
  horaFim: string;
  data: string;
  checkIn: boolean;
  checkOut: boolean;
  pendencia: string;
  descricao: string;
  duration: string;
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
  };
};

type TrackingData = {
  data: string;
  total_tarefas: number;
  total_tecnicos: number;
  tecnicos: TecnicoGroup[];
};

const statusConfig: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  "Finalizada": { color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: CheckCircle2, label: "Finalizada" },
  "Em andamento": { color: "text-blue-600 bg-blue-50 border-blue-200", icon: PlayCircle, label: "Em andamento" },
  "Agendada": { color: "text-amber-600 bg-amber-50 border-amber-200", icon: CalendarClock, label: "Agendada" },
  "Cancelada": { color: "text-red-600 bg-red-50 border-red-200", icon: AlertTriangle, label: "Cancelada" },
};

export default function RealtimeTrackingPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [expandedTechs, setExpandedTechs] = useState<Set<string>>(new Set());

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
    refetchInterval: 120_000, // auto-refresh every 2 min
    staleTime: 30_000,
  });

  const toggleExpand = (id: string) => {
    setExpandedTechs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (!data) return;
    setExpandedTechs(new Set(data.tecnicos.map((t) => t.id)));
  };
  const collapseAll = () => setExpandedTechs(new Set());

  const handleRefresh = () => {
    refetch();
    toast.info("Atualizando...");
  };

  const getStatusBadge = (status: string) => {
    const cfg = statusConfig[status] || statusConfig["Agendada"];
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
        <Icon className="h-3 w-3" />
        {cfg.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Acompanhamento em Tempo Real</h1>
            <p className="text-xs text-muted-foreground">
              Tarefas de cada técnico no Auvo — todas as situações
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(selectedDate, "dd/MM/yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => d && setSelectedDate(d)}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="h-8 text-xs"
            >
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
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Nenhum dado disponível
        </div>
      ) : (
        <div className="p-6 space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="grid grid-cols-3 gap-3 flex-1 min-w-[300px]">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Técnicos
                  </p>
                  <p className="text-2xl font-bold">{data.total_tecnicos}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Tarefas
                  </p>
                  <p className="text-2xl font-bold">{data.total_tarefas}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    <PlayCircle className="h-3.5 w-3.5 text-blue-500" /> Em andamento
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {data.tecnicos.reduce((s, t) => s + t.resumo.emAndamento, 0)}
                  </p>
                </CardContent>
              </Card>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">
                <ChevronDown className="h-3 w-3 mr-1" /> Expandir Todos
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">
                <ChevronUp className="h-3 w-3 mr-1" /> Recolher
              </Button>
            </div>
          </div>

          {/* Technician cards */}
          <div className="space-y-3">
            {data.tecnicos.map((tech) => {
              const isExpanded = expandedTechs.has(tech.id);
              const hasActive = tech.resumo.emAndamento > 0;

              return (
                <Card
                  key={tech.id}
                  className={hasActive ? "border-blue-300 bg-blue-50/30" : ""}
                >
                  {/* Tech header */}
                  <button
                    onClick={() => toggleExpand(tech.id)}
                    className="w-full text-left"
                  >
                    <CardHeader className="pb-2 pt-4 px-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            hasActive
                              ? "bg-blue-100 text-blue-700"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {tech.nome.charAt(0)}
                          </div>
                          <div>
                            <CardTitle className="text-sm font-semibold">{tech.nome}</CardTitle>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">
                                {tech.resumo.total} tarefa(s)
                              </span>
                              {tech.resumo.emAndamento > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-blue-100 text-blue-700 border-blue-200">
                                  {tech.resumo.emAndamento} ativa(s)
                                </Badge>
                              )}
                              {tech.resumo.finalizadas > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-emerald-100 text-emerald-700 border-emerald-200">
                                  {tech.resumo.finalizadas} finalizada(s)
                                </Badge>
                              )}
                              {tech.resumo.agendadas > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-200">
                                  {tech.resumo.agendadas} agendada(s)
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                  </button>

                  {/* Tasks list */}
                  {isExpanded && (
                    <CardContent className="pt-0 pb-3 px-5">
                      <div className="space-y-2 mt-1">
                        {tech.tarefas.map((task, idx) => (
                          <div
                            key={task.taskId || idx}
                            className={`rounded-lg border p-3 text-sm ${
                              task.status === "Em andamento"
                                ? "border-blue-200 bg-blue-50/50"
                                : task.status === "Finalizada"
                                ? "border-emerald-100 bg-emerald-50/30"
                                : "border-border bg-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {getStatusBadge(task.status)}
                                  {task.horaInicio && (
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {task.horaInicio}{task.horaFim ? ` → ${task.horaFim}` : ""}
                                    </span>
                                  )}
                                  {task.duration && task.status === "Finalizada" && (
                                    <span className="text-[10px] text-muted-foreground">({task.duration})</span>
                                  )}
                                </div>
                                <p className="font-medium text-foreground text-sm truncate">
                                  {task.cliente || "Sem cliente"}
                                </p>
                                {task.descricao && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {task.descricao}
                                  </p>
                                )}
                                {task.endereco && (
                                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                                    <MapPin className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{task.endereco}</span>
                                  </p>
                                )}
                              </div>
                              {task.pendencia && task.pendencia.toLowerCase() !== "nenhuma" && task.pendencia !== "0" && (
                                <Badge variant="destructive" className="text-[10px] shrink-0">
                                  Pendência
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}

            {data.tecnicos.length === 0 && (
              <div className="text-center text-muted-foreground py-12">
                Nenhuma tarefa encontrada para {format(selectedDate, "dd/MM/yyyy")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
