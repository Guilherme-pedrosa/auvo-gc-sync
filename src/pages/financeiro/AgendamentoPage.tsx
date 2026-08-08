import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Filter, Loader2,
  PackageSearch, RefreshCw, Search,
} from "lucide-react";
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
  type ChegadaItem, type ChegadaStatus,
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

async function fetchChegadas(): Promise<ChegadaItem[]> {
  const { data, error } = await supabase.functions.invoke("compras-chegadas", { body: {} });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data?.error || "Falha ao consultar compras");
  return (data?.itens || []) as ChegadaItem[];
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
  const hoje = todayISO();
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [mes, setMes] = useState(() => new Date().getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState<string>(hoje);
  const [busca, setBusca] = useState("");
  const [excludedSituacoes, setExcludedSituacoes] = useState<Set<string>>(new Set());
  const [searchSituacao, setSearchSituacao] = useState("");
  const [tipoDoc, setTipoDoc] = useState<"todos" | "orcamentos" | "pedidos">(
    () => (localStorage.getItem("agendamento:tipoDoc") as "todos" | "orcamentos" | "pedidos") || "todos",
  );
  const [alvo, setAlvo] = useState<AgendarAlvo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: itens = [], isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["compras-chegadas"],
    queryFn: fetchChegadas,
    staleTime: 5 * 60 * 1000,
  });

  const handleAtualizar = async () => {
    const t = toast.loading("Atualizando orçamentos e pedidos...");
    try {
      const res = await refetch();
      if (res.error) throw res.error;
      toast.success(`Atualizado: ${res.data?.length ?? 0} documentos`, { id: t });
    } catch (e) {
      toast.error(`Falha ao atualizar: ${(e as Error).message}`, { id: t });
    }
  };

  const termo = busca.trim().toLowerCase();
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

    // Filtro por busca textual
    if (termo) {
      result = result.filter((i) =>
        [i.compra_codigo, i.cliente, i.fornecedor, i.vinculo_texto, i.situacao, i.equipamento,
         ...i.produtos.map((p) => p.nome)]
          .some((v) => String(v || "").toLowerCase().includes(termo)),
      );
    }

    return result;
  }, [itens, termo, excludedSituacoes, tipoDoc]);

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
      `- Orçamento ${i.orcamento_codigo || i.vinculo_codigo} | ${i.compra_codigo ? `PC ${i.compra_codigo} | ` : ""}chegada: ${i.data_chegada ? formatDiaBR(i.data_chegada) : "sem data"}` +
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

  const abrirAgendamento = (i: ChegadaItem) => {
    setAlvo({
      auvo_task_id: i.auvo_task_id || null,
      exec_task_id: i.auvo_task_id || null,
      gc_os_codigo: i.os_codigo || (i.vinculo_tipo === "os" ? i.vinculo_codigo : null),
      cliente: i.cliente || i.fornecedor,
      equipamento: i.equipamento,
      data_tarefa: i.data_chegada,
      tecnico_id: null,
    });
    setDialogOpen(true);
  };

  const renderItem = (i: ChegadaItem, compacto = false) => {
    const status = getChegadaStatus(i.data_chegada);
    const style = STATUS_STYLE[status];
    const ehPedido = isPedidoCompra(i);
    const chave = `${ehPedido ? "pc" : "or"}-${i.compra_id || i.compra_codigo || i.orcamento_id || i.orcamento_codigo || i.vinculo_codigo}`;
    if (compacto) {
      return (
        <span
          key={chave}
          className={cn("block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] leading-tight", style.chip)}
          title={`${ehPedido ? "PC" : "OR"} ${i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo} · ${i.cliente || i.fornecedor} · ${formatBRL(i.valor_total)}`}
        >
          {ehPedido ? "PC" : "OR"} {i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo} · {i.cliente || i.fornecedor}
        </span>
      );
    }
    return (
      <div key={chave} className="rounded-md border border-border bg-card p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs font-bold text-primary">
                {ehPedido ? "Pedido de Compra" : "Orçamento"} {i.orcamento_codigo || i.vinculo_codigo || i.compra_codigo}
              </p>
              {!ehPedido &&
                (i.pedidos_compra?.length ? i.pedidos_compra : i.compra_codigo ? [i.compra_codigo] : []).map((pc) => (
                  <Badge key={pc} variant="outline" className="h-4 px-1 text-[9px] font-normal">PC {pc}</Badge>
                ))}
            </div>
            <p className="truncate text-[11px] text-muted-foreground mt-0.5">
              {i.cliente || "Cliente não identificado"}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{formatBRL(i.documento_valor || i.valor_total)}</span>
        </div>

        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
          {i.produtos.map((p) => `${p.quantidade > 1 ? `${p.quantidade}x ` : ""}${p.nome}`).join(" · ") || "Sem itens"}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={cn("text-[10px]", style.chip)}>
            {style.label}
            {i.data_chegada ? ` · ${formatDiaBR(i.data_chegada)}` : ""}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">{i.situacao}</Badge>
          {i.fornecedor && <Badge variant="outline" className="max-w-[160px] truncate text-[10px]">{i.fornecedor}</Badge>}
          {i.equipamento && <Badge variant="outline" className="max-w-[180px] truncate text-[10px]">{i.equipamento}</Badge>}
        </div>

        <div className="mt-2 flex items-center gap-1">
          <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => abrirAgendamento(i)}>
            <CalendarClock className="mr-1 h-3 w-3" /> Agendar execução
          </Button>
          {i.documento_link && (
            <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
              <a href={i.documento_link} target="_blank" rel="noreferrer" aria-label="Abrir orçamento no GestãoClick">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {i.gc_link && i.compra_codigo && (
            <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
              <a href={i.gc_link} target="_blank" rel="noreferrer" aria-label="Abrir pedido de compra no GestãoClick">
                <PackageSearch className="h-3 w-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Agendamento · Calendário de Compras e Orçamentos</h1>
          <p className="text-xs text-muted-foreground">
            Acompanhamento de orçamentos pendentes e prazos de chegada de pedidos de compra.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
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
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-muted-foreground" /> Sem data ({semData.length})</span>
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
                          onClick={() => setDiaSelecionado(dia)}
                          className={cn(
                            "min-h-[92px] rounded-md border p-1 text-left align-top transition",
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

            <div className="grid gap-3 lg:grid-cols-3">
              {/* Dia selecionado */}
              <section className="rounded-lg border border-border bg-muted/20 p-2">
                <h2 className="mb-2 text-xs font-semibold">Orçamentos em {formatDiaBR(diaSelecionado)} ({itensDoDia.length})</h2>
                <div className="space-y-2">
                  {itensDoDia.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Nenhuma peça prevista neste dia.</p>
                    : itensDoDia.map((i) => renderItem(i))}
                </div>
              </section>

              {/* Atrasadas */}
              <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                <h2 className="mb-2 text-xs font-semibold text-destructive">Orçamentos atrasados ({atrasadas.length})</h2>
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {atrasadas.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Nada atrasado. 🎉</p>
                    : atrasadas.map((i) => renderItem(i))}
                </div>
              </section>

              {/* Sem data */}
              <section className="rounded-lg border border-border bg-muted/20 p-2">
                <h2 className="mb-2 text-xs font-semibold">Sem previsão de chegada ({semData.length})</h2>
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {semData.length === 0
                    ? <p className="py-6 text-center text-[11px] text-muted-foreground">Todos os pedidos têm data.</p>
                    : semData.map((i) => renderItem(i))}
                </div>
              </section>
            </div>
          </div>

          <div className="min-h-0 xl:h-full">
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

      <AgendarTarefaDialog open={dialogOpen} onOpenChange={setDialogOpen} alvo={alvo} onSaved={() => refetch()} />
    </div>
  );
}