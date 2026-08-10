import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ExternalLink, MapPin, Navigation, ClipboardList, Package, Edit, FileText, RefreshCw, ArrowRightLeft } from "lucide-react";
import { RECONCILIATION_OS_SITUATIONS } from "@/lib/osOpenStatuses";
import { toast } from "sonner";

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

interface Props {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
}

export default function TarefaAuvoDetalheDialog({ taskId, onOpenChange, onEdit }: Props) {
  const qc = useQueryClient();
  const [novaSituacao, setNovaSituacao] = useState("");
  const { data: tarefa, isLoading, isError, refetch } = useQuery({
    queryKey: ["tarefa_central_detalhe", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .eq("auvo_task_id", taskId as string)
        .order("atualizado_em", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as Record<string, any> | null;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) return;
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "sync-local", taskId: Number(taskId) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
      toast.success("Tarefa sincronizada com sucesso!");
    },
    onError: (err) => {
      console.error("Erro ao sincronizar tarefa:", err);
      toast.error("Erro ao sincronizar dados da tarefa.");
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (situacaoId: string) => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_os",
          gc_os_id: tarefa?.gc_os_id,
          gc_os_codigo: tarefa?.gc_os_codigo,
          auvo_task_id: taskId,
          situacao_id_antes: situacaoId,
        },
      });
      if (error) throw error;
      if (!(data as any)?.success) {
        throw new Error(
          JSON.stringify((data as any)?.body || (data as any)?.error || data),
        );
      }
      return data as any;
    },
    onSuccess: (data, situacaoId) => {
      const label =
        RECONCILIATION_OS_SITUATIONS.find((s) => s.id === situacaoId)?.label || situacaoId;
      toast.success(`OS ${tarefa?.gc_os_codigo || ""} → ${label}`);
      if (data?.mirror_error) {
        toast.warning(
          "A OS foi alterada no GestãoClick, mas o espelho local será corrigido na próxima sincronização.",
        );
      }
      setNovaSituacao("");
      refetch();
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (err: any) => {
      toast.error(`Não foi possível alterar a situação: ${err?.message || err}`);
    },
  });

  // Fallback de vínculo: quando a tarefa não tem OS/orçamento gravados,
  // extrai a referência do texto de orientação (ex.: "OS ref. Orçamento #5835")
  const refOrcamento = (() => {
    const txt = String(tarefa?.orientacao || "");
    const m = txt.match(/or[cç]amento\s*#?\s*(\d{3,})/i);
    return m ? m[1] : null;
  })();
  const refOs = (() => {
    const txt = String(tarefa?.orientacao || "");
    const m = txt.match(/\bOS\s*#?\s*(\d{3,})/i);
    return m ? m[1] : null;
  })();
  const precisaVinculo = !!tarefa && !tarefa.gc_os_codigo && !!(refOrcamento || refOs);

  const { data: vinculo } = useQuery({
    queryKey: ["tarefa_vinculo_os", refOrcamento, refOs],
    enabled: precisaVinculo,
    queryFn: async () => {
      let q = supabase
        .from("tarefas_central")
        .select(
          "auvo_task_id,gc_os_id,gc_os_codigo,gc_os_situacao,gc_os_cor_situacao,gc_os_valor_total,gc_os_link,gc_orc_link,gc_orcamento_codigo,gc_os_cliente",
        )
        .not("gc_os_codigo", "is", null)
        .limit(1);
      q = refOrcamento
        ? q.eq("gc_orcamento_codigo", refOrcamento)
        : q.eq("gc_os_codigo", refOs as string);
      const { data, error } = await q;
      if (error) throw error;
      return (data?.[0] ?? null) as Record<string, any> | null;
    },
  });

  const os = {
    id: tarefa?.gc_os_id || vinculo?.gc_os_id || null,
    codigo: tarefa?.gc_os_codigo || vinculo?.gc_os_codigo || null,
    situacao: tarefa?.gc_os_situacao || vinculo?.gc_os_situacao || null,
    cor: tarefa?.gc_os_cor_situacao || vinculo?.gc_os_cor_situacao || null,
    valor: Number(tarefa?.gc_os_valor_total || vinculo?.gc_os_valor_total || 0),
    link: tarefa?.gc_os_link || vinculo?.gc_os_link || null,
    orcLink: tarefa?.gc_orc_link || vinculo?.gc_orc_link || null,
    orcamento: tarefa?.gc_orcamento_codigo || vinculo?.gc_orcamento_codigo || refOrcamento || null,
    cliente: tarefa?.gc_os_cliente || vinculo?.gc_os_cliente || null,
    herdado: !tarefa?.gc_os_codigo && !!vinculo?.gc_os_codigo,
    tarefaOrigem: vinculo?.auvo_task_id || null,
  };

  const respostas: any[] = Array.isArray(tarefa?.questionario_respostas)
    ? (tarefa!.questionario_respostas as any[])
    : [];
  const textos = respostas.filter((r) => r?.reply && !String(r.reply).startsWith("http"));
  const fotos = respostas.filter((r) => r?.reply && String(r.reply).startsWith("http"));

  return (
    <Dialog open={!!taskId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <div className="overflow-y-auto p-6 flex-1">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{tarefa?.cliente || "Tarefa Auvo"}</span>
            {tarefa?.gc_os_codigo && <Badge variant="outline">OS {tarefa.gc_os_codigo}</Badge>}
            {tarefa?.gc_os_situacao && (
              <Badge className="text-xs" style={{ backgroundColor: tarefa.gc_os_cor_situacao || undefined }}>
                {tarefa.gc_os_situacao}
              </Badge>
            )}
          </DialogTitle>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Tarefa Auvo #{taskId}</p>
            {onEdit && (
              <Button size="sm" variant="ghost" className="gap-2 h-7" onClick={onEdit}>
                <Edit className="h-3.5 w-3.5" /> Editar
              </Button>
            )}
          </div>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">Não foi possível carregar os dados da tarefa.</p>
        )}

        {!isLoading && !isError && !tarefa && (
          <div className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Tarefa ainda não sincronizada na base.
            </p>
            <Button 
              onClick={() => syncMutation.mutate()} 
              disabled={syncMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />
              Sincronizar dados do Auvo agora
            </Button>
          </div>
        )}

        {tarefa && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Cliente (Auvo)</span>
                <p className="font-medium">{tarefa.cliente || "—"}</p>
                {tarefa.gc_os_cliente && (
                  <p className="text-xs text-muted-foreground">GC: {tarefa.gc_os_cliente}</p>
                )}
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Técnico</span>
                <p className="font-medium">{tarefa.tecnico || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Data da tarefa</span>
                <p className="font-medium">
                  {tarefa.data_tarefa
                    ? new Date(`${tarefa.data_tarefa}T12:00:00`).toLocaleDateString("pt-BR")
                    : "—"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Valor total OS</span>
                <p className="font-semibold">{formatCurrency(Number(tarefa.gc_os_valor_total) || 0)}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Status Auvo</span>
                <p className="font-medium">{tarefa.status_auvo || "—"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">Check-in / Check-out</span>
                <div className="flex items-center gap-2 font-medium">
                  <div className="flex items-center gap-1">
                    {tarefa.check_in ? "✅" : "❌"} In{tarefa.hora_inicio ? ` ${tarefa.hora_inicio}` : ""}
                  </div>
                  <span>→</span>
                  <div className="flex items-center gap-1">
                    {tarefa.check_out ? "✅" : "❌"} Out{tarefa.hora_fim ? ` ${tarefa.hora_fim}` : ""}
                  </div>
                </div>
                {Number(tarefa.duracao_decimal) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Duração: {Number(tarefa.duracao_decimal).toFixed(1)}h
                  </p>
                )}
                {onEdit && (
                  <Button 
                    variant="link" 
                    className="h-auto p-0 text-[10px] text-primary justify-start"
                    onClick={onEdit}
                  >
                    Alterar horário/duração
                  </Button>
                )}
              </div>
              {tarefa.equipamento_nome && (
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs">Equipamento</span>
                  <p className="font-medium">
                    {tarefa.equipamento_nome}
                    {tarefa.equipamento_id_serie ? ` — ${tarefa.equipamento_id_serie}` : ""}
                  </p>
                </div>
              )}
            </div>

            {tarefa.gc_os_id && (
              <div className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Situação da OS no GestãoClick</span>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Situação atual:{" "}
                    <Badge
                      variant="outline"
                      className="text-[10px] ml-1"
                      style={{
                        borderColor: tarefa.gc_os_cor_situacao || undefined,
                        color: tarefa.gc_os_cor_situacao || undefined,
                      }}
                    >
                      {tarefa.gc_os_situacao || "—"}
                    </Badge>
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Select
                      value={novaSituacao}
                      onValueChange={setNovaSituacao}
                      disabled={statusMutation.isPending}
                    >
                      <SelectTrigger className="h-9 text-xs flex-1">
                        <SelectValue placeholder="Selecione a nova situação..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {RECONCILIATION_OS_SITUATIONS.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="gap-2"
                      disabled={!novaSituacao || statusMutation.isPending}
                      onClick={() => statusMutation.mutate(novaSituacao)}
                    >
                      {statusMutation.isPending ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      )}
                      Alterar situação
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    A alteração é aplicada diretamente na OS {tarefa.gc_os_codigo || ""} do GestãoClick.
                  </p>
                </div>
              </div>
            )}

            {tarefa.endereco && (
              <div className="flex items-start gap-2 bg-muted/50 rounded-md p-3">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm flex-1">{tarefa.endereco}</p>
                <Button size="sm" variant="outline" className="shrink-0 gap-1 h-7 text-xs" asChild>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tarefa.endereco)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation className="h-3 w-3" /> Maps
                  </a>
                </Button>
              </div>
            )}

            {tarefa.orientacao && (
              <div className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Orientação / Peças</span>
                </div>
                <pre className="p-3 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                  {tarefa.orientacao}
                </pre>
              </div>
            )}

            {(textos.length > 0 || fotos.length > 0) && (
              <div className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Questionário</span>
                </div>
                <div className="p-3 space-y-2">
                  {textos.map((r, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-muted-foreground text-xs">{r.question}</span>
                      <p className="font-medium">{r.reply}</p>
                    </div>
                  ))}
                  {fotos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      {fotos.map((r, i) => (
                        <a key={i} href={r.reply} target="_blank" rel="noopener noreferrer">
                          <img
                            src={r.reply}
                            alt={r.question || "Foto da tarefa"}
                            loading="lazy"
                            className="rounded-md border object-cover w-full h-24"
                          />
                        </a>
                      ))}
                    </div>
                  )}
              {tarefa && (
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => syncMutation.mutate()} 
                  disabled={syncMutation.isPending}
                  className="gap-1 text-xs text-muted-foreground ml-auto"
                >
                  <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
                  Atualizar dados
                </Button>
              )}
            </div>
          </div>
        )}

            <div className="flex flex-wrap gap-2">
              {taskId && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir no Auvo
                  </a>
                </Button>
              )}
              {taskId && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1"
                  >
                    <FileText className="h-3.5 w-3.5" /> Relatório PDF
                  </a>
                </Button>
              )}
              {tarefa.gc_os_link && (
                <Button size="sm" variant="outline" asChild>
                  <a href={tarefa.gc_os_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                    <ExternalLink className="h-3.5 w-3.5" /> OS no GC
                  </a>
                </Button>
              )}
              {tarefa.gc_orc_link && (
                <Button size="sm" variant="outline" asChild>
                  <a href={tarefa.gc_orc_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                    <ExternalLink className="h-3.5 w-3.5" /> Orçamento no GC
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
