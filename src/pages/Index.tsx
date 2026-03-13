import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarIcon, RefreshCw, DollarSign, FileText,
  ClipboardList, CheckCircle2, XCircle, TrendingUp, BarChart3, Wrench
} from "lucide-react";
import { format, startOfMonth, startOfYear, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
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

  // By situation
  const situacaoMap: Record<string, { count: number; valor: number; cor: string }> = {};
  for (const item of comMatch) {
    const doc = source === "orc" ? item.gc_orcamento : item.gc_os;
    const sit = doc?.gc_situacao || "Sem situação";
    const cor = doc?.gc_cor_situacao || "#888";
    if (!situacaoMap[sit]) situacaoMap[sit] = { count: 0, valor: 0, cor };
    situacaoMap[sit].count++;
    situacaoMap[sit].valor += parseFloat(doc?.gc_valor_total || "0");
  }

  // By technician
  const tecnicoMap: Record<string, { total: number; comMatch: number; valorMatch: number }> = {};
  for (const item of items) {
    const t = item.tecnico || "Sem técnico";
    if (!tecnicoMap[t]) tecnicoMap[t] = { total: 0, comMatch: 0, valorMatch: 0 };
    tecnicoMap[t].total++;
    const matched = source === "orc" ? item.orcamento_realizado : item.os_realizada;
    if (matched) {
      tecnicoMap[t].comMatch++;
      const doc = source === "orc" ? item.gc_orcamento : item.gc_os;
      tecnicoMap[t].valorMatch += parseFloat(doc?.gc_valor_total || "0");
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
  const today = new Date();
  const [dateRange, setDateRange] = useState({
    from: startOfYear(today),
    to: today,
  });
  const [monthRange] = useState({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });

  // Fetch orçamentos data
  const { data: orcData, isLoading: orcLoading, refetch: refetchOrc } = useQuery({
    queryKey: ["dash-orc", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("budget-kanban", {
        body: { mode: "cache", start_date: format(dateRange.from, "yyyy-MM-dd"), end_date: format(dateRange.to, "yyyy-MM-dd") },
      });
      if (error) throw error;
      return data as { items: KanbanItem[]; ultimo_sync?: string };
    },
    staleTime: 60_000,
  });

  // Fetch execução data from custom cache (all config_ids)
  const { data: execData, isLoading: execLoading, refetch: refetchExec } = useQuery({
    queryKey: ["dash-exec", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data: cached, error } = await supabase
        .from("kanban_custom_cache")
        .select("dados, atualizado_em")
        .order("atualizado_em", { ascending: false });
      if (error) throw error;

      // Deduplicate by auvo_task_id
      const seen = new Set<string>();
      const items: KanbanItem[] = [];
      for (const row of cached || []) {
        const d = row.dados as any;
        if (!d?.auvo_task_id || seen.has(d.auvo_task_id)) continue;
        // Filter by date range
        const taskDate = String(d.data_tarefa || "");
        if (taskDate && taskDate >= format(dateRange.from, "yyyy-MM-dd") && taskDate <= format(dateRange.to, "yyyy-MM-dd")) {
          seen.add(d.auvo_task_id);
          items.push(d as KanbanItem);
        }
      }

      let ultimoSync: string | null = null;
      if (cached && cached.length > 0) ultimoSync = cached[0].atualizado_em;
      return { items, ultimo_sync: ultimoSync };
    },
    staleTime: 60_000,
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await Promise.all([
        supabase.functions.invoke("budget-kanban", {
          body: { mode: "sync", start_date: format(dateRange.from, "yyyy-MM-dd"), end_date: format(dateRange.to, "yyyy-MM-dd") },
        }),
      ]);
      toast.success("Orçamentos sincronizados!");
      await Promise.all([refetchOrc(), refetchExec()]);
    } catch {
      toast.warning("Sincronização em processamento...");
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
  const execLabels = { match: "Com OS (GC)", sem: "Sem OS (GC)" };

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
          </div>
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(dateRange.from, "dd/MM/yy")} - {format(dateRange.to, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (!range?.from) return;
                    setDateRange((prev) => {
                      const nextFrom = range.from as Date;
                      const prevToValid = prev.to && prev.to >= nextFrom;
                      return {
                        from: nextFrom,
                        to: (range.to as Date | undefined) ?? (prevToValid ? prev.to : nextFrom),
                      };
                    });
                  }}
                  locale={ptBR}
                  numberOfMonths={2}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing} className="h-8 text-xs">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
              Sincronizar
            </Button>
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
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mês Atual</h2>
                  <Badge variant="outline" className="text-[10px]">{format(monthRange.from, "MMMM yyyy", { locale: ptBR })}</Badge>
                </div>
                {renderMonthKPIs(orcMetrics, orcLabels)}
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {renderSituacaoChart(orcMetrics, "Valor por Situação do Orçamento")}
                {renderTecnicoChart(orcMetrics, orcLabels)}
              </div>
              {renderSituacaoTable(orcMetrics)}
            </TabsContent>

            <TabsContent value="execucao" className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Período Total</h2>
                {renderKPIs(execMetrics, execLabels)}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mês Atual</h2>
                  <Badge variant="outline" className="text-[10px]">{format(monthRange.from, "MMMM yyyy", { locale: ptBR })}</Badge>
                </div>
                {renderMonthKPIs(execMetrics, execLabels)}
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {renderSituacaoChart(execMetrics, "Valor por Situação da OS")}
                {renderTecnicoChart(execMetrics, execLabels)}
              </div>
              {renderSituacaoTable(execMetrics)}
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
