import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarIcon,
  CalendarX2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardX,
  Clock3,
  DollarSign,
  ExternalLink,
  Gauge,
  Medal,
  MessageSquareWarning,
  Navigation,
  RefreshCw,
  Search,
  Target,
  Trophy,
  UserX,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import LastSyncBadge from "@/components/LastSyncBadge";
import { useTechnicianDashboard } from "@/hooks/useTechnicianDashboard";
import { usePremiacaoFaturamento, normalizeTechKey } from "@/hooks/usePremiacaoFaturamento";
import { supabase } from "@/integrations/supabase/client";
import {
  findTechnicianGoal,
  technicianGoalProgress,
  technicianOperationalScore,
  technicianQualityIssues,
  type TechnicianGoal,
} from "@/lib/technicianDashboard";
import type { DivergenceKind } from "@/lib/technicianDivergences";

type Period = "hoje" | "semana" | "mes" | "custom";
type SortKey = "score" | "finalizadas" | "horas" | "qualidade" | "valor";
type DetailKind = DivergenceKind | "all";
type DetailFilter = { kind: DetailKind; technicianId?: string; technicianName?: string };

const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value || 0);
const decimal = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
const shortDate = (value: string) => {
  if (!value) return "Sem data";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "dd/MM/yyyy");
};
const normalizeKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const DETAIL_KIND_LABELS: Record<DetailKind, string> = {
  all: "Todos os alertas",
  schedule: "Não atendidas",
  form: "Formulários incompletos",
  report: "Relatos insuficientes",
  photos: "Poucas/sem fotos",
  checkin: "Check-ins em aberto",
};

const ISSUE_BADGE_CLASSES: Record<DivergenceKind, string> = {
  schedule: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  form: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  report: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  photos: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  checkin: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
};

