import { useMemo, useState } from "react";
import { format, addDays } from "date-fns";
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
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { useQueryClient } from "@tanstack/react-query";
import AgendamentoEquipeDialog from "@/components/operacional/AgendamentoEquipeDialog";

const DIAS_TRADUZIDOS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico");
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
  valor: string;
  onSalvar: (v: string) => void;
  onClick: () => void;
  colorir?: boolean;
}

function Celula({ valor, onSalvar, onClick, colorir = true }: CelulaProps) {
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
      onClick={(e) => {
        if (e.detail === 2) {
          setRascunho(valor);
          setEditando(true);
        } else {
          onClick();
        }
      }}
      className={cn(
        "border border-border p-1.5 align-top text-[11px] font-semibold uppercase leading-tight cursor-pointer h-16 min-w-[130px] hover:ring-1 hover:ring-primary/50",
        colorir && corCliente(valor),
      )}
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

  const inicioEscala = useMemo(() => new Date(), []);
  
  const dias = useMemo(
    () => Array.from({ length: 90 }, (_, i) => format(addDays(inicioEscala, i), "yyyy-MM-dd")),
    [inicioEscala],
  );

  const { data: colaboradores = [], isLoading: loadingCol } = useColaboradores();
  const { data: veiculos = [], isLoading: loadingVei } = useAgendaVeiculos();
  const { data, isLoading, isFetching, refetch } = useAgendaSemana(dias);
  const salvarTecnico = useSalvarCelulaTecnico();
  const salvarVeiculo = useSalvarCelulaVeiculo();

  const tecnicos = useMemo(() => {
    const ativos = colaboradores.filter((c) => c.ativo);
    const t = ativos.filter(isTecnico);
    return (t.length > 0 ? t : ativos).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [colaboradores]);

  const mapTec = useMemo(() => {
    const m = new Map<string, AgendaAgendamento>();
    for (const a of data?.agendamentos ?? []) {
      m.set(`${a.colaborador_id}|${a.data}`, a);
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
    await supabase.from("agenda_veiculos").insert({ nome: nome.trim().toUpperCase(), ordem: veiculos.length + 1, ativo: true } as never);
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
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
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
                          const atual = mapTec.get(`${t.id}|${dia}`);
                          return (
                            <Celula
                              key={dia}
                              valor={atual?.cliente ?? ""}
                              onClick={() => {
                                setSelectedAgendamento(atual || null);
                                setSelectedDate(new Date(dia + "T12:00:00"));
                                setSelectedColabId(t.id);
                                setDialogOpen(true);
                              }}
                              onSalvar={(v) =>
                                salvarTecnico.mutate({
                                  id: atual?.id ?? null,
                                  data: dia,
                                  colaborador_id: t.id,
                                  colaborador_nome: t.nome,
                                  texto: v,
                                })
                              }
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
                          <Celula
                            key={dia}
                            valor={mapVei.get(`${v.id}|${dia}`) ?? ""}
                            colorir={false}
                            onClick={() => {}}
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
    </div>
  );
}
