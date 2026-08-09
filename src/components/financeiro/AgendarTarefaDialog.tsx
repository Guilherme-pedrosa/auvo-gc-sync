import { minutesToClock, clockToMinutes } from "@/lib/auvoDuration";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, CalendarClock, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { todayISO } from "@/lib/agendamento";

export type AgendarAlvo = {
  auvo_task_id: string | null;
  mirror_key?: string | null;
  exec_task_id: string | null;
  gc_os_id?: string | null;
  gc_orcamento_id?: string | null;
  gc_os_codigo?: string | null;
  cliente: string;
  equipamento?: string | null;
  data_tarefa?: string | null;
  tecnico_id?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alvo: AgendarAlvo | null;
  onSaved?: (patch: { dataTarefa: string; tecnico: string; tecnicoId: string }) => void;
};

export default function AgendarTarefaDialog({ open, onOpenChange, alvo, onSaved }: Props) {
  const [dateISO, setDateISO] = useState<string>(todayISO());
  const [hora, setHora] = useState("08:00");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [tecnicoId, setTecnicoId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !alvo) return;
    setDateISO(alvo.data_tarefa?.slice(0, 10) || todayISO());
    setHora("08:00");
    setDurationMinutes(120);
    setTecnicoId(alvo.tecnico_id ? String(alvo.tecnico_id) : "");
  }, [open, alvo?.exec_task_id, alvo?.auvo_task_id]);

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
        { op: "replace", path: "estimatedDuration", value: minutesToClock(durationMinutes) },
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
            gc_orcamento_id: alvo.gc_orcamento_id,
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
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Esta OS não tem tarefa de execução (atributo 73344) vinculada no GestãoClick. Vincule a tarefa Auvo
              primeiro para poder agendar por aqui.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Técnico</Label>
              <SearchableSelect
                options={userOptions}
                value={tecnicoId}
                onValueChange={(v) => setTecnicoId(v as string)}
                placeholder={loadingUsers ? "Carregando..." : "Selecione o técnico"}
                searchPlaceholder="Buscar técnico..."
              />
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
                <Label className="text-xs">Duração (HH:mm)</Label>
                <Input
                  type="time"
                  step={300}
                  value={minutesToClock(durationMinutes)}
                  onChange={(e) => setDurationMinutes(clockToMinutes(e.target.value))}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Tarefa Auvo #{taskId}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !taskId}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Agendar no Auvo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}