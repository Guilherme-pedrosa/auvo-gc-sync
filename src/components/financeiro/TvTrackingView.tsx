import { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, PlayCircle, CalendarClock, AlertTriangle,
  Clock, User, Minimize2, ChevronLeft, ChevronRight, Pause, Play
} from "lucide-react";
import { format } from "date-fns";
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

const statusColor: Record<string, string> = {
  "Finalizada": "text-emerald-400",
  "Em andamento": "text-sky-400",
  "Agendada": "text-amber-400",
  "Cancelada": "text-red-400",
};

const statusDot: Record<string, string> = {
  "Finalizada": "bg-emerald-400",
  "Em andamento": "bg-sky-400",
  "Agendada": "bg-amber-400",
  "Cancelada": "bg-red-400",
};

const TECHS_PER_PAGE = 6;
const AUTO_CYCLE_MS = 12_000;

interface TvTrackingViewProps {
  data: TrackingData;
  selectedDate: Date;
  onExit: () => void;
}

export default function TvTrackingView({ data, selectedDate, onExit }: TvTrackingViewProps) {
  const [page, setPage] = useState(0);
  const [autoCycle, setAutoCycle] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort technicians by total value desc
  const sortedTechs = [...data.tecnicos].sort((a, b) => {
    const valA = a.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
    const valB = b.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
    return valB - valA;
  });

  const totalPages = Math.ceil(sortedTechs.length / TECHS_PER_PAGE);
  const pageTechs = sortedTechs.slice(page * TECHS_PER_PAGE, (page + 1) * TECHS_PER_PAGE);

  // Totals
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

  // Auto-cycle pages
  useEffect(() => {
    if (!autoCycle || totalPages <= 1) return;
    const interval = setInterval(() => {
      setPage((p) => (p + 1) % totalPages);
    }, AUTO_CYCLE_MS);
    return () => clearInterval(interval);
  }, [autoCycle, totalPages]);

  // Fullscreen
  useEffect(() => {
    const el = containerRef.current;
    if (el && document.fullscreenElement !== el) {
      el.requestFullscreen?.().catch(() => {});
    }
    const onFsChange = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onExit]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onExit(); return; }
      if (e.key === "ArrowRight") setPage((p) => Math.min(p + 1, totalPages - 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(p - 1, 0));
      if (e.key === " ") { e.preventDefault(); setAutoCycle((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [totalPages, onExit]);

  const now = new Date();

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-zinc-950 text-zinc-100 flex flex-col select-none"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── TV Header ── */}
      <div className="flex-shrink-0 px-8 py-4 flex items-center justify-between border-b border-zinc-800/60">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Agenda de Técnicos
          </h1>
          <span className="text-lg text-zinc-400">
            {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </span>
          <Badge className="bg-red-600/20 text-red-400 border-red-600/40 text-sm px-3 py-0.5 animate-pulse">
            🔴 AO VIVO
          </Badge>
        </div>

        <div className="flex items-center gap-6 text-base">
          <span className="flex items-center gap-2">
            <User className="h-5 w-5 text-zinc-500" />
            <strong className="text-zinc-200">{data.total_tecnicos}</strong>
            <span className="text-zinc-500">técnicos</span>
          </span>
          <span className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-zinc-500" />
            <strong className="text-zinc-200">{data.total_tarefas}</strong>
            <span className="text-zinc-500">tarefas</span>
          </span>
          <span className="border-l border-zinc-700 pl-5 flex items-center gap-2">
            📋 <span className="text-zinc-400">Agendado:</span>
            <strong className="text-zinc-100">R$ {totalAgendado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </span>
          <span className="flex items-center gap-2">
            ✅ <span className="text-zinc-400">Executado:</span>
            <strong className="text-emerald-400">R$ {totalExecutado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-600">
            {format(now, "HH:mm")}
          </span>
          <button
            onClick={() => { document.exitFullscreen?.(); onExit(); }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1.5"
            title="Sair do modo TV (Esc)"
          >
            <Minimize2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Status summary bar ── */}
      <div className="flex-shrink-0 px-8 py-2.5 flex items-center gap-8 border-b border-zinc-800/40 bg-zinc-900/50 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <strong className="text-emerald-400">{data.tecnicos.reduce((s, t) => s + t.resumo.finalizadas, 0)}</strong>
          <span className="text-zinc-500">Finalizadas</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-sky-400 animate-pulse" />
          <strong className="text-sky-400">{data.tecnicos.reduce((s, t) => s + t.resumo.emAndamento, 0)}</strong>
          <span className="text-zinc-500">Em andamento</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <strong className="text-amber-400">{data.tecnicos.reduce((s, t) => s + t.resumo.agendadas, 0)}</strong>
          <span className="text-zinc-500">Agendadas</span>
        </span>
        {data.total_atrasadas > 0 && (
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            <strong className="text-red-400">{data.total_atrasadas}</strong>
            <span className="text-zinc-500">Atrasadas</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          {totalPages > 1 && (
            <>
              <button
                onClick={() => setAutoCycle((v) => !v)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 text-xs"
                title={autoCycle ? "Pausar rotação (Espaço)" : "Retomar rotação (Espaço)"}
              >
                {autoCycle ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {autoCycle ? "Auto" : "Pausado"}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(p - 1, 0))} className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30" disabled={page === 0}>
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-zinc-500 text-xs tabular-nums">
                  {page + 1} / {totalPages}
                </span>
                <button onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))} className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30" disabled={page === totalPages - 1}>
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Technician cards grid ── */}
      <div className="flex-1 overflow-hidden p-6">
        <div className={`grid gap-5 h-full ${
          pageTechs.length <= 2 ? "grid-cols-2" :
          pageTechs.length <= 3 ? "grid-cols-3" :
          pageTechs.length <= 4 ? "grid-cols-2 grid-rows-2" :
          "grid-cols-3 grid-rows-2"
        }`}>
          {pageTechs.map((tech) => {
            const sortedTasks = [...tech.tarefas].sort((a, b) => (parseFloat(b.gcOsValor) || 0) - (parseFloat(a.gcOsValor) || 0));
            const hasActive = tech.resumo.emAndamento > 0;
            const progress = tech.resumo.total > 0 ? Math.round((tech.resumo.finalizadas / tech.resumo.total) * 100) : 0;
            const totalValor = sortedTasks.reduce((sum, t) => sum + (parseFloat(t.gcOsValor) || 0), 0);

            return (
              <div
                key={tech.id}
                className={`rounded-xl border overflow-hidden flex flex-col transition-all ${
                  hasActive
                    ? "border-sky-600/40 bg-zinc-900/80"
                    : "border-zinc-800/60 bg-zinc-900/40"
                }`}
              >
                {/* Tech header */}
                <div className={`px-5 py-3.5 flex items-center gap-4 flex-shrink-0 ${
                  hasActive ? "bg-sky-950/30" : "bg-zinc-800/30"
                }`}>
                  <div className={`h-12 w-12 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0 ${
                    hasActive ? "bg-sky-500 text-white" : "bg-zinc-700 text-zinc-300"
                  }`}>
                    {tech.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base truncate text-zinc-100">{tech.nome}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-sm text-zinc-400">
                        {tech.resumo.finalizadas}/{tech.resumo.total} tarefas
                      </span>
                      {hasActive && (
                        <span className="text-sm text-sky-400 font-medium animate-pulse">● Ativo</span>
                      )}
                      {tech.resumo.atrasadas > 0 && (
                        <span className="text-sm text-red-400 font-medium">
                          {tech.resumo.atrasadas} atrasada(s)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {totalValor > 0 && (
                      <p className="text-base font-bold text-emerald-400">
                        R$ {totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 justify-end">
                      <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-xs text-zinc-500 tabular-nums">{progress}%</span>
                    </div>
                  </div>
                </div>

                {/* Tasks list — scrollable */}
                <div className="flex-1 overflow-auto px-4 py-2 space-y-0">
                  {sortedTasks.map((task, idx) => {
                    const isLate = task.atrasada;
                    const label = isLate ? "Atrasada" : task.status;
                    const dotClass = isLate ? "bg-red-500" : (statusDot[task.status] || "bg-zinc-600");
                    const textClass = isLate ? "text-red-400" : (statusColor[task.status] || "text-zinc-400");

                    return (
                      <div
                        key={task.taskId || idx}
                        className={`flex items-center gap-3 py-2.5 ${idx > 0 ? "border-t border-zinc-800/50" : ""} ${isLate ? "bg-red-950/20 -mx-2 px-2 rounded-lg" : ""}`}
                      >
                        <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate">
                            {task.cliente || "Sem cliente"}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className={`text-xs font-medium ${textClass}`}>{label}</span>
                            {task.horaInicio && (
                              <span className="text-xs text-zinc-600">
                                {task.horaInicio}{task.horaFim ? ` – ${task.horaFim}` : ""}
                              </span>
                            )}
                            {task.gcOsCodigo && (
                              <span className="text-xs text-zinc-600 font-mono">
                                {task.gcOsTipo || "OS"} {task.gcOsCodigo}
                              </span>
                            )}
                          </div>
                        </div>
                        {task.gcOsValor && task.gcOsValor !== "0" && (
                          <span className="text-sm font-semibold text-emerald-400 flex-shrink-0 tabular-nums">
                            R$ {parseFloat(task.gcOsValor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                        {task.pendencia && task.pendencia.toLowerCase() !== "nenhuma" && task.pendencia !== "0" && (
                          <span className="text-xs text-red-400 flex-shrink-0">⚠</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Page indicator dots ── */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 pb-4">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === page ? "w-8 bg-zinc-400" : "w-2 bg-zinc-700 hover:bg-zinc-600"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
