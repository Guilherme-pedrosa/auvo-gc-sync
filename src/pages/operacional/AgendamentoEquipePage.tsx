import { useMemo, useState, useEffect, useRef } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, RefreshCw, Printer, Plus, Truck, Users, AlertTriangle, Download, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useColaboradores, useRhClientes } from "@/hooks/rh/useRh";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useAgendaVeiculos,
  useAgendaSemana,
  useSalvarCelulaTecnico,
  useSalvarCelulaVeiculo,
  useSaveAgendamento,
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { useQueryClient } from "@tanstack/react-query";
import AgendamentoEquipeDialog from "@/components/operacional/AgendamentoEquipeDialog";
import TarefaAuvoDetalheDialog from "@/components/operacional/TarefaAuvoDetalheDialog";
import CriarTarefaGeralDialog from "@/components/operacional/CriarTarefaGeralDialog";
import AgendaRelatorioDialog from "@/components/operacional/AgendaRelatorioDialog";
import { toast } from "sonner";

const DIAS_TRADUZIDOS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

const norm = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico") || txt.includes("auxiliar");
};

const PALETA = [
  // Azuis
  "bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]",
  "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "bg-[#EFF6FF] text-[#1E40AF] border-[#DBEAFE]",
  // Verdes
  "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]",
  "bg-[#ECFDF5] text-[#047857] border-[#D1FAE5]",
  "bg-[#F0FDF4] text-[#166534] border-[#DCFCE7]",
  // Amarelos/Laranjas
  "bg-[#FEF3C7] text-[#A16207] border-[#FDE68A]",
  "bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]",
  "bg-[#FEF9C3] text-[#854D0E] border-[#FEF08A]",
  // Vermelhos/Rosas
  "bg-[#FFE4E6] text-[#BE123C] border-[#FECDD3]",
  "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  "bg-[#FFF1F2] text-[#9F1239] border-[#FFE4E6]",
  // Roxos/Violets
  "bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF]",
  "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
  "bg-[#EDE9FE] text-[#5B21B6] border-[#DDD6FE]",
  // Cyans/Teals
  "bg-[#ECFEFF] text-[#0E7490] border-[#CFFAFE]",
  "bg-[#F0FDFA] text-[#0F766E] border-[#CCFBF1]",
  "bg-[#E0F7FA] text-[#006064] border-[#B2EBF2]",
  // Outros/Misturas
  "bg-[#FDF4FF] text-[#A21CAF] border-[#FAE8FF]",
  "bg-[#FAF5FF] text-[#553C9A] border-[#E9D8FD]",
  "bg-[#FFF8E1] text-[#855B0F] border-[#FFECB3]",
  "bg-[#F0F9FF] text-[#0369A1] border-[#E0F2FE]",
  "bg-[#EBF8FF] text-[#2C5282] border-[#BEE3F8]",
  "bg-[#E6FFFA] text-[#285E61] border-[#B2F5EA]",
  "bg-[#F5FFF5] text-[#2F855A] border-[#C6F6D5]",
  "bg-[#EFEBE9] text-[#4E342E] border-[#D7CCC8]",
  "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0]",
  "bg-[#E8EAF6] text-[#1A237E] border-[#C5CAE9]",
  "bg-[#F1F8E9] text-[#33691E] border-[#DCEDC8]",
  "bg-[#FFFBEB] text-[#92400E] border-[#FEF3C7]",
  "bg-[#FDF2F8] text-[#9D174D] border-[#FCE7F3]",
  "bg-[#FFF7ED] text-[#9A3412] border-[#FFEDD5]",
  "bg-[#F0FDFA] text-[#0D9488] border-[#CCFBF1]",
  "bg-[#F5F5F4] text-[#44403C] border-[#E7E5E4]",
  "bg-[#FAF5F5] text-[#991B1B] border-[#FEE2E2]",
  "bg-[#EFF6FF] text-[#2563EB] border-[#DBEAFE]",
  "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
  "bg-[#FDF4FF] text-[#C026D3] border-[#FAE8FF]",
  "bg-[#FFF1F2] text-[#E11D48] border-[#FFE4E6]",
  "bg-[#F0FDF4] text-[#16A34A] border-[#DCFCE7]",
  "bg-[#FEFCE8] text-[#A16207] border-[#FEF9C3]",
  "bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]",
  "bg-[#F0F9FF] text-[#0284C7] border-[#E0F9FF]",
  "bg-[#EEF2FF] text-[#4F46E5] border-[#E0E7FF]",
  "bg-[#F5F3FF] text-[#6D28D9] border-[#EDE9FE]",
];

const corCliente = (texto: string) => {
  const t = texto.trim().toUpperCase();
  if (!t) return "";
  if (t === "X" || t === "FOLGA") return "bg-muted text-muted-foreground";
  if (t.startsWith("OFICINA")) return "bg-slate-200 text-slate-800";

  // Hash aprimorado para dispersar melhor as cores e evitar colisões
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = t.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Salt adicional baseado no comprimento para diferenciar strings curtas/similares
  hash += t.length * 31;

  const colorIndex = Math.abs(hash) % PALETA.length;
  return PALETA[colorIndex];
};

interface CelulaProps {
  itens: AgendaAgendamento[];
  onSalvar: (v: string) => void;
  onAbrirTarefa: (a: AgendaAgendamento) => void;
  onAbrirAgendamento: (a: AgendaAgendamento | null) => void;
  onNovaTarefaAuvo: () => void;
  onPreverProximoDia: (a: AgendaAgendamento) => void;
  onDragStart: (a: AgendaAgendamento) => void;
  onDrop: () => void;
  colorir?: boolean;
  clientesInfo?: any[];
}

function Celula({
  itens,
  onSalvar,
  onAbrirTarefa,
  onAbrirAgendamento,
  onNovaTarefaAuvo,
  onPreverProximoDia,
  onDragStart,
  onDrop,
  colorir = true,
  clientesInfo = [],
}: CelulaProps) {
  const [editando, setEditando] = useState(false);
  const manual = itens.find((i) => !i.auvo_task_id && i.origem !== "AUVO");
  const [rascunho, setRascunho] = useState(manual?.cliente ?? "");

  if (editando) {
    return (
      <td className="border border-border p-0 align-top">
        <textarea
          autoFocus
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => {
            setEditando(false);
            if (rascunho.trim() !== (manual?.cliente ?? "").trim()) onSalvar(rascunho);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRascunho(manual?.cliente ?? "");
              setEditando(false);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full h-16 resize-none bg-background p-1.5 text-[11px] font-medium uppercase outline-none ring-2 ring-primary"
        />
      </td>
    );
  }

  return (
    <td
      onDoubleClick={() => {
        setRascunho(manual?.cliente ?? "");
        setEditando(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add("bg-primary/5");
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove("bg-primary/5");
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("bg-primary/5");
        onDrop();
      }}
      className="group relative border border-border p-0.5 align-top h-16 min-w-[150px] transition-colors"
    >
      <div className="flex flex-col gap-0.5 h-full">
        {itens.map((a) => {
          let prefix = "";
          let idText = "";
          if (a.gc_os_codigo) {
            prefix = "OS";
            idText = a.gc_os_codigo;
          } else if (a.gc_orcamento_codigo) {
            prefix = "OR";
            idText = a.gc_orcamento_codigo;
          } else if (a.auvo_task_id) {
            // Só colocamos a tarefa se não houver OS nem Orçamento
            prefix = "T";
            idText = a.auvo_task_id;
          }

          const label = idText ? `${prefix} ${idText} - ${a.cliente}` : a.cliente;

          return (
            <div key={a.id} className="group/item relative flex items-center">
              <button
                type="button"
                draggable
                onDragStart={() => onDragStart(a)}
                title={a.origem === "CONTRATO"
                  ? `Previsão contratual${a.descricao ? ` · ${a.descricao}` : ""}${a.previsao_detalhes ? ` · ${a.previsao_detalhes}` : ""}`
                  : a.previsao_continuidade
                  ? `Previsão interna${a.previsao_detalhes ? ` · ${a.previsao_detalhes}` : ""}`
                  : a.auvo_task_id
                    ? `Tarefa Auvo #${a.auvo_task_id}`
                    : "Agendamento manual"}
                onClick={() => (a.auvo_task_id ? onAbrirTarefa(a) : onAbrirAgendamento(a))}
                onAuxClick={(e) => {
                  if (e.button === 1 && a.auvo_task_id) {
                    onAbrirAgendamento(a);
                  }
                }}
                className={cn(
                  "w-full text-left rounded-sm px-1.5 py-1 text-[11px] font-semibold uppercase leading-tight hover:ring-1 hover:ring-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-grab active:cursor-grabbing border border-transparent",
                  a.previsao_continuidade && "border border-dashed border-primary/50 opacity-80",
                  colorir && corCliente(a.cliente),
                )}
              >
                <div className="flex flex-col">
                  <span className="truncate">{label}</span>
                  {a.previsao_detalhes && (
                    <span className="text-[9px] font-normal lowercase opacity-80 truncate">
                      {a.previsao_detalhes}
                    </span>
                  )}
                  {a.previsao_tipo === "ORCAMENTO_EXECUCAO" && a.previsao_continuidade && a.conversao_status && (
                    <span className="text-[9px] font-normal normal-case opacity-80 truncate">
                      {a.conversao_status === "AGUARDANDO_OS" && "Aguardando geração da OS"}
                      {a.conversao_status === "AGUARDANDO_TAREFA" && `OS ${a.gc_os_codigo || ""} · aguardando tarefa de execução`}
                      {a.conversao_status === "PROCESSANDO" && "Convertendo para tarefa Auvo..."}
                      {a.conversao_status === "BLOQUEADA" && `Conversão bloqueada${a.conversao_erro ? ` · ${a.conversao_erro}` : ""}`}
                      {a.conversao_status === "ERRO" && `Erro na conversão${a.conversao_erro ? ` · ${a.conversao_erro}` : ""}`}
                    </span>
                  )}
                </div>
                {a.previsao_continuidade && (
                  <span className="ml-1 text-[9px] lowercase italic text-primary-foreground/70">
                    {a.origem === "CONTRATO" ? "(contrato)" : "(previsão)"}
                  </span>
                )}
              </button>
              <div className="absolute -right-1 top-1/2 -translate-y-1/2 z-20 hidden group-hover/item:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreverProximoDia(a);
                  }}
                  title="Prever continuação no próximo dia"
                  className="flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] shadow-sm hover:scale-110 transition-transform"
                >
                  +
                </button>
                {a.previsao_continuidade && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbrirAgendamento(a);
                    }}
                    title="Excluir previsão"
                    className="flex items-center justify-center h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] shadow-sm hover:scale-110 transition-transform"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
        
        {/* Espaço clicável para nova tarefa sempre disponível, mesmo com itens */}
        <button
          type="button"
          onClick={() => onNovaTarefaAuvo()}
          className={cn(
            "w-full text-[11px] opacity-25 hover:opacity-100 transition-opacity min-h-[1.5rem] flex-1 flex items-center justify-center hover:bg-primary/5 rounded-sm border border-transparent hover:border-primary/20",
            itens.length > 0 && "mt-auto py-1"
          )}
          aria-label="Nova tarefa ou previsão"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </td>
  );
}

function CelulaTexto({ valor, onSalvar, onExcluir }: { valor: string; onSalvar: (v: string) => void; onExcluir?: () => void }) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);

  if (editando) {
    return (
      <td className="border border-border p-0 align-top">
        <textarea
          autoFocus
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => {
            setEditando(false);
            if (rascunho.trim() !== valor.trim()) onSalvar(rascunho);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRascunho(valor);
              setEditando(false);
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full h-16 resize-none bg-background p-1.5 text-[11px] font-medium uppercase outline-none ring-2 ring-primary"
        />
      </td>
    );
  }

  return (
    <td
      onClick={() => {
        setRascunho(valor);
        setEditando(true);
      }}
      className="group relative border border-border p-1.5 align-top text-[11px] font-semibold uppercase leading-tight cursor-pointer h-16 min-w-[130px] hover:ring-1 hover:ring-primary/50"
    >
      {valor || <span className="opacity-25 normal-case font-normal">—</span>}
    </td>
  );
}

export default function AgendamentoEquipePage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAgendamento, setSelectedAgendamento] = useState<AgendaAgendamento | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedColabId, setSelectedColabId] = useState<string | null>(null);
  const [tarefaId, setTarefaId] = useState<string | null>(null);
  const [dialogEditOpen, setDialogEditOpen] = useState(false);
  const [dialogCreateTaskOpen, setDialogCreateTaskOpen] = useState(false);
  const [dialogRelatorioOpen, setDialogRelatorioOpen] = useState(false);
  const [createTaskPrefill, setCreateTaskPrefill] = useState<{ data: string | null; auvoUserId: string | null; nome: string | null }>({ data: null, auvoUserId: null, nome: null });
  const dragItem = useRef<AgendaAgendamento | null>(null);
  const [dialogChoiceOpen, setDialogChoiceOpen] = useState(false);
  const saveAgendamento = useSaveAgendamento();

  // Expõe o queryClient globalmente para uso no diálogo de criação de tarefa
  useEffect(() => {
    (window as any).queryClient = qc;
    return () => {
      delete (window as any).queryClient;
    };
  }, [qc]);

  const inicioEscala = useMemo(() => new Date(), []);
  
  const dias = useMemo(
    () => Array.from({ length: 90 }, (_, i) => format(addDays(inicioEscala, i), "yyyy-MM-dd")),
    [inicioEscala],
  );

  const { data: colaboradores = [], isLoading: loadingCol, refetch: refetchColaboradores } = useColaboradores();
  const { data: veiculos = [], isLoading: loadingVei } = useAgendaVeiculos();
  const { data: rhClientes = [] } = useRhClientes();
  const { data, isLoading, isFetching, refetch: refetchLocal } = useAgendaSemana(dias);
  const [isSyncing, setIsSyncing] = useState(false);
  const customerSyncPromise = useRef<Promise<void> | null>(null);

  const sincronizarClientesEmSegundoPlano = () => {
    if (customerSyncPromise.current) return customerSyncPromise.current;

    const request = (async () => {
      const { error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-customers", forceRefresh: true },
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["auvo-customers"] });
    })()
      .catch((err: unknown) => {
        console.error("[agendamento-equipe] erro ao atualizar clientes do Auvo:", err);
        toast.warning("As tarefas foram sincronizadas, mas os clientes do Auvo não foram atualizados.");
      })
      .finally(() => {
        customerSyncPromise.current = null;
      });

    customerSyncPromise.current = request;
    return request;
  };

  const refetch = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Atualizando tarefas do Auvo...");
    try {
      // O mesmo clique também atualiza os clientes, mas esse trabalho não segura
      // a agenda nem o botão de sincronização.
      void sincronizarClientesEmSegundoPlano();

      // Uma única leitura do RH; o retorno é usado nesta sincronização para
      // evitar trabalhar com o estado anterior do React Query.
      const [colaboradoresResult, agendaResult] = await Promise.all([
        refetchColaboradores(),
        supabase.functions.invoke("auvo-agenda", {
          body: { startDate: dias[0], endDate: dias[dias.length - 1], fast: true },
        }),
      ]);
      if (colaboradoresResult.error) throw colaboradoresResult.error;
      const colaboradoresAtuais = colaboradoresResult.data ?? colaboradores;

      const { data: syncRes, error } = agendaResult;
      if (error) throw error;
      if ((syncRes as any)?.error) throw new Error((syncRes as any).error);

      const tarefas: any[] = Array.isArray(syncRes?.data) ? syncRes.data : [];

      // Resolução do técnico: auvo_user_id (fonte da verdade) → nome → primeiro nome
      const porAuvoId = new Map<string, any>();
      const porNome = new Map<string, any>();
      const porPrimeiroNome = new Map<string, any>();
      for (const c of colaboradoresAtuais) {
        if (!c.ativo) continue;
        if (c.auvo_user_id) porAuvoId.set(String(c.auvo_user_id), c);
        const n = norm(c.nome);
        porNome.set(n, c);
        const p = n.split(" ")[0];
        if (p && !porPrimeiroNome.has(p)) porPrimeiroNome.set(p, c);
      }
      const resolver = (t: any) => {
        if (t.tecnico_id && porAuvoId.has(String(t.tecnico_id))) return porAuvoId.get(String(t.tecnico_id));
        const n = norm(t.tecnico || "");
        if (!n) return undefined;
        return porNome.get(n) ?? porPrimeiroNome.get(n.split(" ")[0]);
      };

      // 1 linha por tarefa (cliente por linha, clicável)
      const linhas: any[] = [];
      let semTecnico = 0;
      const vistos = new Set<string>();
      
      for (const t of tarefas) {
        if (!t.data_tarefa) continue;
        const colab = resolver(t);
        if (!colab) { semTecnico++; continue; }
        const taskId = String(t.auvo_task_id ?? t.taskID ?? t.id ?? "");
        if (!taskId) continue;
        
        const key = `${taskId}|${t.data_tarefa}|${colab.id}`;
        if (vistos.has(key)) continue;
        vistos.add(key);
        
        const clienteLimpo = String(t.cliente || "SEM CLIENTE").trim().toUpperCase();

        linhas.push({
          data: t.data_tarefa,
          hora_inicio: t.hora_inicio || "08:00",
          hora_fim: t.hora_fim || "18:00",
          colaborador_id: colab.id,
          colaborador_nome: colab.nome,
          cliente: clienteLimpo,
          descricao: t.descricao || t.orientacao || null,
          status: "AGENDADO",
          auvo_task_id: taskId,
          origem: "AUVO",
          gc_os_codigo: t.gc_os_codigo || null,
          // O orçamento é a chave que liga a previsão à OS e não pode ser descartado.
          gc_orcamento_codigo: t.gc_orcamento_codigo || null,
        });
      }

      // Reconsulta somente as tarefas retornadas. Isso captura previsões que a
      // edge function acabou de promover sem varrer toda a tarefas_central.
      const lineTaskIds = [...new Set(linhas.map((line) => String(line.auvo_task_id)).filter(Boolean))];
      const { data: existingTaskRows, error: existingReadError } = lineTaskIds.length
        ? await supabase
          .from("agenda_agendamentos")
          .select("id,auvo_task_id,data,hora_inicio,hora_fim,colaborador_id,colaborador_nome,cliente,descricao,status,origem,gc_os_codigo,gc_orcamento_codigo,previsao_continuidade,previsao_tipo,conversao_status")
          .in("auvo_task_id", lineTaskIds)
        : { data: [], error: null };
      if (existingReadError) throw existingReadError;

      const taskKey = (row: { auvo_task_id?: string | null; data: string; colaborador_id?: string | null }) =>
        `${String(row.auvo_task_id || "")}|${row.data}|${String(row.colaborador_id || "")}`;
      const slotKey = (row: { data: string; colaborador_id?: string | null }) =>
        `${row.data}|${String(row.colaborador_id || "")}`;
      const sourceKeys = new Set(linhas.map(taskKey));
      const occupiedSlots = new Set(linhas.map(slotKey));
      const existingByKey = new Map((existingTaskRows || []).map((row) => [taskKey(row), row]));

      const protectedForecast = (row: any) =>
        row.previsao_tipo === "ORCAMENTO_EXECUCAO" || row.conversao_status === "CONVERTIDA";
      const previousRows = data?.agendamentos ?? [];
      const rowsForCleanup = [...previousRows, ...(existingTaskRows || [])];
      const deleteIds = [...new Set(rowsForCleanup
        .filter((row: any) => {
          if (protectedForecast(row)) return false;
          if (row.auvo_task_id && (row.origem === "AUVO" || row.origem == null)) {
            return row.data >= dias[0]
              && row.data <= dias[dias.length - 1]
              && !sourceKeys.has(taskKey(row));
          }
          return !row.auvo_task_id
            && row.origem === "MANUAL"
            && !row.previsao_continuidade
            && occupiedSlots.has(slotKey(row));
        })
        .map((row: any) => String(row.id))
        .filter(Boolean))];

      // Exclusão em lote dos poucos registros que realmente ficaram obsoletos.
      for (let i = 0; i < deleteIds.length; i += 500) {
        const { error: deleteError } = await supabase
          .from("agenda_agendamentos")
          .delete()
          .in("id", deleteIds.slice(i, i + 500));
        if (deleteError) throw deleteError;
      }

      // Atualiza pelo ID estável; novas linhas recebem UUID no cliente. Assim,
      // tarefas inalteradas não são apagadas e previsões promovidas mantêm o ID.
      const syncFields = [
        "data", "hora_inicio", "hora_fim", "colaborador_id", "colaborador_nome",
        "cliente", "descricao", "status", "origem", "gc_os_codigo", "gc_orcamento_codigo",
      ] as const;
      const equalValue = (value: unknown) => value == null ? "" : String(value);
      const upsertRows = linhas.flatMap((line) => {
        const existing = existingByKey.get(taskKey(line));
        const changed = !existing || syncFields.some((field) =>
          equalValue((existing as any)[field]) !== equalValue(line[field]),
        );
        if (!changed) return [];
        return [{
          ...line,
          id: existing?.id ?? crypto.randomUUID(),
        }];
      });
      for (let i = 0; i < upsertRows.length; i += 500) {
        const { error: upsertError } = await supabase
          .from("agenda_agendamentos")
          .upsert(upsertRows.slice(i, i + 500) as never, { onConflict: "id" });
        if (upsertError) throw upsertError;
      }

      await refetchLocal();
      toast.success(`Escala atualizada: ${linhas.length} agendamentos (${tarefas.length} tarefas)`, {
        id: toastId,
        description: semTecnico > 0 ? `${semTecnico} tarefas sem técnico vinculado no RH.` : undefined,
      });
    } catch (err) {
      console.error("[agendamento-equipe] erro na sincronização:", err);
      toast.error("Não foi possível atualizar a escala", {
        id: toastId,
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const salvarTecnico = useSalvarCelulaTecnico();
  const salvarVeiculo = useSalvarCelulaVeiculo();

  const handleDragDrop = async (date: string, colabId: string) => {
    const item = dragItem.current;
    if (!item) return;

    // Se mudou de técnico ou data
    if (item.data === date && item.colaborador_id === colabId) return;

    const colab = colaboradores.find((c) => c.id === colabId);
    if (!colab) return;

    const ehPrevisao = Boolean(item.previsao_continuidade);
    const toastId = toast.loading(ehPrevisao ? "Movendo previsão..." : "Atualizando agendamento...");
    try {
      // 1. Atualiza no Auvo se for origem AUVO
      if (item.auvo_task_id && item.origem === "AUVO") {
        const patches = [
          { op: "replace", path: "taskDate", value: `${date}T${item.hora_inicio.slice(0, 5)}:00` },
        ];
        
        if (colab.auvo_user_id) {
          patches.push({ op: "replace", path: "idUserTo", value: String(colab.auvo_user_id) });
        }

        const { data: auvoRes, error: auvoErr } = await supabase.functions.invoke("auvo-task-update", {
          body: { action: "edit", taskId: item.auvo_task_id, patches },
        });

        if (auvoErr || auvoRes?.status >= 400) {
          throw new Error(auvoRes?.data?.message || "Erro ao atualizar no Auvo");
        }
      }

      // 2. Atualiza localmente
      await saveAgendamento.mutateAsync({
        id: item.id,
        data: date,
        colaborador_id: colabId,
        colaborador_nome: colab.nome,
        // Mantém o resto
        hora_inicio: item.hora_inicio,
        hora_fim: item.hora_fim,
        veiculo_id: item.veiculo_id,
        cliente: item.cliente,
        descricao: item.descricao,
        status: item.status,
        auvo_task_id: item.auvo_task_id,
        origem: item.origem,
        gc_os_codigo: item.gc_os_codigo,
        gc_orcamento_codigo: item.gc_orcamento_codigo,
        previsao_continuidade: item.previsao_continuidade,
        previsao_detalhes: item.previsao_detalhes,
      });

      toast.success(ehPrevisao ? "Previsão movida com sucesso!" : "Agendamento movido com sucesso!", { id: toastId });
      refetchLocal();
    } catch (err: any) {
      console.error("Erro ao mover agendamento:", err);
      toast.error(err.message || "Erro ao mover agendamento", { id: toastId });
    } finally {
      dragItem.current = null;
    }
  };

  const tecnicos = useMemo(() => {
    const ativos = colaboradores.filter((c) => c.ativo);
    const t = ativos.filter(isTecnico);
    return (t.length > 0 ? t : ativos).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [colaboradores]);

  const mapTec = useMemo(() => {
    const m = new Map<string, AgendaAgendamento[]>();
    for (const a of data?.agendamentos ?? []) {
      const k = `${a.colaborador_id}|${a.data}`;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((x, y) => (x.hora_inicio ?? "").localeCompare(y.hora_inicio ?? "") || x.cliente.localeCompare(y.cliente));
    }
    return m;
  }, [data]);

  const mapVei = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of data?.veiculoDias ?? []) m.set(`${v.veiculo_id}|${v.data}`, v.texto);
    return m;
  }, [data]);

  const adicionarVeiculo = async () => {
    const nome = window.prompt("Nome do veículo (ex: ETIOS PRATA)");
    if (!nome?.trim()) return;
    const placa = window.prompt("Placa do veículo (opcional)");
    await supabase.from("agenda_veiculos").insert({ 
      nome: nome.trim().toUpperCase(), 
      placa: placa?.trim()?.toUpperCase() || null,
      ordem: String(veiculos.length + 1), 
      ativo: true 
    } as never);
    qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
  };

  const [syncFrota, setSyncFrota] = useState(false);
  const sincronizarFrota = async () => {
    setSyncFrota(true);
    const toastId = toast.loading("Buscando veículos na Frota (Technician & Vehicle Hub)...");
    try {
      const { data: res, error } = await supabase.functions.invoke("tvh-veiculos-sync", { body: {} });
      if (error) throw error;
      if (!(res as any)?.ok) throw new Error((res as any)?.error || "Falha na sincronização");
      await qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
      toast.success(
        `Frota sincronizada: ${(res as any).total} veículos (${(res as any).criados} novos, ${(res as any).com_alerta} com tarefa crítica aberta)`,
        {
          id: toastId,
          description: (res as any).maintenance_warning || undefined,
        },
      );
    } catch (e: any) {
      toast.error(`Não foi possível sincronizar a frota: ${e?.message || String(e)}`, { id: toastId });
    } finally {
      setSyncFrota(false);
    }
  };

  const carregando = isLoading || loadingCol || loadingVei;
  const rotulo = `ESCALA PRÓXIMOS 90 DIAS — A partir de ${format(new Date(), "dd/MM/yyyy", { locale: ptBR })}`;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b bg-card shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Escala de Técnicos (90 Dias)</h1>
          <div className="flex items-center bg-muted rounded-md p-1 gap-1">
            <span className="px-2 text-xs font-semibold uppercase">{rotulo}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            const el = document.getElementById("hoje-col");
            if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'start' });
          }}>
            Ir para Hoje
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialogRelatorioOpen(true)}>
            <Printer className="h-4 w-4" /> Exportar PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            title="Sincronizar tarefas e clientes do Auvo"
            onClick={() => refetch()}
            disabled={isFetching || isSyncing}
          >
            <RefreshCw className={cn("h-4 w-4", (isFetching || isSyncing) && "animate-spin")} />
            {isSyncing ? "Sincronizando Auvo..." : "Sincronizar Auvo"}
          </Button>
          <Button className="gap-2" size="sm" onClick={() => setDialogCreateTaskOpen(true)}>
            <Plus className="h-4 w-4" /> Nova Tarefa Auvo
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {carregando ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold uppercase tracking-wide">Técnicos</h2>
              </div>
              <div className="overflow-x-auto border rounded-md max-h-[600px] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-60 sticky left-0 top-0 bg-muted z-20">
                        Técnico
                      </th>
                      {dias.map((diaStr) => {
                        const date = new Date(diaStr + "T00:00:00");
                        const isHoje = format(new Date(), "yyyy-MM-dd") === diaStr;
                        return (
                          <th 
                            key={diaStr} 
                            id={isHoje ? "hoje-col" : undefined}
                            className={cn(
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[130px] sticky top-0 bg-muted z-10",
                              isHoje && "bg-primary/10 ring-1 ring-primary/30"
                            )}
                          >
                            {DIAS_TRADUZIDOS[date.getDay() === 0 ? 6 : date.getDay() - 1]}
                            <div className="text-[10px] font-normal opacity-60">
                              {format(date, "dd/MM")}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tecnicos.map((t) => (
                      <tr key={t.id}>
                        <td className="border border-border p-2 text-[11px] font-bold uppercase bg-card sticky left-0 z-10">
                          {t.nome}
                        </td>
                        {dias.map((dia) => {
                          const itens = mapTec.get(`${t.id}|${dia}`) ?? [];
                          const manual = itens.find((i) => !i.auvo_task_id && i.origem !== "AUVO");
                          return (
                            <Celula
                              key={dia}
                              itens={itens}
                              clientesInfo={rhClientes}
                               onAbrirTarefa={(a) => setTarefaId(a.auvo_task_id ?? null)}
                               onAbrirAgendamento={(a) => {
                                 setSelectedAgendamento(a);
                                 setSelectedDate(parseISO(dia));
                                 setSelectedColabId(t.id);
                                 setDialogOpen(true);
                               }}
                              onSalvar={(v) =>
                                salvarTecnico.mutate({
                                  id: manual?.id ?? null,
                                  data: dia,
                                  colaborador_id: t.id,
                                  colaborador_nome: t.nome,
                                  texto: v,
                                })
                              }
                              onDragStart={(a) => { dragItem.current = a; }}
                              onDrop={() => handleDragDrop(dia, t.id)}
                              onNovaTarefaAuvo={() => {
                                setCreateTaskPrefill({
                                  data: dia,
                                  auvoUserId: (t as any).auvo_user_id ? String((t as any).auvo_user_id) : null,
                                  nome: t.nome,
                                });
                                setDialogCreateTaskOpen(true);
                              }}
                              onPreverProximoDia={async (a) => {
                                const proximoDia = format(addDays(parseISO(a.data), 1), "yyyy-MM-dd");
                                const toastId = toast.loading("Gerando previsão...");
                                try {
                                  const payload = {
                                    ...a,
                                    id: undefined, // Novo registro
                                    data: proximoDia,
                                    status: "PREVISAO",
                                    previsao_continuidade: true,
                                    previsao_tipo: "CONTINUACAO",
                                    conversao_status: null,
                                    conversao_erro: null,
                                    conversao_tentada_em: null,
                                    convertida_em: null,
                                    auvo_task_id: null,
                                    origem: "MANUAL",
                                  };
                                  delete (payload as any).id;
                                  delete (payload as any).criado_em;
                                  delete (payload as any).atualizado_em;

                                  const { error } = await supabase.from("agenda_agendamentos").insert(payload as any);
                                  if (error) throw error;

                                  qc.invalidateQueries({ queryKey: ["agenda_semana"] });
                                  toast.success("Previsão gerada para o dia seguinte", { id: toastId });
                                } catch (err) {
                                  console.error("Erro ao prever:", err);
                                  toast.error("Erro ao gerar previsão", { id: toastId });
                                }
                              }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                    {tecnicos.length === 0 && (
                      <tr>
                        <td colSpan={dias.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                          Nenhum técnico ativo cadastrado no RH.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-bold uppercase tracking-wide">Veículos</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={sincronizarFrota}
                    disabled={syncFrota}
                  >
                    <Download className={cn("h-3.5 w-3.5", syncFrota && "animate-pulse")} />
                    {syncFrota ? "Atualizando veículos..." : "Atualizar veículos"}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={adicionarVeiculo}>
                    <Plus className="h-3.5 w-3.5" /> Veículo
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto border rounded-md max-h-[400px] overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-60 sticky left-0 top-0 bg-muted z-20">
                        Veículo
                      </th>
                      {dias.map((diaStr) => {
                        const date = new Date(diaStr + "T00:00:00");
                        const isHoje = format(new Date(), "yyyy-MM-dd") === diaStr;
                        return (
                          <th 
                            key={diaStr}
                            className={cn(
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[130px] sticky top-0 bg-muted z-10",
                              isHoje && "bg-primary/10"
                            )}
                          >
                            {DIAS_TRADUZIDOS[date.getDay() === 0 ? 6 : date.getDay() - 1]}
                            <div className="text-[10px] font-normal opacity-60">
                              {format(date, "dd/MM")}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                     {veiculos.map((v) => (
                        <tr key={v.id} className="group/row">
                          <td className="group border border-border p-2 text-[11px] font-bold uppercase bg-card sticky left-0 z-10 align-top">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="truncate">{v.nome}</span>
                                {v.placa && <div className="text-[10px] font-normal opacity-60">{v.placa}</div>}
                                {v.status && (
                                  <div className="text-[10px] font-normal normal-case opacity-70">{v.status}</div>
                                )}
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Deseja realmente excluir o veículo ${v.nome}? Ele não retornará na próxima sincronização.`)) return;
                                  
                                  const { error } = await supabase
                                    .from("agenda_veiculos")
                                    .update({ deletado_em: new Date().toISOString(), ativo: false } as any)
                                    .eq("id", v.id);
                                  
                                  if (error) {
                                    toast.error("Erro ao excluir veículo");
                                  } else {
                                    toast.success("Veículo excluído");
                                    qc.invalidateQueries({ queryKey: ["agenda_veiculos"] });
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                                title="Excluir veículo permanentemente"
                              >
                                <Plus className="h-3 w-3 rotate-45" />
                              </button>
                            </div>
                            {v.observacao && (
                              <div
                                title={v.observacao}
                                className="mt-1 flex flex-col gap-1 rounded border border-destructive/40 bg-destructive/10 p-1 text-[10px] font-normal normal-case text-destructive"
                              >
                                <div className="flex items-center gap-1 font-bold uppercase text-[9px]">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  <span>Não conformidade — último checklist</span>
                                </div>
                                <span className="whitespace-pre-line leading-snug">{v.observacao}</span>
                              </div>
                            )}
                          </td>
                          {dias.map((dia) => (
                            <CelulaTexto
                              key={dia}
                              valor={mapVei.get(`${v.id}|${dia}`) ?? ""}
                              onSalvar={(texto) => salvarVeiculo.mutate({ veiculo_id: v.id, data: dia, texto })}
                            />
                          ))}
                        </tr>
                      ))}
                    {veiculos.length === 0 && (
                      <tr>
                        <td colSpan={dias.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                          Nenhum veículo cadastrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Diálogo de Escolha: Tarefa ou Previsão */}
      <Dialog open={dialogChoiceOpen} onOpenChange={setDialogChoiceOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>O que deseja lançar?</DialogTitle>
            <DialogDescription>
              Escolha entre criar uma tarefa real no Auvo ou apenas uma previsão interna na agenda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2 items-center justify-center border-2 hover:border-primary hover:bg-primary/5"
              onClick={() => {
                setDialogChoiceOpen(false);
                setDialogCreateTaskOpen(true);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <span className="font-bold">Tarefa Auvo</span>
              <span className="text-[10px] text-muted-foreground font-normal">Sincroniza com aplicativo</span>
            </Button>

            <Button
              variant="outline"
              className="h-24 flex flex-col gap-2 items-center justify-center border-2 hover:border-emerald-500 hover:bg-emerald-50"
              onClick={() => {
                setDialogChoiceOpen(false);
                setSelectedAgendamento(null);
                setDialogOpen(true);
              }}
            >
              <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <CalendarClock className="h-5 w-5 text-emerald-600" />
              </div>
              <span className="font-bold">Previsão</span>
              <span className="text-[10px] text-muted-foreground font-normal">Apenas escala interna</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgendamentoEquipeDialog
        open={dialogOpen || dialogEditOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          setDialogEditOpen(open);
          if (!open) {
            setSelectedAgendamento(null);
            setSelectedDate(undefined);
            setSelectedColabId(null);
          }
        }}
        initialDate={selectedDate}
        initialColaboradorId={selectedColabId}
        agendamento={selectedAgendamento}
      />

      <TarefaAuvoDetalheDialog 
        taskId={tarefaId} 
        onOpenChange={(open) => !open && setTarefaId(null)} 
        onEdit={() => {
          const item = data?.agendamentos?.find(i => i.auvo_task_id === tarefaId);
          if (item) {
            setSelectedAgendamento(item);
            setDialogEditOpen(true);
            setTarefaId(null);
          }
        }}
      />

      <CriarTarefaGeralDialog
        open={dialogCreateTaskOpen}
        onOpenChange={(o) => {
          setDialogCreateTaskOpen(o);
          if (!o) setCreateTaskPrefill({ data: null, auvoUserId: null, nome: null });
        }}
        initialDate={createTaskPrefill.data}
        initialUserAuvoId={createTaskPrefill.auvoUserId}
        initialUserNome={createTaskPrefill.nome}
        onSuccess={() => {
          refetchLocal();
          // Além do refetch local, forçamos o refresh do queryClient para garantir sincronia em todos os componentes
          qc.invalidateQueries({ queryKey: ["agenda_semana"] });
          qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
        }}
      />

      <AgendaRelatorioDialog
        open={dialogRelatorioOpen}
        onOpenChange={setDialogRelatorioOpen}
        agendamentos={data?.agendamentos ?? []}
        veiculoDias={data?.veiculoDias ?? []}
      />
    </div>
  );
}
