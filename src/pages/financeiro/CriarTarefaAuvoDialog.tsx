import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  equipamento: {
    id: string;
    nome: string;
    cliente: string | null;
    auvo_equipment_id: string | null;
    proxima_data?: string | null;
    htHoras?: number | null;
  };
  onCreated?: (taskId: string | null) => void;
};

const PREFERRED_TASK_TYPE_IDS = new Set(["180175", "180176"]);
const FALLBACK_PREVENTIVE_TASK_TYPES = [
  { id: 180176, description: "Visita Preventiva Contrato", active: true },
  { id: 180175, description: "Visita Preventiva + OS", active: true },
];

export default function CriarTarefaAuvoDialog({ open, onOpenChange, equipamento, onCreated }: Props) {
  const [taskTypeId, setTaskTypeId] = useState<string>("");
  const [idUserTo, setIdUserTo] = useState<string>("");
  const [dateISO, setDateISO] = useState<string>(() => {
    const base = equipamento.proxima_data?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    return base;
  });
  const [startTime, setStartTime] = useState<string>("08:00");
  const defaultDuration = (() => {
    const h = Number(equipamento.htHoras);
    if (Number.isFinite(h) && h > 0) return Math.round(h * 60);
    return 120;
  })();
  const [durationMinutes, setDurationMinutes] = useState<number>(defaultDuration);
  const [orientation, setOrientation] = useState<string>(
    `Preventiva — ${equipamento.nome}${equipamento.cliente ? ` (${equipamento.cliente})` : ""}`
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const base = equipamento.proxima_data?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      setDateISO(base);
      setOrientation(`Preventiva — ${equipamento.nome}${equipamento.cliente ? ` (${equipamento.cliente})` : ""}`);
      const h = Number(equipamento.htHoras);
      setDurationMinutes(Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 120);
    }
  }, [open, equipamento.id, equipamento.htHoras]);

  const { data: taskTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ["auvo-task-types", "preventiva-v2"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-task-types" },
      });
      if (error) {
        console.error("[list-task-types] erro:", error);
        return FALLBACK_PREVENTIVE_TASK_TYPES;
      }
      const list = Array.isArray(data?.data) ? data.data : [];
      return list.length > 0 ? list : FALLBACK_PREVENTIVE_TASK_TYPES;
    },
  });

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

  const taskTypeOptions = useMemo(() => {
    const byId = new Map<string, { value: string; label: string }>();
    [...FALLBACK_PREVENTIVE_TASK_TYPES, ...taskTypes].forEach((t: any) => {
      const value = String(t.id ?? t.taskTypeId ?? t.taskTypeID ?? "").trim();
      if (!value) return;
      byId.set(value, {
        value,
        label: String(t.description ?? t.name ?? t.taskTypeDescription ?? `Tipo ${value}`),
      });
    });
    const list = Array.from(byId.values()).filter(o => o.value);
    // Preventivas primeiro
    list.sort((a, b) => {
      const ap = PREFERRED_TASK_TYPE_IDS.has(a.value) ? 0 : 1;
      const bp = PREFERRED_TASK_TYPE_IDS.has(b.value) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [taskTypes]);

  // Default to first preventive type when loaded
  useEffect(() => {
    if (!taskTypeId && taskTypeOptions.length > 0) {
      const pref = taskTypeOptions.find(o => PREFERRED_TASK_TYPE_IDS.has(o.value));
      setTaskTypeId(pref?.value || taskTypeOptions[0].value);
    }
  }, [taskTypeOptions, taskTypeId]);

  const userOptions = useMemo(() => {
    return users
      .map((u: any) => ({
        value: String(u.userID ?? u.userId ?? u.id ?? ""),
        label: String(u.name ?? u.userName ?? u.user_name ?? `Usuário ${u.userID ?? "?"}`),
        active: u.userStatus !== false && u.active !== false,
      }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const handleSubmit = async () => {
    if (!equipamento.auvo_equipment_id) {
      toast.error("Equipamento sem ID Auvo");
      return;
    }
    if (!taskTypeId || !idUserTo || !dateISO || !startTime) {
      toast.error("Preencha tipo, técnico, data e hora");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "create-preventive-task",
          auvoEquipmentId: equipamento.auvo_equipment_id,
          idUserTo,
          taskTypeId,
          dateISO,
          startTime,
          durationMinutes,
          orientation,
          priority: 1,
        },
      });
      if (error) throw error;
      if (data?.success && data?.taskId) {
        toast.success(`Tarefa criada no Auvo (#${data.taskId})`, {
          action: {
            label: "Abrir",
            onClick: () => window.open(`https://app2.auvo.com.br/gerenciarTarefas/tarefa/${data.taskId}`, "_blank"),
          },
        });
        onCreated?.(String(data.taskId));
        onOpenChange(false);
      } else {
        const msg = data?.error || data?.data?.errorMessage || data?.data?.error || `Status ${data?.status}`;
        toast.error(`Auvo recusou: ${msg}`);
        console.error("[create-preventive-task] resposta:", data);
      }
    } catch (e: any) {
      toast.error("Erro ao criar tarefa: " + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa Auvo · Preventiva</DialogTitle>
          <DialogDescription className="text-xs">
            <strong>{equipamento.nome}</strong>
            {equipamento.cliente ? <> · {equipamento.cliente}</> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Tipo de tarefa</Label>
            <SearchableSelect
              options={taskTypeOptions}
              value={taskTypeId}
              onValueChange={(v) => setTaskTypeId(v as string)}
              placeholder={loadingTypes ? "Carregando..." : "Selecione o tipo"}
              searchPlaceholder="Buscar tipo..."
            />
          </div>

          <div>
            <Label className="text-xs">Técnico</Label>
            <SearchableSelect
              options={userOptions}
              value={idUserTo}
              onValueChange={(v) => setIdUserTo(v as string)}
              placeholder={loadingUsers ? "Carregando..." : "Selecione o técnico"}
              searchPlaceholder="Buscar técnico..."
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">Data</Label>
              <Input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Hora</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Duração (min)</Label>
            <Input
              type="number"
              min={15}
              step={15}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 60)}
            />
          </div>

          <div>
            <Label className="text-xs">Orientação</Label>
            <Textarea
              value={orientation}
              onChange={(e) => setOrientation(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Criar no Auvo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}