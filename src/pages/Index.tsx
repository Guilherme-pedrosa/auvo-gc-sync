import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarIcon, RefreshCw, DollarSign, FileText,
  ClipboardList, CheckCircle2, XCircle, TrendingUp, BarChart3, Wrench,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { format, startOfMonth, startOfYear, endOfMonth, isWithinInterval, parseISO, subMonths, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import LastSyncBadge from "@/components/LastSyncBadge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

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

const COLORS = [
  "hsl(142, 71%, 45%)", "hsl(217, 91%, 60%)", "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)", "hsl(262, 83%, 58%)", "hsl(180, 70%, 45%)",
  "hsl(330, 80%, 55%)", "hsl(45, 93%, 47%)", "hsl(190, 90%, 50%)"
];

const pieColors = ["hsl(38, 92%, 50%)", "hsl(142, 71%, 45%)", "hsl(217, 91%, 60%)", "hsl(262, 83%, 58%)"];

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });


function computeMetrics(items: KanbanItem[], monthItems: KanbanItem[], source: "orc" | "exec") {
  const total = items.length;

  const comMatch = source === "orc"
    ? items.filter((i) => i.orcamento_realizado)
    : items.filter((i) => i.os_realizada);
  const comOs = items.filter((i) => i.os_realizada);
  const semMatch = source === "orc"
    ? items.filter((i) => !i.orcamento_realizado && !i.os_realizada)
    : items.filter((i) => !i.os_realizada);

  const valorMatch = comMatch.reduce((acc, i) => {
    if (source === "orc") return acc + parseFloat(i.gc_orcamento?.gc_valor_total || "0");
    return acc + parseFloat(i.gc_os?.gc_valor_total || "0");
  }, 0);
  const valorOs = comOs.reduce((acc, i) => acc + parseFloat(i.gc_os?.gc_valor_total || "0"), 0);

  // Monthly
  const mesComMatch = source === "orc"
    ? monthItems.filter((i) => i.orcamento_realizado)
    : monthItems.filter((i) => i.os_realizada);
  const mesSemMatch = source === "orc"
    ? monthItems.filter((i) => !i.orcamento_realizado && !i.os_realizada)
    : monthItems.filter((i) => !i.os_realizada);
  const mesValorMatch = mesComMatch.reduce((acc, i) => {
    if (source === "orc") return acc + parseFloat(i.gc_orcamento?.gc_valor_total || "0");
    return acc + parseFloat(i.gc_os?.gc_valor_total || "0");
  }, 0);

  // By situation — only items that have the actual GC document
  const situacaoMap: Record<string, { count: number; valor: number; cor: string }> = {};
  for (const item of comMatch) {
    const doc = source === "orc" ? item.gc_orcamento : item.gc_os;
    if (!doc) continue; // Skip items without GC document
    const sit = doc.gc_situacao || "Sem situação";
    const cor = doc.gc_cor_situacao || "#888";
    if (!situacaoMap[sit]) situacaoMap[sit] = { count: 0, valor: 0, cor };
    situacaoMap[sit].count++;
    situacaoMap[sit].valor += parseFloat(doc.gc_valor_total || "0");
  }

  // By technician — green = has match, yellow = no match
  const tecnicoMap: Record<string, { total: number; comMatch: number; valorMatch: number }> = {};
  for (const item of items) {
    const t = item.tecnico || "Sem técnico";
    if (!tecnicoMap[t]) tecnicoMap[t] = { total: 0, comMatch: 0, valorMatch: 0 };
    tecnicoMap[t].total++;
    const hasMatch = source === "orc"
      ? (item.orcamento_realizado || item.os_realizada)
      : item.os_realizada;
    if (hasMatch) {
      tecnicoMap[t].comMatch++;
      const valorOrc = parseFloat(item.gc_orcamento?.gc_valor_total || "0");
      const valorOs = parseFloat(item.gc_os?.gc_valor_total || "0");
      tecnicoMap[t].valorMatch += valorOrc + valorOs;
    }
  }

  const taxaMatch = total > 0 ? ((comMatch.length / total) * 100).toFixed(1) : "0";

  return {
    total, comMatch: comMatch.length, semMatch: semMatch.length,
    valorMatch, valorOs,
    mesTotal: monthItems.length, mesComMatch: mesComMatch.length,
    mesSemMatch: mesSemMatch.length, mesValorMatch,
    situacaoMap, tecnicoMap, taxaMatch,
  };
}

