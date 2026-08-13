import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ExternalLink, MapPin, Navigation, ClipboardList, Package, Edit, FileText, RefreshCw, ArrowRightLeft, AlertTriangle } from "lucide-react";
import { RECONCILIATION_OS_SITUATIONS } from "@/lib/osOpenStatuses";
import { toast } from "sonner";
import AgendaTagsEditor from "@/components/operacional/AgendaTagsEditor";
import { useAgendaIdByTask } from "@/hooks/operacional/useAgendaTags";
import { areNamesDivergent } from "@/lib/clientMatching";

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
  const { data: agendaAgendamentoId } = useAgendaIdByTask(taskId);
  const { data: tarefa, isLoading, isError, refetch } = useQuery({
    queryKey: ["tarefa_central_detalhe", taskId],
    enabled: !!taskId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .eq("auvo_task_id", taskId as string)
        .order("atualizado_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      const latest = data?.[0] as Record<string, any> | undefined;
      if (!latest) return null;
      const linked = data?.find((row: Record<string, any>) =>
        row.gc_os_id || row.gc_os_codigo || row.gc_orcamento_id || row.gc_orcamento_codigo
      ) as Record<string, any> | undefined;
      if (!linked || linked === latest) return latest;

      const merged = { ...linked, ...latest };
      for (const [key, value] of Object.entries(linked)) {
        const preservesDocument = key.startsWith("gc_")
          || key === "os_realizada"
          || key === "orcamento_realizado";
        if (preservesDocument && (merged[key] == null || merged[key] === "")) {
          merged[key] = value;
        }
      }
      if (merged.gc_cliente_id) {
        const { data: rh } = await supabase
          .from("rh_clientes")
          .select("vinculo_status")
          .eq("gc_cliente_id", merged.gc_cliente_id)
          .maybeSingle();
        merged.vinculo_status = rh?.vinculo_status;
      }
      return merged;
    },
  });

  const { data: vinculoExecucao } = useQuery({
    queryKey: ["tarefa_vinculo_execucao_os", taskId],
    enabled: !!taskId && !tarefa?.gc_os_codigo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select(`
          auvo_task_id,gc_os_id,gc_os_codigo,gc_os_situacao,gc_os_cor_situacao,gc_os_valor_total,gc_os_link,gc_orc_link,gc_orcamento_codigo,gc_orcamento_id,gc_os_vendedor,gc_os_data,gc_os_cliente,gc_os_tarefa_exec
        `)
        .not("gc_os_codigo", "is", null)
        .not("gc_os_tarefa_exec", "is", null)
        .limit(5000);
      if (error) throw error;
      const found = (data ?? []).find((row) =>
        String(row.gc_os_tarefa_exec || "")
          .split("/")
          .map((id) => id.trim())
          .includes(String(taskId)),
      ) as Record<string, any> | null;

      if (found) {
        if (found.rh_clientes && Array.isArray(found.rh_clientes)) {
          found.vinculo_status = found.rh_clientes[0]?.vinculo_status;
        } else if (found.rh_clientes) {
          found.vinculo_status = (found.rh_clientes as any).vinculo_status;
        }
      }
      return found;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) return;
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "sync-local", taskId: Number(taskId) },
      });
      if (error) throw error;
      if ((data as any)?.success === false || Number((data as any)?.status || 200) >= 400) {
        throw new Error((data as any)?.error || "A tarefa não pôde ser sincronizada.");
      }
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tarefa_central_detalhe", taskId] });
      await refetch();
      await qc.invalidateQueries({ queryKey: ["agenda_semana"] });
      toast.success("Tarefa sincronizada com sucesso!");
    },
    onError: (err: any) => {
      console.error("Erro ao sincronizar tarefa:", err);
      toast.error(err?.message || "Erro ao sincronizar dados da tarefa.");
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (situacaoId: string) => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_os",
          gc_os_id: os.id,
          gc_os_codigo: os.codigo,
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
      toast.success(`OS ${os.codigo || ""} → ${label}`);
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
        .select(`
          auvo_task_id,gc_os_id,gc_os_codigo,gc_os_situacao,gc_os_cor_situacao,gc_os_valor_total,gc_os_link,gc_orc_link,gc_orcamento_codigo,gc_orcamento_id,gc_os_vendedor,gc_os_data,gc_os_cliente
        `)
        .not("gc_os_codigo", "is", null)
        .limit(1);
      q = refOrcamento
        ? q.eq("gc_orcamento_codigo", refOrcamento)
        : q.eq("gc_os_codigo", refOs as string);
      const { data, error } = await q;
      if (error) throw error;
      const found = (data?.[0] ?? null) as Record<string, any> | null;
      if (found) {
        if (found.rh_clientes && Array.isArray(found.rh_clientes)) {
          found.vinculo_status = found.rh_clientes[0]?.vinculo_status;
        } else if (found.rh_clientes) {
          found.vinculo_status = (found.rh_clientes as any).vinculo_status;
        }
      }
      return found;
    },
  });

  const vinculoOs = vinculoExecucao || vinculo;
  const os = {
    id: tarefa?.gc_os_id || vinculoOs?.gc_os_id || null,
    codigo: tarefa?.gc_os_codigo || vinculoOs?.gc_os_codigo || null,
    situacao: tarefa?.gc_os_situacao || vinculoOs?.gc_os_situacao || null,
    cor: tarefa?.gc_os_cor_situacao || vinculoOs?.gc_os_cor_situacao || null,
    valor: Number(tarefa?.gc_os_valor_total || vinculoOs?.gc_os_valor_total || 0),
    link: tarefa?.gc_os_link || vinculoOs?.gc_os_link || null,
    orcLink: tarefa?.gc_orc_link || vinculoOs?.gc_orc_link || null,
    orcamento: tarefa?.gc_orcamento_codigo || vinculoOs?.gc_orcamento_codigo || refOrcamento || null,
    cliente: tarefa?.gc_os_cliente || vinculoOs?.gc_os_cliente || null,
    herdado: !tarefa?.gc_os_codigo && !!vinculoOs?.gc_os_codigo,
    tarefaOrigem: vinculoOs?.auvo_task_id || null,
    vinculo_status: tarefa?.vinculo_status || vinculoOs?.vinculo_status || null,
  };

  const orcamentoId = tarefa?.gc_orcamento_id || vinculoOs?.gc_orcamento_id || null;
  const vendedorGc = tarefa?.gc_os_vendedor || vinculoOs?.gc_os_vendedor || tarefa?.gc_orc_vendedor || null;
  const dataAberturaGc = tarefa?.gc_os_data || vinculoOs?.gc_os_data || tarefa?.gc_orc_data || null;

  // Detalhe financeiro completo do documento no GestãoClick (mesmo padrão do Controle OS)
  const docEndpoint = os.id
    ? `/api/ordens_servicos/${os.id}`
    : orcamentoId
      ? `/api/orcamentos/${orcamentoId}`
      : null;

  const { data: gcDoc, isLoading: gcDocLoading } = useQuery({
    queryKey: ["tarefa_gc_doc_detalhe", docEndpoint],
    enabled: !!docEndpoint,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body: { endpoint: docEndpoint, method: "GET" },
      });
      if (error) return null;
      return (data?.data?.data ?? data?.data ?? null) as Record<string, any> | null;
    },
  });

  const gcProdutos: any[] = (gcDoc?.produtos || []).map((p: any) => p?.produto || p);
  const gcServicos: any[] = (gcDoc?.servicos || []).map((s: any) => s?.servico || s);
  const gcValorProdutos = Number(gcDoc?.valor_produtos || gcDoc?.total_produtos || 0);
  const gcValorServicos = Number(gcDoc?.valor_servicos || gcDoc?.total_servicos || 0);
  const gcValorDesconto = Number(gcDoc?.desconto || gcDoc?.valor_desconto || 0);
  const gcValorTotal = Number(gcDoc?.valor_total || os.valor || 0);

  const respostas: any[] = Array.isArray(tarefa?.questionario_respostas)
    ? (tarefa!.questionario_respostas as any[])
    : [];
  const textos = respostas.filter((r) => r?.reply && !String(r.reply).startsWith("http"));
  const fotos = respostas.filter((r) => r?.reply && String(r.reply).startsWith("http"));
  const auvoAdminUrl = taskId
    ? `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}#`
    : null;
  const publicTaskUrl = String((tarefa as any)?.auvo_task_url || "").trim();
  const auvoPdfUrl = publicTaskUrl.includes("/informacoes/tarefa/")
    ? publicTaskUrl.replace(/^https:\/\/app2\.auvo\.com\.br/i, "https://app.auvo.com.br")
    : null;

  return (
    <Dialog open={!!taskId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <div className="overflow-y-auto p-6 flex-1">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{tarefa?.cliente || "Tarefa Auvo"}</span>
            {os.codigo && <Badge variant="outline">OS {os.codigo}</Badge>}
            {os.orcamento && <Badge variant="outline">Orç #{os.orcamento}</Badge>}
            {os.situacao && (
              <Badge className="text-xs" style={{ backgroundColor: os.cor || undefined }}>
                {os.situacao}
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

        {agendaAgendamentoId && (
          <div className="mt-4">
            <AgendaTagsEditor agendamentoId={agendaAgendamentoId} />
          </div>
        )}

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
            {os.cliente && os.vinculo_status !== "vinculado" && areNamesDivergent(tarefa.cliente, os.cliente) && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 animate-pulse">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">Divergência de Cliente (Vínculo: {os.vinculo_status || "pendente"})</p>
                  <p className="text-xs">O nome no Auvo e no GestãoClick são significativamente diferentes.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Cliente (Auvo)</span>
                <p className="font-medium">{tarefa.cliente || "—"}</p>
                {os.cliente && (
                  <p className={cn(
                    "text-xs font-semibold mt-0.5",
                    os.vinculo_status !== "vinculado" && areNamesDivergent(tarefa.cliente, os.cliente) ? "text-amber-600" : "text-muted-foreground"
                  )}>
                    GC: {os.cliente}
                  </p>
                )}
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Vendedor GC</span>
                <p className="font-medium">{vendedorGc || gcDoc?.nome_vendedor || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">
                  {os.id ? "Valor Total OS" : "Valor Total Orçamento"}
                </span>
                <p className="font-semibold text-foreground">{formatCurrency(gcValorTotal)}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Data Abertura GC</span>
                <p className="font-medium">{dataAberturaGc || gcDoc?.data || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Técnico (Auvo)</span>
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
                {Array.isArray((tarefa as any).pausas) && (tarefa as any).pausas.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-muted-foreground/10 pt-1">
                    <p className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                      ⏸️ Pausas detectadas:
                    </p>
                    {(tarefa as any).pausas.map((p: any, idx: number) => {
                      const start = p.inicio ? new Date(p.inicio) : null;
                      const end = p.fim ? new Date(p.fim) : null;
                      const formatTime = (d: Date | null) => d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "—";
                      
                      let diffText = "";
                      if (start && end && end > start) {
                        const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
                        diffText = `(${diffMin}min)`;
                      }

                      return (
                        <p key={idx} className="text-[10px] text-muted-foreground flex items-center justify-between">
                          <span>{formatTime(start)} → {formatTime(end)}</span>
                          <span className="font-medium">{diffText}</span>
                        </p>
                      );
                    })}
                  </div>
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

            {os.id && (
              <div className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">
                    OS {os.codigo || ""} no GestãoClick
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {os.herdado && (
                    <p className="text-[10px] text-muted-foreground">
                      Vínculo identificado pela Tarefa OS #{os.tarefaOrigem} / Tarefa Execução #{taskId}.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Situação atual:{" "}
                    <Badge
                      variant="outline"
                      className="text-[10px] ml-1"
                      style={{
                        borderColor: os.cor || undefined,
                        color: os.cor || undefined,
                      }}
                    >
                      {os.situacao || "—"}
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
                    A alteração é aplicada diretamente na OS {os.codigo || ""} do GestãoClick.
                  </p>
                </div>
              </div>
            )}

            {gcDocLoading && docEndpoint && (
              <div className="border rounded-md p-4 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}

            {!gcDocLoading && gcDoc && (
              <>
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    <span className="text-sm font-semibold">
                      💰 Resumo Financeiro {os.id ? `— OS ${os.codigo || ""}` : `— Orçamento #${os.orcamento || ""}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 p-3 text-sm">
                    <div className="text-center">
                      <span className="text-muted-foreground text-xs block">Produtos</span>
                      <p className="font-semibold">{formatCurrency(gcValorProdutos)}</p>
                    </div>
                    <div className="text-center">
                      <span className="text-muted-foreground text-xs block">Serviços</span>
                      <p className="font-semibold">{formatCurrency(gcValorServicos)}</p>
                    </div>
                    <div className="text-center">
                      <span className="text-muted-foreground text-xs block">Desconto</span>
                      <p className="font-semibold text-destructive">
                        {gcValorDesconto > 0 ? `-${formatCurrency(gcValorDesconto)}` : "—"}
                      </p>
                    </div>
                    <div className="text-center">
                      <span className="text-muted-foreground text-xs block">Total</span>
                      <p className="font-bold text-foreground">{formatCurrency(gcValorTotal)}</p>
                    </div>
                  </div>
                </div>

                {gcProdutos.length > 0 && (
                  <div className="border rounded-md">
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Produtos ({gcProdutos.length})</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-xs">Descrição</TableHead>
                          <TableHead className="text-xs text-right">Qtd</TableHead>
                          <TableHead className="text-xs text-right">Unit.</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gcProdutos.map((p: any, i: number) => {
                          const qtd = Number(p.quantidade || p.qtd || 1);
                          const unitario = Number(p.valor_venda || p.valor_unitario || p.preco || p.valor || 0);
                          const total = Number(p.valor_total || p.subtotal || qtd * unitario);
                          return (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-mono py-1.5">
                                {String(p.codigo_interno || p.codigo || p.produto_id || "—")}
                              </TableCell>
                              <TableCell className="text-xs py-1.5 max-w-[200px] truncate">
                                {String(p.nome_produto || p.descricao || p.nome || "—")}
                              </TableCell>
                              <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                              <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                              <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {gcServicos.length > 0 && (
                  <div className="border rounded-md">
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold">Serviços ({gcServicos.length})</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-xs">Descrição</TableHead>
                          <TableHead className="text-xs text-right">Qtd</TableHead>
                          <TableHead className="text-xs text-right">Unit.</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gcServicos.map((s: any, i: number) => {
                          const qtd = Number(s.quantidade || s.qtd || 1);
                          const unitario = Number(s.valor_venda || s.valor_unitario || s.preco || s.valor || 0);
                          const total = Number(s.valor_total || s.subtotal || qtd * unitario);
                          return (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-mono py-1.5">
                                {String(s.codigo_interno || s.codigo || s.servico_id || "—")}
                              </TableCell>
                              <TableCell className="text-xs py-1.5 max-w-[200px] truncate">
                                {String(s.nome_servico || s.descricao || s.nome || "—")}
                              </TableCell>
                              <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                              <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                              <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {gcProdutos.length === 0 && gcServicos.length === 0 && (
                  <div className="border rounded-md p-3 text-sm text-muted-foreground text-center">
                    Nenhum produto ou serviço cadastrado neste documento do GestãoClick
                  </div>
                )}
              </>
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


            {(textos.length > 0 || fotos.length > 0 || tarefa.orientacao) && (
              <div className="border rounded-md">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Relato / Questionário</span>
                </div>
                <div className="p-3 space-y-2">
                  {tarefa.orientacao && (
                    <div className="text-sm border-b border-muted-foreground/10 pb-2 mb-2">
                      <span className="text-muted-foreground text-xs block mb-1">Relato / Orientação</span>
                      <pre className="whitespace-pre-wrap font-sans leading-relaxed text-sm">
                        {tarefa.orientacao}
                      </pre>
                    </div>
                  )}
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
              {auvoAdminUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={auvoAdminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir no Auvo
                  </a>
                </Button>
              )}
              {auvoPdfUrl ? (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={auvoPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1"
                  >
                    <FileText className="h-3.5 w-3.5" /> Relatório PDF
                  </a>
                </Button>
              ) : taskId ? (
                <Button size="sm" variant="outline" disabled title="Link público do relatório ainda não sincronizado">
                  <FileText className="h-3.5 w-3.5" /> Relatório PDF
                </Button>
              ) : null}
              {os.link && (
                <Button size="sm" variant="outline" asChild>
                  <a href={os.link} target="_blank" rel="noopener noreferrer" className="gap-1">
                    <ExternalLink className="h-3.5 w-3.5" /> OS {os.codigo || ""} no GC
                  </a>
                </Button>
              )}
              {os.orcLink && (
                <Button size="sm" variant="outline" asChild>
                  <a href={os.orcLink} target="_blank" rel="noopener noreferrer" className="gap-1">
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
