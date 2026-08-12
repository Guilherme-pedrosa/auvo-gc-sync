import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  RefreshCw, CalendarIcon, MapPin, Clock, User,
  CheckCircle2, PlayCircle, CalendarClock, AlertTriangle,
  ChevronLeft, ChevronRight, FileWarning, ChevronDown,
  LayoutGrid, List, ChevronsUpDown, Monitor
} from "lucide-react";
import TvTrackingView from "@/components/financeiro/TvTrackingView";
import TechnicianDivergencesPanel from "@/components/financeiro/TechnicianDivergencesPanel";
import { format, addDays, subDays, isToday, startOfMonth, endOfMonth, startOfWeek, startOfYear } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import LastSyncBadge from "@/components/LastSyncBadge";
import { regroupTrackingByAuvoAssignee } from "@/lib/realtime-tracking-normalizer";
import {
  auditTechnicianTasks,
  buildTechnicianDivergenceRecords,
  hasQuestionnaireResponses,
  type TechnicianTaskAuditInput,
} from "@/lib/technicianDivergences";
import { exportTechnicianDivergencesPdf } from "@/lib/technicianDivergencePdf";

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
  gcOsTipo?: string;
  gcVendedor?: string;
  _auvoTechId?: string;
  _auvoTechName?: string;
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
  gc_cache?: {
    mode: "read_only" | "cache" | "manual";
    source: "cache" | "manual" | "database";
    refreshed_at: string | null;
    stale: boolean;
    refreshing: boolean;
    blocked_until: string | null;
    rate_limited: boolean;
    error: string | null;
  };
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
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [expandedTechs, setExpandedTechs] = useState<Set<string>>(new Set());
  const [headerMinimized, setHeaderMinimized] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [divPeriodo, setDivPeriodo] = useState<"mes" | "semana" | "ano" | "custom">("mes");
  const [divCustomStart, setDivCustomStart] = useState<Date | undefined>(undefined);
  const [divCustomEnd, setDivCustomEnd] = useState<Date | undefined>(undefined);
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);
  const [isSyncingDivergencias, setIsSyncingDivergencias] = useState(false);
  const [isRefreshingGc, setIsRefreshingGc] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["realtime-tracking", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("realtime-tracking", {
        body: { date: dateStr, gc_mode: "cache" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setLastFetchTime(new Date().toISOString());
      return regroupTrackingByAuvoAssignee(data as TrackingData);
    },
    refetchInterval: 15 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 15_000,
  });

  // Mantém somente o Auvo em 60s. O hotfix de 15 minutos da consulta principal
  // permanece, e este caminho read_only jamais inicia paginação no GestãoClick.
  useEffect(() => {
    let stopped = false;
    let running = false;
    const refreshAuvoOnly = async () => {
      if (running || stopped || document.visibilityState !== "visible") return;
      running = true;
      try {
        const { data: refreshed, error } = await supabase.functions.invoke("realtime-tracking", {
          body: { date: dateStr, gc_mode: "read_only" },
        });
        if (error) throw error;
        if (refreshed?.error) throw new Error(refreshed.error);
        if (!stopped) {
          queryClient.setQueryData(
            ["realtime-tracking", dateStr],
            regroupTrackingByAuvoAssignee(refreshed as TrackingData),
          );
          setLastFetchTime(new Date().toISOString());
        }
      } catch (error) {
        console.warn("[RealtimeTracking] Atualização rápida do Auvo falhou:", error);
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => void refreshAuvoOnly(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [dateStr, queryClient]);

  const refreshAuvoAndGc = useCallback(async () => {
    if (isRefreshingGc) return;
    setIsRefreshingGc(true);
    toast.info("Atualizando Auvo e cache do GestãoClick...");
    try {
      const { data: refreshed, error } = await supabase.functions.invoke("realtime-tracking", {
        body: { date: dateStr, gc_mode: "manual" },
      });
      if (error) throw error;
      if (refreshed?.error) throw new Error(refreshed.error);

      const normalized = regroupTrackingByAuvoAssignee(refreshed as TrackingData);
      queryClient.setQueryData(["realtime-tracking", dateStr], normalized);
      setLastFetchTime(new Date().toISOString());

      if (normalized.gc_cache?.rate_limited) {
        toast.warning("GestãoClick atingiu o limite. Dados locais mantidos sem novas tentativas automáticas.");
      } else if (normalized.gc_cache?.source === "manual") {
        toast.success("Auvo e GestãoClick atualizados.");
      } else {
        toast.success("Auvo atualizado; dados do GestãoClick mantidos pelo cache.");
      }
    } catch (error) {
      console.error("[RealtimeTracking] Erro na atualização manual:", error);
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar os dados.");
    } finally {
      setIsRefreshingGc(false);
    }
  }, [dateStr, isRefreshingGc, queryClient]);

  const isRefreshing = isFetching || isRefreshingGc;

  // Monthly late tasks query
  const getDivDates = () => {
    const ref = selectedDate;
    switch (divPeriodo) {
      case "semana":
        return { start: format(startOfWeek(ref, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(ref, "yyyy-MM-dd") };
      case "ano":
        return { start: format(startOfYear(ref), "yyyy-MM-dd"), end: format(endOfMonth(ref), "yyyy-MM-dd") };
      case "custom":
        return {
          start: divCustomStart ? format(divCustomStart, "yyyy-MM-dd") : format(startOfMonth(ref), "yyyy-MM-dd"),
          end: divCustomEnd ? format(divCustomEnd, "yyyy-MM-dd") : format(endOfMonth(ref), "yyyy-MM-dd"),
        };
      default: // mes
        return { start: format(startOfMonth(ref), "yyyy-MM-dd"), end: format(endOfMonth(ref), "yyyy-MM-dd") };
    }
  };
  const divDates = getDivDates();
  const divStart = divDates.start;
  const divEnd = divDates.end;

  const divLabel = (() => {
    switch (divPeriodo) {
      case "semana": return `semana de ${format(new Date(divStart + "T12:00:00"), "dd/MM")} a ${format(new Date(divEnd + "T12:00:00"), "dd/MM/yyyy")}`;
      case "ano": return format(selectedDate, "yyyy");
      case "custom": return `${format(new Date(divStart + "T12:00:00"), "dd/MM/yy")} → ${format(new Date(divEnd + "T12:00:00"), "dd/MM/yy")}`;
      default: return format(selectedDate, "MMMM yyyy", { locale: ptBR });
    }
  })();

  const { data: atrasadasMes, isLoading: loadingAtrasadas, refetch: refetchAtrasadas } = useQuery({
    queryKey: ["atrasadas-mes", divStart, divEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atividades_nao_executadas")
        .select("*")
        .gte("data_planejada", divStart)
        .lte("data_planejada", divEnd)
        .order("data_planejada", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: sheetOpen,
  });

  // Evidências de execução do período: formulário, relato e fotos.
  const { data: pendenciasMesRaw, refetch: refetchPendencias } = useQuery({
    queryKey: ["divergencias-execucao", divStart, divEnd],
    queryFn: async () => {
      const rows: TechnicianTaskAuditInput[] = [];
      const fields = "auvo_task_id, atualizado_em, tecnico_id, tecnico, cliente, data_tarefa, data_conclusao, status_auvo, check_out, pendencia, descricao, orientacao, questionario_preenchido, questionario_respostas, gc_os_codigo, auvo_link";
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select(fields)
          .gte("data_tarefa", divStart)
          .lte("data_tarefa", divEnd)
          .order("atualizado_em", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...(data as TechnicianTaskAuditInput[]));
        if (data.length < 1000) break;
      }
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select(fields)
          .not("data_conclusao", "is", null)
          .gte("data_conclusao", divStart)
          .lte("data_conclusao", divEnd)
          .or(`data_tarefa.lt.${divStart},data_tarefa.gt.${divEnd},data_tarefa.is.null`)
          .order("atualizado_em", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...(data as TechnicianTaskAuditInput[]));
        if (data.length < 1000) break;
      }
      return rows;
    },
    enabled: sheetOpen,
  });

  const taskAudits = useMemo(() => auditTechnicianTasks(pendenciasMesRaw || []), [pendenciasMesRaw]);
  const divergenceRecords = useMemo(
    () => buildTechnicianDivergenceRecords(atrasadasMes || [], taskAudits),
    [atrasadasMes, taskAudits],
  );

  const atualizarDivergencias = useCallback(async () => {
    if (isSyncingDivergencias) return;

    setIsSyncingDivergencias(true);
    const toastId = toast.loading("Sincronizando pendências...");

    try {
      const { data: syncResult, error } = await supabase.functions.invoke("central-sync", {
        body: {
          start_date: divStart,
          end_date: divEnd,
          wait: true,
        },
      });

      if (error) throw error;
      if (syncResult?.success === false || syncResult?.error) {
        throw new Error(syncResult?.error || "Falha ao sincronizar pendências");
      }

      const [, refreshedTasks] = await Promise.all([refetchAtrasadas(), refetchPendencias()]);
      const detailTaskIds = [...new Set((refreshedTasks.data || [])
        .filter((task) => {
          const status = String(task.status_auvo || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          const finished = task.check_out === true || ["finalizada", "concluida"].includes(status);
          return finished && (task.questionario_preenchido !== true || !hasQuestionnaireResponses(task.questionario_respostas));
        })
        .map((task) => String(task.auvo_task_id || "").trim())
        .filter(Boolean))];

      for (let index = 0; index < detailTaskIds.length; index += 20) {
        const batch = detailTaskIds.slice(index, index + 20);
        const { data: detailResult, error: detailError } = await supabase.functions.invoke("central-sync", {
          body: { task_ids: batch, wait: true },
        });
        if (detailError) throw detailError;
        if (detailResult?.success === false || detailResult?.errors > 0) {
          throw new Error(detailResult?.error || `Falha ao buscar detalhes de ${batch.length} tarefa(s) no Auvo`);
        }
      }

      if (detailTaskIds.length > 0) await refetchPendencias();

      toast.success("Pendências atualizadas", {
        id: toastId,
        description: syncResult?.auvo_tarefas
          ? `${syncResult.auvo_tarefas} tarefa(s) conferida(s) no período · ${detailTaskIds.length} detalhe(s) recuperado(s).`
          : "Dados recarregados com sucesso.",
      });
    } catch (err) {
      console.error("[RealtimeTracking] Erro ao atualizar divergências:", err);
      toast.error("Falha ao atualizar pendências", {
        id: toastId,
        description: err instanceof Error ? err.message : "Tente novamente em alguns instantes.",
      });
    } finally {
      setIsSyncingDivergencias(false);
    }
  }, [divEnd, divStart, isSyncingDivergencias, refetchAtrasadas, refetchPendencias]);

  const exportUnifiedDivergences = useCallback(() => {
    exportTechnicianDivergencesPdf(divergenceRecords, divLabel);
    toast.success("PDF de divergências gerado");
  }, [divLabel, divergenceRecords]);

  const goDay = (dir: number) => setSelectedDate((d) => (dir > 0 ? addDays(d, 1) : subDays(d, 1)));

  if (tvMode && data) {
    return <TvTrackingView data={data} selectedDate={selectedDate} onExit={() => setTvMode(false)} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card flex-shrink-0 transition-all duration-200">
        {headerMinimized ? (
          /* ── Minimized header: single compact row ── */
          <div className="px-4 py-1.5 flex items-center gap-3">
            <button onClick={() => setHeaderMinimized(false)} className="text-muted-foreground hover:text-foreground transition-colors" title="Expandir cabeçalho">
              <ChevronsUpDown className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">Agenda de Técnicos</span>
            <LastSyncBadge className="hidden sm:flex" overrideTimestamp={lastFetchTime} />

            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center border rounded-lg overflow-hidden h-7">
                <button onClick={() => goDay(-1)} className="px-1.5 h-full hover:bg-muted transition-colors">
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="px-2 h-full text-[11px] font-medium hover:bg-muted transition-colors flex items-center gap-1 border-x">
                      <CalendarIcon className="h-2.5 w-2.5" />
                      {isToday(selectedDate) ? "Hoje" : format(selectedDate, "dd MMM", { locale: ptBR })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} locale={ptBR} />
                  </PopoverContent>
                </Popover>
                <button onClick={() => goDay(1)} className="px-1.5 h-full hover:bg-muted transition-colors">
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>

              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={() => void refreshAuvoAndGc()} disabled={isRefreshing}>
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>

              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={() => setTvMode(true)} disabled={!data} title="Modo TV">
                <Monitor className="h-3 w-3" />
              </Button>

              {isToday(selectedDate) && (
                <Badge variant="outline" className="text-[9px] h-5 bg-blue-50 text-blue-700 border-blue-200">
                  🔴 VIVO
                </Badge>
              )}
            </div>
          </div>
        ) : (
          /* ── Full header ── */
          <>
            <div className="px-6 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-foreground">Agenda de Técnicos</h1>
                  <p className="text-xs text-muted-foreground">
                    Acompanhamento em tempo real — Auvo
                  </p>
                  <LastSyncBadge className="mt-0.5" overrideTimestamp={lastFetchTime} />
                </div>

                <div className="flex items-center gap-2">
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

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void refreshAuvoAndGc()}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    Sincronizar
                  </Button>

                  {isToday(selectedDate) && (
                    <Badge variant="outline" className="text-[10px] h-6 bg-blue-50 text-blue-700 border-blue-200">
                      🔴 AO VIVO
                    </Badge>
                  )}

                  <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50">
                        <FileWarning className="h-3.5 w-3.5 mr-1.5" />
                        Divergências
                      </Button>
                    </SheetTrigger>
                    <SheetContent className="w-[600px] sm:max-w-[600px]">
                      <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                          Divergências — {divLabel}
                        </SheetTitle>
                      </SheetHeader>
                      <div className="mt-3 flex flex-wrap gap-2 items-end">
                        <Select value={divPeriodo} onValueChange={(v) => setDivPeriodo(v as "mes" | "semana" | "ano" | "custom")}>
                          <SelectTrigger className="w-36 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="semana">Esta Semana</SelectItem>
                            <SelectItem value="mes">Este Mês</SelectItem>
                            <SelectItem value="ano">Este Ano</SelectItem>
                            <SelectItem value="custom">Personalizado</SelectItem>
                          </SelectContent>
                        </Select>
                        {divPeriodo === "custom" && (
                          <>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 text-xs w-28 justify-start">
                                  <CalendarIcon className="mr-1 h-3 w-3" />
                                  {divCustomStart ? format(divCustomStart, "dd/MM/yy") : "Início"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="single" selected={divCustomStart} onSelect={setDivCustomStart} locale={ptBR} className="pointer-events-auto" />
                              </PopoverContent>
                            </Popover>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 text-xs w-28 justify-start">
                                  <CalendarIcon className="mr-1 h-3 w-3" />
                                  {divCustomEnd ? format(divCustomEnd, "dd/MM/yy") : "Fim"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="single" selected={divCustomEnd} onSelect={setDivCustomEnd} locale={ptBR} className="pointer-events-auto" />
                              </PopoverContent>
                            </Popover>
                          </>
                        )}
                      </div>
                      <TechnicianDivergencesPanel
                        records={divergenceRecords}
                        loading={loadingAtrasadas || pendenciasMesRaw === undefined}
                        syncing={isSyncingDivergencias}
                        onRefresh={() => void atualizarDivergencias()}
                        onExport={exportUnifiedDivergences}
                      />
                    </SheetContent>
                  </Sheet>

                  <Button variant="outline" size="sm" onClick={() => void refreshAuvoAndGc()} disabled={isRefreshing} className="h-8 text-xs">
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    Atualizar
                  </Button>

                  {/* TV mode button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => setTvMode(true)}
                    disabled={!data}
                    title="Modo TV — tela cheia otimizada para televisão"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    TV
                  </Button>

                  {/* Minimize button */}
                  <button onClick={() => setHeaderMinimized(true)} className="text-muted-foreground hover:text-foreground transition-colors ml-1" title="Minimizar cabeçalho">
                    <ChevronsUpDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
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
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Summary strip */}
          <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-6 text-xs flex-wrap">
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

            {(() => {
              let totalAgendado = 0;
              let totalExecutado = 0;
              for (const tech of data.tecnicos) {
                for (const task of tech.tarefas) {
                  const val = parseFloat(task.gcOsValor || "0");
                  if (!val) continue;
                  totalAgendado += val;
                  if (task.status === "Finalizada") totalExecutado += val;
                }
              }
              return (
                <>
                  <span className="border-l pl-4 ml-2 flex items-center gap-1.5 font-semibold">
                    📋 Agendado: <strong className="text-foreground">R$ {totalAgendado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    ✅ Executado: <strong className="text-emerald-600">R$ {totalExecutado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                  </span>
                </>
              );
            })()}

            {/* View mode toggle */}
            <div className="ml-auto flex items-center border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <LayoutGrid className="h-3 w-3" /> Grid
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <List className="h-3 w-3" /> Tabela
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-auto p-4">
            {viewMode === "grid" ? (
              /* ═══ GRID VIEW — responsive cards ═══ */
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {[...data.tecnicos].sort((a, b) => {
                  const valA = a.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
                  const valB = b.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
                  return valB - valA;
                }).map((tech) => {
                  const sortedTarefas = [...tech.tarefas].sort((a, b) => (parseFloat(b.gcOsValor) || 0) - (parseFloat(a.gcOsValor) || 0));
                  const hasActive = tech.resumo.emAndamento > 0;
                  const progress = tech.resumo.total > 0
                    ? Math.round((tech.resumo.finalizadas / tech.resumo.total) * 100)
                    : 0;
                  const totalValor = sortedTarefas.reduce((sum, t) => sum + (parseFloat(t.gcOsValor) || 0), 0);
                  const isExpanded = expandedTechs.has(tech.id);

                  const toggleExpand = () => {
                    setExpandedTechs((prev) => {
                      const next = new Set(prev);
                      if (next.has(tech.id)) next.delete(tech.id);
                      else next.add(tech.id);
                      return next;
                    });
                  };

                  // Show up to 3 tasks collapsed, all when expanded
                  const visibleTasks = isExpanded ? sortedTarefas : sortedTarefas.slice(0, 3);
                  const hasMore = sortedTarefas.length > 3;

                  return (
                    <Card key={tech.id} className={`overflow-hidden transition-shadow hover:shadow-md ${hasActive ? "ring-1 ring-blue-300" : ""}`}>
                      {/* Tech header */}
                      <div className={`px-4 py-3 ${hasActive ? "bg-blue-50 dark:bg-blue-950/30" : "bg-muted/30"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                            hasActive ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                          }`}>
                            {tech.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{tech.nome}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                                {tech.resumo.finalizadas}/{tech.resumo.total}
                              </Badge>
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
                          {totalValor > 0 && (
                            <span className="text-xs font-bold text-emerald-700 whitespace-nowrap">
                              R$ {totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                        {/* Progress bar */}
                        <div className="mt-2.5 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-medium">{progress}%</span>
                        </div>
                      </div>

                      {/* Tasks list */}
                      <CardContent className="px-3 py-2 space-y-0">
                        {visibleTasks.map((task, idx) => {
                          const isLate = task.atrasada;
                          const cfg = isLate
                            ? { icon: AlertTriangle, class: "text-red-600" }
                            : (statusIcon[task.status] || statusIcon["Agendada"]);
                          const Icon = cfg.icon;
                          const barColor = isLate ? "bg-red-500" : (statusBarColor[task.status] || "bg-muted");

                          return (
                            <div key={task.taskId || idx} className={`flex gap-2 py-2 ${idx > 0 ? "border-t border-border/50" : ""} ${isLate ? "bg-red-50/50 dark:bg-red-950/20 -mx-1 px-1 rounded" : ""}`}>
                              <div className={`h-2 w-2 rounded-full ${barColor} mt-1.5 flex-shrink-0`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Icon className={`h-3 w-3 flex-shrink-0 ${cfg.class}`} />
                                  <span className={`text-[10px] font-medium ${cfg.class}`}>
                                    {isLate ? "Atrasada" : task.status}
                                  </span>
                                  {task.horaInicio && (
                                    <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
                                      <Clock className="h-2.5 w-2.5" />
                                      {task.horaInicio}{task.horaFim ? ` – ${task.horaFim}` : ""}
                                    </span>
                                  )}
                                </div>
                                <p className="font-medium text-xs text-foreground truncate mt-0.5">
                                  {task.cliente || "Sem cliente"}
                                </p>
                                {task.gcOsCodigo && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
                                      {task.gcOsTipo || "OS"} {task.gcOsCodigo}
                                    </Badge>
                                    {task.gcOsValor && task.gcOsValor !== "0" && (
                                      <span className="text-[10px] font-semibold text-emerald-600">
                                        R$ {parseFloat(task.gcOsValor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {task.taskId && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-mono">
                                      Auvo {task.taskId}
                                    </Badge>
                                  </div>
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

                        {hasMore && (
                          <button
                            onClick={toggleExpand}
                            className="w-full py-2 text-[11px] text-primary font-medium hover:bg-muted/50 rounded transition-colors flex items-center justify-center gap-1"
                          >
                            <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            {isExpanded ? "Recolher" : `Ver mais ${sortedTarefas.length - 3} tarefa(s)`}
                          </button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* ═══ TABLE VIEW — compact rows ═══ */
              <div className="rounded-lg border overflow-hidden bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Técnico</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Cliente</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">OS / Orç</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Horário</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.tecnicos].sort((a, b) => {
                      const valA = a.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
                      const valB = b.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
                      return valB - valA;
                    }).flatMap((tech) =>
                      [...tech.tarefas].sort((a, b) => (parseFloat(b.gcOsValor) || 0) - (parseFloat(a.gcOsValor) || 0)).map((task, idx) => {
                        const isLate = task.atrasada;
                        const cfg = isLate
                          ? { icon: AlertTriangle, class: "text-red-600" }
                          : (statusIcon[task.status] || statusIcon["Agendada"]);
                        const Icon = cfg.icon;
                        const barColor = isLate ? "bg-red-500" : (statusBarColor[task.status] || "bg-muted");

                        return (
                          <tr key={`${tech.id}-${task.taskId || idx}`} className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${isLate ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                                  tech.resumo.emAndamento > 0 ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                                }`}>
                                  {tech.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                                </div>
                                <span className="font-medium truncate max-w-[120px]">{tech.nome}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className="truncate max-w-[180px] block">{task.cliente || "—"}</span>
                            </td>
                            <td className="px-3 py-2">
                              {task.gcOsCodigo ? (
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
                                  {task.gcOsTipo || "OS"} {task.gcOsCodigo}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <div className={`h-2 w-2 rounded-full ${barColor} flex-shrink-0`} />
                                <Icon className={`h-3 w-3 ${cfg.class}`} />
                                <span className={`text-[10px] font-medium ${cfg.class}`}>
                                  {isLate ? "Atrasada" : task.status}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {task.horaInicio ? `${task.horaInicio}${task.horaFim ? ` – ${task.horaFim}` : ""}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                              {task.gcOsValor && task.gcOsValor !== "0"
                                ? `R$ ${parseFloat(task.gcOsValor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
