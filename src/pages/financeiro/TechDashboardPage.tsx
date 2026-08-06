import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  DollarSign,
  Gauge,
  Medal,
  Navigation,
  RefreshCw,
  Search,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import LastSyncBadge from "@/components/LastSyncBadge";
import { useTechnicianDashboard } from "@/hooks/useTechnicianDashboard";
import { supabase } from "@/integrations/supabase/client";
import {
  findTechnicianGoal,
  technicianGoalProgress,
  technicianOperationalScore,
  technicianQualityIssues,
  type TechnicianGoal,
} from "@/lib/technicianDashboard";

type Period = "hoje" | "semana" | "mes" | "custom";
type SortKey = "score" | "finalizadas" | "horas" | "qualidade" | "valor";

const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value || 0);
const decimal = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function SummaryCard({ label, value, detail, icon: Icon, alert = false }: { label: string; value: string; detail: string; icon: typeof Users; alert?: boolean }) {
  return (
    <Card className={alert ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20" : "shadow-sm"}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
          </div>
          <div className="rounded-lg border bg-background/80 p-2"><Icon className="h-4 w-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

function scoreBadge(score: number) {
  if (score >= 75) return <Badge className="bg-emerald-600 hover:bg-emerald-600">{score}%</Badge>;
  if (score >= 50) return <Badge className="bg-amber-500 hover:bg-amber-500">{score}%</Badge>;
  return <Badge variant="destructive">{score}%</Badge>;
}

export default function TechDashboardPage() {
  const [period, setPeriod] = useState<Period>("mes");
  const [customStart, setCustomStart] = useState<Date>();
  const [customEnd, setCustomEnd] = useState<Date>();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("score");

  const dates = useMemo(() => {
    const today = new Date();
    if (period === "hoje") return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    if (period === "semana") return { start: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    if (period === "custom") return {
      start: format(customStart || today, "yyyy-MM-dd"),
      end: format(customEnd || customStart || today, "yyyy-MM-dd"),
    };
    return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
  }, [customEnd, customStart, period]);

  const dashboardQuery = useTechnicianDashboard(dates.start, dates.end);

  const goalsQuery = useQuery({
    queryKey: ["metas-tecnicos-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metas_tecnicos")
        .select("nome_tecnico,meta_faturamento,ativo")
        .eq("ativo", true);
      if (error) throw error;
      return (data || []) as TechnicianGoal[];
    },
    staleTime: 300_000,
  });

  const technicians = useMemo(() => {
    const rows = [...(dashboardQuery.data?.tecnicos || [])];
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const filtered = query ? rows.filter((tech) => tech.nome.toLocaleLowerCase("pt-BR").includes(query)) : rows;
    return filtered.sort((a, b) => {
      if (sortBy === "finalizadas") return b.tarefas_finalizadas - a.tarefas_finalizadas;
      if (sortBy === "horas") return b.tempo_horas - a.tempo_horas;
      if (sortBy === "qualidade") return b.qualidade_pct - a.qualidade_pct || b.tarefas_finalizadas - a.tarefas_finalizadas;
      if (sortBy === "valor") return b.valor_total - a.valor_total;
      return technicianOperationalScore(b) - technicianOperationalScore(a) || b.tarefas_finalizadas - a.tarefas_finalizadas;
    });
  }, [dashboardQuery.data?.tecnicos, search, sortBy]);

  const highlights = useMemo(() => {
    const rows = dashboardQuery.data?.tecnicos || [];
    if (!rows.length) return [];
    const mostFinished = [...rows].sort((a, b) => b.tarefas_finalizadas - a.tarefas_finalizadas)[0];
    const bestPace = [...rows].sort((a, b) => b.media_execucoes_dia - a.media_execucoes_dia || b.tarefas_finalizadas - a.tarefas_finalizadas)[0];
    const bestQuality = [...rows].sort((a, b) => b.qualidade_pct - a.qualidade_pct || b.tarefas_finalizadas - a.tarefas_finalizadas)[0];
    return [
      { title: "Maior volume concluído", tech: mostFinished, value: `${mostFinished.tarefas_finalizadas} tarefas`, icon: Trophy },
      { title: "Melhor ritmo", tech: bestPace, value: `${decimal(bestPace.media_execucoes_dia)} exec./dia`, icon: Medal },
      { title: "Melhor qualidade", tech: bestQuality, value: `${bestQuality.qualidade_pct}% sem falhas`, icon: ClipboardCheck },
    ];
  }, [dashboardQuery.data?.tecnicos]);

  const periodLabel = dates.start === dates.end
    ? format(new Date(`${dates.start}T12:00:00`), "dd/MM/yyyy")
    : `${format(new Date(`${dates.start}T12:00:00`), "dd/MM")} → ${format(new Date(`${dates.end}T12:00:00`), "dd/MM/yyyy")}`;
  const data = dashboardQuery.data;
  const goals = goalsQuery.data || [];

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="bg-background"><Users className="mr-1 h-3 w-3" /> Performance de campo</Badge>
              <LastSyncBadge overrideTimestamp={dashboardQuery.dataUpdatedAt ? new Date(dashboardQuery.dataUpdatedAt).toISOString() : null} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Dashboard Técnicos</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground md:text-base">
              Produtividade, capacidade, qualidade dos apontamentos e valor vinculado por técnico — com tarefas e documentos GC sem duplicidade.
            </p>
          </div>
          <Button variant="outline" onClick={() => dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${dashboardQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar indicadores
          </Button>
        </header>

        <Card className="shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Período de análise</label>
              <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <SelectTrigger className="w-full bg-background lg:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
                  <SelectItem value="semana">Esta semana</SelectItem>
                  <SelectItem value="mes">Este mês</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === "custom" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Início</label>
                  <Popover>
                    <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start bg-background font-normal lg:w-40"><CalendarIcon className="mr-2 h-4 w-4" />{customStart ? format(customStart, "dd/MM/yyyy") : "Selecionar"}</Button></PopoverTrigger>
                    <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={customStart} onSelect={setCustomStart} locale={ptBR} /></PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Fim</label>
                  <Popover>
                    <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start bg-background font-normal lg:w-40"><CalendarIcon className="mr-2 h-4 w-4" />{customEnd ? format(customEnd, "dd/MM/yyyy") : "Selecionar"}</Button></PopoverTrigger>
                    <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} disabled={(date) => Boolean(customStart && date < customStart)} locale={ptBR} /></PopoverContent>
                  </Popover>
                </div>
              </>
            )}
            <Badge variant="outline" className="h-10 justify-center bg-background px-3">{periodLabel}</Badge>
            <div className="flex-1" />
            <div className="relative w-full lg:w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar técnico..." className="bg-background pl-9" />
            </div>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortKey)}>
              <SelectTrigger className="w-full bg-background lg:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Saúde operacional</SelectItem>
                <SelectItem value="finalizadas">Mais finalizadas</SelectItem>
                <SelectItem value="horas">Mais horas</SelectItem>
                <SelectItem value="qualidade">Melhor qualidade</SelectItem>
                <SelectItem value="valor">Maior valor vinculado</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {dashboardQuery.error && (
          <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20">
            <CardContent className="flex items-start gap-3 p-4 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Falha ao consultar os indicadores</p><p className="text-sm">{(dashboardQuery.error as Error).message}</p></div>
            </CardContent>
          </Card>
        )}

        {dashboardQuery.isLoading ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-32 rounded-xl" />)}</div>
            <Skeleton className="h-96 rounded-xl" />
          </>
        ) : data ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <SummaryCard label="Técnicos ativos" value={String(data.resumo.total_tecnicos)} detail={`${data.resumo.total_tarefas} tarefas no recorte`} icon={Users} />
              <SummaryCard label="Finalizadas" value={`${pct(data.resumo.total_finalizadas, data.resumo.total_tarefas)}%`} detail={`${data.resumo.total_finalizadas} tarefas concluídas`} icon={CheckCircle2} />
              <SummaryCard label="Horas produtivas" value={`${decimal(data.resumo.total_horas)}h`} detail={`${decimal(data.resumo.total_deslocamento_horas)}h em deslocamento`} icon={Clock3} />
              <SummaryCard
                label="% horas produtivas"
                value={`${data.resumo.produtividade_pct}%`}
                detail={`${data.resumo.dias_uteis} dia(s) útil(eis) · ${decimal(data.resumo.horas_disponiveis)}h disponíveis`}
                icon={Gauge}
                alert={data.resumo.produtividade_pct < 70}
              />
              <SummaryCard label="Sem questionário" value={String(data.resumo.total_sem_questionario)} detail="finalizadas sem evidência completa" icon={ClipboardCheck} alert={data.resumo.total_sem_questionario > 0} />
              <SummaryCard label="Check-ins em aberto" value={String(data.resumo.total_checkins_sem_checkout)} detail="sem checkout correspondente" icon={Navigation} alert={data.resumo.total_checkins_sem_checkout > 0} />
              <SummaryCard label="Valor vinculado" value={brl(data.resumo.valor_total)} detail="documentos GC únicos e rateados" icon={DollarSign} />
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              {highlights.map((highlight) => (
                <Card key={highlight.title} className="overflow-hidden shadow-sm">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary"><highlight.icon className="h-5 w-5" /></div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{highlight.title}</p>
                      <p className="truncate font-bold">{highlight.tech.nome}</p>
                      <p className="text-sm text-muted-foreground">{highlight.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>

            <Card className="shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Desempenho por técnico</CardTitle>
                    <CardDescription className="mt-1">Saúde operacional combina fechamento, ritmo, ocupação e ausência de falhas de qualidade.</CardDescription>
                  </div>
                  <Badge variant="outline">{technicians.length} técnico(s)</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="min-w-[210px] pl-6">Técnico</TableHead>
                        <TableHead className="min-w-[150px]">Execução</TableHead>
                        <TableHead className="text-center">Ritmo</TableHead>
                        <TableHead className="min-w-[130px]">Horas</TableHead>
                        <TableHead className="min-w-[155px]">Qualidade</TableHead>
                        <TableHead className="min-w-[130px]">Vínculo OS</TableHead>
                        <TableHead className="min-w-[190px]">Valor / meta</TableHead>
                        <TableHead className="pr-6 text-center">Saúde</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {technicians.map((tech, index) => {
                        const completion = pct(tech.tarefas_finalizadas, tech.tarefas_total);
                        const osCoverage = pct(tech.tarefas_com_os, tech.tarefas_total);
                        const qualityIssues = technicianQualityIssues(tech);
                        const score = technicianOperationalScore(tech);
                        const goal = period === "mes" ? findTechnicianGoal(tech.nome, goals) : undefined;
                        const goalProgress = technicianGoalProgress(tech.valor_total, goal);
                        return (
                          <TableRow key={tech.id}>
                            <TableCell className="pl-6">
                              <div className="flex items-center gap-3">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{index + 1}</span>
                                <div><p className="font-semibold">{tech.nome}</p><p className="text-xs text-muted-foreground">{tech.dias_trabalhados} dia(s) com atividade</p></div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="mb-1.5 flex justify-between text-xs"><span>{tech.tarefas_finalizadas}/{tech.tarefas_total}</span><strong>{completion}%</strong></div>
                              <Progress value={completion} className="h-1.5" />
                            </TableCell>
                            <TableCell className="text-center"><p className="font-bold tabular-nums">{decimal(tech.media_execucoes_dia)}</p><p className="text-[10px] text-muted-foreground">exec./dia</p></TableCell>
                            <TableCell><p className="font-semibold tabular-nums">{decimal(tech.tempo_horas)}h</p><p className="text-xs text-muted-foreground">{decimal(tech.deslocamento_horas)}h desloc.</p></TableCell>
                            <TableCell>
                              <div className="flex items-center justify-between"><span className="font-semibold">{tech.qualidade_pct}%</span>{qualityIssues > 0 && <Badge variant="outline" className="border-amber-200 text-[10px] text-amber-700">{qualityIssues} alerta(s)</Badge>}</div>
                              <p className="mt-1 text-[10px] text-muted-foreground">{tech.tarefas_sem_questionario} sem form. · {tech.checkins_sem_checkout} em aberto</p>
                            </TableCell>
                            <TableCell>
                              <div className="mb-1.5 flex justify-between text-xs"><span>{tech.tarefas_com_os}/{tech.tarefas_total}</span><strong>{osCoverage}%</strong></div>
                              <Progress value={osCoverage} className="h-1.5" />
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold tabular-nums">{brl(tech.valor_total)}</p>
                              {goalProgress !== null ? (
                                <><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Meta {brl(goal!.meta_faturamento)}</span><span>{goalProgress}%</span></div><Progress value={Math.min(goalProgress, 100)} className="mt-1 h-1.5" /></>
                              ) : <p className="text-[10px] text-muted-foreground">{period === "mes" ? "Meta não cadastrada" : "Meta mensal não aplicada ao recorte"}</p>}
                            </TableCell>
                            <TableCell className="pr-6 text-center">{scoreBadge(score)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {technicians.length === 0 && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">Nenhum técnico encontrado no período ou na busca.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
              <CardContent className="grid gap-4 p-4 text-sm md:grid-cols-4">
                <div className="flex gap-2"><Gauge className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Fechamento</strong><p className="text-xs text-muted-foreground">Meta operacional de 70% das tarefas.</p></div></div>
                <div className="flex gap-2"><Target className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Ritmo</strong><p className="text-xs text-muted-foreground">Ao menos 1 execução concluída por dia ativo.</p></div></div>
                <div className="flex gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Ocupação</strong><p className="text-xs text-muted-foreground">70% da jornada registrada em atividade.</p></div></div>
                <div className="flex gap-2"><ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Qualidade</strong><p className="text-xs text-muted-foreground">Sem pendência, formulário ausente ou check-in aberto.</p></div></div>
              </CardContent>
            </Card>

            <p className="pb-2 text-center text-xs text-muted-foreground">
              Uma tarefa Auvo conta uma vez. Uma OS compartilhada conta uma vez e seu valor é rateado entre os técnicos vinculados.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