function SummaryCard({ label, value, detail, icon: Icon, alert = false, onClick }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
  alert?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <Card
      className={`${alert ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20" : "shadow-sm"} ${interactive ? "cursor-pointer transition-colors hover:border-primary/50" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
          </div>
          <div className="rounded-lg border bg-background/80 p-2"><Icon className="h-4 w-4" /></div>
        </div>
        {interactive && <p className="mt-2 text-[10px] font-medium text-primary">Toque para ver as tarefas</p>}
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
  const [detailFilter, setDetailFilter] = useState<DetailFilter | null>(null);
  const [outsideOpen, setOutsideOpen] = useState(false);

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

  // Faturamento oficial (base Premiação) é mensal: só entra quando o recorte é o mês —
  // em "Hoje"/"Esta semana" ele mostraria o mês inteiro e não bateria com o restante do painel.
  const premiacaoMonth = useMemo(() => {
    const sameMonth = dates.start.slice(0, 7) === dates.end.slice(0, 7);
    if (!sameMonth) return null;
    if (period === "mes") return dates.start.slice(0, 7);
    if (period === "custom" && dates.start.endsWith("-01")) return dates.start.slice(0, 7);
    return null;
  }, [dates.end, dates.start, period]);
  const premiacaoQuery = usePremiacaoFaturamento(premiacaoMonth);
  const faturamento = premiacaoQuery.data;
  const isRefreshing = dashboardQuery.isFetching || premiacaoQuery.isFetching;

  const refreshIndicators = async () => {
    await Promise.all([
      dashboardQuery.refetch(),
      premiacaoMonth ? premiacaoQuery.refetch() : Promise.resolve(),
      goalsQuery.refetch(),
    ]);
  };

  const valorDoTecnico = (nome: string, fallback: number) => {
    if (!faturamento) return fallback;
    return faturamento.porTecnico.get(normalizeTechKey(nome))?.faturamento ?? 0;
  };

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

  const totalAlertas = data
    ? data.resumo.total_nao_atendidas + data.resumo.total_formularios_incompletos + data.resumo.total_sem_relato
      + data.resumo.total_poucas_fotos + data.resumo.total_checkins_sem_checkout
    : 0;

  const detailRecords = useMemo(() => {
    if (!data || !detailFilter) return [];
    const technicianKey = detailFilter.technicianName ? normalizeKey(detailFilter.technicianName) : "";
    return data.divergencias.filter((record) => {
      if (detailFilter.kind !== "all" && !record.issues.some((issue) => issue.kind === detailFilter.kind)) return false;
      if (!detailFilter.technicianId && !technicianKey) return true;
      return (detailFilter.technicianId && record.technicianId === detailFilter.technicianId)
        || (technicianKey && normalizeKey(record.technicianName) === technicianKey);
    });
  }, [data, detailFilter]);

  const openDetail = (kind: DetailKind, technician?: { id: string; nome: string }) =>
    setDetailFilter({ kind, technicianId: technician?.id, technicianName: technician?.nome });

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
          <Button variant="outline" onClick={() => void refreshIndicators()} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} /> Atualizar indicadores
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

        {premiacaoQuery.error && (
          <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20">
            <CardContent className="flex items-start gap-3 p-4 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Falha ao consultar o faturamento da Premiação</p><p className="text-sm">{(premiacaoQuery.error as Error).message}</p></div>
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
              <SummaryCard label="Finalizadas" value={`${pct(data.resumo.total_finalizadas, data.resumo.total_tarefas)}%`} detail={`${data.resumo.total_finalizadas} de ${data.resumo.total_tarefas} tarefas`} icon={CheckCircle2} />
              <SummaryCard label="Horas produtivas" value={`${decimal(data.resumo.total_horas)}h`} detail={`${decimal(data.resumo.total_deslocamento_horas)}h em deslocamento`} icon={Clock3} />
              <SummaryCard
                label="% horas produtivas"
                value={`${data.resumo.produtividade_pct}%`}
                detail={`${decimal(data.resumo.horas_produtivas_liquidas)}h líquidas de ${decimal(data.resumo.horas_disponiveis)}h · ${data.resumo.dias_uteis} dia(s) útil(eis)`}
                icon={Gauge}
                alert={data.resumo.produtividade_pct < 70}
              />
              <SummaryCard
                label="Alertas de qualidade"
                value={String(totalAlertas)}
                detail="agenda, formulário, relato, fotos e check-ins"
                icon={ClipboardCheck}
                alert={totalAlertas > 0}
                onClick={() => openDetail("all")}
              />
              <SummaryCard
                label="Valor em contratos"
                value={brl(data.resumo.total_valor_contratos)}
                detail={`${decimal(data.resumo.total_horas_contrato)}h em atividades finalizadas × valor/hora do contrato`}
                icon={DollarSign}
              />
              <SummaryCard
                label="Check-ins em aberto"
                value={String(data.resumo.total_checkins_sem_checkout)}
                detail={data.resumo.total_em_execucao > 0
                  ? `esquecidos em dias anteriores · ${data.resumo.total_em_execucao} em execução agora (não conta como alerta)`
                  : "esquecidos em dias anteriores, sem checkout"}
                icon={Navigation}
                alert={data.resumo.total_checkins_sem_checkout > 0}
                onClick={() => openDetail("checkin")}
              />
              <SummaryCard
                label="Faturamento"
                value={premiacaoQuery.isLoading ? "Atualizando…" : brl(faturamento ? faturamento.total : data.resumo.valor_total)}
                detail={faturamento ? `base Premiação · OS com saída em ${faturamento.month}` : "documentos GC únicos e rateados no recorte"}
                icon={DollarSign}
              />
            </section>

            {data.resumo.tarefas_fora_painel > 0 && (
              <Card
                className="cursor-pointer border-slate-200 bg-slate-50/70 transition-colors hover:border-primary/50 dark:border-slate-800 dark:bg-slate-900/40"
                role="button"
                tabIndex={0}
                onClick={() => setOutsideOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOutsideOpen(true);
                  }
                }}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <UserX className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{data.resumo.tarefas_fora_painel} tarefa(s) do período fora do painel</p>
                    <p className="text-xs text-muted-foreground">
                      Sem técnico atribuído ou executadas por quem não está cadastrado como técnico/auxiliar no RH. Elas não entram nos números acima — toque para ver quais são.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <section>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Divergências de execução</h2>
                  <p className="text-xs text-muted-foreground">Os mesmos critérios da Agenda de Técnicos, consolidados no período selecionado. Toque em um card para ver as tarefas e os motivos.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Não atendidas" value={String(data.resumo.total_nao_atendidas)} detail="fora do dia planejado" icon={CalendarX2} alert={data.resumo.total_nao_atendidas > 0} onClick={() => openDetail("schedule")} />
                <SummaryCard label="Formulários incompletos" value={String(data.resumo.total_formularios_incompletos)} detail="ausentes, incompletos ou com pendência" icon={ClipboardX} alert={data.resumo.total_formularios_incompletos > 0} onClick={() => openDetail("form")} />
                <SummaryCard label="Relatos insuficientes" value={String(data.resumo.total_sem_relato)} detail="sem relato técnico compreensível" icon={MessageSquareWarning} alert={data.resumo.total_sem_relato > 0} onClick={() => openDetail("report")} />
                <SummaryCard label="Poucas/sem fotos" value={String(data.resumo.total_poucas_fotos)} detail="menos de 3 evidências na execução" icon={Camera} alert={data.resumo.total_poucas_fotos > 0} onClick={() => openDetail("photos")} />
              </div>
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
                    <CardDescription className="mt-1">Saúde operacional combina fechamento, ritmo, ocupação e ausência de falhas de qualidade. Toque no marcador de alertas para ver o detalhe do técnico.</CardDescription>
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
                        <TableHead className="min-w-[150px]">Horas produtivas</TableHead>
                        <TableHead className="min-w-[160px]">Contratos</TableHead>
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
                        const techValue = valorDoTecnico(tech.nome, tech.valor_total);
                        const goal = premiacaoMonth ? findTechnicianGoal(tech.nome, goals) : undefined;
                        const goalProgress = technicianGoalProgress(techValue, goal);
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
                            <TableCell>
                              <p className="font-semibold tabular-nums">{decimal(tech.tempo_horas)}h</p>
                              <p className="text-xs text-muted-foreground">{decimal(tech.deslocamento_horas)}h desloc.</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">{decimal(tech.horas_produtivas_liquidas)}h líq. · {tech.produtividade_pct}% de {decimal(tech.horas_disponiveis)}h</p>
                              <Progress value={Math.min(tech.produtividade_pct, 100)} className="mt-1 h-1.5" />
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold tabular-nums">{brl(tech.valor_contratos)}</p>
                              <p className="text-xs text-muted-foreground">{decimal(tech.horas_contrato)}h em contratos</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">horas finalizadas × valor/hora</p>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">{tech.qualidade_pct}%</span>
                                {qualityIssues > 0 && (
                                  <button
                                    type="button"
                                    className="rounded-md border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-900 dark:hover:bg-amber-950/40"
                                    onClick={() => openDetail("all", { id: tech.id, nome: tech.nome })}
                                  >
                                    {qualityIssues} alerta(s)
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 text-[10px] text-muted-foreground">{tech.tarefas_nao_atendidas || 0} não atend. · {tech.tarefas_com_formulario_incompleto || 0} formulário(s)</p>
                              <p className="text-[10px] text-muted-foreground">{tech.tarefas_sem_relato || 0} sem relato · {tech.tarefas_com_poucas_fotos || 0} fotos · {tech.checkins_sem_checkout || 0} check-in(s) aberto(s){(tech.tarefas_em_execucao || 0) > 0 ? ` · ${tech.tarefas_em_execucao} em execução` : ""}</p>
                            </TableCell>
                            <TableCell>
                              <div className="mb-1.5 flex justify-between text-xs"><span>{tech.tarefas_com_os}/{tech.tarefas_total}</span><strong>{osCoverage}%</strong></div>
                              <Progress value={osCoverage} className="h-1.5" />
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold tabular-nums">{brl(techValue)}</p>
                              {goalProgress !== null ? (
                                <><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Meta {brl(goal!.meta_faturamento)}</span><span>{goalProgress}%</span></div><Progress value={Math.min(goalProgress, 100)} className="mt-1 h-1.5" /></>
                              ) : <p className="text-[10px] text-muted-foreground">{premiacaoMonth ? "Meta não cadastrada" : "Meta mensal não aplicada ao recorte"}</p>}
                            </TableCell>
                            <TableCell className="pr-6 text-center">{scoreBadge(score)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {technicians.length === 0 && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">Nenhum técnico encontrado no período ou na busca.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
              <CardContent className="grid gap-4 p-4 text-sm md:grid-cols-4">
                <div className="flex gap-2"><Gauge className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Fechamento</strong><p className="text-xs text-muted-foreground">Meta operacional de 70% das tarefas.</p></div></div>
                <div className="flex gap-2"><Target className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Ritmo</strong><p className="text-xs text-muted-foreground">Ao menos 1 execução concluída por dia ativo.</p></div></div>
                <div className="flex gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Ocupação</strong><p className="text-xs text-muted-foreground">Jornada de 8h por dia útil (sem fins de semana e feriados nacionais).</p></div></div>
                <div className="flex gap-2"><ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong>Qualidade</strong><p className="text-xs text-muted-foreground">Sem não atendimento, pendência de formulário, relato insuficiente, poucas fotos ou check-in esquecido aberto. Check-in de hoje em andamento não pontua contra.</p></div></div>
              </CardContent>
            </Card>

            <p className="pb-2 text-center text-xs text-muted-foreground">
              Uma tarefa Auvo conta uma vez. Uma OS compartilhada conta uma vez e seu valor é rateado entre os técnicos vinculados.
            </p>
          </>
        ) : null}
      </div>

      <Dialog open={Boolean(detailFilter)} onOpenChange={(open) => { if (!open) setDetailFilter(null); }}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl overflow-hidden p-0">
          {detailFilter && data && (
            <div className="flex max-h-[85vh] flex-col">
              <DialogHeader className="border-b p-4 pb-3 text-left">
                <DialogTitle className="text-base">
                  {DETAIL_KIND_LABELS[detailFilter.kind]}
                  {detailFilter.technicianName ? ` · ${detailFilter.technicianName}` : ""}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {detailRecords.length} tarefa(s) no período {periodLabel}. Cada item mostra o motivo do alerta e o link da tarefa no Auvo.
                </DialogDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select value={detailFilter.kind} onValueChange={(value) => setDetailFilter({ ...detailFilter, kind: value as DetailKind })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs sm:w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DETAIL_KIND_LABELS) as DetailKind[]).map((kind) => (
                        <SelectItem key={kind} value={kind}>{DETAIL_KIND_LABELS[kind]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {detailFilter.technicianName && (
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDetailFilter({ kind: detailFilter.kind })}>
                      Ver todos os técnicos
                    </Button>
                  )}
                </div>
              </DialogHeader>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {detailRecords.map((record) => (
                  <div key={record.key} className="rounded-lg border bg-background p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{record.technicianName}</p>
                        <p className="text-xs text-muted-foreground">{shortDate(record.date)} · {record.client}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {record.gcOsCode && <Badge variant="outline" className="text-[10px]">OS {record.gcOsCode}</Badge>}
                        {record.photoCount !== null && <Badge variant="outline" className="text-[10px]"><Camera className="mr-1 h-3 w-3" />{record.photoCount} foto(s)</Badge>}
                        {record.auvoUrl && (
                          <a
                            href={record.auvoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-muted"
                          >
                            <ExternalLink className="h-3 w-3" /> Abrir no Auvo
                          </a>
                        )}
                      </div>
                    </div>
                    {record.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{record.description}</p>}
                    <div className="mt-2 space-y-1.5">
                      {record.issues.map((issue, issueIndex) => (
                        <div key={`${record.key}-${issue.kind}-${issueIndex}`} className="flex flex-col gap-1 rounded-md bg-muted/40 p-2 sm:flex-row sm:items-start sm:gap-2">
                          <Badge variant="outline" className={`w-fit shrink-0 text-[10px] ${ISSUE_BADGE_CLASSES[issue.kind]}`}>{issue.label}</Badge>
                          <p className="text-xs leading-snug text-muted-foreground">{issue.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {detailRecords.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma tarefa com esse tipo de alerta no período selecionado.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={outsideOpen} onOpenChange={setOutsideOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-0">
          <div className="flex max-h-[85vh] flex-col">
            <DialogHeader className="border-b p-4 pb-3 text-left">
              <DialogTitle className="text-base">Tarefas fora do painel</DialogTitle>
              <DialogDescription className="text-xs">
                Estas tarefas do período não entram nos indicadores. Para incluir alguém, cadastre o colaborador no RH com cargo ou função de técnico/auxiliar técnico e o Auvo ID correto.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {(data?.fora_painel || []).map((task) => (
                <div key={`${task.auvo_task_id}-${task.data}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-background p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">{task.tecnico}</p>
                    <p className="text-xs text-muted-foreground">{shortDate(task.data)} · {task.cliente}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{task.motivo}</p>
                  </div>
                  {task.auvoUrl && (
                    <a
                      href={task.auvoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-muted"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir no Auvo
                    </a>
                  )}
                </div>
              ))}
              {(data?.fora_painel || []).length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma tarefa fora do painel no período.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
