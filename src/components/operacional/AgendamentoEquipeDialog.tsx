import { minutesToClock, clockToMinutes } from "@/lib/auvoDuration";
import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useColaboradores } from "@/hooks/rh/useRh";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAgendaVeiculos,
  useSaveAgendamento,
  useDeleteAgendamento,
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery } from "@tanstack/react-query";

interface AgendamentoEquipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
  initialColaboradorId?: string | null;
  agendamento?: AgendaAgendamento | null;
}

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico") || txt.includes("auxiliar");
};

export default function AgendamentoEquipeDialog({
  open,
  onOpenChange,
  initialDate,
  initialColaboradorId,
  agendamento,
}: AgendamentoEquipeDialogProps) {
  const { data: colaboradores = [], isLoading } = useColaboradores();
  const { data: veiculos = [] } = useAgendaVeiculos();
  const save = useSaveAgendamento();
  const del = useDeleteAgendamento();

  const [data, setData] = useState("");
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [colaboradorId, setColaboradorId] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [cliente, setCliente] = useState("");
  const [descricao, setDescricao] = useState("");
  const [questionnaireId, setQuestionnaireId] = useState("");

  const { data: questionnaires = [] } = useQuery({
    queryKey: ["auvo-questionnaires"],
    enabled: open && !!agendamento?.auvo_task_id,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-questionnaires" },
      });
      if (error) throw error;
      return (data?.data || []) as any[];
    },
  });

  const questionnaireOptions = useMemo(() => {
    return questionnaires
      .map((q: any) => ({
        value: String(q.id ?? q.questionnaireId ?? ""),
        label: String(q.description ?? q.name ?? `Questionário ${q.id ?? "?"}`),
      }))
      .filter((o) => o.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [questionnaires]);

  // Questionário atualmente vinculado à tarefa no Auvo
  const { data: currentQuestionnaireId, isLoading: loadingCurrentQ } = useQuery({
    queryKey: ["auvo-task-questionnaire", agendamento?.auvo_task_id],
    enabled: open && !!agendamento?.auvo_task_id,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "get", taskId: agendamento?.auvo_task_id },
      });
      if (error) throw error;
      const task = data?.data?.result ?? data?.data ?? {};
      const qid =
        task?.questionnaireId ??
        task?.questionnaire?.id ??
        (Array.isArray(task?.questionnaires) ? task.questionnaires[0]?.id : null);
      return qid ? String(qid) : "";
    },
  });

  useEffect(() => {
    if (currentQuestionnaireId) setQuestionnaireId(currentQuestionnaireId);
  }, [currentQuestionnaireId]);

  const currentQuestionnaireLabel = useMemo(() => {
    if (!currentQuestionnaireId) return null;
    return (
      questionnaireOptions.find((o) => o.value === currentQuestionnaireId)?.label ??
      `Questionário ${currentQuestionnaireId}`
    );
  }, [currentQuestionnaireId, questionnaireOptions]);

  useEffect(() => {
    if (!open) return;
    if (agendamento) {
      setData(agendamento.data);
      setHoraInicio(agendamento.hora_inicio.slice(0, 5));
      setDuracaoMin(
        Math.max(
          15,
          clockToMinutes(agendamento.hora_fim.slice(0, 5)) - clockToMinutes(agendamento.hora_inicio.slice(0, 5)),
        ),
      );
      setColaboradorId(agendamento.colaborador_id ?? "");
      setVeiculoId(agendamento.veiculo_id ?? "");
      setCliente(agendamento.cliente);
      setDescricao(agendamento.descricao ?? "");
      setQuestionnaireId(""); // Reset or fetch current if needed, but Auvo API for tasks doesn't always return current QID easily in list
    } else {
      setData(initialDate ? format(initialDate, "yyyy-MM-dd") : "");
      setHoraInicio("08:00");
      setDuracaoMin(60);
      setColaboradorId(initialColaboradorId || "");
      setVeiculoId("");
      setCliente("");
      setDescricao("");
    }
  }, [open, agendamento, initialDate]);

  const tecnicos = colaboradores.filter((c) => c.ativo && isTecnico(c));
  const lista = tecnicos.length > 0 ? tecnicos : colaboradores.filter((c) => c.ativo);

  const handleSave = async () => {
    const nome = lista.find((c) => c.id === colaboradorId)?.nome ?? "";
    const colab = lista.find((c) => c.id === colaboradorId);
    if (!data || !colaboradorId || !cliente.trim()) return;

    try {
      // 1. Se for AUVO, atualiza data/técnico/orientação no Auvo
      if (agendamento?.auvo_task_id && agendamento.origem === "AUVO") {
        const patches = [];
        
        // Data e Hora (Início e Fim)
        const horaFimCalc = minutesToClock(clockToMinutes(horaInicio) + duracaoMin);
        if (
          data !== agendamento.data ||
          horaInicio !== agendamento.hora_inicio.slice(0, 5) ||
          horaFimCalc !== agendamento.hora_fim.slice(0, 5)
        ) {
          patches.push({ op: "replace", path: "taskDate", value: `${data}T${horaInicio}:00` });
          // A API v2 do Auvo não aceita taskEndDate/estimatedDuration na escrita.
          // A duração é definida pelo Tipo de Tarefa no Auvo; aqui ela é apenas local (agenda/PDF).
        }
        
        // Técnico
        if (colaboradorId !== agendamento.colaborador_id && colab?.auvo_user_id) {
          patches.push({ op: "replace", path: "idUserTo", value: String(colab.auvo_user_id) });
        }

        // Descrição (Orientação no Auvo)
        if (descricao !== (agendamento.descricao || "")) {
          patches.push({ op: "replace", path: "orientation", value: descricao });
        }

        // Questionário
        if (questionnaireId) {
          patches.push({ op: "replace", path: "questionnaireId", value: Number(questionnaireId) });
        }

        if (patches.length > 0) {
          const { data: res, error } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "edit", taskId: agendamento.auvo_task_id, patches }
          });
          if (error || res?.status >= 400) throw new Error(res?.data?.message || "Erro ao sincronizar com Auvo");
        }
      }

      // 2. Salva localmente
      await save.mutateAsync({
        id: agendamento?.id,
        data,
        hora_inicio: horaInicio.includes(":") ? (horaInicio.length === 5 ? `${horaInicio}:00` : horaInicio) : "08:00:00",
        hora_fim: `${minutesToClock(clockToMinutes(horaInicio) + duracaoMin)}:00`,
        colaborador_id: colaboradorId,
        colaborador_nome: nome,
        veiculo_id: veiculoId || null,
        cliente: cliente.trim(),
        descricao: descricao.trim() || null,
        // Preserva os campos técnicos se for edição
        auvo_task_id: agendamento?.auvo_task_id,
        origem: agendamento?.origem,
        gc_os_codigo: agendamento?.gc_os_codigo,
        gc_orcamento_codigo: agendamento?.gc_orcamento_codigo,
      });

      onOpenChange(false);
    } catch (err: any) {
      console.error("Erro ao salvar:", err);
      toast.error(err.message || "Erro ao salvar agendamento");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col p-0">
        <div className="overflow-y-auto p-6 flex-1">
        <DialogHeader>
          <DialogTitle>{agendamento ? "Editar Agendamento" : "Adicionar Novo Agendamento"}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start">Hora Início</Label>
              <Input id="start" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">Duração (HH:mm)</Label>
              <Input
                id="end"
                type="time"
                step={300}
                value={minutesToClock(duracaoMin)}
                onChange={(e) => setDuracaoMin(clockToMinutes(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tech">Técnico</Label>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={colaboradorId} onValueChange={setColaboradorId}>
                <SelectTrigger id="tech">
                  <SelectValue placeholder="Selecione um técnico" />
                </SelectTrigger>
                <SelectContent>
                  {lista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                  {lista.length === 0 && (
                    <SelectItem value="none" disabled>
                      Nenhum técnico ativo encontrado
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vehicle">Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId}>
              <SelectTrigger id="vehicle">
                <SelectValue placeholder="Selecione um veículo" />
              </SelectTrigger>
              <SelectContent>
                {veiculos.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nome}
                    {v.placa ? ` - ${v.placa}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client">Cliente</Label>
            <Input
              id="client"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome do cliente"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Descrição do serviço</Label>
            <Textarea 
              id="desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes do serviço"
              className="resize-none"
            />
          </div>

          {agendamento?.auvo_task_id && (
            <div className="space-y-2">
              <Label className="text-xs text-primary font-bold">Vincular/Alterar Questionário Auvo</Label>
              <div className="text-[11px]">
                {loadingCurrentQ ? (
                  <span className="text-muted-foreground">Verificando questionário vinculado...</span>
                ) : currentQuestionnaireLabel ? (
                  <span className="text-emerald-600 font-medium">
                    Já vinculado: {currentQuestionnaireLabel}
                  </span>
                ) : (
                  <span className="text-amber-600 font-medium">Nenhum questionário vinculado</span>
                )}
              </div>
              <SearchableSelect
                options={questionnaireOptions}
                value={questionnaireId}
                onValueChange={setQuestionnaireId}
                placeholder="Selecione um questionário para aplicar"
                searchPlaceholder="Buscar questionário..."
              />
              <p className="text-[10px] text-muted-foreground italic">
                Nota: Isso aplicará o questionário à tarefa no Auvo ao salvar.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {agendamento ? (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={async () => {
                await del.mutateAsync(agendamento.id);
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending || !data || !colaboradorId || !cliente.trim()}>
              {save.isPending ? "Salvando..." : "Salvar Agendamento"}
            </Button>
          </div>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
