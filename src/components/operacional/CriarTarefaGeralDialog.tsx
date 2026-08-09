import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (taskId: string) => void;
}

export default function CriarTarefaGeralDialog({ open, onOpenChange, onSuccess }: Props) {
  const [taskTypeId, setTaskTypeId] = useState<string>("");
  const [idUserTo, setIdUserTo] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [questionnaireId, setQuestionnaireId] = useState<string>("");
  const [dateISO, setDateISO] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("08:00");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [orientation, setOrientation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["auvo-customers"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", { body: { action: "list-customers" } });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const { data: equipments = [], isLoading: loadingEquipments } = useQuery({
    queryKey: ["auvo-customer-equipments", customerId],
    enabled: open && !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", { body: { action: "list-customer-equipments", customerId } });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const { data: taskTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ["auvo-task-types"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", { body: { action: "list-task-types" } });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["auvo-users"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", { body: { action: "list-users" } });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const { data: questionnaires = [], isLoading: loadingQuestionnaires } = useQuery({
    queryKey: ["auvo-questionnaires"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", { body: { action: "list-questionnaires" } });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const customerOptions = useMemo(() => 
    customers
      .map(c => ({ value: String(c.customerId || c.id || ""), label: String(c.name || "") }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label))
  , [customers]);

  const equipmentOptions = useMemo(() => 
    equipments
      .map(e => ({ 
        value: String(e.equipmentId || e.id || ""), 
        label: `${e.name} ${e.idSerie ? `(${e.idSerie})` : ""}` 
      }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label))
  , [equipments]);

  const taskTypeOptions = useMemo(() => 
    taskTypes
      .map(t => ({ value: String(t.taskTypeId || t.id || ""), label: String(t.description || t.name || "") }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label))
  , [taskTypes]);

  const userOptions = useMemo(() => 
    users
      .map(u => ({ value: String(u.userID || u.id || ""), label: String(u.name || "") }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label))
  , [users]);

  const questionnaireOptions = useMemo(() => 
    questionnaires
      .map(q => ({ 
        value: String(q.id ?? q.questionnaireId ?? q.questionnaireID ?? ""), 
        label: String(q.description ?? q.name ?? q.questionnaireDescription ?? `Questionário ${q.id ?? "?"}`) 
      }))
      .filter(o => o.value)
      .sort((a, b) => a.label.localeCompare(b.label))
  , [questionnaires]);

  const handleSubmit = async () => {
    if (!customerId || !idUserTo || !taskTypeId || !dateISO || !startTime) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "create-task",
          customerId, idUserTo, taskTypeId, dateISO, startTime,
          durationMinutes, orientation, questionnaireId, equipmentId
        }
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("Tarefa criada no Auvo!");
        onSuccess?.(data.taskId);
        onOpenChange(false);
      } else {
        toast.error("Erro ao criar: " + (data?.error || "Desconhecido"));
      }
    } catch (e: any) {
      toast.error("Falha na requisição: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
        <div className="overflow-y-auto p-6 flex-1">
        <DialogHeader>
          <DialogTitle>Nova Tarefa Auvo</DialogTitle>
          <DialogDescription>Abra uma tarefa do zero sincronizada com o Auvo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label className="text-xs">Cliente</Label>
            <SearchableSelect options={customerOptions} value={customerId} onValueChange={setCustomerId} placeholder={loadingCustomers ? "Carregando..." : "Selecione o cliente"} searchPlaceholder="Buscar cliente..." />
          </div>
          {customerId && (
            <div className="grid gap-2">
              <Label className="text-xs">Equipamento (opcional)</Label>
              <SearchableSelect options={equipmentOptions} value={equipmentId} onValueChange={setEquipmentId} placeholder={loadingEquipments ? "Carregando..." : "Selecione o equipamento"} searchPlaceholder="Buscar equipamento..." />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-xs">Tipo de Tarefa</Label>
              <SearchableSelect options={taskTypeOptions} value={taskTypeId} onValueChange={setTaskTypeId} placeholder={loadingTypes ? "Carregando..." : "Selecione o tipo"} searchPlaceholder="Buscar tipo..." />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Técnico</Label>
              <SearchableSelect options={userOptions} value={idUserTo} onValueChange={setIdUserTo} placeholder={loadingUsers ? "Carregando..." : "Selecione o técnico"} searchPlaceholder="Buscar técnico..." />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Questionário (opcional)</Label>
            <SearchableSelect options={questionnaireOptions} value={questionnaireId} onValueChange={setQuestionnaireId} placeholder={loadingQuestionnaires ? "Carregando..." : questionnaireOptions.length === 0 ? "Nenhum questionário disponível" : "Sem questionário"} searchPlaceholder="Buscar questionário..." />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2 col-span-1">
              <Label className="text-xs">Data</Label>
              <Input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
            </div>
            <div className="grid gap-2 col-span-1">
              <Label className="text-xs">Hora Início</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="grid gap-2 col-span-1">
              <Label className="text-xs">Duração (min)</Label>
              <Input type="number" step={15} min={15} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Orientação</Label>
            <Textarea value={orientation} onChange={e => setOrientation(e.target.value)} rows={3} placeholder="Descreva o serviço..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Criar no Auvo
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
