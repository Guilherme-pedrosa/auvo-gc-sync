import { minutesToClock, clockToMinutes } from "@/lib/auvoDuration";
import { useEffect, useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
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
import { Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useQuery } from "@tanstack/react-query";
import AgendaTagsEditor from "@/components/operacional/AgendaTagsEditor";
import { areNamesDivergent } from "@/lib/clientMatching";

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
  const [previsaoDetalhes, setPrevisaoDetalhes] = useState("");
  const [gcDocEndpoint, setGcDocEndpoint] = useState<string | null>(null);


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

  const { data: gcDoc, isLoading: gcDocLoading } = useQuery({
    queryKey: ["previsao_gc_doc_detalhe", gcDocEndpoint],
    enabled: !!gcDocEndpoint,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body: { endpoint: gcDocEndpoint, method: "GET" },
      });
      if (error) return null;
      return (data?.data?.data ?? data?.data ?? null) as Record<string, any> | null;
    },
  });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

  const gcProdutos: any[] = (gcDoc?.produtos || []).map((p: any) => p?.produto || p);
  const gcServicos: any[] = (gcDoc?.servicos || []).map((s: any) => s?.servico || s);
  const gcValorTotal = Number(gcDoc?.valor_total || 0);


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
        Number(agendamento.duracao_planejada_minutos) > 0
          ? Number(agendamento.duracao_planejada_minutos)
          : Math.max(
            15,
            clockToMinutes(agendamento.hora_fim.slice(0, 5)) - clockToMinutes(agendamento.hora_inicio.slice(0, 5)),
          ),
      );
      setColaboradorId(agendamento.colaborador_id ?? "");
      setVeiculoId(agendamento.veiculo_id ?? "");
      setCliente(agendamento.cliente);
      setDescricao(agendamento.descricao ?? "");
      setQuestionnaireId(""); 
      setPrevisaoDetalhes(agendamento.previsao_detalhes ?? "");

      // O agendamento da escala pode vir de previsões manuais ou de tarefas reais sincronizadas
      // Precisamos garantir que os IDs do GestãoClick estejam disponíveis para o fetch financeiro
      const osId = agendamento.gc_os_id;
      const orcamentoId = agendamento.gc_orcamento_id;
      
      if (osId) {
        setGcDocEndpoint(`/api/ordens_servicos/${osId}`);
      } else if (orcamentoId) {
        setGcDocEndpoint(`/api/orcamentos/${orcamentoId}`);
      } else {
        setGcDocEndpoint(null);
      }



    } else {
      setData(initialDate ? format(initialDate, "yyyy-MM-dd") : "");
      setHoraInicio("08:00");
      setDuracaoMin(60);
      setColaboradorId(initialColaboradorId || "");
      setVeiculoId("");
      setCliente("");
      setDescricao("");
      setPrevisaoDetalhes("");
      setGcDocEndpoint(null);

    }
  }, [open, agendamento, initialDate]);

  const tecnicos = colaboradores.filter((c) => c.ativo && isTecnico(c));
  const lista = tecnicos.length > 0 ? tecnicos : colaboradores.filter((c) => c.ativo);

  const handleSave = async () => {
    const nome = lista.find((c) => c.id === colaboradorId)?.nome ?? "";
    const colab = lista.find((c) => c.id === colaboradorId);
    if (!data || !colaboradorId || !cliente.trim()) return;

    try {
      // 1. Se for AUVO, atualiza primeiro agenda/duração e depois os metadados.
      if (agendamento?.auvo_task_id && agendamento.origem === "AUVO") {
        const originalStart = clockToMinutes(agendamento.hora_inicio.slice(0, 5));
        const originalEnd = clockToMinutes(agendamento.hora_fim.slice(0, 5));
        const originalDuration = Number(agendamento.duracao_planejada_minutos) > 0
          ? Number(agendamento.duracao_planejada_minutos)
          : Math.max(15, originalEnd > originalStart
            ? originalEnd - originalStart
            : originalEnd + 24 * 60 - originalStart);
        const technicianChanged = colaboradorId !== agendamento.colaborador_id;
        const scheduleChanged = data !== agendamento.data
          || horaInicio !== agendamento.hora_inicio.slice(0, 5)
          || duracaoMin !== originalDuration
          || technicianChanged;

        if (technicianChanged && !colab?.auvo_user_id) {
          throw new Error("O colaborador selecionado não possui vínculo de usuário com o Auvo.");
        }

        if (scheduleChanged) {
          const { data: scheduleResult, error: scheduleError } = await supabase.functions.invoke("auvo-task-update", {
            body: {
              action: "edit-schedule",
              taskId: agendamento.auvo_task_id,
              taskDate: `${data}T${horaInicio}:00`,
              durationMinutes: duracaoMin,
              ...(technicianChanged ? { idUserTo: Number(colab?.auvo_user_id) } : {}),
            },
          });
          if (scheduleError || scheduleResult?.success === false || scheduleResult?.status >= 400) {
            throw new Error(scheduleResult?.data?.message || scheduleResult?.error || "Erro ao atualizar agenda no Auvo");
          }
          if (scheduleResult?.warning) toast.warning(scheduleResult.warning);
        }

        const patches = [];
        if (descricao !== (agendamento.descricao || "")) {
          patches.push({ op: "replace", path: "orientation", value: descricao });
        }

        if (questionnaireId && questionnaireId !== currentQuestionnaireId) {
          patches.push({ op: "replace", path: "questionnaireId", value: Number(questionnaireId) });
        }

        if (patches.length > 0) {
          const { data: res, error } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "edit", taskId: agendamento.auvo_task_id, patches }
          });
          if (error || res?.status >= 400) throw new Error(res?.data?.message || res?.error || "Erro ao sincronizar com Auvo");
        }
      }

      // 2. Salva localmente
      await save.mutateAsync({
        id: agendamento?.id,
        data,
        hora_inicio: horaInicio.includes(":") ? (horaInicio.length === 5 ? `${horaInicio}:00` : horaInicio) : "08:00:00",
        hora_fim: `${minutesToClock(clockToMinutes(horaInicio) + duracaoMin)}:00`,
        duracao_planejada_minutos: duracaoMin,
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
        previsao_continuidade: agendamento?.previsao_continuidade,
        previsao_detalhes: previsaoDetalhes.trim() || null,
      });

      onOpenChange(false);
    } catch (err: any) {
      console.error("Erro ao salvar:", err);
      toast.error(err.message || (agendamento?.previsao_continuidade ? "Erro ao salvar previsão" : "Erro ao salvar agendamento"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col p-0">
        <div className="overflow-y-auto p-6 flex-1">
        <DialogHeader>
          <DialogTitle>
            {agendamento?.previsao_continuidade
              ? "Editar previsão"
              : agendamento
                ? "Editar agendamento"
                : "Adicionar novo agendamento"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 flex flex-col">
              <Label htmlFor="date">Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !data && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {data ? format(parseISO(data), "PPP", { locale: ptBR }) : <span>Selecione uma data</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={data ? parseISO(data) : undefined}
                    onSelect={(date) => date && setData(format(date, "yyyy-MM-dd"))}
                    initialFocus
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start">Hora Início</Label>
              <Input id="start" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">Duração planejada (HH:mm)</Label>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="client">Cliente</Label>
              {agendamento?.origem === "AUVO" && agendamento.cliente && areNamesDivergent(agendamento.cliente, cliente) && (
                <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600 h-5">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Divergente
                </Badge>
              )}
            </div>
            <Input
              id="client"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome do cliente"
              className={cn(
                agendamento?.origem === "AUVO" && agendamento.cliente && areNamesDivergent(agendamento.cliente, cliente) && "border-amber-400 focus-visible:ring-amber-400"
              )}
            />
            {agendamento?.origem === "AUVO" && agendamento.cliente && areNamesDivergent(agendamento.cliente, cliente) && (
              <p className="text-[10px] text-amber-600 font-medium">Original no Auvo: {agendamento.cliente}</p>
            )}
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

          {agendamento?.id && (
            <AgendaTagsEditor agendamentoId={agendamento.id} />
          )}

          {agendamento?.previsao_continuidade && (
            <div className="space-y-2 p-3 bg-primary/5 rounded-md border border-primary/20">
              <Label htmlFor="prev_det" className="text-xs font-bold text-primary">Detalhes da Previsão</Label>
              <Textarea
                id="prev_det"
                value={previsaoDetalhes}
                onChange={(e) => setPrevisaoDetalhes(e.target.value)}
                placeholder="Observações exclusivas desta previsão..."
                className="min-h-20 resize-y text-xs"
              />
            </div>
          )}

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

          {gcDocEndpoint && (
            <div className="space-y-3">
              <Label className="text-xs text-primary font-bold flex items-center gap-2">
                💰 Detalhes Financeiros {agendamento?.gc_os_codigo ? `(OS ${agendamento.gc_os_codigo})` : `(Orç. ${agendamento?.gc_orcamento_codigo})`}
              </Label>
              
              {gcDocLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : gcDoc ? (
                <div className="space-y-2 border rounded-md p-3 bg-muted/30">
                  {agendamento?.previsao_detalhes && (
                    <div className="bg-blue-50/50 border border-blue-200 rounded p-2 mb-2">
                      <p className="text-[10px] text-blue-700 font-medium">
                        {agendamento.previsao_detalhes}
                      </p>
                    </div>
                  )}
                  <div className="flex justify-between items-center border-b pb-2 mb-2">

                    <span className="text-xs font-bold uppercase">Total do Documento</span>
                    <span className="text-sm font-bold text-foreground">{formatCurrency(gcValorTotal)}</span>
                  </div>
                  
                  {gcProdutos.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                        📦 Produtos ({gcProdutos.length})
                      </span>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {gcProdutos.map((p, i) => (
                          <div key={i} className="flex justify-between text-[10px] bg-background/50 p-1.5 rounded border border-border/50">
                            <span className="truncate flex-1 pr-2">
                              {p.codigo_interno || p.codigo || "?"} · {p.nome_produto || p.descricao || p.nome || "?"}
                            </span>
                            <span className="font-medium whitespace-nowrap">
                              {p.quantidade || p.qtd || 1} x {formatCurrency(Number(p.valor_venda || p.valor_unitario || 0))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {gcServicos.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                        🛠️ Serviços ({gcServicos.length})
                      </span>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {gcServicos.map((s, i) => (
                          <div key={i} className="flex justify-between text-[10px] bg-background/50 p-1.5 rounded border border-border/50">
                            <span className="truncate flex-1 pr-2">
                              {s.nome_servico || s.descricao || s.nome || "?"}
                            </span>
                            <span className="font-medium whitespace-nowrap">
                              {formatCurrency(Number(s.valor_total || s.subtotal || 0))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!gcDocLoading && gcProdutos.length === 0 && gcServicos.length === 0 && (
                    <p className="text-[10px] text-center text-muted-foreground py-2 italic">
                      Nenhum item detalhado encontrado no GestãoClick.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                  Não foi possível carregar os detalhes financeiros deste documento.
                </p>
              )}
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
              {save.isPending ? "Salvando..." : agendamento?.previsao_continuidade ? "Salvar previsão" : "Salvar agendamento"}
            </Button>
          </div>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
