import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Minimize2,
  Pause,
  Play,
  PlayCircle,
  RefreshCw,
  Users,
  Wifi,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";

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

interface TvTrackingViewProps {
  data: TrackingData;
  selectedDate: Date;
  lastFetchTime?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onExit: () => void;
}

type WakeLockSentinelLike = {
  release?: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request?: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const TECHS_PER_PAGE = 6;
const ROTATION_MS = 18_000;

const statusConfig: Record<string, { label: string; dot: string; text: string; surface: string }> = {
  "Finalizada": {
    label: "Concluída",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    surface: "bg-emerald-500/10 border-emerald-500/20",
  },
  "Em andamento": {
    label: "Em andamento",
    dot: "bg-sky-400",
    text: "text-sky-300",
    surface: "bg-sky-500/10 border-sky-500/25",
  },
  "Agendada": {
    label: "Agendada",
    dot: "bg-amber-400",
    text: "text-amber-300",
    surface: "bg-amber-500/10 border-amber-500/20",
  },
  "Cancelada": {
    label: "Cancelada",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    surface: "bg-zinc-800/60 border-zinc-700/60",
  },
};

function parseValue(value: string): number {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour)) return Number.MAX_SAFE_INTEGER;
  return hour * 60 + (Number.isFinite(minute) ? minute : 0);
}

function taskPriority(task: TaskItem): number {
  if (task.atrasada) return 0;
  if (task.status === "Em andamento") return 1;
  if (task.status === "Agendada") return 2;
  if (task.status === "Finalizada") return 3;
  return 4;
}

function hasPendingIssue(task: TaskItem): boolean {
  const pending = String(task.pendencia || "").trim().toLowerCase();
  return Boolean(pending && pending !== "nenhuma" && pending !== "0");
}

function getTechState(tech: TecnicoGroup) {
  if (tech.resumo.atrasadas > 0) {
    return { label: "Requer atenção", text: "text-red-300", badge: "bg-red-500/15 border-red-500/30", ring: "border-red-500/45" };
  }
  if (tech.resumo.emAndamento > 0) {
    return { label: "Em atendimento", text: "text-sky-300", badge: "bg-sky-500/15 border-sky-500/30", ring: "border-sky-500/45" };
  }
  if (tech.resumo.agendadas > 0) {
    return { label: "Próximos atendimentos", text: "text-amber-300", badge: "bg-amber-500/15 border-amber-500/30", ring: "border-zinc-700" };
  }
  return { label: "Roteiro concluído", text: "text-emerald-300", badge: "bg-emerald-500/15 border-emerald-500/30", ring: "border-emerald-500/25" };
}

