import { clockToMinutes, minutesToClock } from "@/lib/auvoDuration";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
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
import { todayISO } from "@/lib/agendamento";
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
  onSaved?: (patch: { dataTarefa: string; tecnico: string; tecnicoId: string }) => void;
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

    setDateISO((alvo.data_tarefa || alvo.data_sugerida || todayISO()).slice(0, 10));
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
        status: "AGENDADO",
        auvo_task_id: null,
        gc_os_codigo: alvo.gc_os_codigo || null,
        gc_orcamento_codigo: alvo.gc_orcamento_codigo || null,
        previsao_continuidade: true,
        previsao_detalhes: previsaoDetalhes.trim() || null,
        origem: "MANUAL",
        atualizado_em: new Date().toISOString(),
      };

      let previsaoId = alvo.previsao_id || null;
      if (!previsaoId) {
        let consulta = supabase
          .from("agenda_agendamentos")
          .select("id")
          .eq("previsao_continuidade", true)
          .order("atualizado_em", { ascending: false })
          .limit(1);

        if (alvo.gc_orcamento_codigo) {
          consulta = consulta.eq("gc_orcamento_codigo", alvo.gc_orcamento_codigo);
        } else if (alvo.gc_os_codigo) {
          consulta = consulta.eq("gc_os_codigo", alvo.gc_os_codigo);
        }

        if (alvo.gc_orcamento_codigo || alvo.gc_os_codigo) {
          const { data: existente, error: readError } = await consulta.maybeSingle();
          if (readError) throw readError;
          previsaoId = existente?.id ?? null;
        }
      }

      if (previsaoId) {
        const { error } = await supabase
          .from("agenda_agendamentos")
          .update(payload)
          .eq("id", previsaoId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agenda_agendamentos").insert(payload);
        if (error) throw error;
      }

      toast.success(previsaoId ? "Previsão atualizada." : "Previsão criada na agenda da equipe.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["compras-chegadas"] }),
        qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] }),
        qc.invalidateQueries({ queryKey: ["agenda_semana"] }),
      ]);
      onSaved?.({ dataTarefa: dateISO, tecnico: colaborador.nome, tecnicoId: colaborador.id });
      onOpenChange(false);
    } catch (error) {
      toast.error(`Não foi possível salvar a previsão: ${(error as Error).message}`);
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

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800">
          Esta ação cria somente uma previsão interna no Agendamento Equipe. Nenhuma tarefa será criada ou alterada no Auvo.
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
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={dateISO} onChange={(event) => setDateISO(event.target.value)} />
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
