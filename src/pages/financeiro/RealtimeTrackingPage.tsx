import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  RefreshCw, CalendarIcon, MapPin, Clock, User,
  CheckCircle2, PlayCircle, CalendarClock, AlertTriangle,
  ChevronLeft, ChevronRight, FileWarning, ChevronDown, Download,
  LayoutGrid, List
} from "lucide-react";
import { format, addDays, subDays, isToday, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import LastSyncBadge from "@/components/LastSyncBadge";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [expandedTechs, setExpandedTechs] = useState<Set<string>>(new Set());
  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["realtime-tracking", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("realtime-tracking", {
        body: { date: dateStr },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setLastFetchTime(new Date().toISOString());
      return data as TrackingData;
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // Monthly late tasks query
  const monthStart = format(startOfMonth(selectedDate), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(selectedDate), "yyyy-MM-dd");

  const { data: atrasadasMes, isLoading: loadingAtrasadas, refetch: refetchAtrasadas } = useQuery({
    queryKey: ["atrasadas-mes", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atividades_nao_executadas")
        .select("*")
        .gte("data_planejada", monthStart)
        .lte("data_planejada", monthEnd)
        .order("data_planejada", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: sheetOpen,
  });

  // Monthly pendências from tarefas_central
  const { data: pendenciasMesRaw, refetch: refetchPendencias } = useQuery({
    queryKey: ["pendencias-mes", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, cliente, tecnico, data_tarefa, pendencia, descricao, gc_os_codigo, status_auvo, questionario_respostas")
        .gte("data_tarefa", monthStart)
        .lte("data_tarefa", monthEnd)
        .neq("pendencia", "")
        .not("pendencia", "is", null)
        .order("data_tarefa", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: sheetOpen,
  });

  const isBlankChecklistReply = (value: unknown) => {
    if (value === null || value === undefined) return true;
    const text = String(value).trim().toLowerCase();
    return !text || [".", "-", "na", "n/a", "null", "undefined"].includes(text);
  };

  const pendenciasMes = useMemo(() => {
    return (pendenciasMesRaw || []).map((item) => {
      const pendenciaRaw = item.pendencia || "";
      const formName = pendenciaRaw.startsWith("Checklist: ")
        ? pendenciaRaw.replace("Checklist: ", "")
        : pendenciaRaw;

      const respostas = Array.isArray(item.questionario_respostas)
        ? (item.questionario_respostas as Array<Record<string, unknown>>)
            .filter((r) => typeof r === "object" && r !== null)
        : [];

      const camposVazios = respostas
        .filter((r) => isBlankChecklistReply(r.reply))
        .map((r) => (typeof r.question === "string" ? r.question.trim() : ""))
        .filter(Boolean);

      const motivosPendencia = [
        ...(respostas.length === 0 ? ["Formulário sem respostas enviadas"] : []),
        ...(camposVazios.length > 0 ? [`Sem preenchimento: ${camposVazios.join(", ")}`] : []),
      ];

      return {
        taskId: item.auvo_task_id,
        cliente: item.cliente || "",
        tecnico: item.tecnico || "",
        data: item.data_tarefa || "",
        pendencia: pendenciaRaw,
        formName,
        motivosPendencia,
        descricao: item.descricao || "",
        gcOsCodigo: item.gc_os_codigo || "",
      };
    });
  }, [pendenciasMesRaw]);

  const goDay = (dir: number) => setSelectedDate((d) => (dir > 0 ? addDays(d, 1) : subDays(d, 1)));

  const exportPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const mesLabel = format(selectedDate, "MMMM yyyy", { locale: ptBR });
    const now = format(new Date(), "dd/MM/yyyy HH:mm");
    const pageW = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.text(`Divergências — ${mesLabel}`, 14, 15);
    doc.setFontSize(8);
    doc.text(`Gerado em ${now}`, 14, 21);

    let startY = 28;

    // ── Group atrasos by technician ──
    const atrasosByTech: Record<string, typeof atrasadasMes> = {};
    (atrasadasMes || []).forEach((item) => {
      const key = item.tecnico_nome || "Sem técnico";
      if (!atrasosByTech[key]) atrasosByTech[key] = [];
      atrasosByTech[key].push(item);
    });

    const techNamesAtrasos = Object.keys(atrasosByTech).sort();

    if (techNamesAtrasos.length > 0) {
      doc.setFontSize(12);
      doc.setTextColor(220, 53, 69);
      doc.text("Não Atendidas no Dia Planejado", 14, startY);
      doc.setTextColor(0, 0, 0);
      startY += 2;

      doc.setFontSize(8);
      doc.text(
        `Total: ${(atrasadasMes || []).length} ocorrência(s) · ${techNamesAtrasos.length} técnico(s)`,
        14,
        startY + 4
      );
      startY += 8;

      for (const techName of techNamesAtrasos) {
        const items = atrasosByTech[techName];
        if (startY > 170) { doc.addPage(); startY = 15; }

        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        doc.text(`${techName}  (${items.length})`, 14, startY);
        doc.setTextColor(0, 0, 0);
        startY += 2;

        const rows = items.map((item) => [
          item.data_planejada ? format(new Date(item.data_planejada + "T12:00:00"), "dd/MM/yyyy") : "—",
          item.cliente || "Sem cliente",
          item.descricao || "",
          item.motivo || "",
          item.auvo_task_id,
        ]);

        autoTable(doc, {
          startY,
          head: [["Data", "Cliente", "Descrição", "Motivo", "Task ID"]],
          body: rows,
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [220, 53, 69], textColor: 255 },
          columnStyles: {
            0: { cellWidth: 22 },
            2: { cellWidth: 60 },
            3: { cellWidth: 50 },
            4: { cellWidth: 22 },
          },
        });

        startY = (doc as any).lastAutoTable.finalY + 6;
      }
    }

    // ── Group pendências by technician ──
    const pendByTech: Record<string, typeof pendenciasMes> = {};
    pendenciasMes.forEach((item) => {
      const key = item.tecnico || "Sem técnico";
      if (!pendByTech[key]) pendByTech[key] = [];
      pendByTech[key].push(item);
    });

    const techNamesPend = Object.keys(pendByTech).sort();

    if (techNamesPend.length > 0) {
      if (startY > 160) { doc.addPage(); startY = 15; }

      doc.setFontSize(12);
      doc.setTextColor(217, 149, 24);
      doc.text("OS com Pendência", 14, startY);
      doc.setTextColor(0, 0, 0);
      startY += 2;

      doc.setFontSize(8);
      doc.text(
        `Total: ${pendenciasMes.length} ocorrência(s) · ${techNamesPend.length} técnico(s)`,
        14,
        startY + 4
      );
      startY += 8;

      for (const techName of techNamesPend) {
        const items = pendByTech[techName];
        if (startY > 170) { doc.addPage(); startY = 15; }

        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        doc.text(`${techName}  (${items.length})`, 14, startY);
        doc.setTextColor(0, 0, 0);
        startY += 2;

        const rows = items.map((item) => [
          item.data ? format(new Date(item.data + "T12:00:00"), "dd/MM/yyyy") : "—",
          item.cliente || "Sem cliente",
          item.formName || "",
          item.motivosPendencia.length > 0
            ? item.motivosPendencia.join("; ")
            : "Motivo não detalhado",
          item.gcOsCodigo ? `OS #${item.gcOsCodigo}` : item.taskId,
        ]);

        autoTable(doc, {
          startY,
          head: [["Data", "Cliente", "Formulário", "Motivo", "Ref"]],
          body: rows,
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [217, 149, 24], textColor: 255 },
          columnStyles: {
            0: { cellWidth: 22 },
            2: { cellWidth: 38 },
            3: { cellWidth: 70 },
            4: { cellWidth: 22 },
          },
        });

        startY = (doc as any).lastAutoTable.finalY + 6;
      }
    }

    // ── Summary page ──
    doc.addPage();
    doc.setFontSize(14);
    doc.text(`Resumo por Técnico — ${mesLabel}`, 14, 15);

    const summaryRows: string[][] = [];
    const allTechNames = [...new Set([...techNamesAtrasos, ...techNamesPend])].sort();
    for (const name of allTechNames) {
      const nAtrasos = (atrasosByTech[name] || []).length;
      const nPend = (pendByTech[name] || []).length;
      summaryRows.push([name, String(nAtrasos), String(nPend), String(nAtrasos + nPend)]);
    }
    // Total row
    const totalAtrasos = (atrasadasMes || []).length;
    const totalPend = pendenciasMes.length;
    summaryRows.push(["TOTAL", String(totalAtrasos), String(totalPend), String(totalAtrasos + totalPend)]);

    autoTable(doc, {
      startY: 22,
      head: [["Técnico", "Não Atendidas", "Pendências", "Total"]],
      body: summaryRows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [60, 60, 60], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { halign: "center" as const },
        2: { halign: "center" as const },
        3: { halign: "center" as const, fontStyle: "bold" as const },
      },
      didParseCell: (data: any) => {
        // Bold the total row
        if (data.row.index === summaryRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 240, 240];
        }
      },
    });

    doc.save(`divergencias-${format(selectedDate, "yyyy-MM")}.pdf`);
    toast.success("PDF gerado com sucesso!");
  }, [atrasadasMes, pendenciasMes, selectedDate]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Agenda de Técnicos</h1>
            <p className="text-xs text-muted-foreground">
              Acompanhamento em tempo real — Auvo
            </p>
            <LastSyncBadge className="mt-0.5" overrideTimestamp={lastFetchTime} />
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

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                refetch();
                toast.info("Atualizando dados...");
              }}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
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
                  Divergências do Mês
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[600px] sm:max-w-[600px]">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Divergências — {format(selectedDate, "MMMM yyyy", { locale: ptBR })}
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-4">
                  {loadingAtrasadas ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {atrasadasMes && atrasadasMes.length > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {atrasadasMes.length} atraso(s)
                            </Badge>
                          )}
                          {pendenciasMes.length > 0 && (
                            <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300">
                              {pendenciasMes.length} pendência(s)
                            </Badge>
                          )}
                          {(!atrasadasMes || atrasadasMes.length === 0) && pendenciasMes.length === 0 && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                              <span className="text-sm">Nenhuma divergência neste mês!</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={exportPDF}
                            disabled={(!atrasadasMes || atrasadasMes.length === 0) && pendenciasMes.length === 0}
                          >
                            <Download className="h-3 w-3 mr-1" /> PDF
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              void Promise.all([refetchAtrasadas(), refetchPendencias()]);
                            }}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
                          </Button>
                        </div>
                      </div>
                      <ScrollArea className="h-[calc(100vh-12rem)]">
                        <div className="space-y-4">
                          {/* SEÇÃO: Atrasadas */}
                          {atrasadasMes && atrasadasMes.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Não Atendidas no Dia Planejado
                              </h3>
                              <div className="space-y-2">
                                {(() => {
                                  const byTech: Record<string, { nome: string; items: typeof atrasadasMes }> = {};
                                  for (const item of atrasadasMes) {
                                    const key = item.tecnico_id;
                                    if (!byTech[key]) byTech[key] = { nome: item.tecnico_nome, items: [] };
                                    byTech[key].items.push(item);
                                  }
                                  const sorted = Object.entries(byTech).sort((a, b) => b[1].items.length - a[1].items.length);

                                  return sorted.map(([techId, group]) => (
                                    <Collapsible key={techId}>
                                      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                          <div className="h-8 w-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {group.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                                          </div>
                                          <div className="text-left">
                                            <p className="text-sm font-semibold">{group.nome}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                              {group.items.length} atraso(s) no mês
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Badge variant="destructive" className="text-[10px] h-5 px-2">
                                            {group.items.length}
                                          </Badge>
                                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                                        </div>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="mt-1 ml-4 border-l-2 border-red-200 pl-3 space-y-1.5 py-1.5">
                                          {group.items.map((item) => (
                                            <div key={item.id} className="flex items-start gap-2 text-xs py-1">
                                              <span className="font-mono text-muted-foreground whitespace-nowrap min-w-[40px]">
                                                {item.data_planejada ? format(new Date(item.data_planejada + "T12:00:00"), "dd/MM") : "—"}
                                              </span>
                                              <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{item.cliente || "Sem cliente"}</p>
                                                {item.descricao && (
                                                  <p className="text-[10px] text-muted-foreground truncate">{item.descricao}</p>
                                                )}
                                              </div>
                                              <span className="text-[10px] text-muted-foreground font-mono">#{item.auvo_task_id}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  ));
                                })()}
                              </div>
                            </div>
                          )}

                          {/* SEÇÃO: Pendências */}
                          {pendenciasMes.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                <FileWarning className="h-3.5 w-3.5" />
                                OS com Pendência
                              </h3>
                              <div className="space-y-2">
                                {(() => {
                                  const byTech: Record<string, { nome: string; items: typeof pendenciasMes }> = {};
                                  for (const item of pendenciasMes) {
                                    const key = item.tecnico;
                                    if (!byTech[key]) byTech[key] = { nome: item.tecnico, items: [] };
                                    byTech[key].items.push(item);
                                  }
                                  const sorted = Object.entries(byTech).sort((a, b) => b[1].items.length - a[1].items.length);

                                  return sorted.map(([techName, group]) => (
                                    <Collapsible key={techName}>
                                      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                          <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {group.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                                          </div>
                                          <div className="text-left">
                                            <p className="text-sm font-semibold">{group.nome}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                              {group.items.length} pendência(s)
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Badge className="text-[10px] h-5 px-2 bg-amber-100 text-amber-800 border border-amber-300">
                                            {group.items.length}
                                          </Badge>
                                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                                        </div>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="mt-1 ml-4 border-l-2 border-amber-300 pl-3 space-y-1.5 py-1.5">
                                          {group.items.map((item) => (
                                             <div key={item.taskId} className="flex items-start gap-2 text-xs py-1.5">
                                              <span className="font-mono text-muted-foreground whitespace-nowrap min-w-[40px]">
                                                {item.data ? format(new Date(item.data + "T12:00:00"), "dd/MM") : "—"}
                                              </span>
                                              <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{item.cliente || "Sem cliente"}</p>
                                                <p className="text-[10px] text-amber-700 font-medium">
                                                  📋 {item.formName}
                                                </p>
                                                {item.motivosPendencia.length > 0 ? (
                                                  item.motivosPendencia.map((motivo: string, idx: number) => (
                                                    <p key={`${item.taskId}-motivo-${idx}`} className="text-[10px] text-destructive mt-0.5">
                                                      ❌ {motivo}
                                                    </p>
                                                  ))
                                                ) : (
                                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                                    ⚠️ Motivo da pendência não detalhado pelo formulário
                                                  </p>
                                                )}
                                              </div>
                                              {item.gcOsCodigo && (
                                                <span className="text-[10px] text-muted-foreground font-mono">OS #{item.gcOsCodigo}</span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  ));
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>

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
                {data.tecnicos.map((tech) => {
                  const hasActive = tech.resumo.emAndamento > 0;
                  const progress = tech.resumo.total > 0
                    ? Math.round((tech.resumo.finalizadas / tech.resumo.total) * 100)
                    : 0;
                  const totalValor = tech.tarefas.reduce((sum, t) => sum + (parseFloat(t.gcOsValor) || 0), 0);
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
                  const visibleTasks = isExpanded ? tech.tarefas : tech.tarefas.slice(0, 3);
                  const hasMore = tech.tarefas.length > 3;

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
                            {isExpanded ? "Recolher" : `Ver mais ${tech.tarefas.length - 3} tarefa(s)`}
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
                    {data.tecnicos.flatMap((tech) =>
                      tech.tarefas.map((task, idx) => {
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
