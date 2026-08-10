import { minutesToClock, clockToMinutes } from "@/lib/auvoDuration";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (taskId: string | null) => void;
  /** Data pré-selecionada (linha/coluna da escala) */
  initialDate?: string | null;
  /** Técnico dono da linha clicada (userID do Auvo) */
  initialUserAuvoId?: string | null;
  initialUserNome?: string | null;
}

const invokeAuvo = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("auvo-task-update", { body });
  if (error) throw error;
  return (data?.data || []) as any[];
};

export default function CriarTarefaGeralDialog({
  open, onOpenChange, onSuccess, initialDate, initialUserAuvoId, initialUserNome,
}: Props) {
  const [taskTypeId, setTaskTypeId] = useState("");
  const [idUserTo, setIdUserTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [questionnaireId, setQuestionnaireId] = useState("");
  const [dateISO, setDateISO] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("08:00");
  const [durationMinutes, setDurationMinutes] = useState(240);
  const [priority, setPriority] = useState("1");
  const [checkinType, setCheckinType] = useState("1");
  const [orientation, setOrientation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pré-preenche com a célula clicada (dia + técnico dono da linha)
  useEffect(() => {
    if (!open) return;
    if (initialDate) setDateISO(initialDate);
    if (initialUserAuvoId) setIdUserTo(String(initialUserAuvoId));
  }, [open, initialDate, initialUserAuvoId]);

  useEffect(() => {
    if (!open) {
      setCustomerId(""); setEquipmentIds([]); setQuestionnaireId("");
      setOrientation(""); setTaskTypeId(""); setPriority("1"); setCheckinType("1");
      setStartTime("08:00");
      setDurationMinutes(240);
    }
  }, [open]);

  const { data: customers = [], isLoading: loadingCustomers, isError: errCustomers } = useQuery({
    queryKey: ["auvo-customers"],
    enabled: open,
    staleTime: 60 * 60 * 1000,
    queryFn: () => invokeAuvo({ action: "list-customers", forceRefresh: false }),
  });

  const { data: equipments = [], isLoading: loadingEquipments } = useQuery({
    queryKey: ["auvo-customer-equipments", customerId],
    enabled: open && !!customerId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => invokeAuvo({ action: "list-customer-equipments", customerId }),
  });

  const { data: taskTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ["auvo-task-types"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: () => invokeAuvo({ action: "list-task-types" }),
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["auvo-users"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: () => invokeAuvo({ action: "list-users" }),
  });

  const { data: questionnaires = [], isLoading: loadingQuestionnaires } = useQuery({
    queryKey: ["auvo-questionnaires"],
    enabled: open,
    staleTime: 30 * 60 * 1000,
    queryFn: () => invokeAuvo({ action: "list-questionnaires" }),
  });

  const sortOpts = (arr: { value: string; label: string }[]) =>
    arr.filter(o => o.value).sort((a, b) => a.label.localeCompare(b.label));

  const customerOptions = useMemo(() => sortOpts(customers.map((c: any) => ({
    value: String(c.id ?? c.customerId ?? ""),
    label: String(c.description ?? c.name ?? c.customerDescription ?? `Cliente ${c.id ?? ""}`),
  }))), [customers]);

  const equipmentOptions = useMemo(() => sortOpts(equipments.map((e: any) => ({
    value: String(e.id ?? e.equipmentId ?? ""),
    label: `${e.name ?? e.description ?? "Equipamento"}${e.identifier ? ` (${e.identifier})` : ""}`,
  }))), [equipments]);

  const taskTypeOptions = useMemo(() => sortOpts(taskTypes.map((t: any) => ({
    value: String(t.id ?? t.taskTypeId ?? ""),
    label: String(t.description ?? t.name ?? `Tipo ${t.id ?? ""}`),
  }))), [taskTypes]);

  const userOptions = useMemo(() => sortOpts(users.map((u: any) => ({
    value: String(u.userID ?? u.userId ?? u.id ?? ""),
    label: String(u.name ?? u.userName ?? `Usuário ${u.userID ?? ""}`),
  }))), [users]);

  const questionnaireOptions = useMemo(() => sortOpts(questionnaires.map((q: any) => ({
    value: String(q.id ?? q.questionnaireId ?? ""),
    label: String(q.description ?? q.name ?? `Questionário ${q.id ?? ""}`),
  }))), [questionnaires]);

  const addEquipment = (v: string) => {
    if (!v) return;
    setEquipmentIds(prev => (prev.includes(v) ? prev : [...prev, v]));
  };

  const handleSubmit = async () => {
    if (!customerId || !idUserTo || !taskTypeId || !dateISO || !startTime) {
      toast.error("Preencha cliente, tipo de tarefa, técnico, data e hora.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "create-task",
          customerId, idUserTo, taskTypeId, dateISO, startTime,
          durationMinutes, orientation, questionnaireId: questionnaireId || null,
          equipmentIds, priority: Number(priority), checkinType: Number(checkinType),
        },
      });
      if (error) throw error;
      if (data?.success) {
        const tid = data.taskId ? String(data.taskId) : null;
        toast.success(tid ? `Tarefa criada no Auvo (#${tid})` : "Tarefa criada no Auvo", {
          action: tid ? {
            label: "Abrir",
            onClick: () => window.open(`https://app2.auvo.com.br/gerenciarTarefas/tarefa/${tid}`, "_blank"),
          } : undefined,
        });
        if (data?.warning) toast.warning(data.warning);
        onSuccess?.(tid);
        // Após criar a tarefa, invalidamos os caches para forçar a atualização da escala
        const qc = (window as any).queryClient;
        if (qc) {
          qc.invalidateQueries({ queryKey: ["agenda_semana"] });
          qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
        }
        onOpenChange(false);
      } else {
        toast.error("Auvo recusou: " + (data?.error || "erro desconhecido"));
      }
    } catch (e: any) {
      toast.error("Falha na requisição: " + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Nova Tarefa Auvo</DialogTitle>
          <DialogDescription>
            {initialUserNome
              ? `Responsável: ${initialUserNome}${initialDate ? ` · ${initialDate.split("-").reverse().join("/")}` : ""}`
              : "Abra uma tarefa do zero já sincronizada com o Auvo."}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          <div className="grid gap-2">
            <Label className="text-xs">Cliente (Auvo) *</Label>
            <SearchableSelect
              options={customerOptions}
              value={customerId}
              onValueChange={(v) => { setCustomerId(v as string); setEquipmentIds([]); }}
              placeholder={loadingCustomers ? "Carregando clientes..." : errCustomers ? "Erro ao carregar clientes" : "Selecione o cliente"}
              searchPlaceholder="Buscar cliente..."
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-xs">Equipamentos do cliente</Label>
            <SearchableSelect
              options={equipmentOptions.filter(o => !equipmentIds.includes(o.value))}
              value=""
              onValueChange={(v) => addEquipment(v as string)}
              placeholder={
                !customerId ? "Selecione o cliente primeiro"
                  : loadingEquipments ? "Carregando equipamentos..."
                  : equipmentOptions.length === 0 ? "Nenhum equipamento neste cliente"
                  : "Adicionar equipamento"
              }
              searchPlaceholder="Buscar equipamento..."
            />
            {equipmentIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {equipmentIds.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {equipmentOptions.find(o => o.value === id)?.label ?? id}
                    <button
                      type="button"
                      aria-label="Remover equipamento"
                      onClick={() => setEquipmentIds(prev => prev.filter(x => x !== id))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-xs">Tipo de tarefa *</Label>
              <SearchableSelect
                options={taskTypeOptions}
                value={taskTypeId}
                onValueChange={(v) => setTaskTypeId(v as string)}
                placeholder={loadingTypes ? "Carregando..." : "Selecione o tipo"}
                searchPlaceholder="Buscar tipo..."
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Responsável (técnico) *</Label>
              <SearchableSelect
                options={userOptions}
                value={idUserTo}
                onValueChange={(v) => setIdUserTo(v as string)}
                placeholder={loadingUsers ? "Carregando..." : "Selecione o técnico"}
                searchPlaceholder="Buscar técnico..."
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs">Questionário</Label>
            <SearchableSelect
              options={questionnaireOptions}
              value={questionnaireId}
              onValueChange={(v) => setQuestionnaireId(v as string)}
              placeholder={
                loadingQuestionnaires ? "Carregando..."
                  : questionnaireOptions.length === 0 ? "Nenhum questionário disponível"
                  : "Sem questionário"
              }
              searchPlaceholder="Buscar questionário..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label className="text-xs">Data *</Label>
              <Input type="date" value={dateISO} onChange={e => setDateISO(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Hora início *</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Duração (HH:mm) *</Label>
              <Input
                type="time"
                step={300}
                value={minutesToClock(durationMinutes)}
                onChange={e => setDurationMinutes(clockToMinutes(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-xs">Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Baixa</SelectItem>
                  <SelectItem value="2">Média</SelectItem>
                  <SelectItem value="3">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Tipo de check-in</Label>
              <Select value={checkinType} onValueChange={setCheckinType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Manual</SelectItem>
                  <SelectItem value="2">Automático</SelectItem>
                  <SelectItem value="3">Usuário</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs">Detalhamento da atividade</Label>
            <Textarea
              value={orientation}
              onChange={e => setOrientation(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Descreva o serviço a ser executado..."
            />
            <span className="text-[10px] text-muted-foreground">{orientation.length}/500</span>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Criar no Auvo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