export default function Index() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [dateRange, setDateRange] = useState({
    from: startOfYear(today),
    to: today,
  });
  const [selectedMonth, setSelectedMonth] = useState(today);
  const monthRange = useMemo(() => ({
    from: startOfMonth(selectedMonth),
    to: endOfMonth(selectedMonth),
  }), [selectedMonth]);

  // Fetch orçamentos data
  const { data: orcData, isLoading: orcLoading, refetch: refetchOrc } = useQuery({
    queryKey: ["dash-orc", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("budget-kanban", {
        body: {
          mode: "cache",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      if (error) throw error;
      return data as { items: KanbanItem[]; ultimo_sync?: string };
    },
    staleTime: 60_000,
  });

  // Fetch execução data from central mirror table (all tasks + OS)
  const { data: execData, isLoading: execLoading, refetch: refetchExec } = useQuery({
    queryKey: ["dash-exec", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const startDate = format(dateRange.from, "yyyy-MM-dd");
      const endDate = format(dateRange.to, "yyyy-MM-dd");
      const pageSize = 1000;
      let from = 0;
      const rows: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select("auvo_task_id,auvo_link,cliente,tecnico,data_tarefa,orientacao,status_auvo,questionario_respostas,orcamento_realizado,os_realizada,gc_orcamento_id,gc_orcamento_codigo,gc_orc_cliente,gc_orc_situacao,gc_orc_situacao_id,gc_orc_cor_situacao,gc_orc_valor_total,gc_orc_vendedor,gc_orc_data,gc_orc_link,gc_os_id,gc_os_codigo,gc_os_cliente,gc_os_situacao,gc_os_situacao_id,gc_os_cor_situacao,gc_os_valor_total,gc_os_vendedor,gc_os_data,gc_os_link,atualizado_em")
          .gte("data_tarefa", startDate)
          .lte("data_tarefa", endDate)
          .order("data_tarefa", { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data?.length) break;

        rows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      const items: KanbanItem[] = rows.map((row: any) => ({
        auvo_task_id: String(row.auvo_task_id || ""),
        auvo_link: String(row.auvo_link || ""),
        cliente: String(row.cliente || "Cliente não identificado"),
        tecnico: String(row.tecnico || "Sem técnico"),
        data_tarefa: String(row.data_tarefa || ""),
        orientacao: String(row.orientacao || ""),
        status_auvo: String(row.status_auvo || ""),
        questionario_respostas: Array.isArray(row.questionario_respostas)
          ? row.questionario_respostas
          : [],
        orcamento_realizado: !!row.orcamento_realizado,
        os_realizada: !!row.os_realizada,
        gc_orcamento: row.gc_orcamento_id
          ? {
              gc_orcamento_id: String(row.gc_orcamento_id || ""),
              gc_orcamento_codigo: String(row.gc_orcamento_codigo || ""),
              gc_os_id: "",
              gc_os_codigo: "",
              gc_cliente: String(row.gc_orc_cliente || ""),
              gc_situacao: String(row.gc_orc_situacao || ""),
              gc_situacao_id: String(row.gc_orc_situacao_id || ""),
              gc_cor_situacao: String(row.gc_orc_cor_situacao || ""),
              gc_valor_total: String(row.gc_orc_valor_total ?? "0"),
              gc_vendedor: String(row.gc_orc_vendedor || ""),
              gc_data: String(row.gc_orc_data || ""),
              gc_link: String(row.gc_orc_link || ""),
            }
          : null,
        gc_os: row.gc_os_id
          ? {
              gc_orcamento_id: "",
              gc_orcamento_codigo: "",
              gc_os_id: String(row.gc_os_id || ""),
              gc_os_codigo: String(row.gc_os_codigo || ""),
              gc_cliente: String(row.gc_os_cliente || ""),
              gc_situacao: String(row.gc_os_situacao || ""),
              gc_situacao_id: String(row.gc_os_situacao_id || ""),
              gc_cor_situacao: String(row.gc_os_cor_situacao || ""),
              gc_valor_total: String(row.gc_os_valor_total ?? "0"),
              gc_vendedor: String(row.gc_os_vendedor || ""),
              gc_data: String(row.gc_os_data || ""),
              gc_link: String(row.gc_os_link || ""),
            }
          : null,
      }));

      const ultimo_sync = rows
        .map((row) => row.atualizado_em)
        .filter(Boolean)
        .sort()
        .at(-1);

      return { items, ultimo_sync } as { items: KanbanItem[]; ultimo_sync?: string };
    },
    staleTime: 60_000,
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus("Iniciando sincronização...");
    try {
      const kanbanPromise = supabase.functions.invoke("budget-kanban", {
        body: {
          mode: "sync",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      }).then(() => setSyncStatus(prev => prev.includes("Central") ? "Tudo pronto!" : "Kanban ✓ — Aguardando Central..."));

      const centralPromise = supabase.functions.invoke("central-sync")
        .then(() => setSyncStatus(prev => prev.includes("Kanban") ? "Tudo pronto!" : "Central ✓ — Aguardando Kanban..."));

      await Promise.all([kanbanPromise, centralPromise]);
      setSyncStatus("Atualizando dados...");
      toast.success("Dados sincronizados (Kanban + Central)!");
      await Promise.all([refetchOrc(), refetchExec()]);
      setSyncStatus("");
    } catch {
      toast.warning("Sincronização em processamento...");
      setSyncStatus("");
    } finally {
      setIsSyncing(false);
    }
  };

  const isLoading = orcLoading || execLoading;

  const orcItems = useMemo(() => orcData?.items || [], [orcData]);
  const execItems = useMemo(() => execData?.items || [], [execData]);

  const filterMonth = (items: KanbanItem[]) =>
    items.filter((item) => {
      if (!item.data_tarefa) return false;
      try { return isWithinInterval(parseISO(item.data_tarefa), { start: monthRange.from, end: monthRange.to }); }
      catch { return false; }
    });

  const orcMonthItems = useMemo(() => filterMonth(orcItems), [orcItems, monthRange]);
  const execMonthItems = useMemo(() => filterMonth(execItems), [execItems, monthRange]);

  const orcMetrics = useMemo(() => computeMetrics(orcItems, orcMonthItems, "orc"), [orcItems, orcMonthItems]);
  const execMetrics = useMemo(() => computeMetrics(execItems, execMonthItems, "exec"), [execItems, execMonthItems]);

  // Month-only metrics for charts and table
  const orcMonthMetrics = useMemo(() => computeMetrics(orcMonthItems, orcMonthItems, "orc"), [orcMonthItems]);
  const execMonthMetrics = useMemo(() => computeMetrics(execMonthItems, execMonthItems, "exec"), [execMonthItems]);

  // Combined totals
  const combined = useMemo(() => ({
    totalTarefas: orcMetrics.total + execMetrics.total,
    valorTotal: orcMetrics.valorMatch + execMetrics.valorMatch,
    mesTotalTarefas: orcMetrics.mesTotal + execMetrics.mesTotal,
    mesValorTotal: orcMetrics.mesValorMatch + execMetrics.mesValorMatch,
  }), [orcMetrics, execMetrics]);

  const renderKPIs = (m: ReturnType<typeof computeMetrics>, label: { match: string; sem: string }) => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <ClipboardList className="h-3.5 w-3.5" /> Total Tarefas
          </div>
          <p className="text-2xl font-bold text-foreground">{m.total}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs mb-1 text-amber-600">
            <XCircle className="h-3.5 w-3.5" /> {label.sem}
          </div>
          <p className="text-2xl font-bold text-amber-600">{m.semMatch}</p>
          <p className="text-[10px] text-muted-foreground">{m.total > 0 ? ((m.semMatch / m.total) * 100).toFixed(0) : 0}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs mb-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {label.match}
          </div>
          <p className="text-2xl font-bold text-emerald-600">{m.comMatch}</p>
          <p className="text-[10px] text-muted-foreground">{fmtBRL(m.valorMatch)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs mb-1 text-primary">
            <TrendingUp className="h-3.5 w-3.5" /> Taxa
          </div>
          <p className="text-2xl font-bold text-primary">{m.taxaMatch}%</p>
          <p className="text-[10px] text-muted-foreground">Match GC</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-xs mb-1 text-foreground">
            <DollarSign className="h-3.5 w-3.5" /> Valor Total
          </div>
          <p className="text-xl font-bold text-foreground">{fmtBRL(m.valorMatch)}</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderMonthKPIs = (m: ReturnType<typeof computeMetrics>, label: { match: string; sem: string }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card className="border-l-4 border-l-foreground/20">
        <CardContent className="pt-3 pb-2 px-4">
          <p className="text-xs text-muted-foreground mb-1">Tarefas no mês</p>
          <p className="text-xl font-bold">{m.mesTotal}</p>
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-amber-400">
        <CardContent className="pt-3 pb-2 px-4">
          <p className="text-xs text-amber-600 mb-1">{label.sem}</p>
          <p className="text-xl font-bold text-amber-600">{m.mesSemMatch}</p>
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-emerald-500">
        <CardContent className="pt-3 pb-2 px-4">
          <p className="text-xs text-emerald-600 mb-1">{label.match}</p>
          <p className="text-xl font-bold text-emerald-600">{m.mesComMatch}</p>
          <p className="text-[10px] text-muted-foreground">{fmtBRL(m.mesValorMatch)}</p>
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-primary">
        <CardContent className="pt-3 pb-2 px-4">
          <p className="text-xs text-primary mb-1">Valor mês</p>
          <p className="text-xl font-bold text-primary">{fmtBRL(m.mesValorMatch)}</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderSituacaoChart = (m: ReturnType<typeof computeMetrics>, title: string) => {
    const chartData = Object.entries(m.situacaoMap)
      .sort(([, a], [, b]) => b.valor - a.valor)
      .map(([name, d]) => ({ name, valor: Math.round(d.valor * 100) / 100, count: d.count, cor: d.cor }));

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.cor || COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderTecnicoChart = (m: ReturnType<typeof computeMetrics>, labels: { match: string; sem: string }) => {
    const chartData = Object.entries(m.tecnicoMap)
      .sort(([, a], [, b]) => b.valorMatch - a.valorMatch)
      .slice(0, 10)
      .map(([name, d]) => ({
        name: name.length > 15 ? name.substring(0, 15) + "..." : name,
        [labels.match]: d.comMatch,
        [labels.sem]: d.total - d.comMatch,
      }));

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tarefas por Técnico</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" angle={-25} textAnchor="end" height={60} tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey={labels.sem} stackId="a" fill="hsl(38, 92%, 50%)" />
                <Bar dataKey={labels.match} stackId="a" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSituacaoTable = (m: ReturnType<typeof computeMetrics>) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Detalhamento por Situação</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b">
                <th className="h-9 px-3 text-left font-medium text-muted-foreground text-xs">Situação</th>
                <th className="h-9 px-3 text-right font-medium text-muted-foreground text-xs">Qtd</th>
                <th className="h-9 px-3 text-right font-medium text-muted-foreground text-xs">Valor Total</th>
                <th className="h-9 px-3 text-right font-medium text-muted-foreground text-xs">Ticket Médio</th>
                <th className="h-9 px-3 text-right font-medium text-muted-foreground text-xs">%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(m.situacaoMap)
                .sort(([, a], [, b]) => b.valor - a.valor)
                .map(([sit, data]) => (
                  <tr key={sit} className="border-b hover:bg-muted/50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: data.cor }} />
                        <span className="font-medium text-sm">{sit}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right text-sm">{data.count}</td>
                    <td className="p-3 text-right font-medium text-sm">{fmtBRL(data.valor)}</td>
                    <td className="p-3 text-right text-muted-foreground text-sm">
                      {fmtBRL(data.count > 0 ? data.valor / data.count : 0)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground text-sm">
                      {m.valorMatch > 0 ? ((data.valor / m.valorMatch) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              {Object.keys(m.situacaoMap).length === 0 && (
                <tr><td colSpan={5} className="p-3 text-center text-muted-foreground text-sm">Sem dados</td></tr>
              )}
            </tbody>
            {Object.keys(m.situacaoMap).length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/50 font-medium">
                  <td className="p-3 text-sm">Total</td>
                  <td className="p-3 text-right text-sm">{m.comMatch}</td>
                  <td className="p-3 text-right text-sm">{fmtBRL(m.valorMatch)}</td>
                  <td className="p-3 text-right text-muted-foreground text-sm">
                    {fmtBRL(m.comMatch > 0 ? m.valorMatch / m.comMatch : 0)}
                  </td>
                  <td className="p-3 text-right text-sm">100%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );

  const orcLabels = { match: "Com Orçamento", sem: "Sem Orçamento" };
  const execLabels = { match: "Com OS", sem: "Sem OS" };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Orçamentos e Execução de Serviços — Auvo × GestãoClick
            </p>
            <LastSyncBadge className="mt-0.5" />
          </div>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(dateRange.from, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={dateRange.from}
                  onSelect={(d) => {
                    if (!d) return;
                    setDateRange((prev) => ({
                      from: d,
                      to: prev.to >= d ? prev.to : d,
                    }));
                  }}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">até</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(dateRange.to, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={dateRange.to}
                  onSelect={(d) => {
                    if (!d) return;
                    setDateRange((prev) => ({
                      from: prev.from <= d ? prev.from : d,
                      to: d,
                    }));
                  }}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing} className="h-8 text-xs">
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Sincronizando..." : "Sincronizar"}
              </Button>
              {syncStatus && (
                <span className="text-xs text-muted-foreground animate-pulse">{syncStatus}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* Combined summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Total Geral de Tarefas</p>
                <p className="text-2xl font-bold text-foreground">{combined.totalTarefas}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Valor Total (Orç + Exec)</p>
                <p className="text-2xl font-bold text-foreground">{fmtBRL(combined.valorTotal)}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Tarefas no Mês</p>
                <p className="text-2xl font-bold text-foreground">{combined.mesTotalTarefas}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground mb-1">Valor Mês (Orç + Exec)</p>
                <p className="text-2xl font-bold text-foreground">{fmtBRL(combined.mesValorTotal)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="orcamentos" className="space-y-4">
            <TabsList className="h-9">
              <TabsTrigger value="orcamentos" className="text-xs gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Orçamentos
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{orcMetrics.total}</Badge>
              </TabsTrigger>
              <TabsTrigger value="execucao" className="text-xs gap-1.5">
                <Wrench className="h-3.5 w-3.5" /> Execução de Serviços
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{execMetrics.total}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orcamentos" className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Período Total</h2>
                {renderKPIs(orcMetrics, orcLabels)}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mês</h2>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMonth(prev => subMonths(prev, 1))}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Badge variant="outline" className="text-[10px] min-w-[100px] justify-center">{format(monthRange.from, "MMMM yyyy", { locale: ptBR })}</Badge>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMonth(prev => addMonths(prev, 1))}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {renderMonthKPIs(orcMetrics, orcLabels)}
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {renderSituacaoChart(orcMonthMetrics, "Valor por Situação do Orçamento")}
                {renderTecnicoChart(orcMonthMetrics, orcLabels)}
              </div>
              {renderSituacaoTable(orcMonthMetrics)}
            </TabsContent>

            <TabsContent value="execucao" className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Período Total</h2>
                {renderKPIs(execMetrics, execLabels)}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mês</h2>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMonth(prev => subMonths(prev, 1))}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Badge variant="outline" className="text-[10px] min-w-[100px] justify-center">{format(monthRange.from, "MMMM yyyy", { locale: ptBR })}</Badge>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMonth(prev => addMonths(prev, 1))}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {renderMonthKPIs(execMetrics, execLabels)}
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {renderSituacaoChart(execMonthMetrics, "Valor por Situação da OS")}
                {renderTecnicoChart(execMonthMetrics, execLabels)}
              </div>
              {renderSituacaoTable(execMonthMetrics)}
            </TabsContent>
          </Tabs>

          {/* Sync info */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            {orcData?.ultimo_sync && <span>Orçamentos sync: {new Date(orcData.ultimo_sync).toLocaleString("pt-BR")}</span>}
            {execData?.ultimo_sync && <span>Execução sync: {new Date(execData.ultimo_sync).toLocaleString("pt-BR")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
