import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar, ExternalLink, Loader2, Save } from "lucide-react";

export type TarefaAgendada = {
  id: string;
  tipo: string;
  data: string;
  tecnico?: string | null;
  status?: string | null;
  link?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  equipamento: string;
  cliente?: string | null;
  tarefas: TarefaAgendada[];
  onUpdated?: () => void;
}

export default function TarefasAgendadasDialog({ open, onOpenChange, equipamento, cliente, tarefas, onUpdated }: Props) {
  const [dates, setDates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const dateValue = (t: TarefaAgendada) =>
    dates[t.id] ?? (t.data ? t.data.substring(0, 10) : "");

  const reagendar = async (t: TarefaAgendada) => {
    const novaData = dateValue(t);
    if (!novaData) return toast.error("Informe a nova data");
    setSavingId(t.id);
    try {
      // Preserva o horário atual da tarefa no Auvo
      const { data: taskData } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "get", taskId: Number(t.id) },
      });
      const taskResult = taskData?.data?.result;
      const hora = String(taskResult?.taskDate || "").substring(11, 19) || "08:00:00";

      const { data: patchResult, error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "edit",
          taskId: Number(t.id),
          patches: [{ op: "replace", path: "/taskDate", value: `${novaData}T${hora}` }],
        },
      });
      if (error) throw error;
      if (patchResult?.status && patchResult.status >= 400) {
        throw new Error(patchResult?.data?.message || `Erro ${patchResult.status}`);
      }
      toast.success(`Tarefa #${t.id} reagendada para ${format(parseISO(novaData), "dd/MM/yyyy")}`);
      onUpdated?.();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reagendar tarefa");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Tarefas agendadas no Auvo
          </DialogTitle>
          <DialogDescription>
            {equipamento}{cliente ? ` — ${cliente}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {tarefas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma tarefa em aberto.</p>
          )}
          {tarefas.map((t) => (
            <div key={t.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">#{t.id}</Badge>
                  <span className="text-sm font-medium">{t.tipo}</span>
                  {t.status && <Badge variant="secondary" className="text-[10px]">{t.status}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {t.tecnico && <span>{t.tecnico}</span>}
                  <span>
                    {t.data ? format(parseISO(t.data), "dd/MM/yyyy", { locale: ptBR }) : "Sem data"}
                  </span>
                  {t.link && (
                    <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                      Abrir <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Nova data</label>
                  <Input
                    type="date"
                    value={dateValue(t)}
                    onChange={(e) => setDates((p) => ({ ...p, [t.id]: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => reagendar(t)}
                  disabled={savingId === t.id || dateValue(t) === (t.data ? t.data.substring(0, 10) : "")}
                >
                  {savingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Reagendar</>}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
