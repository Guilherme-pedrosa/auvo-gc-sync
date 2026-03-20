import { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, PlayCircle, CalendarClock, AlertTriangle,
  Clock, User, Minimize2
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

interface TvTrackingViewProps {
  data: TrackingData;
  selectedDate: Date;
  onExit: () => void;
}

export default function TvTrackingView({ data, selectedDate, onExit }: TvTrackingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Sort technicians by total value desc
  const sortedTechs = [...data.tecnicos].sort((a, b) => {
    const valA = a.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
    const valB = b.tarefas.reduce((s, t) => s + (parseFloat(t.gcOsValor) || 0), 0);
    return valB - valA;
  });

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

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExit]);

  // Auto-scroll: slowly scroll the grid area up/down
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;

    let direction = 1;
    const speed = 0.5; // px per frame

    const tick = () => {
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return; // fits on screen, no scroll needed

      el.scrollTop += direction * speed;

      if (el.scrollTop >= maxScroll) {
        direction = -1;
      } else if (el.scrollTop <= 0) {
        direction = 1;
      }
    };

    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [autoScroll]);

  const now = new Date();

  // Dynamic grid columns based on tech count
  const techCount = sortedTechs.length;
  const gridCols =
    techCount <= 3 ? "grid-cols-3" :
    techCount <= 4 ? "grid-cols-4" :
    techCount <= 6 ? "grid-cols-3" :
    techCount <= 8 ? "grid-cols-4" :
    techCount <= 12 ? "grid-cols-4" :
    "grid-cols-5";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-zinc-950 text-zinc-100 flex flex-col select-none"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── TV Header ── */}
      <div className="flex-shrink-0 px-6 py-2.5 flex items-center justify-between border-b border-zinc-800/60">
        <div className="flex items-center gap-5">
          <h1 className="text-xl font-bold tracking-tight text-zinc-50">
            Agenda de Técnicos
          </h1>
          <span className="text-base text-zinc-400">
            {format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </span>
          <Badge className="bg-red-600/20 text-red-400 border-red-600/40 text-xs px-2.5 py-0.5 animate-pulse">
            🔴 AO VIVO
          </Badge>
        </div>

        <div className="flex items-center gap-5 text-sm">
          <span className="flex items-center gap-1.5">
            <User className="h-4 w-4 text-zinc-500" />
            <strong className="text-zinc-200">{data.total_tecnicos}</strong>
            <span className="text-zinc-500">técnicos</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-zinc-500" />
            <strong className="text-zinc-200">{data.total_tarefas}</strong>
            <span className="text-zinc-500">tarefas</span>
          </span>

          <span className="border-l border-zinc-700 pl-4 flex items-center gap-1.5">
            📋 <span className="text-zinc-400">Agendado:</span>
            <strong className="text-zinc-100">R$ {totalAgendado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            ✅ <span className="text-zinc-400">Executado:</span>
            <strong className="text-emerald-400">R$ {totalExecutado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </span>

          {/* Status counts inline */}
          <span className="border-l border-zinc-700 pl-4 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <strong className="text-emerald-400">{data.tecnicos.reduce((s, t) => s + t.resumo.finalizadas, 0)}</strong>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
              <strong className="text-sky-400">{data.tecnicos.reduce((s, t) => s + t.resumo.emAndamento, 0)}</strong>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <strong className="text-amber-400">{data.tecnicos.reduce((s, t) => s + t.resumo.agendadas, 0)}</strong>
            </span>
            {data.total_atrasadas > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <strong className="text-red-400">{data.total_atrasadas}</strong>
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-600 tabular-nums">
            {format(now, "HH:mm")}
          </span>
          <button
            onClick={() => { document.exitFullscreen?.(); onExit(); }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
            title="Sair do modo TV (Esc)"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── All technician cards ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4"
        onMouseEnter={() => setAutoScroll(false)}
        onMouseLeave={() => setAutoScroll(true)}
      >
        <div className={`grid ${gridCols} gap-3 auto-rows-min`}>
          {sortedTechs.map((tech) => {
            const sortedTasks = [...tech.tarefas].sort((a, b) => (parseFloat(b.gcOsValor) || 0) - (parseFloat(a.gcOsValor) || 0));
            const hasActive = tech.resumo.emAndamento > 0;
            const progress = tech.resumo.total > 0 ? Math.round((tech.resumo.finalizadas / tech.resumo.total) * 100) : 0;
            const totalValor = sortedTasks.reduce((sum, t) => sum + (parseFloat(t.gcOsValor) || 0), 0);

            return (
              <div
                key={tech.id}
                className={`rounded-lg border overflow-hidden flex flex-col ${
                  hasActive
                    ? "border-sky-600/40 bg-zinc-900/80"
                    : "border-zinc-800/60 bg-zinc-900/40"
                }`}
              >
                {/* Tech header — compact */}
                <div className={`px-3 py-2 flex items-center gap-2.5 flex-shrink-0 ${
                  hasActive ? "bg-sky-950/30" : "bg-zinc-800/30"
                }`}>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    hasActive ? "bg-sky-500 text-white" : "bg-zinc-700 text-zinc-300"
                  }`}>
                    {tech.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate text-zinc-100">{tech.nome}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-zinc-500">
                        {tech.resumo.finalizadas}/{tech.resumo.total}
                      </span>
                      {hasActive && (
                        <span className="text-[10px] text-sky-400 font-medium animate-pulse">● Ativo</span>
                      )}
                      {tech.resumo.atrasadas > 0 && (
                        <span className="text-[10px] text-red-400 font-medium">
                          {tech.resumo.atrasadas} atrasada(s)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {totalValor > 0 && (
                      <p className="text-sm font-bold text-emerald-400 tabular-nums">
                        R$ {totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-[10px] text-zinc-600 tabular-nums">{progress}%</span>
                    </div>
                  </div>
                </div>

                {/* Tasks — compact list */}
                <div className="px-2.5 py-1.5">
                  {sortedTasks.map((task, idx) => {
                    const isLate = task.atrasada;
                    const label = isLate ? "Atrasada" : task.status;
                    const dotClass = isLate ? "bg-red-500" : (statusDot[task.status] || "bg-zinc-600");
                    const textClass = isLate ? "text-red-400" : (statusColor[task.status] || "text-zinc-400");

                    return (
                      <div
                        key={task.taskId || idx}
                        className={`flex items-center gap-2 py-1.5 ${idx > 0 ? "border-t border-zinc-800/40" : ""} ${isLate ? "bg-red-950/20 -mx-1 px-1 rounded" : ""}`}
                      >
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-zinc-200 truncate">
                            {task.cliente || "Sem cliente"}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-medium ${textClass}`}>{label}</span>
                            {task.gcOsCodigo && (
                              <span className="text-[10px] text-zinc-600 font-mono">
                                {task.gcOsTipo || "OS"} {task.gcOsCodigo}
                              </span>
                            )}
                            {task.horaInicio && (
                              <span className="text-[10px] text-zinc-600">
                                {task.horaInicio}{task.horaFim ? `–${task.horaFim}` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        {task.gcOsValor && task.gcOsValor !== "0" && (
                          <span className="text-[11px] font-semibold text-emerald-400 flex-shrink-0 tabular-nums">
                            R$ {parseFloat(task.gcOsValor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                        {task.pendencia && task.pendencia.toLowerCase() !== "nenhuma" && task.pendencia !== "0" && (
                          <span className="text-[10px] text-red-400 flex-shrink-0">⚠</span>
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
    </div>
  );
}
