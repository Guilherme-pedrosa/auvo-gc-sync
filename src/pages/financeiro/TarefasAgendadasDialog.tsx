import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type EditState = { date: string; hour: string; minute: string; tecnicoId: string; durationMinutes: number };

export default function TarefasAgendadasDialog({ open, onOpenChange, equipamento, cliente, tarefas, onUpdated }: Props) {
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { data: auvoUsers = [] } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-users" },
      });
      if (error) throw error;
      return (data?.data || []) as { userID: number; name: string }[];
    },
    enabled: open,
    staleTime: 1000 * 60 * 30,
  });

  // Carrega hora e técnico atuais direto do Auvo (igual ao Kanban de OS)
  useEffect(() => {
    if (!open || tarefas.length === 0) return;
    let cancelled = false;
    setLoadingDetails(true);
    (async () => {
      const next: Record<string, EditState> = {};
      for (const t of tarefas) {
        const fallbackDate = t.data ? t.data.substring(0, 10) : "";
        let hour = "08";
        let minute = "00";
        let tecnicoId = "";
        let date = fallbackDate;
        let durationMinutes = 120;
        try {
          const { data } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "get", taskId: Number(t.id) },
          });
          const task = data?.data?.result ?? data?.data ?? null;
          const raw = task?.taskDate || task?.task_date || null;
          if (raw) {
            const parsed = new Date(raw);
            if (!isNaN(parsed.getTime())) {
              date = format(parsed, "yyyy-MM-dd");
              hour = String(parsed.getHours()).padStart(2, "0");
              minute = String(parsed.getMinutes()).padStart(2, "0");
            }
          }
          const rawEnd = task?.taskEndDate || task?.task_end_date || null;
          if (raw && rawEnd) {
            const s0 = new Date(raw).getTime();
            const e0 = new Date(rawEnd).getTime();
            const diff = Math.round((e0 - s0) / 60000);
            if (Number.isFinite(diff) && diff > 0) durationMinutes = diff;
          }
          const estimatedDuration = String(task?.estimatedDuration ?? task?.estimated_duration ?? "");
          const durationMatch = estimatedDuration.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2})/);
          if (durationMatch) {
            const estimatedMinutes = Number(durationMatch[1] || 0) * 1440
              + Number(durationMatch[2] || 0) * 60
              + Number(durationMatch[3] || 0);
            if (estimatedMinutes > 0) durationMinutes = estimatedMinutes;
          }
          const userTo = task?.idUserTo ?? task?.id_user_to ?? null;
          if (userTo) tecnicoId = String(userTo);
        } catch {
          // mantém fallback
        }
        next[t.id] = { date, hour, minute, tecnicoId, durationMinutes };
      }
      if (!cancelled) {
        setEdits(next);
        setLoadingDetails(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, tarefas]);

  const setField = (id: string, patch: Partial<EditState>) =>
    setEdits((p) => ({ ...p, [id]: { ...(p[id] || { date: "", hour: "08", minute: "00", tecnicoId: "", durationMinutes: 120 }), ...patch } }));

  const reagendar = async (t: TarefaAgendada) => {
    const st = edits[t.id];
    if (!st?.date) return toast.error("Informe a nova data");
    setSavingId(t.id);
    try {
      const hh = st.hour.padStart(2, "0");
      const mm = st.minute.padStart(2, "0");
      const startISO = `${st.date}T${hh}:${mm}:00`;
      const dur = Math.max(15, Number(st.durationMinutes) || 120);

      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "edit-schedule",
          taskId: Number(t.id),
          taskDate: startISO,
          idUserTo: st.tecnicoId ? Number(st.tecnicoId) : undefined,
          durationMinutes: dur,
        },
      });

      if (error) {
        console.error("[TarefasAgendadasDialog] invoke error:", error);
        throw error;
      }
      
      const status = data?.status ?? 200;
      if (status >= 400) {
        let detail = data?.data?.error ?? data?.data ?? JSON.stringify(data);
        if (typeof detail === 'object' && detail !== null) {
          if (detail.message) {
            detail = detail.message + (detail.errors ? ": " + detail.errors.join(", ") : "");
          } else {
            detail = JSON.stringify(detail);
          }
        }
        console.error("[TarefasAgendadasDialog] Auvo API error:", detail);
        throw new Error(`Erro ${status} no Auvo: ${detail}`);
      }
      if (data?.warning) toast.warning(data.warning);
      toast.success(`Tarefa #${t.id} reagendada para ${format(parseISO(st.date), "dd/MM/yyyy")} às ${hh}:${mm} (${dur} min)`);
      
      // Update local state immediately so the user sees the change without waiting for a re-sync
      setEdits(prev => ({
        ...prev,
        [t.id]: { ...st }
      }));

      // Invalidate queries so the main table refreshes when the dialog is closed
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
          {loadingDetails && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados do Auvo...
            </p>
          )}
          {tarefas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma tarefa em aberto.</p>
          )}
          {tarefas.map((t) => {
            const st = edits[t.id];
            return (
              <div key={t.id} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">#{t.id}</Badge>
                    <span className="text-sm font-medium">{t.tipo}</span>
                    {t.status && <Badge variant="secondary" className="text-[10px]">{t.status}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {st?.date
                        ? format(parseISO(st.date), "dd/MM/yyyy", { locale: ptBR })
                        : t.data
                          ? format(parseISO(t.data), "dd/MM/yyyy", { locale: ptBR })
                          : "Sem data"}
                    </span>
                    {t.link && (
                      <a href={t.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                        Abrir <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Nova data</label>
                    <Input
                      type="date"
                      value={st?.date ?? ""}
                      onChange={(e) => setField(t.id, { date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Hora</label>
                    <div className="flex items-center gap-1">
                      <Select value={st?.hour ?? "08"} onValueChange={(v) => setField(t.id, { hour: v })}>
                        <SelectTrigger className="w-[72px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">:</span>
                      <Select value={st?.minute ?? "00"} onValueChange={(v) => setField(t.id, { minute: v })}>
                        <SelectTrigger className="w-[72px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {["00", "15", "30", "45"].map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Duração (min)</label>
                    <Input
                      type="number"
                      min={15}
                      step={15}
                      className="w-[110px]"
                      value={st?.durationMinutes ?? 120}
                      onChange={(e) => setField(t.id, { durationMinutes: Number(e.target.value) })}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Fim: {st?.date
                        ? format(
                            new Date(
                              new Date(`${st.date}T${(st.hour || "08").padStart(2, "0")}:${(st.minute || "00").padStart(2, "0")}:00`).getTime()
                              + Math.max(15, Number(st?.durationMinutes) || 120) * 60_000,
                            ),
                            "dd/MM HH:mm",
                          )
                        : "—"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => reagendar(t)}
                    disabled={savingId === t.id || loadingDetails || !st?.date}
                  >
                    {savingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Salvar no Auvo</>}
                  </Button>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground">Técnico responsável</label>
                  <Select value={st?.tecnicoId ?? ""} onValueChange={(v) => setField(t.id, { tecnicoId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.tecnico || "Selecionar técnico"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {auvoUsers.map((u) => (
                        <SelectItem key={u.userID} value={String(u.userID)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
