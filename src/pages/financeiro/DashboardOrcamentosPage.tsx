import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, CalendarIcon, RefreshCw, DollarSign, FileText,
  ClipboardList, CheckCircle2, XCircle, TrendingUp, BarChart3
} from "lucide-react";
import { format, startOfMonth, startOfYear, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
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
  _coluna?: string;
  _posicao?: number;
};

const COLORS = [
  "hsl(142, 71%, 45%)", "hsl(217, 91%, 60%)", "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)", "hsl(262, 83%, 58%)", "hsl(180, 70%, 45%)",
  "hsl(330, 80%, 55%)", "hsl(45, 93%, 47%)", "hsl(190, 90%, 50%)"
];

export default function DashboardOrcamentosPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [dateRange, setDateRange] = useState({
    from: startOfYear(today),
    to: today,
  });
  const [monthRange, setMonthRange] = useState({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["dashboard-orc", format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
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

  const [isSyncing, setIsSyncing] = useState(false);
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await supabase.functions.invoke("budget-kanban", {
        body: {
          mode: "sync",
          start_date: format(dateRange.from, "yyyy-MM-dd"),
          end_date: format(dateRange.to, "yyyy-MM-dd"),
        },
      });
      toast.success("Sincronizado!");
      await refetch();
    } catch {
      toast.warning("Sincronização em processamento...");
    } finally {
      setIsSyncing(false);
    }
  };

  const items = useMemo(() => data?.items || [], [data]);

  // Filter items by month for "this month" metrics
  const monthItems = useMemo(() => {
    return items.filter((item) => {
      if (!item.data_tarefa) return false;
      try {
        const d = parseISO(item.data_tarefa);
        return isWithinInterval(d, { start: monthRange.from, end: monthRange.to });
      } catch { return false; }
    });
  }, [items, monthRange]);

  // === METRICS ===
  const metrics = useMemo(() => {
    const total = items.length;
    const comOrcamento = items.filter((i) => i.orcamento_realizado);
    const comOs = items.filter((i) => i.os_realizada);
    const semOrcamento = items.filter((i) => !i.orcamento_realizado && !i.os_realizada);

    const valorTotalOrc = comOrcamento.reduce(
      (acc, i) => acc + parseFloat(i.gc_orcamento?.gc_valor_total || "0"), 0
    );
    const valorTotalOs = comOs.reduce(
      (acc, i) => acc + parseFloat(i.gc_os?.gc_valor_total || "0"), 0
    );

    // Monthly
    const mesComOrcamento = monthItems.filter((i) => i.orcamento_realizado);
    const mesComOs = monthItems.filter((i) => i.os_realizada);
    const mesSemOrcamento = monthItems.filter((i) => !i.orcamento_realizado && !i.os_realizada);
    const mesValorOrc = mesComOrcamento.reduce(
      (acc, i) => acc + parseFloat(i.gc_orcamento?.gc_valor_total || "0"), 0
    );
    const mesValorOs = mesComOs.reduce(
      (acc, i) => acc + parseFloat(i.gc_os?.gc_valor_total || "0"), 0
    );

    // By situation
    const situacaoMap: Record<string, { count: number; valor: number; cor: string }> = {};
    for (const item of comOrcamento) {
      const sit = item.gc_orcamento?.gc_situacao || "Sem situação";
      const cor = item.gc_orcamento?.gc_cor_situacao || "#888";
      if (!situacaoMap[sit]) situacaoMap[sit] = { count: 0, valor: 0, cor };
      situacaoMap[sit].count++;
      situacaoMap[sit].valor += parseFloat(item.gc_orcamento?.gc_valor_total || "0");
    }

    // By technician
    const tecnicoMap: Record<string, { total: number; comOrc: number; valorOrc: number; comOs: number; valorOs: number }> = {};
    for (const item of items) {
      const t = item.tecnico || "Sem técnico";
      if (!tecnicoMap[t]) tecnicoMap[t] = { total: 0, comOrc: 0, valorOrc: 0, comOs: 0, valorOs: 0 };
      tecnicoMap[t].total++;
      if (item.orcamento_realizado) {
        tecnicoMap[t].comOrc++;
        tecnicoMap[t].valorOrc += parseFloat(item.gc_orcamento?.gc_valor_total || "0");
      }
      if (item.os_realizada) {
        tecnicoMap[t].comOs++;
        tecnicoMap[t].valorOs += parseFloat(item.gc_os?.gc_valor_total || "0");
      }
    }

    // Conversion: tasks with orc that also have OS (approved + executed)
    const orcComOs = comOrcamento.filter((i) => i.os_realizada);
    const taxaConversao = comOrcamento.length > 0
      ? ((orcComOs.length / comOrcamento.length) * 100).toFixed(1)
      : "0";

    return {
      total, comOrcamento: comOrcamento.length, comOs: comOs.length,
      semOrcamento: semOrcamento.length, valorTotalOrc, valorTotalOs,
      mesTotal: monthItems.length, mesComOrcamento: mesComOrcamento.length,
      mesComOs: mesComOs.length, mesSemOrcamento: mesSemOrcamento.length,
      mesValorOrc, mesValorOs,
      situacaoMap, tecnicoMap, taxaConversao,
      orcComOs: orcComOs.length,
    };
  }, [items, monthItems]);

  const situacaoChartData = useMemo(() => {
    return Object.entries(metrics.situacaoMap)
      .sort(([, a], [, b]) => b.valor - a.valor)
      .map(([name, data]) => ({
        name,
        valor: Math.round(data.valor * 100) / 100,
        count: data.count,
        cor: data.cor,
      }));
  }, [metrics]);

  const tecnicoChartData = useMemo(() => {
    // Only count tasks that have a match with OS in GC
    const tecnicoOsMap: Record<string, { total: number; comOrc: number; semOrc: number; valorOrc: number }> = {};
    for (const item of items) {
      if (!item.os_realizada) continue; // Only tasks with OS match
      const t = item.tecnico || "Sem técnico";
      if (!tecnicoOsMap[t]) tecnicoOsMap[t] = { total: 0, comOrc: 0, semOrc: 0, valorOrc: 0 };
      tecnicoOsMap[t].total++;
      if (item.orcamento_realizado) {
        tecnicoOsMap[t].comOrc++;
        tecnicoOsMap[t].valorOrc += parseFloat(item.gc_orcamento?.gc_valor_total || "0");
      } else {
        tecnicoOsMap[t].semOrc++;
      }
    }
    return Object.entries(tecnicoOsMap)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([name, data]) => ({
        name: name.length > 15 ? name.substring(0, 15) + "..." : name,
        fullName: name,
        "Com Orçamento": data.comOrc,
        "Sem Orçamento": data.semOrc,
        valorOrc: data.valorOrc,
      }));
  }, [items]);

  const pieData = useMemo(() => {
    const d = [
      { name: "Sem Orçamento", value: metrics.semOrcamento },
      { name: "Com Orçamento", value: metrics.comOrcamento - metrics.orcComOs },
      { name: "Orç. + OS", value: metrics.orcComOs },
      { name: "Só OS", value: metrics.comOs - metrics.orcComOs },
    ].filter((d) => d.value > 0);
    return d;
  }, [metrics]);

  const pieColors = ["hsl(38, 92%, 50%)", "hsl(142, 71%, 45%)", "hsl(217, 91%, 60%)", "hsl(262, 83%, 58%)"];

  const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
              <h1 className="text-xl font-bold text-foreground">Dashboard de Orçamentos</h1>
              <p className="text-sm text-muted-foreground">
                Métricas e análises de orçamentos Auvo × GestãoClick
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Date FROM */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  {format(dateRange.from, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={dateRange.from}
                  onSelect={(d) => d && setDateRange(prev => ({ ...prev, from: d }))}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">até</span>
            {/* Date TO */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  {format(dateRange.to, "dd/MM/yy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={dateRange.to}
                  onSelect={(d) => d && setDateRange(prev => ({ ...prev, to: d }))}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing || isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
            {data?.ultimo_sync && (
              <span className="text-xs text-muted-foreground">
                Sync: {new Date(data.ultimo_sync).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
          {/* KPI Cards - Period Total */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Período Total</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <ClipboardList className="h-3.5 w-3.5" /> Total Tarefas
                  </div>
                  <p className="text-2xl font-bold text-foreground">{metrics.total}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-xs mb-1 text-amber-600">
                    <XCircle className="h-3.5 w-3.5" /> Sem Orçamento
                  </div>
                  <p className="text-2xl font-bold text-amber-600">{metrics.semOrcamento}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {metrics.total > 0 ? ((metrics.semOrcamento / metrics.total) * 100).toFixed(0) : 0}% do total
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-xs mb-1 text-emerald-600">
                    <FileText className="h-3.5 w-3.5" /> Com Orçamento
                  </div>
                  <p className="text-2xl font-bold text-emerald-600">{metrics.comOrcamento}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBRL(metrics.valorTotalOrc)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-xs mb-1 text-blue-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Com OS
                  </div>
                  <p className="text-2xl font-bold text-blue-600">{metrics.comOs}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBRL(metrics.valorTotalOs)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-xs mb-1 text-purple-600">
                    <TrendingUp className="h-3.5 w-3.5" /> Taxa Conversão
                  </div>
                  <p className="text-2xl font-bold text-purple-600">{metrics.taxaConversao}%</p>
                  <p className="text-[10px] text-muted-foreground">Orç. → OS</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-xs mb-1 text-foreground">
                    <DollarSign className="h-3.5 w-3.5" /> Valor Total
                  </div>
                  <p className="text-xl font-bold text-foreground">{fmtBRL(metrics.valorTotalOrc + metrics.valorTotalOs)}</p>
                  <p className="text-[10px] text-muted-foreground">Orç + OS</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* KPI Cards - This Month */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Mês Atual</h2>
              <Badge variant="outline" className="text-xs">
                {format(monthRange.from, "MMMM yyyy", { locale: ptBR })}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="border-l-4 border-l-foreground/20">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-1">Tarefas no mês</p>
                  <p className="text-2xl font-bold">{metrics.mesTotal}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-amber-400">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-amber-600 mb-1">Sem orçamento</p>
                  <p className="text-2xl font-bold text-amber-600">{metrics.mesSemOrcamento}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-emerald-500">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-emerald-600 mb-1">Com orçamento</p>
                  <p className="text-2xl font-bold text-emerald-600">{metrics.mesComOrcamento}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBRL(metrics.mesValorOrc)}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-blue-600 mb-1">Com OS</p>
                  <p className="text-2xl font-bold text-blue-600">{metrics.mesComOs}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBRL(metrics.mesValorOs)}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-purple-500">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-purple-600 mb-1">Valor mês (Orç + OS)</p>
                  <p className="text-xl font-bold text-purple-600">{fmtBRL(metrics.mesValorOrc + metrics.mesValorOs)}</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Situação breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Valor por Situação do Orçamento
                </CardTitle>
                <CardDescription>Distribuição de valores por status no GestãoClick</CardDescription>
              </CardHeader>
              <CardContent>
                {situacaoChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={situacaoChartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(v: number) => fmtBRL(v)}
                        labelFormatter={(l) => `${l}`}
                      />
                      <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                        {situacaoChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.cor || COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-12">Nenhum orçamento encontrado</p>
                )}
              </CardContent>
            </Card>

            {/* Pie: distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Distribuição Geral das Tarefas</CardTitle>
                <CardDescription>Proporção entre pendentes, orçados e executados</CardDescription>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={50}
                        dataKey="value"
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v} tarefas`} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-12">Sem dados</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Technician breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tarefas por Técnico (com OS)</CardTitle>
              <CardDescription>Top 10 técnicos — apenas tarefas com OS vinculada no GC</CardDescription>
            </CardHeader>
            <CardContent>
              {tecnicoChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={tecnicoChartData} margin={{ bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" angle={-25} textAnchor="end" height={60} tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Sem Orçamento" stackId="a" fill="hsl(38, 92%, 50%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Com Orçamento" stackId="a" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-12">Sem dados</p>
              )}
            </CardContent>
          </Card>

          {/* Situação table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Detalhamento por Situação</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative w-full overflow-auto">
                <table className="w-full caption-bottom text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="h-10 px-4 text-left font-medium text-muted-foreground">Situação</th>
                      <th className="h-10 px-4 text-right font-medium text-muted-foreground">Qtd</th>
                      <th className="h-10 px-4 text-right font-medium text-muted-foreground">Valor Total</th>
                      <th className="h-10 px-4 text-right font-medium text-muted-foreground">Ticket Médio</th>
                      <th className="h-10 px-4 text-right font-medium text-muted-foreground">% do Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(metrics.situacaoMap)
                      .sort(([, a], [, b]) => b.valor - a.valor)
                      .map(([sit, data]) => (
                        <tr key={sit} className="border-b hover:bg-muted/50">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: data.cor }} />
                              <span className="font-medium">{sit}</span>
                            </div>
                          </td>
                          <td className="p-4 text-right">{data.count}</td>
                          <td className="p-4 text-right font-medium">{fmtBRL(data.valor)}</td>
                          <td className="p-4 text-right text-muted-foreground">
                            {fmtBRL(data.count > 0 ? data.valor / data.count : 0)}
                          </td>
                          <td className="p-4 text-right text-muted-foreground">
                            {metrics.valorTotalOrc > 0
                              ? ((data.valor / metrics.valorTotalOrc) * 100).toFixed(1)
                              : 0}%
                          </td>
                        </tr>
                      ))}
                    {Object.keys(metrics.situacaoMap).length === 0 && (
                      <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nenhum orçamento</td></tr>
                    )}
                  </tbody>
                  {Object.keys(metrics.situacaoMap).length > 0 && (
                    <tfoot>
                      <tr className="border-t bg-muted/50 font-medium">
                        <td className="p-4">Total</td>
                        <td className="p-4 text-right">{metrics.comOrcamento}</td>
                        <td className="p-4 text-right">{fmtBRL(metrics.valorTotalOrc)}</td>
                        <td className="p-4 text-right text-muted-foreground">
                          {fmtBRL(metrics.comOrcamento > 0 ? metrics.valorTotalOrc / metrics.comOrcamento : 0)}
                        </td>
                        <td className="p-4 text-right">100%</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