export default function TvTrackingView({
  data,
  selectedDate,
  lastFetchTime,
  isRefreshing = false,
  onRefresh,
  onExit,
}: TvTrackingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const [currentPage, setCurrentPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rotationProgress, setRotationProgress] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [compactTv, setCompactTv] = useState(() => window.innerHeight < 850);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  const sortedTechs = useMemo(() => {
    return [...data.tecnicos].sort((a, b) => {
      const priorityA = (a.resumo.atrasadas * 1_000) + (a.resumo.emAndamento * 100) + (a.resumo.agendadas * 10);
      const priorityB = (b.resumo.atrasadas * 1_000) + (b.resumo.emAndamento * 100) + (b.resumo.agendadas * 10);
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [data.tecnicos]);

  const totalPages = Math.max(1, Math.ceil(sortedTechs.length / TECHS_PER_PAGE));
  const visibleTechs = sortedTechs.slice(currentPage * TECHS_PER_PAGE, (currentPage + 1) * TECHS_PER_PAGE);

  const totals = useMemo(() => {
    let scheduledValue = 0;
    let completedValue = 0;
    let finished = 0;
    let inProgress = 0;
    let scheduled = 0;
    let activeTechs = 0;
    let pendingIssues = 0;

    for (const tech of data.tecnicos) {
      finished += tech.resumo.finalizadas;
      inProgress += tech.resumo.emAndamento;
      scheduled += tech.resumo.agendadas;
      if (tech.resumo.emAndamento > 0) activeTechs += 1;

      for (const task of tech.tarefas) {
        const value = parseValue(task.gcOsValor);
        scheduledValue += value;
        if (task.status === "Finalizada") completedValue += value;
        if (hasPendingIssue(task)) pendingIssues += 1;
      }
    }

    const executionRate = data.total_tarefas > 0 ? Math.round((finished / data.total_tarefas) * 100) : 0;
    return { scheduledValue, completedValue, finished, inProgress, scheduled, activeTechs, pendingIssues, executionRate };
  }, [data]);

  const goToPage = useCallback((direction: number) => {
    setCurrentPage((page) => (page + direction + totalPages) % totalPages);
    setRotationProgress(0);
  }, [totalPages]);

  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(0);
  }, [currentPage, totalPages]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => setCompactTv(window.innerHeight < 850);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (paused || totalPages <= 1) {
      setRotationProgress(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= ROTATION_MS) {
        window.clearInterval(timer);
        setCurrentPage((page) => (page + 1) % totalPages);
        setRotationProgress(0);
        return;
      }
      setRotationProgress((elapsed / ROTATION_MS) * 100);
    }, 250);

    return () => window.clearInterval(timer);
  }, [currentPage, paused, totalPages]);

  useEffect(() => {
    const element = containerRef.current;
    let enteredFullscreen = false;

    if (element && !document.fullscreenElement) {
      element.requestFullscreen?.()
        .then(() => { enteredFullscreen = true; })
        .catch(() => {});
    } else if (document.fullscreenElement) {
      enteredFullscreen = true;
    }

    const handleFullscreenChange = () => {
      if (enteredFullscreen && !document.fullscreenElement) onExitRef.current();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    let wakeLock: WakeLockSentinelLike | null = null;
    const requestWakeLock = async () => {
      try {
        wakeLock = await (navigator as NavigatorWithWakeLock).wakeLock?.request?.("screen") || null;
      } catch {
        wakeLock = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLock) void requestWakeLock();
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      void wakeLock?.release?.();
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExitRef.current();
      if (event.key === "ArrowRight") goToPage(1);
      if (event.key === "ArrowLeft") goToPage(-1);
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => !value);
      }
      if (event.key.toLowerCase() === "r") onRefresh?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goToPage, onRefresh]);

  const updatedAt = lastFetchTime ? new Date(lastFetchTime) : null;
  const isLive = isToday(selectedDate);
  const gridLayout = visibleTechs.length <= 1
    ? "grid-cols-1 grid-rows-1"
    : visibleTechs.length === 2
      ? "grid-cols-2 grid-rows-1"
      : visibleTechs.length === 3
        ? "grid-cols-3 grid-rows-1"
        : "grid-cols-3 grid-rows-2";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex cursor-none select-none flex-col overflow-hidden bg-[#070a10] text-zinc-100"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <header className="shrink-0 border-b border-white/10 bg-[#0b1019] px-6 pb-4 pt-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/25">
              <Users className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">Operação em campo</h1>
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold tracking-[0.18em] ${
                  isLive ? "border-red-500/40 bg-red-500/15 text-red-300" : "border-zinc-600 bg-zinc-800 text-zinc-300"
                }`}>
                  <span className={`h-2 w-2 rounded-full ${isLive ? "animate-pulse bg-red-400" : "bg-zinc-500"}`} />
                  {isLive ? "AO VIVO" : "HISTÓRICO"}
                </span>
              </div>
              <p className="mt-1 text-lg capitalize text-zinc-400">
                {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-5">
            <div className="text-right">
              <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-white">{format(now, "HH:mm")}</p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-zinc-500">
                <Wifi className={`h-3 w-3 ${isRefreshing ? "animate-pulse text-sky-400" : "text-emerald-400"}`} />
                {isRefreshing
                  ? "Atualizando dados"
                  : updatedAt && !Number.isNaN(updatedAt.getTime())
                    ? `Atualizado às ${format(updatedAt, "HH:mm:ss")}`
                    : "Atualização automática ativa"}
              </p>
            </div>
            <button
              onClick={() => { void document.exitFullscreen?.(); onExitRef.current(); }}
              className="cursor-pointer rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Sair do Painel TV"
            >
              <Minimize2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-6 gap-3">
          <TvMetric icon={<Users className="h-4 w-4" />} label="Técnicos em campo" value={`${totals.activeTechs}/${data.total_tecnicos}`} tone="sky" />
          <TvMetric icon={<PlayCircle className="h-4 w-4" />} label="Em atendimento" value={String(totals.inProgress)} tone="sky" />
          <TvMetric icon={<CheckCircle2 className="h-4 w-4" />} label="Concluídas" value={`${totals.finished}/${data.total_tarefas}`} detail={`${totals.executionRate}% executado`} tone="emerald" />
          <TvMetric icon={<CalendarClock className="h-4 w-4" />} label="Aguardando" value={String(totals.scheduled)} tone="amber" />
          <TvMetric icon={<AlertTriangle className="h-4 w-4" />} label="Atrasos" value={String(data.total_atrasadas || 0)} detail={totals.pendingIssues > 0 ? `${totals.pendingIssues} pendência(s)` : "Sem pendências"} tone={data.total_atrasadas > 0 ? "red" : "slate"} />
          <TvMetric icon={<CircleDollarSign className="h-4 w-4" />} label="Valor executado" value={totals.completedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} detail={`de ${totals.scheduledValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`} tone="emerald" />
        </div>
      </header>

      <main className="min-h-0 flex-1 p-4">
        {visibleTechs.length > 0 ? (
          <div className={`grid h-full gap-3 ${gridLayout}`}>
            {visibleTechs.map((tech) => (
              <TechnicianTvCard key={tech.id} tech={tech} maxTasks={compactTv ? 2 : 4} />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <CalendarClock className="mb-3 h-12 w-12" />
            <p className="text-xl font-semibold text-zinc-300">Nenhum atendimento programado</p>
            <p className="mt-1 text-sm">A tela será atualizada automaticamente.</p>
          </div>
        )}
      </main>

      <footer className="relative flex h-12 shrink-0 items-center border-t border-white/10 bg-[#0b1019] px-5 text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <Legend dot="bg-sky-400" label="Em atendimento" />
          <Legend dot="bg-amber-400" label="Agendada" />
          <Legend dot="bg-emerald-400" label="Concluída" />
          <Legend dot="bg-red-400" label="Atrasada" />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {totalPages > 1 && (
            <>
              <button onClick={() => goToPage(-1)} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-medium tabular-nums text-zinc-300">Equipe {currentPage + 1} de {totalPages}</span>
              <button onClick={() => goToPage(1)} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => setPaused((value) => !value)} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white" title={paused ? "Retomar rotação" : "Pausar rotação"}>
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            </>
          )}
          {onRefresh && (
            <button onClick={onRefresh} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white" title="Atualizar agora">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          )}
          <span className="hidden text-zinc-600 2xl:inline">Espaço pausa · Setas navegam · R atualiza · Esc sai</span>
        </div>

        {totalPages > 1 && !paused && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
            <div className="h-full bg-blue-400 transition-[width] duration-200 ease-linear" style={{ width: `${rotationProgress}%` }} />
          </div>
        )}
      </footer>
    </div>
  );
}

function TechnicianTvCard({ tech, maxTasks }: { tech: TecnicoGroup; maxTasks: number }) {
  const state = getTechState(tech);
  const tasks = useMemo(() => {
    return [...tech.tarefas].sort((a, b) => {
      const priority = taskPriority(a) - taskPriority(b);
      return priority !== 0 ? priority : timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio);
    });
  }, [tech.tarefas]);
  const visibleTasks = tasks.slice(0, maxTasks);
  const hiddenTasks = Math.max(0, tasks.length - visibleTasks.length);
  const progress = tech.resumo.total > 0 ? Math.round((tech.resumo.finalizadas / tech.resumo.total) * 100) : 0;

  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-[#101620] shadow-2xl shadow-black/20 ${state.ring}`}>
      <div className="shrink-0 border-b border-white/8 bg-white/[0.025] px-4 py-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${
            tech.resumo.emAndamento > 0 ? "bg-sky-500 text-white" : tech.resumo.atrasadas > 0 ? "bg-red-500 text-white" : "bg-zinc-800 text-zinc-200"
          }`}>
            {tech.nome.split(" ").filter(Boolean).map((name) => name[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold text-white" title={tech.nome}>{tech.nome}</h2>
              <span className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${state.badge} ${state.text}`}>
                {state.label}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-semibold tabular-nums text-zinc-400">{tech.resumo.finalizadas}/{tech.resumo.total}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-white/[0.06] px-3">
        {visibleTasks.map((task, index) => {
          const config = task.atrasada
            ? { label: "Atrasada", dot: "bg-red-400", text: "text-red-300", surface: "bg-red-500/10 border-red-500/25" }
            : statusConfig[task.status] || statusConfig.Agendada;
          const important = task.atrasada || task.status === "Em andamento";

          return (
            <div key={task.taskId || index} className={`flex items-center gap-3 py-2.5 ${important ? `-mx-1 rounded-lg border px-2 ${config.surface}` : ""}`}>
              <div className="w-12 shrink-0 text-center">
                <p className="font-mono text-sm font-bold tabular-nums text-zinc-200">{task.horaInicio || "--:--"}</p>
                {task.horaFim && <p className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-600">até {task.horaFim}</p>}
              </div>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${config.dot} ${task.status === "Em andamento" ? "animate-pulse" : ""}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-zinc-100" title={task.cliente}>{task.cliente || "Cliente não informado"}</p>
                  {hasPendingIssue(task) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <span className={`font-semibold ${config.text}`}>{config.label}</span>
                  {task.gcOsCodigo && <span className="truncate font-mono text-zinc-500">{task.gcOsTipo || "OS"} {task.gcOsCodigo}</span>}
                </div>
              </div>
              {parseValue(task.gcOsValor) > 0 && (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-300">
                  {parseValue(task.gcOsValor).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                </span>
              )}
            </div>
          );
        })}

        {visibleTasks.length === 0 && (
          <div className="flex h-full items-center justify-center py-8 text-sm text-zinc-600">Nenhuma tarefa para exibir</div>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center border-t border-white/[0.06] bg-black/10 px-4 text-[11px] text-zinc-500">
        <span>{progress}% do roteiro concluído</span>
        {hiddenTasks > 0 && <span className="ml-auto font-medium text-zinc-400">+{hiddenTasks} tarefa{hiddenTasks === 1 ? "" : "s"} no roteiro</span>}
      </div>
    </section>
  );
}

function TvMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone: "sky" | "emerald" | "amber" | "red" | "slate";
}) {
  const tones = {
    sky: "border-sky-500/20 bg-sky-500/8 text-sky-300",
    emerald: "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/8 text-amber-300",
    red: "border-red-500/30 bg-red-500/12 text-red-300",
    slate: "border-white/10 bg-white/[0.035] text-zinc-300",
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <span className={tone === "slate" ? "text-zinc-400" : ""}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <strong className="truncate text-xl font-bold tabular-nums text-current">{value}</strong>
        {detail && <span className="truncate text-[10px] text-zinc-500">{detail}</span>}
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
