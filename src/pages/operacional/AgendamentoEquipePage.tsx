import { useMemo, useState, useEffect, useRef } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, RefreshCw, Printer, Plus, Truck, Users, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useColaboradores } from "@/hooks/rh/useRh";
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
  "bg-blue-100 text-blue-900",
  "bg-emerald-100 text-emerald-900",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900",
  "bg-violet-100 text-violet-900",
  "bg-cyan-100 text-cyan-900",
  "bg-lime-100 text-lime-900",
  "bg-orange-100 text-orange-900",
];

const corCliente = (texto: string) => {
  const t = texto.trim().toUpperCase();
  if (!t) return "";
  if (t === "X" || t === "FOLGA") return "bg-muted text-muted-foreground";
  if (t.startsWith("OFICINA")) return "bg-slate-200 text-slate-800";
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = t.charCodeAt(i) + ((hash << 5) - hash);
  return PALETA[Math.abs(hash) % PALETA.length];
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
                title={a.auvo_task_id ? `Tarefa Auvo #${a.auvo_task_id}` : "Agendamento manual"}
                onClick={() => (a.auvo_task_id ? onAbrirTarefa(a) : onAbrirAgendamento(a))}
                onAuxClick={(e) => {
                  if (e.button === 1 && a.auvo_task_id) {
                    onAbrirAgendamento(a);
                  }
                }}
                className={cn(
                  "w-full text-left rounded-sm px-1.5 py-1 text-[11px] font-semibold uppercase leading-tight hover:ring-1 hover:ring-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-grab active:cursor-grabbing",
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
                </div>
                {a.previsao_continuidade && (
                  <span className="ml-1 text-[9px] lowercase italic text-primary-foreground/70">(previsão)</span>
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
            "w-full text-[11px] opacity-25 hover:opacity-60 transition-opacity min-h-[1.5rem] flex-1",
            itens.length > 0 && "mt-auto py-1"
          )}
          aria-label="Nova tarefa Auvo"
        >
          —
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
  const { data, isLoading, isFetching, refetch: refetchLocal } = useAgendaSemana(dias);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdatingCustomers, setIsUpdatingCustomers] = useState(false);

  const atualizarClientesAuvo = async () => {
    setIsUpdatingCustomers(true);
    const toastId = toast.loading("Atualizando cache de clientes do Auvo...");
    try {
      const { data: res, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-customers", forceRefresh: true },
      });
      if (error) throw error;
      toast.success("Cache de clientes atualizado com sucesso!", { id: toastId });
      qc.invalidateQueries({ queryKey: ["auvo-customers"] });
    } catch (err: any) {
      console.error("Erro ao atualizar clientes:", err);
      toast.error("Falha ao atualizar clientes: " + (err.message || String(err)), { id: toastId });
    } finally {
      setIsUpdatingCustomers(false);
    }
  };

  const refetch = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Puxando tarefas e atualizando clientes do Auvo...");
    try {
      // Força a atualização da lista de colaboradores (RH)
      await refetchColaboradores();

      // Atualiza a lista de colaboradores (RH)
      await refetchColaboradores();

      // Sincroniza agenda (Auvo -> Local)

      const { data: syncRes, error } = await supabase.functions.invoke("auvo-agenda", {
        body: { startDate: dias[0], endDate: dias[dias.length - 1] },
      });
      if (error) throw error;
      if ((syncRes as any)?.error) throw new Error((syncRes as any).error);

      const tarefas: any[] = Array.isArray(syncRes?.data) ? syncRes.data : [];

      // Fallback: completa códigos de OS/Orçamento a partir da base local (mesma fonte do Controle OS)
      const taskIds = new Set(
        tarefas.map((t) => String(t.auvo_task_id ?? t.taskID ?? t.id ?? "")).filter(Boolean)
      );
      // IDs podem vir concatenados no GC ("123 / 456"), então normalizamos
      const parseIds = (v: unknown): string[] =>
        String(v ?? "")
          .split(/[^0-9]+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 4);

      const codigosLocais = new Map<string, { os: string | null; orc: string | null }>();
      const registrar = (key: string, os: string | null, orc: string | null) => {
        if (!key || !taskIds.has(key)) return;
        const existing = codigosLocais.get(key);
        if (!existing) {
          codigosLocais.set(key, { os, orc });
          return;
        }
        // Preserva o vínculo mais rico (prioridade OS > Orçamento)
        codigosLocais.set(key, {
          os: existing.os || os,
          orc: existing.orc || orc,
        });
      };

      // Varre a base local paginada procurando vínculos de OS/Orçamento
      const PAGE = 1000;
      for (let page = 0; page < 40; page++) {
        const { data: rows, error: errRows } = await supabase
          .from("tarefas_central")
          .select("auvo_task_id, gc_os_codigo, gc_orcamento_codigo, gc_os_tarefa_os, gc_os_tarefa_exec")
          .or("gc_os_codigo.not.is.null,gc_orcamento_codigo.not.is.null")
          .order("data_tarefa", { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (errRows) break;
        const list = rows ?? [];
        for (const r of list) {
          const os = (r as any).gc_os_codigo || null;
          const orc = (r as any).gc_orcamento_codigo || null;
          if (!os && !orc) continue;
          const keys = [
            String((r as any).auvo_task_id || ""),
            ...parseIds((r as any).gc_os_tarefa_os),
            ...parseIds((r as any).gc_os_tarefa_exec),
          ];
          for (const k of keys) registrar(k, os, orc);
        }
        if (list.length < PAGE) break;
      }

      // Resolução do técnico: auvo_user_id (fonte da verdade) → nome → primeiro nome
      const porAuvoId = new Map<string, any>();
      const porNome = new Map<string, any>();
      const porPrimeiroNome = new Map<string, any>();
      for (const c of colaboradores) {
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
        
        const local = codigosLocais.get(taskId);
        const osCodigo = t.gc_os_codigo || local?.os || null;
        const orcCodigo = t.gc_orcamento_codigo || local?.orc || null;

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
          gc_os_codigo: osCodigo,
          gc_orcamento_codigo: osCodigo ? null : orcCodigo,
        });
      }

      // 1. Limpa agendamentos de origem AUVO ou nula no período, mas PRESERVA os que têm código de Orçamento ou são Previsões
      const { error: errDelAuvo } = await supabase
        .from("agenda_agendamentos")
        .delete()
        .or(`origem.eq.AUVO,origem.is.null`)
        .gte("data", dias[0])
        .lte("data", dias[dias.length - 1])
        .is("gc_orcamento_codigo", null)
        .eq("previsao_continuidade", false);
      
      if (errDelAuvo) throw errDelAuvo;

      // 2. Remove agendamentos manuais que agora coincidem com tarefas do Auvo (evita duplicidade)
      if (linhas.length > 0) {
        const uniqueKeys = Array.from(new Set(linhas.map(l => `${l.data}|${l.colaborador_id}`)));
        for (const key of uniqueKeys) {
          const [d, cId] = key.split('|');
          await supabase
            .from("agenda_agendamentos")
            .delete()
            .match({ data: d, colaborador_id: cId, origem: "MANUAL", previsao_continuidade: false });
        }
      }

      // 3. Insere as novas tarefas sincronizadas
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: errIns } = await supabase
          .from("agenda_agendamentos")
          .insert(linhas.slice(i, i + 500) as never);
        if (errIns) throw errIns;
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

  useEffect(() => {
    const cleanOldConcatenatedEntries = async () => {
      // Remove entradas que contêm "/" no cliente, pois eram as antigas concatenadas
      const { error } = await supabase
        .from("agenda_agendamentos")
        .delete()
        .like("cliente", "%/%");
      
      if (error) {
        console.error("Erro ao limpar agendamentos antigos:", error);
      } else {
        // Recarrega os dados locais se houver deleção (embora o refetch inicial já deva lidar com isso se as tabelas estiverem limpas)
        refetchLocal();
      }
    };
    
    cleanOldConcatenatedEntries();
  }, []);

  const salvarTecnico = useSalvarCelulaTecnico();
  const salvarVeiculo = useSalvarCelulaVeiculo();

  const handleDragDrop = async (date: string, colabId: string) => {
    const item = dragItem.current;
    if (!item) return;

    // Se mudou de técnico ou data
    if (item.data === date && item.colaborador_id === colabId) return;

    const colab = colaboradores.find((c) => c.id === colabId);
    if (!colab) return;

    const toastId = toast.loading("Atualizando agendamento...");
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
        gc_orcamento_codigo: item.gc_orcamento_codigo
      });

      toast.success("Agendamento movido com sucesso!", { id: toastId });
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
        { id: toastId },
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
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b bg-card shrink-0">
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
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2" 
            onClick={atualizarClientesAuvo}
            disabled={isUpdatingCustomers}
          >
            <Users className={cn("h-4 w-4", isUpdatingCustomers && "animate-spin")} />
            {isUpdatingCustomers ? "Atualizando..." : "Atualizar Clientes"}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialogRelatorioOpen(true)}>
            <Printer className="h-4 w-4" /> Exportar PDF
          </Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching || isSyncing}>
            <RefreshCw className={cn("h-4 w-4", (isFetching || isSyncing) && "animate-spin")} />
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
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-40 sticky left-0 bg-muted z-10">
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
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[130px]",
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
                    <Download className={cn("h-3.5 w-3.5", syncFrota && "animate-pulse")} /> Sincronizar Frota
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={adicionarVeiculo}>
                    <Plus className="h-3.5 w-3.5" /> Veículo
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="border border-border p-2 text-left text-[11px] font-bold uppercase w-40 sticky left-0 bg-muted z-10">
                        Veículo
                      </th>
                      {dias.map((diaStr) => {
                        const date = new Date(diaStr + "T00:00:00");
                        const isHoje = format(new Date(), "yyyy-MM-dd") === diaStr;
                        return (
                          <th 
                            key={diaStr}
                            className={cn(
                              "border border-border p-2 text-center text-[10px] font-bold uppercase min-w-[130px]",
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
