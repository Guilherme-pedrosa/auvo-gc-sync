import { clockToMinutes, minutesToClock } from "@/lib/auvoDuration";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, ExternalLink, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { forecastDateMeetsMinimum, forecastInitialDate, todayISO } from "@/lib/agendamento";
import { useColaboradores } from "@/hooks/rh/useRh";

export type AgendarAlvo = {
  previsao_id?: string | null;
  auvo_task_id: string | null;
  mirror_key?: string | null;
  exec_task_id: string | null;
  gc_os_id?: string | null;
  gc_orcamento_id?: string | null;
  gc_os_codigo?: string | null;
  gc_orcamento_codigo?: string | null;
  cliente: string;
  equipamento?: string | null;
  data_tarefa?: string | null;
  data_sugerida?: string | null;
  data_minima?: string | null;
  aviso_estoque?: string | null;
  tecnico_id?: string | null;
  tecnico_nome?: string | null;
  previsao_detalhes?: string | null;
  hora?: string | null;
  hora_fim?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alvo: AgendarAlvo | null;
  onSaved?: (patch: {
    dataTarefa: string;
    tecnico: string;
    tecnicoId: string;
    hora?: string;
    horaFim?: string;
    detalhes?: string | null;
    previsaoId?: string;
  }) => void;
};

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function AgendarTarefaDialog({ open, onOpenChange, alvo, onSaved }: Props) {
  const qc = useQueryClient();
  const [dateISO, setDateISO] = useState(todayISO());
  const [hora, setHora] = useState("08:00");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [tecnicoId, setTecnicoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [previsaoDetalhes, setPrevisaoDetalhes] = useState("");

  const { data: colaboradores = [], isLoading: loadingColaboradores } = useColaboradores();

  const userOptions = useMemo(() => {
    const isTecnico = (cargo: unknown, funcao: unknown) => {
      const texto = normalizeName(`${cargo ?? ""} ${funcao ?? ""}`);
      return texto.includes("tecnico") || texto.includes("auxiliar");
    };

    const ativos = colaboradores.filter((colaborador) => colaborador.ativo);
    const tecnicos = ativos.filter((colaborador) => isTecnico(colaborador.cargo, colaborador.funcao));
    const lista = tecnicos.length > 0 ? [...tecnicos] : [...ativos];
    const selectedId = String(alvo?.tecnico_id ?? "");
    const selectedName = normalizeName(alvo?.tecnico_nome);
    const selected = colaboradores.find((colaborador) =>
      String(colaborador.id) === selectedId
      || (colaborador.auvo_user_id && String(colaborador.auvo_user_id) === selectedId)
      || (selectedName && normalizeName(colaborador.nome) === selectedName),
    );
    if (selected && !lista.some((colaborador) => colaborador.id === selected.id)) lista.push(selected);

    return lista
      .map((colaborador) => ({ value: colaborador.id, label: colaborador.nome }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [alvo?.tecnico_id, alvo?.tecnico_nome, colaboradores]);

  useEffect(() => {
    if (!open || !alvo) return;

    setDateISO(forecastInitialDate(alvo.data_tarefa, alvo.data_sugerida, alvo.data_minima));
    const targetHora = alvo.hora?.slice(0, 5) || "08:00";
    setHora(targetHora);
    setDurationMinutes(
      alvo.hora && alvo.hora_fim
        ? Math.max(15, clockToMinutes(alvo.hora_fim.slice(0, 5)) - clockToMinutes(targetHora))
        : 120,
    );

    const idInformado = String(alvo.tecnico_id ?? "");
    const nomeInformado = normalizeName(alvo.tecnico_nome);
    const colaborador = colaboradores.find((item) =>
      String(item.id) === idInformado
      || (item.auvo_user_id && String(item.auvo_user_id) === idInformado)
      || (nomeInformado && normalizeName(item.nome) === nomeInformado),
    );
    setTecnicoId(colaborador?.id ?? "");
    setPrevisaoDetalhes(alvo.previsao_detalhes || "");
  }, [open, alvo, colaboradores]);

  const handleSaveForecast = async () => {
    if (!alvo) return;
    if (!dateISO || !tecnicoId) {
      toast.error("Informe a data e o técnico.");
      return;
    }

    const dataMinima = alvo.data_minima?.slice(0, 10);
    if (dataMinima && !forecastDateMeetsMinimum(dateISO, dataMinima)) {
      toast.error(`A execução deve ser prevista para ${format(parseISO(dataMinima), "dd/MM/yyyy")} ou depois, após a reposição das peças.`);
      return;
    }

    const colaborador = colaboradores.find((item) => item.id === tecnicoId);
    if (!colaborador) {
      toast.error("Selecione um técnico cadastrado no RH.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        data: dateISO,
        hora_inicio: hora,
        hora_fim: minutesToClock(clockToMinutes(hora) + durationMinutes),
        colaborador_id: colaborador.id,
        colaborador_nome: colaborador.nome,
        cliente: alvo.cliente.trim().toUpperCase(),
        descricao: alvo.equipamento ? `Equipamento: ${alvo.equipamento}` : null,
        status: "PREVISAO",
        auvo_task_id: null,
        gc_os_codigo: alvo.gc_os_codigo || null,
        gc_orcamento_codigo: alvo.gc_orcamento_codigo || null,
        previsao_continuidade: true,
        previsao_tipo: alvo.gc_orcamento_codigo ? "ORCAMENTO_EXECUCAO" : "OS_EXECUCAO",
        conversao_status: alvo.gc_orcamento_codigo
          ? (alvo.gc_os_codigo ? "AGUARDANDO_TAREFA" : "AGUARDANDO_OS")
          : null,
        conversao_erro: null,
        previsao_detalhes: previsaoDetalhes.trim() || null,
        origem: "MANUAL",
        atualizado_em: new Date().toISOString(),
      };

      let previsaoId = alvo.previsao_id || null;
      if (!previsaoId) {
        let consulta = supabase
          .from("agenda_agendamentos")
          .select("id,previsao_continuidade,auvo_task_id")
          .order("atualizado_em", { ascending: false })
          .limit(1);

        if (alvo.gc_orcamento_codigo) {
          consulta = consulta
            .eq("gc_orcamento_codigo", alvo.gc_orcamento_codigo)
            .eq("previsao_tipo", "ORCAMENTO_EXECUCAO");
        } else if (alvo.gc_os_codigo) {
          consulta = consulta
            .eq("gc_os_codigo", alvo.gc_os_codigo)
            .eq("previsao_continuidade", true);
        }

        if (alvo.gc_orcamento_codigo || alvo.gc_os_codigo) {
          const { data: existente, error: readError } = await consulta.maybeSingle();
          if (readError) throw readError;
          if (existente && !existente.previsao_continuidade && existente.auvo_task_id) {
            throw new Error(`Este orçamento já foi convertido na tarefa Auvo ${existente.auvo_task_id}. Edite o agendamento real.`);
          }
          previsaoId = existente?.id ?? null;
        }
      }

      const wasUpdate = Boolean(previsaoId);
      if (previsaoId) {
        const { error } = await supabase
          .from("agenda_agendamentos")
          .update(payload)
          .eq("id", previsaoId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("agenda_agendamentos")
          .insert(payload)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!inserted?.id) throw new Error("A previsão não foi salva (nenhuma linha gravada).");
        previsaoId = inserted.id;
      }

      toast.success(wasUpdate ? "Previsão atualizada." : "Previsão criada na agenda da equipe.");
      onSaved?.({
        dataTarefa: dateISO,
        tecnico: colaborador.nome,
        tecnicoId: colaborador.id,
        hora,
        horaFim: payload.hora_fim,
        detalhes: payload.previsao_detalhes,
        previsaoId: previsaoId || undefined,
      });
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      void qc.invalidateQueries({ queryKey: ["agenda_semana"] });
    } catch (error) {
      toast.error(`Não foi possível salvar a previsão interna: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Previsão de execução
          </DialogTitle>
          <DialogDescription className="text-xs">
            {alvo?.gc_os_codigo ? <strong>OS {alvo.gc_os_codigo} · </strong> : null}
            {!alvo?.gc_os_codigo && alvo?.gc_orcamento_codigo
              ? <strong>Orçamento {alvo.gc_orcamento_codigo} · </strong>
              : null}
            {alvo?.cliente}
            {alvo?.equipamento ? <> · {alvo.equipamento}</> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800">
            Esta ação cria somente uma previsão interna no Agendamento Equipe. Nenhuma tarefa será criada ou alterada no Auvo ou no GestãoClick.
          </div>

          {(alvo?.gc_orcamento_codigo || alvo?.aviso_estoque) && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[10px] space-y-2">
              <div className="flex flex-col gap-1 text-slate-700">
                {alvo?.gc_orcamento_codigo && (
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-0.5">
                    <span className="font-semibold text-slate-900">Orçamento {alvo.gc_orcamento_codigo}</span>
                    <a 
                      href={`https://gestaoclick.com/v2/api/orcamentos/editar/${alvo.gc_orcamento_codigo}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1 font-medium"
                    >
                      Ver no GC <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                
                {alvo?.aviso_estoque && (
                  <div className="flex items-start gap-1.5 text-amber-900 bg-amber-100/50 p-1.5 rounded border border-amber-200">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <div>
                      <strong>Atenção:</strong> {alvo.aviso_estoque}
                      {alvo.data_minima && (
                        <p className="mt-0.5">Execução permitida a partir de {format(parseISO(alvo.data_minima.slice(0, 10)), "dd/MM/yyyy")}.</p>
                      )}
                    </div>
                  </div>
                )}
                
                {alvo?.data_sugerida && dateISO && dateISO < alvo.data_sugerida.slice(0, 10) && (
                  <div className="flex items-start gap-1.5 text-destructive bg-destructive/10 p-1.5 rounded border border-destructive/40">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <div>
                      <strong>Alerta de Atraso:</strong> A data de chegada das peças está prevista para {format(parseISO(alvo.data_sugerida.slice(0, 10)), "dd/MM/yyyy")}. Agendar antes disso pode causar deslocamento inútil.
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>

        <div className="mt-2 space-y-3">
          <div>
            <Label className="text-xs">Técnico do RH</Label>
            <Select value={tecnicoId} onValueChange={setTecnicoId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={loadingColaboradores ? "Carregando técnicos..." : "Selecione o técnico"} />
              </SelectTrigger>
              <SelectContent>
                {userOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 flex flex-col">
              <Label className="text-xs">Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dateISO && "text-muted-foreground"
                    )}
                  >
                    <CalendarClock className="mr-2 h-3.5 w-3.5" />
                    {dateISO ? format(parseISO(dateISO), "dd/MM/yyyy") : <span>Data</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateISO ? parseISO(dateISO) : undefined}
                    onSelect={(date) => date && setDateISO(format(date, "yyyy-MM-dd"))}
                    disabled={alvo?.data_minima
                      ? (date) => format(date, "yyyy-MM-dd") < alvo.data_minima!.slice(0, 10)
                      : undefined}
                    initialFocus
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs">Hora</Label>
              <Input type="time" value={hora} onChange={(event) => setHora(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Duração local</Label>
              <Input
                type="time"
                step={300}
                value={minutesToClock(durationMinutes)}
                onChange={(event) => setDurationMinutes(Math.max(15, clockToMinutes(event.target.value)))}
              />
            </div>
          </div>

          <div className="space-y-1 border-t border-dashed pt-2">
            <Label className="text-xs font-medium text-primary">Detalhes da previsão</Label>
            <Textarea
              value={previsaoDetalhes}
              onChange={(event) => setPrevisaoDetalhes(event.target.value)}
              placeholder="Ex.: peças separadas, levar ferramenta especial, combinar acesso com o cliente..."
              className="min-h-20 resize-y text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSaveForecast} disabled={saving || loadingColaboradores}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar previsão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
