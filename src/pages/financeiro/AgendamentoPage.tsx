import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Filter, Loader2,
  Package, PackageSearch, RefreshCw, Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  buildMonthGrid, formatBRL, formatDiaBR, getChegadaStatus, monthLabel, todayISO,
  latestForecastForDocument, latestMissingPartsArrival, missingPartArrivalDates,
  type ChegadaItem, type ChegadaStatus,
  type PrevisaoAgendamento,
} from "@/lib/agendamento";
import AgendarTarefaDialog, { type AgendarAlvo } from "@/components/financeiro/AgendarTarefaDialog";
import AgendamentoAiPanel from "@/components/financeiro/AgendamentoAiPanel";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_STYLE: Record<ChegadaStatus, { chip: string; dot: string; label: string }> = {
  atrasada: { chip: "bg-destructive/10 text-destructive border-destructive/40", dot: "bg-destructive", label: "Atrasada" },
  hoje: { chip: "bg-amber-100 text-amber-900 border-amber-300", dot: "bg-amber-500", label: "Chega hoje" },
  futura: { chip: "bg-emerald-50 text-emerald-800 border-emerald-300", dot: "bg-emerald-500", label: "Prevista" },
  sem_data: { chip: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground", label: "Sem data" },
};

async function fetchForecastsByDocument(
  field: "gc_orcamento_codigo" | "gc_os_codigo",
  codes: string[],
): Promise<PrevisaoAgendamento[]> {
  const uniqueCodes = [...new Set(codes.map(String).map((code) => code.trim()).filter(Boolean))];
  const rows: PrevisaoAgendamento[] = [];

  for (let start = 0; start < uniqueCodes.length; start += 100) {
    const { data, error } = await supabase
      .from("agenda_agendamentos")
      .select("id, data, colaborador_nome, colaborador_id, gc_orcamento_codigo, gc_os_codigo, previsao_detalhes, hora_inicio, hora_fim, atualizado_em")
      .eq("previsao_continuidade", true)
      .in(field, uniqueCodes.slice(start, start + 100))
      .order("atualizado_em", { ascending: false });
    if (error) throw error;
    rows.push(...((data ?? []) as PrevisaoAgendamento[]));
  }

  return rows;
}

async function fetchChegadas(): Promise<ChegadaItem[]> {
  console.log("[AgendamentoPage] chamando compras-chegadas...");
  try {
    const { data, error } = await supabase.functions.invoke("compras-chegadas", { body: {} });
    if (error) {
      console.error("[AgendamentoPage] erro invoke:", error);
      throw error;
    }
    if (data?.ok === false) {
      console.error("[AgendamentoPage] erro backend:", data?.error);
      throw new Error(data?.error || "Falha ao consultar compras");
    }

    let itens = ((data?.itens || []) as ChegadaItem[]).map((item) => {
      const maiorPrazo = latestMissingPartsArrival(item.pecas_em_falta);
      return maiorPrazo
        ? { ...item, data_chegada: maiorPrazo, proxima_reposicao: maiorPrazo }
        : item;
    });
    console.log("[AgendamentoPage] Itens recebidos:", itens.length);

    // Buscar previsões locais para marcar nos cards
    const orcCodigos = itens
      .map((item) => item.orcamento_codigo || (item.vinculo_tipo === "orcamento" ? item.vinculo_codigo : ""))
      .filter(Boolean);
    const osCodigos = itens
      .map((item) => item.os_codigo || (item.vinculo_tipo === "os" ? item.vinculo_codigo : ""))
      .filter(Boolean);

    if (orcCodigos.length > 0 || osCodigos.length > 0) {
      const [porOrcamento, porOs] = await Promise.all([
        fetchForecastsByDocument("gc_orcamento_codigo", orcCodigos),
        fetchForecastsByDocument("gc_os_codigo", osCodigos),
      ]);
      const previsoes = [...new Map(
        [...porOrcamento, ...porOs].map((previsao) => [previsao.id, previsao]),
      ).values()];

      if (previsoes.length > 0) {
        itens = itens.map(item => {
          const prev = latestForecastForDocument(item, previsoes);
          if (prev) {
            return { 
              ...item, 
              previsao_id: prev.id,
              previsao_data: prev.data, 
              previsao_atualizado_em: prev.atualizado_em,
              previsao_tecnico: prev.colaborador_nome,
              previsao_colab_id: prev.colaborador_id,
              previsao_detalhes: prev.previsao_detalhes,
              previsao_hora: prev.hora_inicio,
              previsao_hora_fim: prev.hora_fim
            };
          }
          return item;
        });
      }
    }

    return itens;
  } catch (e) {
    console.error("[AgendamentoPage] Erro fatal no fetchChegadas:", e);
    throw e;
  }
}

function documentoLabel(item: ChegadaItem): string {
  if (item.vinculo_tipo === "orcamento") return `Orçamento ${item.vinculo_codigo}`;
  if (item.vinculo_tipo === "os") return `OS ${item.vinculo_codigo}`;
  return item.vinculo_texto ? item.vinculo_texto.slice(0, 40) : "Sem vínculo";
}

/** Tipo real do documento: preferimos o campo do backend, com fallback pelo código de compra. */
function isPedidoCompra(i: ChegadaItem): boolean {
  if (i.doc_tipo) return i.doc_tipo === "compra";
  return Boolean(i.compra_id || i.compra_codigo);
}

export default function AgendamentoPage() {
  const queryClient = useQueryClient();
  const hoje = todayISO();
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [mes, setMes] = useState(() => new Date().getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState<string>(hoje);
  const [busca, setBusca] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [excludedSituacoes, setExcludedSituacoes] = useState<Set<string>>(new Set());
  const [searchSituacao, setSearchSituacao] = useState("");
  const [tipoDoc, setTipoDoc] = useState<"todos" | "orcamentos" | "pedidos">(
    () => (localStorage.getItem("agendamento:tipoDoc") as "todos" | "orcamentos" | "pedidos") || "orcamentos",
  );
  const [alvo, setAlvo] = useState<AgendarAlvo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detalhesDialog, setDetalhesDialog] = useState<{ open: boolean; dia: string }>({ open: false, dia: "" });

  const { data: itens = [], isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["compras-chegadas"],
    queryFn: fetchChegadas,
    staleTime: 5 * 60 * 1000,
  });

  const handleAtualizar = useCallback(async () => {
    const t = toast.loading("Atualizando orçamentos e pedidos...");
    try {
      console.log("[AgendamentoPage] Forçando atualização manual...");
      queryClient.invalidateQueries({ queryKey: ["compras-chegadas"] });
      const res = await refetch();
      if (res.error) throw res.error;
      toast.success(`Atualizado: ${res.data?.length ?? 0} documentos`, { id: t });
    } catch (e) {
      console.error("[AgendamentoPage] Erro na atualização manual:", e);
      toast.error(`Falha ao atualizar: ${(e as Error).message}`, { id: t });
    }
  }, [queryClient, refetch]);

  const termo = busca.trim().toLowerCase();
  const termoCliente = buscaCliente.trim().toLowerCase();
  const filtrados = useMemo(() => {
    let result = itens;

    // Filtro por tipo de documento (Orçamento GC x Pedido de Compra GC)
    if (tipoDoc !== "todos") {
      result = result.filter((i) => (tipoDoc === "pedidos" ? isPedidoCompra(i) : !isPedidoCompra(i)));
    }

    // Filtro por situação
    if (excludedSituacoes.size > 0) {
      result = result.filter((i) => !excludedSituacoes.has(i.situacao));
    }

    // Filtro por busca de cliente
    if (termoCliente) {
      result = result.filter((i) =>
        String(i.cliente || "").toLowerCase().includes(termoCliente)
      );
    }

    // Filtro por busca textual geral
    if (termo) {
      result = result.filter((i) =>
         [i.compra_codigo, i.cliente, i.fornecedor, i.vinculo_texto, i.situacao, i.equipamento,
          ...(i.pedidos_compra ?? []), ...((i.pedidos_detalhes ?? []).map((p) => p.situacao)),
         ...i.produtos.map((p) => p.nome)]
          .some((v) => String(v || "").toLowerCase().includes(termo)),
      );
    }

    return result;
  }, [itens, termo, termoCliente, excludedSituacoes, tipoDoc]);

  const totaisTipo = useMemo(() => ({
    todos: itens.length,
    orcamentos: itens.filter((i) => !isPedidoCompra(i)).length,
    pedidos: itens.filter((i) => isPedidoCompra(i)).length,
  }), [itens]);

  const allSituacoes = useMemo(() => {
    return Array.from(new Set(itens.map((i) => i.situacao).filter(Boolean))).sort();
  }, [itens]);

  const filteredSituacoes = useMemo(() => {
    if (!searchSituacao) return allSituacoes;
    const s = searchSituacao.toLowerCase();
    return allSituacoes.filter((sit) => sit.toLowerCase().includes(s));
  }, [allSituacoes, searchSituacao]);

  // Forçar recarga ao montar se estiver vazio
  useEffect(() => {
    console.log("[AgendamentoPage] Montado. Itens:", itens.length, "Loading:", isLoading);
    if (itens.length === 0 && !isLoading && !isFetching) {
      refetch();
    }
  }, [itens.length, isLoading, isFetching, refetch]);

  const porDia = useMemo(() => {
    const map = new Map<string, ChegadaItem[]>();
    filtrados.forEach((i) => {
      const dia = String(i.data_chegada ?? "").slice(0, 10);
      if (!dia) return;
      const arr = map.get(dia) ?? [];
      arr.push(i);
      map.set(dia, arr);
    });
    map.forEach((arr) => arr.sort((a, b) => b.valor_total - a.valor_total));
    return map;
  }, [filtrados]);

  const semData = useMemo(() => filtrados.filter((i) => !i.data_chegada), [filtrados]);
  const atrasadas = useMemo(
    () => filtrados.filter((i) => getChegadaStatus(i.data_chegada) === "atrasada")
      .sort((a, b) => String(a.data_chegada).localeCompare(String(b.data_chegada))),
    [filtrados],
  );

  const semanas = useMemo(() => buildMonthGrid(ano, mes), [ano, mes]);

  const navegar = (delta: number) => {
    const d = new Date(ano, mes + delta, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
  };

  const itensDoDia = porDia.get(diaSelecionado) ?? [];

  const boardSummary = useMemo(() => {
    const linha = (i: ChegadaItem) =>
      `- Orçamento ${i.orcamento_codigo || i.vinculo_codigo} | ${(i.pedidos_detalhes ?? []).map((p) => `PC ${p.codigo}: ${p.situacao}${p.data_chegada ? ` (${formatDiaBR(p.data_chegada)})` : ""}`).join("; ") || (i.compra_codigo ? `PC ${i.compra_codigo}` : "sem PC")} | chegada final: ${i.data_chegada ? formatDiaBR(i.data_chegada) : "sem data"}` +
      ` | cliente: ${i.cliente || "?"} | fornecedor: ${i.fornecedor}` +
      ` | ${formatBRL(i.documento_valor || i.valor_total)} | situação: ${i.situacao}` +
      ` | peças: ${i.produtos.slice(0, 4).map((p) => p.nome).join(", ") || "-"}`;
    return [
      `[ATRASADAS] (${atrasadas.length})`,
      ...atrasadas.slice(0, 30).map(linha),
      `\n[SEM DATA DE CHEGADA] (${semData.length})`,
      ...semData.slice(0, 30).map(linha),
      `\n[PREVISTAS] (${filtrados.length - atrasadas.length - semData.length})`,
      ...filtrados
        .filter((i) => ["hoje", "futura"].includes(getChegadaStatus(i.data_chegada)))
        .slice(0, 40)
        .map(linha),
    ].join("\n");
  }, [filtrados, atrasadas, semData]);

  const abrirPrevisao = (i: ChegadaItem) => {
    const semEstoque = i.pode_agendar === false;
    const dataReposicaoConfirmada = semEstoque ? (i.proxima_reposicao || null) : null;
    setAlvo({
      previsao_id: i.previsao_id || null,
      auvo_task_id: null,
      exec_task_id: null,
      gc_os_codigo: i.os_codigo || (i.vinculo_tipo === "os" ? i.vinculo_codigo : null),
      gc_orcamento_codigo: i.orcamento_codigo || (i.vinculo_tipo === "orcamento" ? i.vinculo_codigo : null),
      cliente: i.cliente || i.fornecedor,
      equipamento: i.equipamento,
      data_tarefa: i.previsao_data || null,
      data_sugerida: dataReposicaoConfirmada || i.data_chegada,
      data_minima: dataReposicaoConfirmada,
      aviso_estoque: semEstoque
        ? (i.motivo_bloqueio || "Há peças sem saldo disponível para este orçamento.")
        : null,
      tecnico_id: i.previsao_colab_id ? String(i.previsao_colab_id) : null,
      tecnico_nome: i.previsao_tecnico || null,
      previsao_detalhes: i.previsao_detalhes,
      hora: i.previsao_hora || "08:00",
      hora_fim: i.previsao_hora_fim,
    });
    setDetalhesDialog({ open: false, dia: "" });
    setDialogOpen(true);
  };

  const renderItem = (i: ChegadaItem, compacto = false) => {
    const status = getChegadaStatus(i.data_chegada);
    const style = STATUS_STYLE[status];
    const ehPedido = isPedidoCompra(i);
    const osJaLancada = !ehPedido && Boolean(String(i.os_codigo || "").trim());
    const chave = `${ehPedido ? "pc" : "or"}-${i.compra_id || i.compra_codigo || i.orcamento_id || i.orcamento_codigo || i.vinculo_codigo}`;
    if (compacto) {
      return (
        <span
          key={chave}
          className={cn("block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] leading-tight", style.chip)}
          title={`${ehPedido ? "PC" : "OR"} ${i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo} · ${i.cliente || i.fornecedor} · ${formatBRL(i.valor_total)}${osJaLancada ? ` · OS já lançada: ${i.os_codigo}` : ""}`}
        >
          {osJaLancada ? "⚠ " : ""}{ehPedido ? "PC" : "OR"} {i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo} · {i.cliente || i.fornecedor}
        </span>
      );
    }
    return (
      <div key={chave} className="flex flex-col rounded-md border border-border bg-card p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs font-bold text-primary">
                {i.documento_link ? (
                  <a
                    href={i.documento_link.replace("/visualizar/", "/editar/")}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    {ehPedido ? "Pedido de Compra" : "Orçamento"} {i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo}
                    <ExternalLink className="h-2 w-2" />
                  </a>

                ) : (
                  `${ehPedido ? "Pedido de Compra" : "Orçamento"} ${i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo}`
                )}
              </p>
            </div>
            <p className="truncate text-[11px] text-muted-foreground mt-0.5">
              {i.cliente || "Cliente não identificado"}
            </p>
            {i.equipamento && (
              <p className="truncate text-[10px] font-medium text-amber-700 bg-amber-50 px-1 rounded mt-0.5 border border-amber-100 w-fit">
                {i.equipamento}
              </p>
            )}
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{formatBRL(i.documento_valor || i.valor_total)}</span>
        </div>

        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
          {i.produtos.map((p) => `${p.quantidade > 1 ? `${p.quantidade}x ` : ""}${p.nome}`).join(" · ") || "Sem itens"}
        </p>

        {!ehPedido && (i.pedidos_detalhes?.length ?? 0) > 0 && (
          <div className="mt-2 space-y-1 border-l-2 border-border pl-2">
            {i.pedidos_detalhes?.map((pedido) => (
              <div key={pedido.codigo} className="flex flex-wrap items-center gap-1 text-[10px]">
                {pedido.gc_link ? (
                  <a href={pedido.gc_link.replace("/visualizar/", "/editar/")} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                    PC {pedido.codigo}
                  </a>
                ) : <span className="font-semibold">PC {pedido.codigo}</span>}

                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 px-1 text-[9px]",
                    pedido.estado === "chegou" && "border-emerald-300 bg-emerald-50 text-emerald-800",
                    pedido.estado === "pendente" && "border-amber-300 bg-amber-50 text-amber-900",
                    pedido.estado === "cancelado" && "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  {pedido.estado === "chegou" ? "Peças chegaram" : pedido.situacao}
                </Badge>
                <span className="text-muted-foreground">
                  {pedido.data_chegada ? `Chegada ${formatDiaBR(pedido.data_chegada)}` : "Sem previsão"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {status === "atrasada" && (
            <Badge variant="outline" className="text-[10px] border-destructive bg-destructive/10 text-destructive">
              Atrasada · {formatDiaBR(i.data_chegada)}
            </Badge>
          )}
          <Badge variant="outline" className={cn(
            "text-[10px]",
            i.pode_agendar
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : i.estoque_verificado === false
                ? "border-slate-300 bg-slate-50 text-slate-700"
                : "border-amber-300 bg-amber-50 text-amber-900",
          )}>
            {i.pode_agendar
              ? "Disponível em estoque"
              : i.estoque_verificado === false
                ? "Estoque não confirmado"
                : "Sem estoque · aguarda reposição"}
            {i.data_chegada && status !== "atrasada" ? ` · ${formatDiaBR(i.data_chegada)}` : ""}
          </Badge>
          {!i.pode_agendar && !ehPedido && (
            <Badge variant="outline" className="text-[9px] border-amber-500 bg-amber-50 text-amber-700">
              {i.proxima_reposicao ? `Reposição ${formatDiaBR(i.proxima_reposicao)}` : "Reposição sem data"}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">{i.situacao}</Badge>
          {i.fornecedor && <Badge variant="outline" className="max-w-[160px] truncate text-[10px]">{i.fornecedor}</Badge>}
          {i.equipamento && <Badge variant="outline" className="max-w-[180px] truncate text-[10px]">{i.equipamento}</Badge>}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          {(i.pecas_em_falta?.length ?? 0) > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[10px] text-amber-950">
              <p className="font-semibold">Peças faltantes e chegada</p>
              <div className="mt-1.5 divide-y divide-amber-200">
                {i.pecas_em_falta?.map((peca) => {
                  const datasChegada = missingPartArrivalDates(peca);
                  return (
                    <div key={`${peca.produto_id}-${peca.nome}`} className="py-1 first:pt-0 last:pb-0">
                      <p className="font-medium leading-tight">{peca.nome}</p>
                      <p className={cn("mt-0.5", datasChegada.length > 0 ? "text-amber-800" : "text-muted-foreground")}>
                        {datasChegada.length > 0
                          ? `Chegada: ${datasChegada.map(formatDiaBR).join(" · ")}`
                          : "Sem previsão de chegada"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {i.equipamento && (
             <div className="flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-800">
               <Package className="h-3 w-3 shrink-0" />
               <span className="font-medium truncate">{i.equipamento}</span>
             </div>
          )}
          {osJaLancada && (
            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[10px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <strong>OS já lançada</strong> para este orçamento (OS {i.os_codigo}). A previsão é somente interna e não cria outra tarefa no Auvo ou no GestãoClick.
              </span>
            </div>
          )}
          {i.previsao_data && (
            <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-1.5 text-[10px] text-emerald-800">
              <CalendarClock className="h-3 w-3" />
              <span>
                <strong>Previsão:</strong> {formatDiaBR(i.previsao_data)} {i.previsao_tecnico ? `com ${i.previsao_tecnico}` : ""}
              </span>
            </div>
          )}
          <div className="mt-auto flex items-center gap-1 pt-2">
            <Button 
              size="sm" 
              variant={i.previsao_data ? "outline" : "default"}
              className="h-7 flex-1 text-[11px]" 
              onClick={() => abrirPrevisao(i)}
              title={i.pode_agendar === false
                ? "Criar previsão interna para depois da chegada das peças"
                : "Criar previsão interna de execução"}
            >
              <CalendarClock className="mr-1 h-3 w-3" /> 
              {i.previsao_data ? "Alterar previsão" : "Criar previsão"}
            </Button>
            {i.documento_link && (
              <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Editar no GestãoClick">
                <a href={i.documento_link.replace("/visualizar/", "/editar/")} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}

            {ehPedido && i.gc_link && i.compra_codigo && (
              <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Editar no GestãoClick">
                <a href={i.gc_link.replace("/visualizar/", "/editar/")} target="_blank" rel="noreferrer">
                  <PackageSearch className="h-3 w-3" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-max w-full flex-col gap-3 overflow-visible bg-background p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Chegada Orçamentos</h1>
          <p className="text-xs text-muted-foreground">
            Acompanhamento de orçamentos e prazos de entrega baseados nos pedidos de compra do GestãoClick.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              value={buscaCliente}
              onChange={(e) => setBuscaCliente(e.target.value)}
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Geral..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-8 w-40 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center rounded-md border border-border p-0.5">
            {([
              { id: "todos", label: "Todos" },
              { id: "orcamentos", label: "Orçamentos" },
              { id: "pedidos", label: "Pedidos" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setTipoDoc(opt.id);
                  localStorage.setItem("agendamento:tipoDoc", opt.id);
                }}
                className={cn(
                  "rounded px-2 py-1 text-[11px] font-medium transition",
                  tipoDoc === opt.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label} ({totaisTipo[opt.id]})
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 text-xs">
                <Filter className="h-3.5 w-3.5" />
                Situações
                {excludedSituacoes.size > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {allSituacoes.length - excludedSituacoes.size}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="space-y-2">
                <div className="flex items-center justify-between px-2 pb-1 border-b">
                  <span className="text-xs font-semibold">Filtrar Situações</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => setExcludedSituacoes(new Set())}
                  >
                    Limpar
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar situação..."
                    value={searchSituacao}
                    onChange={(e) => setSearchSituacao(e.target.value)}
                    className="h-7 pl-7 text-[10px]"
                  />
                </div>
                <ScrollArea className="h-64 pr-2">
                  <div className="space-y-1">
                    {filteredSituacoes.map((sit) => (
                      <div
                        key={sit}
                        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          id={`sit-${sit}`}
                          checked={!excludedSituacoes.has(sit)}
                          onCheckedChange={(checked) => {
                            const next = new Set(excludedSituacoes);
                            if (checked) next.delete(sit);
                            else next.add(sit);
                            setExcludedSituacoes(next);
                          }}
                        />
                        <label
                          htmlFor={`sit-${sit}`}
                          className="flex-1 cursor-pointer truncate text-[11px] font-medium leading-none"
                        >
                          {sit}
                        </label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </PopoverContent>
          </Popover>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nº Orçamento, Cliente, PC, Peça..."
              className="h-8 w-64 pl-7 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleAtualizar} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" /> Não consegui carregar os orçamentos: {String((error as Error).message)}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando calendário de compras e orçamentos...
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border-2 border-dashed rounded-lg p-12 text-center bg-muted/20">
          <div className="max-w-md space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <CalendarClock className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Nenhum orçamento encontrado</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Não há orçamentos pendentes nas situações de compra/chegada para os filtros selecionados.
              </p>
            </div>
            <Button variant="outline" onClick={handleAtualizar} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row overflow-visible">
          <div className="flex flex-1 flex-col gap-3 pr-1 overflow-visible">
            {/* Calendário */}
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => navegar(-1)} aria-label="Mês anterior">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[150px] text-center text-sm font-semibold">{monthLabel(ano, mes)}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => navegar(1)} aria-label="Próximo mês">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const d = new Date();
                      setAno(d.getFullYear());
                      setMes(d.getMonth());
                      setDiaSelecionado(hoje);
                    }}
                  >
                    Hoje
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-destructive" /> Atrasada ({atrasadas.length})</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" /> Hoje</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> Prevista</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-muted-foreground" /> Sem previsão ({semData.length})</span>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                {DIAS.map((d) => <div key={d}>{d}</div>)}
              </div>

              <div className="mt-1 space-y-1">
                {semanas.map((semana, idx) => (
                  <div key={idx} className="grid grid-cols-7 gap-1">
                    {semana.map((dia) => {
                      const doMes = Number(dia.slice(5, 7)) - 1 === mes;
                      const lista = porDia.get(dia) ?? [];
                      const temAtraso = lista.some((i) => getChegadaStatus(i.data_chegada) === "atrasada");
                      const total = lista.reduce((s, i) => s + i.valor_total, 0);
                      return (
                        <button
                          key={dia}
                          onClick={() => {
                            setDiaSelecionado(dia);
                            if (lista.length > 0) {
                              setDetalhesDialog({ open: true, dia });
                            }
                          }}
                          className={cn(
                            "group relative min-h-[92px] rounded-md border p-1 text-left align-top transition hover:border-primary/50 hover:bg-muted/10",
                            doMes ? "bg-background" : "bg-muted/30 opacity-60",
                            diaSelecionado === dia ? "border-primary ring-1 ring-primary" : "border-border",
                            temAtraso && "border-destructive/60",
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className={cn("text-[11px] font-semibold", dia === hoje && "rounded bg-primary px-1 text-primary-foreground")}>
                              {Number(dia.slice(8, 10))}
                            </span>
                            {lista.length > 0 && (
                              <span className="text-[9px] text-muted-foreground">{formatBRL(lista.reduce((s, i) => s + (i.documento_valor || i.valor_total), 0))}</span>
                            )}
                          </div>
                          <div className="space-y-0.5">
                            {lista.slice(0, 3).map((i) => renderItem(i, true))}
                            {lista.length > 3 && (
                              <span className="block text-[9px] text-muted-foreground">+{lista.length - 3} pedidos</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-3">
              {/* Dia selecionado */}
              <section className="flex flex-col rounded-lg border border-border bg-muted/20 p-2">
                <h2 className="mb-2 text-xs font-semibold">Orçamentos em {formatDiaBR(diaSelecionado)} ({itensDoDia.length})</h2>
                <div className="flex flex-col flex-1 space-y-2">
                  {itensDoDia.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Nenhuma peça prevista neste dia.</p>
                    : itensDoDia.map((i) => renderItem(i))}
                </div>
              </section>

              {/* Atrasadas */}
              <section className="flex flex-col rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                <h2 className="mb-2 text-xs font-semibold text-destructive">Orçamentos atrasados ({atrasadas.length})</h2>
                <div className="flex flex-col flex-1 max-h-[600px] space-y-2 overflow-y-auto">
                  {atrasadas.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Nada atrasado. 🎉</p>
                    : atrasadas.map((i) => renderItem(i))}
                </div>
              </section>

              {/* Sem previsão */}
              <section className="flex flex-col rounded-lg border border-border bg-muted/20 p-2">
                <h2 className="mb-2 text-xs font-semibold">Sem previsão de chegada ({semData.length})</h2>
                <div className="flex flex-col flex-1 max-h-[600px] space-y-2 overflow-y-auto">
                  {semData.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Todos os pedidos têm data.</p>
                    : semData.map((i) => renderItem(i))}
                </div>
              </section>
            </div>
          </div>

          <div className="xl:h-full xl:w-[340px] shrink-0 overflow-visible">
            <AgendamentoAiPanel
              boardSummary={boardSummary}
              contexto={{
                modulo: "agendamento_orcamentos",
                orcamentos_pendentes: filtrados.length,
                atrasados: atrasadas.length,
                sem_data: semData.length,
                valor_total: filtrados.reduce((s, i) => s + (i.documento_valor || i.valor_total), 0),
              }}
            />
          </div>
        </div>
      )}

      <AgendarTarefaDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        alvo={alvo} 
        onSaved={(patch) => {
          const alvoAtual = alvo;
          if (alvoAtual) {
            queryClient.setQueryData<ChegadaItem[]>(["compras-chegadas"], (old) =>
              (old || []).map((item) => {
                const match =
                  (alvoAtual.gc_orcamento_codigo && item.orcamento_codigo === alvoAtual.gc_orcamento_codigo) ||
                  (alvoAtual.gc_os_codigo && item.os_codigo === alvoAtual.gc_os_codigo);
                if (!match) return item;
                return {
                  ...item,
                  previsao_data: patch.dataTarefa,
                  previsao_id: patch.previsaoId ?? item.previsao_id,
                  previsao_tecnico: patch.tecnico,
                  previsao_colab_id: patch.tecnicoId,
                  previsao_detalhes: patch.detalhes ?? null,
                  previsao_hora: patch.hora ?? null,
                  previsao_hora_fim: patch.horaFim ?? null,
                } as ChegadaItem;
              }),
            );
          }
          refetch();
        }}
      />

      <Dialog open={detalhesDialog.open} onOpenChange={(open) => setDetalhesDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="grid h-[90dvh] max-h-[90dvh] w-[calc(100vw-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b p-4">
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Documentos em {formatDiaBR(detalhesDialog.dia)}
            </DialogTitle>
            <DialogDescription>
              {porDia.get(detalhesDialog.dia)?.length || 0} itens previstos para este dia.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto p-4">
            <div className="grid min-w-[720px] gap-3 sm:grid-cols-2">
              {(porDia.get(detalhesDialog.dia) || []).map((i) => renderItem(i))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
