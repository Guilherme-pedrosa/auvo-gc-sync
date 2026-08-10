import { minutesToClock, clockToMinutes } from "@/lib/auvoDuration";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, CalendarClock, AlertTriangle, Eye } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { todayISO } from "@/lib/agendamento";
import { useColaboradores } from "@/hooks/rh/useRh";

export type AgendarAlvo = {
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
  tecnico_id?: string | null;
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

export default function AgendarTarefaDialog({ open, onOpenChange, alvo, onSaved }: Props) {
  const qc = useQueryClient();
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [hora, setHora] = useState("08:00");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [tecnicoId, setTecnicoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingForecast, setSavingForecast] = useState(false);
  const [previsaoDetalhes, setPrevisaoDetalhes] = useState("");

  const { data: colaboradores = [] } = useColaboradores();

  useEffect(() => {
    if (!open || !alvo) return;
    
    console.log("[AgendarTarefaDialog] Populando campos com alvo:", {
      data_tarefa: alvo.data_tarefa,
      tecnico_id: alvo.tecnico_id,
      hora: alvo.hora,
      previsao_detalhes: alvo.previsao_detalhes
    });

    setDateISO(alvo.data_tarefa?.slice(0, 10) || todayISO());
    
    const targetHora = alvo.hora?.slice(0, 5) || "08:00";
    setHora(targetHora);
    
    const dur = alvo.hora && alvo.hora_fim 
      ? Math.max(15, clockToMinutes(alvo.hora_fim.slice(0, 5)) - clockToMinutes(alvo.hora.slice(0, 5)))
      : 120;
    setDurationMinutes(dur);
    
    // Tenta encontrar o colaborador no cache do RH para setar o ID local se for um ID de usuário Auvo
    // Caso contrário, usa o ID como está (ex: ID UUID do Supabase)
    if (alvo.tecnico_id) {
      const colab = colaboradores.find(c => String(c.auvo_user_id) === String(alvo.tecnico_id));
      setTecnicoId(colab ? colab.id : String(alvo.tecnico_id));
    } else {
      setTecnicoId("");
    }
    
    setPrevisaoDetalhes(alvo.previsao_detalhes || "");
  }, [open, alvo, colaboradores]);

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["auvo-users"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-users" },
      });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const userOptions = useMemo(
    () =>
      users
        .map((u: any) => ({
          value: String(u.userID ?? u.userId ?? u.id ?? ""),
          label: String(u.name ?? u.userName ?? `Usuário ${u.userID ?? "?"}`),
        }))
        .filter((o) => o.value)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users],
  );

  const taskId = alvo?.exec_task_id || alvo?.auvo_task_id || null;

  const handleSave = async () => {
    if (!alvo || !taskId) {
      toast.error("Esta OS ainda não possui tarefa Auvo vinculada para agendar.");
      return;
    }
    if (!dateISO || !tecnicoId) {
      toast.error("Informe data e técnico.");
      return;
    }
    setSaving(true);
    try {
      const patches = [
        { op: "replace", path: "taskDate", value: `${dateISO}T${hora}:00` },
        { op: "replace", path: "idUserTo", value: Number(tecnicoId) },
      ];
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(taskId), patches },
      });
      if (error) throw error;
      if (data?.status && data.status >= 400) {
        throw new Error(typeof data?.data === "string" ? data.data : JSON.stringify(data?.data ?? "Erro no Auvo"));
      }

      const tecnico = userOptions.find((o) => o.value === tecnicoId)?.label || "";

      const { error: persistError } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "persist-central",
          row: {
            auvo_task_id: alvo.auvo_task_id,
            mirror_key: alvo.mirror_key,
            gc_os_id: alvo.gc_os_id,
            gc_orcamento_id: alvo.gc_orcamento_id || alvo.gc_orcamento_codigo,
            data_tarefa: dateISO,
            tecnico_id: tecnicoId,
            tecnico,
          },
        },
      });
      if (persistError) console.warn("Falha ao espelhar agendamento local:", persistError);

      toast.success(`Tarefa #${taskId} agendada para ${dateISO} às ${hora}`);
      onSaved?.({ dataTarefa: dateISO, tecnico, tecnicoId });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Não foi possível agendar: ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveForecast = async () => {
    if (!alvo) return;
    if (!dateISO || !tecnicoId) {
      toast.error("Informe data e técnico.");
      return;
    }

    setSavingForecast(true);
    try {
      const tecnico = userOptions.find((o) => o.value === tecnicoId)?.label || "";
      const colab = colaboradores.find(c => String(c.auvo_user_id) === String(tecnicoId));
      
      const payload = {
        data: dateISO,
        hora_inicio: hora,
        hora_fim: minutesToClock(clockToMinutes(hora) + durationMinutes),
        colaborador_id: colab?.id || null,
        colaborador_nome: colab?.nome || tecnico,
        cliente: alvo.cliente.toUpperCase(),
        descricao: alvo.equipamento ? `Equipamento: ${alvo.equipamento}` : null,
        status: "AGENDADO",
        auvo_task_id: taskId,
        gc_os_codigo: alvo.gc_os_codigo,
        gc_orcamento_codigo: alvo.gc_orcamento_codigo,
        previsao_continuidade: true,
        previsao_detalhes: previsaoDetalhes.trim() || null,
        origem: "MANUAL"
      };

      // Se já tiver uma previsão (previsao_data), atualizamos em vez de inserir
      if (alvo.data_tarefa && (alvo.gc_orcamento_codigo || alvo.gc_os_codigo)) {
        const { error } = await supabase
          .from("agenda_agendamentos")
          .update(payload)
          .match({
            data: alvo.data_tarefa.slice(0, 10),
            gc_orcamento_codigo: alvo.gc_orcamento_codigo,
            gc_os_codigo: alvo.gc_os_codigo,
            previsao_continuidade: true
          });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agenda_agendamentos").insert(payload as any);
        if (error) throw error;
      }

      toast.success(`Previsão criada na agenda para ${dateISO} às ${hora}`);
      qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Erro ao criar previsão: ${e?.message || String(e)}`);
    } finally {
      setSavingForecast(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Agendar execução
          </DialogTitle>
          <DialogDescription className="text-xs">
            {alvo?.gc_os_codigo ? <strong>OS {alvo.gc_os_codigo} · </strong> : null}
            {alvo?.cliente}
            {alvo?.equipamento ? <> · {alvo.equipamento}</> : null}
          </DialogDescription>
        </DialogHeader>

        {!taskId ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Esta OS não tem tarefa de execução vinculada. Você pode salvar como <strong>Previsão</strong> para controle interno na agenda, mas não poderá agendar no Auvo.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <span>
              Ao clicar em <strong>Apenas Previsão</strong>, o registro será criado apenas na escala semanal interna para controle.
            </span>
          </div>
        )}

        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs">Técnico</Label>
            <Select value={tecnicoId} onValueChange={setTecnicoId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={loadingUsers ? "Carregando..." : "Selecione o técnico"} />
              </SelectTrigger>
              <SelectContent>
                {userOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <Label className="text-xs">Data</Label>
              <Input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Hora</Label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Duração (HH:mm) — local</Label>
              <Input
                type="time"
                step={300}
                value={minutesToClock(durationMinutes)}
                onChange={(e) => setDurationMinutes(clockToMinutes(e.target.value))}
              />
            </div>
          </div>
          {taskId && <p className="text-[11px] text-muted-foreground italic">Tarefa Auvo #{taskId}</p>}
          
          <div className="space-y-1 pt-1 border-t border-dashed">
            <Label className="text-[11px] text-primary font-medium">Detalhes da Previsão (Opcional)</Label>
            <Input 
              value={previsaoDetalhes}
              onChange={(e) => setPrevisaoDetalhes(e.target.value)}
              placeholder="Ex: Levar ferramentas especiais, retirar material..."
              className="text-xs h-8"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || savingForecast}>
            Cancelar
          </Button>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="secondary" onClick={handleSaveForecast} disabled={saving || savingForecast}>
              {savingForecast ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              Apenas Previsão
            </Button>
            <Button onClick={handleSave} disabled={saving || savingForecast || !taskId} className="hidden">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
              Agendar no Auvo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}