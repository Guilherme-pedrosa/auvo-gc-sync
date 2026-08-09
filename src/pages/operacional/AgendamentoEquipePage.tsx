import { useMemo, useState, useEffect, useRef } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, RefreshCw, Printer, Plus, Truck, Users } from "lucide-react";
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
  onDragStart: (a: AgendaAgendamento) => void;
  onDrop: () => void;
  colorir?: boolean;
}

function Celula({ itens, onSalvar, onAbrirTarefa, onAbrirAgendamento, onDragStart, onDrop, colorir = true }: CelulaProps) {
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
      className="border border-border p-0.5 align-top h-16 min-w-[150px] transition-colors"
    >
      {itens.length === 0 ? (
        <button
          type="button"
          onClick={() => onAbrirAgendamento(null)}
          className="w-full h-full min-h-[3.5rem] text-[11px] opacity-25 hover:opacity-60"
          aria-label="Adicionar agendamento"
        >
          —
        </button>
      ) : (
        <div className="flex flex-col gap-0.5">
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
              <button
                key={a.id}
                type="button"
                draggable
                onDragStart={() => onDragStart(a)}
                title={a.auvo_task_id ? `Tarefa Auvo #${a.auvo_task_id}` : "Agendamento manual"}
                onClick={() => (a.auvo_task_id ? onAbrirTarefa(a) : onAbrirAgendamento(a))}
                onAuxClick={(e) => {
                  // Clique com botão do meio ou scroll abre edição mesmo se tiver tarefa
                  if (e.button === 1 && a.auvo_task_id) {
                    onAbrirAgendamento(a);
                  }
                }}
                className={cn(
                  "w-full text-left rounded-sm px-1.5 py-1 text-[11px] font-semibold uppercase leading-tight hover:ring-1 hover:ring-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-grab active:cursor-grabbing",
                  colorir && corCliente(a.cliente),
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </td>
  );
}

function CelulaTexto({ valor, onSalvar }: { valor: string; onSalvar: (v: string) => void }) {
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
      className="border border-border p-1.5 align-top text-[11px] font-semibold uppercase leading-tight cursor-pointer h-16 min-w-[130px] hover:ring-1 hover:ring-primary/50"
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
  const dragItem = useRef<AgendaAgendamento | null>(null);
  const saveAgendamento = useSaveAgendamento();

  const inicioEscala = useMemo(() => new Date(), []);
  
  const dias = useMemo(
    () => Array.from({ length: 90 }, (_, i) => format(addDays(inicioEscala, i), "yyyy-MM-dd")),
    [inicioEscala],
  );

  const { data: colaboradores = [], isLoading: loadingCol } = useColaboradores();
  const { data: veiculos = [], isLoading: loadingVei } = useAgendaVeiculos();
  const { data, isLoading, isFetching, refetch: refetchLocal } = useAgendaSemana(dias);
  const [isSyncing, setIsSyncing] = useState(false);

  const refetch = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Puxando tarefas do Auvo/GC para a escala...");
    try {
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
        
        // Critério: Só mostrar se tiver OS ou Orçamento, OU se for tarefa pura sem vínculos
        // A lógica do usuário diz: "SÓ COLOCAR A TAREFA NA LINHA QUANDO NÃO TIVER ORÇAMENTO NEM OS"
        // No contexto de sincronização, cada tarefa enriquecida já traz esses campos se existirem.
        
        const local = codigosLocais.get(taskId);
        const osCodigo = t.gc_os_codigo || local?.os || null;
        const orcCodigo = t.gc_orcamento_codigo || local?.orc || null;


        const key = `${taskId}|${t.data_tarefa}|${colab.id}`;
        if (vistos.has(key)) continue;
        vistos.add(key);
        linhas.push({
          data: t.data_tarefa,
          hora_inicio: t.hora_inicio || "08:00",
          hora_fim: t.hora_fim || "18:00",
          colaborador_id: colab.id,
          colaborador_nome: colab.nome,
          cliente: String(t.cliente || "SEM CLIENTE").trim().toUpperCase(),
          descricao: t.descricao || t.orientacao || null,
          status: "AGENDADO",
          auvo_task_id: taskId,
          origem: "AUVO",
          gc_os_codigo: osCodigo,
          gc_orcamento_codigo: osCodigo ? null : orcCodigo,
        });
      }

      // Remove sincronizados antigos do período e regrava
      // Também remove agendamentos manuais que agora possuem uma tarefa vinculada no Auvo
      // para evitar duplicidade (ex: Dener com OS e Dener sem nada)
      const { error: errDel } = await supabase
        .from("agenda_agendamentos")
        .delete()
        .or(`origem.eq.AUVO,and(origem.eq.MANUAL,cliente.in.(${linhas.map(l => `'${l.cliente}'`).join(",")}),data.in.(${linhas.map(l => `'${l.data}'`).join(",")}))`)
        .gte("data", dias[0])
        .lte("data", dias[dias.length - 1]);
      if (errDel) throw errDel;

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
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching || isSyncing}>
            <RefreshCw className={cn("h-4 w-4", (isFetching || isSyncing) && "animate-spin")} />
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
                                setSelectedDate(new Date(dia + "T12:00:00"));
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
                <Button variant="outline" size="sm" className="gap-2" onClick={adicionarVeiculo}>
                  <Plus className="h-3.5 w-3.5" /> Veículo
                </Button>
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
                      <tr key={v.id}>
                        <td className="border border-border p-2 text-[11px] font-bold uppercase bg-card sticky left-0 z-10">
                          {v.nome}
                          {v.placa && <div className="text-[10px] font-normal opacity-60">{v.placa}</div>}
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={selectedDate}
        initialColaboradorId={selectedColabId}
        agendamento={selectedAgendamento}
      />

      <TarefaAuvoDetalheDialog taskId={tarefaId} onOpenChange={(open) => !open && setTarefaId(null)} />
    </div>
  );
}
