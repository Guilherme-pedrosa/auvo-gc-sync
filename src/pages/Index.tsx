import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileWarning,
  Gauge,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  TimerReset,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useOperationsDashboard } from "@/hooks/useOperationsDashboard";
import type { FreshnessItem } from "@/lib/operationsDashboard";

const number = (value: number) => new Intl.NumberFormat("pt-BR").format(value || 0);
const decimal = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0);
const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "border-border bg-card",
  success: "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
  warning: "border-amber-200/80 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
  danger: "border-rose-200/80 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20",
  info: "border-blue-200/80 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20",
};

function HighlightCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: Tone;
}) {
  return (
    <Card className={`${toneClasses[tone]} shadow-sm`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          </div>
          <div className="rounded-xl border bg-background/80 p-2.5 shadow-sm">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricLine({ label, value, emphasis = false }: { label: string; value: string | number; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm tabular-nums ${emphasis ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>{value}</span>
    </div>
  );
}

function OperationCard({
  title,
  description,
  icon: Icon,
  route,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Activity;
  route: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Card className="flex h-full flex-col shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-xl bg-primary/10 p-2.5 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1 text-xs leading-relaxed">{description}</CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(route)} aria-label={`Abrir ${title}`}>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{children}</CardContent>
    </Card>
  );
}

function FreshnessRow({ item }: { item: FreshnessItem }) {
  const styles = {
    healthy: { dot: "bg-emerald-500", badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300", label: "Atualizado" },
    attention: { dot: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300", label: "Verificar" },
    error: { dot: "bg-rose-500", badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300", label: "Falhou" },
    unknown: { dot: "bg-slate-400", badge: "", label: "Sem registro" },
  }[item.status];

  const relative = item.timestamp
    ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: ptBR })
    : "sem data disponível";

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{item.label}</p>
          <Badge variant="outline" className={`h-5 text-[10px] ${styles.badge}`}>{styles.label}</Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
      </div>
      <span className="shrink-0 text-right text-xs text-muted-foreground">{relative}</span>
    </div>
  );
}

export default function Index() {
  useEffect(() => {
    // Redireciona para a escala de equipe, que é o ponto central da operação agora
    window.location.href = "/operacional/agendamento-equipe";
  }, []);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useOperationsDashboard();
  const [isSyncing, setIsSyncing] = useState(false);
  const now = new Date();
  const monthLabel = format(now, "MMMM 'de' yyyy", { locale: ptBR });

  const priorities = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "Análises de alta prioridade",
        value: data.analyses.critical + data.analyses.high,
        detail: `${data.analyses.critical} críticas e ${data.analyses.high} altas ainda abertas`,
        route: "/financeiro/analises-operacionais",
        tone: "danger" as Tone,
        icon: ShieldAlert,
      },
      {
        label: "Preventivas vencidas",
        value: data.preventive.overdue,
        detail: `${data.preventive.dueNext30Days} vencem nos próximos 30 dias`,
        route: "/financeiro/equipamentos-preventivos",
        tone: "danger" as Tone,
        icon: TimerReset,
      },
      {
        label: "Orçamentos sem preenchimento",
        value: data.budget.missingForm,
        detail: `${data.budget.toDo} tarefas ainda estão na coluna A fazer`,
        route: "/financeiro/kanban-orcamentos",
        tone: "warning" as Tone,
        icon: FileWarning,
      },
      {
        label: "Finalizadas sem questionário",
        value: data.month.finishedWithoutQuestionnaire,
        detail: "Qualidade e rastreabilidade comprometidas no mês",
        route: "/financeiro/acompanhamento",
        tone: "warning" as Tone,
        icon: ClipboardCheck,
      },
      {
        label: "Check-in sem checkout",
        value: data.month.checkInWithoutCheckout,
        detail: "Apontamentos que precisam ser encerrados ou conferidos",
        route: "/financeiro/acompanhamento",
        tone: "warning" as Tone,
        icon: Clock3,
      },
      {
        label: "Oficina aguardando OS",
        value: data.workshop.awaitingOs,
        detail: `${data.workshop.active} equipamentos seguem no fluxo ativo`,
        route: "/financeiro/kanban-oficina",
        tone: "info" as Tone,
        icon: Wrench,
      },
    ].filter((item) => item.value > 0);
  }, [data]);

  const handleSync = async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const startDate = format(startOfMonth(new Date()), "yyyy-MM-dd");
    setIsSyncing(true);
    const toastId = toast.loading("Sincronizando Central Auvo e kanban de orçamentos...");

    try {
      const [central, budget] = await Promise.all([
        supabase.functions.invoke("central-sync", {
          body: { start_date: startDate, end_date: today, wait: true },
        }),
        supabase.functions.invoke("budget-kanban", {
          body: { mode: "sync", start_date: startDate, end_date: today },
        }),
      ]);

      if (central.error || central.data?.error || central.data?.success === false) {
        throw new Error(central.data?.error || central.error?.message || "Falha na Central Auvo");
      }
      if (budget.error || budget.data?.error || budget.data?.success === false) {
        throw new Error(budget.data?.error || budget.error?.message || "Falha no kanban de orçamentos");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operations-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["last-sync-timestamp"] }),
      ]);
      await refetch();
      toast.success("Bases operacionais atualizadas", { id: toastId });
    } catch (syncError) {
      toast.error("A sincronização não concluiu", {
        id: toastId,
        description: syncError instanceof Error ? syncError.message : "Tente novamente em alguns instantes.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen space-y-6 bg-muted/30 p-4 md:p-6 xl:p-8">
        <div className="space-y-2"><Skeleton className="h-9 w-72" /><Skeleton className="h-5 w-[32rem] max-w-full" /></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-xl" />)}</div>
        <Skeleton className="h-72 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-72 rounded-xl" />)}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-lg border-rose-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-rose-600" /> Não foi possível montar a central</CardTitle>
            <CardDescription>{error instanceof Error ? error.message : "Falha ao consultar os dados operacionais."}</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button></CardContent>
        </Card>
      </div>
    );
  }

  const completionRate = percent(data.month.finished, data.month.total);
  const gcCoverage = percent(data.month.withOs, data.month.total);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-background"><Sparkles className="mr-1 h-3 w-3" /> Central de decisão</Badge>
              <span className="text-xs capitalize text-muted-foreground">{monthLabel}</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Operações Auvo ↔ GestãoClick</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
              O que está acontecendo hoje, onde a operação travou e quais filas exigem ação — sem somar a mesma tarefa duas vezes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching || isSyncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching && !isSyncing ? "animate-spin" : ""}`} /> Recarregar painel
            </Button>
            <Button onClick={handleSync} disabled={isSyncing}>
              <Database className={`mr-2 h-4 w-4 ${isSyncing ? "animate-pulse" : ""}`} /> {isSyncing ? "Sincronizando..." : "Sincronizar bases"}
            </Button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <HighlightCard
            label="Agenda de hoje"
            value={number(data.today.total)}
            detail={`${data.today.open} abertas · ${data.today.inProgress} em curso · ${data.today.finished} finalizadas`}
            icon={CalendarDays}
            tone={data.today.unassigned > 0 ? "warning" : "info"}
          />
          <HighlightCard
            label="Execução no mês"
            value={`${completionRate}%`}
            detail={`${data.month.finished} de ${data.month.total} tarefas encerradas`}
            icon={Gauge}
            tone={completionRate >= 70 ? "success" : "warning"}
          />
          <HighlightCard
            label="Horas registradas"
            value={`${decimal(data.month.hours)}h`}
            detail={`${decimal(data.month.travelHours)}h em deslocamento · ${data.month.activeTechnicians} técnicos`}
            icon={Clock3}
          />
          <HighlightCard
            label="Alertas gerenciais"
            value={number(data.analyses.critical + data.analyses.high)}
            detail={`${data.analyses.critical} críticos · ${data.analyses.open} análises abertas no total`}
            icon={ShieldAlert}
            tone={data.analyses.critical + data.analyses.high > 0 ? "danger" : "success"}
          />
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Prioridades agora</h2>
              <p className="text-sm text-muted-foreground">Filas que merecem tratamento antes de virarem atraso, retrabalho ou perda de rastreabilidade.</p>
            </div>
            <Badge variant="outline" className="hidden bg-background sm:inline-flex">{priorities.length} frentes com ação</Badge>
          </div>
          <Card className="shadow-sm">
            <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {priorities.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className={`group flex items-center gap-3 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${toneClasses[item.tone]}`}
                >
                  <div className="rounded-lg bg-background/80 p-2 shadow-sm"><item.icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <span className="text-xl font-bold tabular-nums">{number(item.value)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-xl font-bold tracking-tight">Fluxo completo da operação</h2>
            <p className="text-sm text-muted-foreground">Cada bloco abre diretamente a rotina responsável por aquele indicador.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <OperationCard title="Escala e campo" description="Escala de técnicos e andamento das tarefas no Auvo." icon={Route} route="/operacional/agendamento-equipe">
              <MetricLine label="Programadas hoje" value={number(data.today.total)} emphasis />
              <MetricLine label="Abertas / em andamento" value={`${data.today.open} / ${data.today.inProgress}`} />
              <MetricLine label="Pausadas" value={number(data.today.paused)} />
              <MetricLine label="Sem técnico" value={number(data.today.unassigned)} />
              <MetricLine label="Não atendidas no mês" value={number(data.month.missedActivities)} />
            </OperationCard>

            <OperationCard title="Execução e vínculo GC" description="Cobertura por OS e integridade dos apontamentos do mês." icon={BarChart3} route="/financeiro/dashboard-tecnicos">
              <div className="mb-3 rounded-lg border bg-muted/30 p-3">
                <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">Tarefas com OS vinculada</span><strong>{gcCoverage}%</strong></div>
                <Progress value={gcCoverage} className="h-2" />
              </div>
              <MetricLine label="Com OS no GestãoClick" value={number(data.month.withOs)} />
              <MetricLine label="Sem documento GC" value={number(data.month.withoutGc)} emphasis />
              <MetricLine label="Com pendência registrada" value={number(data.month.withPendingIssue)} />
              <MetricLine label="Check-in sem checkout" value={number(data.month.checkInWithoutCheckout)} />
            </OperationCard>

            <OperationCard title="Orçamentos" description="Backlog técnico, aprovação e geração de OS." icon={FileWarning} route="/financeiro/kanban-orcamentos">
              <MetricLine label="Backlog aberto" value={number(data.budget.open)} emphasis />
              <MetricLine label="Falta preenchimento" value={number(data.budget.missingForm)} />
              <MetricLine label="A fazer" value={number(data.budget.toDo)} />
              <MetricLine label="Aguardando aprovação" value={number(data.budget.awaitingApproval)} />
              <MetricLine label="Aprovados / OS gerada" value={number(data.budget.osGenerated)} />
            </OperationCard>

            <OperationCard title="Follow-up comercial" description="Orçamentos esperando avanço no GestãoClick." icon={Users} route="/financeiro/kanban-followup">
              <MetricLine label="Em acompanhamento" value={number(data.followup.open)} emphasis />
              {data.followup.stages.slice(0, 4).map((stage) => (
                <MetricLine key={stage.id} label={stage.label} value={number(stage.count)} />
              ))}
            </OperationCard>

            <OperationCard title="Oficina" description="Equipamentos dentro do galpão e gargalos do fluxo." icon={Wrench} route="/financeiro/kanban-oficina">
              <MetricLine label="Fluxo ativo" value={number(data.workshop.active)} emphasis />
              <MetricLine label="Aguardando OS" value={number(data.workshop.awaitingOs)} />
              <MetricLine label="Em orçamento" value={number(data.workshop.quotation)} />
              <MetricLine label="Peças solicitadas" value={number(data.workshop.partsRequested)} />
              <MetricLine label="Em execução" value={number(data.workshop.inProgress)} />
            </OperationCard>

            <OperationCard title="Preventivas" description="Cobertura da base instalada e próximos vencimentos." icon={TimerReset} route="/financeiro/equipamentos-preventivos">
              <MetricLine label="Equipamentos monitorados" value={number(data.preventive.total)} emphasis />
              <MetricLine label="Vencidos" value={number(data.preventive.overdue)} />
              <MetricLine label="Vencem em até 30 dias" value={number(data.preventive.dueNext30Days)} />
              <MetricLine label="Nunca atendidos" value={number(data.preventive.never)} />
              <MetricLine label="Em dia" value={number(data.preventive.upToDate)} />
            </OperationCard>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><AlertTriangle className="h-5 w-5 text-amber-500" /> Qualidade e risco operacional</CardTitle>
              <CardDescription>Os indicadores abaixo não são volume: são pontos que podem invalidar medição, cobrança ou histórico.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                ["Questionário ausente", data.month.finishedWithoutQuestionnaire, "tarefas finalizadas no mês"],
                ["Check-in em aberto", data.month.checkInWithoutCheckout, "sem checkout correspondente"],
                ["Sem documento GC", data.month.withoutGc, "tarefas sem OS nem orçamento"],
                ["Sem próxima preventiva", data.preventive.withoutNextDate, "equipamentos sem data futura"],
              ].map(([label, value, detail]) => (
                <div key={String(label)} className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold tabular-nums">{number(Number(value))}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Database className="h-5 w-5 text-primary" /> Saúde das fontes</CardTitle>
              <CardDescription>Recência de cada operação; “verificar” indica dado antigo ou falha explícita.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.freshness.map((item) => <FreshnessRow key={item.key} item={item} />)}
            </CardContent>
          </Card>
        </section>

        <p className="pb-2 text-center text-xs text-muted-foreground">
          Central calculada sobre tarefas únicas do mês atual. Atualização automática a cada 2 minutos.
        </p>
      </div>
    </div>
  );
}
