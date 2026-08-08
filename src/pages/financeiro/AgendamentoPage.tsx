import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarClock, ExternalLink, Loader2, Package, RefreshCw, Search, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isOpenOsSituation } from "@/lib/osOpenStatuses";
import {
  AGENDA_BUCKETS, ORC_PECA_SITUACOES, ORC_PECA_SITUACAO_IDS, diasDesde, formatBRL,
  getAgendaBucket, parseExecTaskId, parseValor, type AgendaBucket,
} from "@/lib/agendamento";
import AgendarTarefaDialog, { type AgendarAlvo } from "@/components/financeiro/AgendarTarefaDialog";
import AgendamentoAiPanel from "@/components/financeiro/AgendamentoAiPanel";

const COLS =
  "auvo_task_id, mirror_key, cliente, tecnico, tecnico_id, data_tarefa, auvo_link, equipamento_nome, equipamento_id_serie," +
  " gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_situacao, gc_os_situacao_id, gc_os_valor_total, gc_os_data, gc_os_link," +
  " gc_os_tarefa_exec, gc_os_local_reparo, gc_orcamento_id, gc_orcamento_codigo, gc_orc_cliente, gc_orc_situacao," +
  " gc_orc_situacao_id, gc_orc_valor_total, gc_orc_data, gc_orc_link";

type Row = Record<string, any>;

type Card = {
  key: string;
  tipo: "orcamento" | "os";
  cliente: string;
  codigo: string;
  valor: number;
  equipamento: string;
  situacao: string;
  situacaoId: string;
  data: string | null;
  tecnico: string;
  local: string;
  link: string;
  auvoLink: string;
  alvo: AgendarAlvo;
};

function nomeEquipamento(r: Row): string {
  const nome = String(r.equipamento_nome ?? "").trim();
  const serie = String(r.equipamento_id_serie ?? "").trim();
  if (nome && serie) return `${nome} · ${serie}`;
  return nome || serie || "Equipamento não informado";
}

function toAlvo(r: Row): AgendarAlvo {
  return {
    auvo_task_id: r.auvo_task_id ? String(r.auvo_task_id) : null,
    mirror_key: r.mirror_key ?? null,
    exec_task_id: parseExecTaskId(r.gc_os_tarefa_exec) || (r.auvo_task_id ? String(r.auvo_task_id) : null),
    gc_os_id: r.gc_os_id ?? null,
    gc_orcamento_id: r.gc_orcamento_id ?? null,
    gc_os_codigo: r.gc_os_codigo ?? null,
    cliente: String(r.gc_os_cliente || r.gc_orc_cliente || r.cliente || "Cliente não informado"),
    equipamento: nomeEquipamento(r),
    data_tarefa: r.data_tarefa ?? null,
    tecnico_id: r.tecnico_id ?? null,
  };
}

async function fetchRows() {
  const [orc, os] = await Promise.all([
    supabase.from("tarefas_central").select(COLS).in("gc_orc_situacao_id", ORC_PECA_SITUACAO_IDS).limit(1000),
    supabase.from("tarefas_central").select(COLS).not("gc_os_id", "is", null)
      .order("gc_os_data", { ascending: false }).limit(3000),
  ]);
  if (orc.error) throw orc.error;
  if (os.error) throw os.error;
  return { orcamentos: (orc.data || []) as Row[], os: (os.data || []) as Row[] };
}

export default function AgendamentoPage() {
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<AgendarAlvo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { data: string; tecnico: string }>>({});

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agendamento-board"],
    queryFn: fetchRows,
    staleTime: 60_000,
  });

  const { orcCards, osCards } = useMemo(() => {
    const orcMap = new Map<string, Card>();
    (data?.orcamentos || []).forEach((r) => {
      const id = String(r.gc_orcamento_id || r.gc_orcamento_codigo || r.auvo_task_id || "");
      if (!id || orcMap.has(id)) return;
      orcMap.set(id, {
        key: `orc-${id}`,
        tipo: "orcamento",
        cliente: String(r.gc_orc_cliente || r.cliente || "Cliente não informado"),
        codigo: String(r.gc_orcamento_codigo || id),
        valor: parseValor(r.gc_orc_valor_total),
        equipamento: nomeEquipamento(r),
        situacao: String(r.gc_orc_situacao || ""),
        situacaoId: String(r.gc_orc_situacao_id || ""),
        data: r.gc_orc_data || null,
        tecnico: String(r.tecnico || ""),
        local: String(r.gc_os_local_reparo || ""),
        link: String(r.gc_orc_link || ""),
        auvoLink: String(r.auvo_link || ""),
        alvo: toAlvo(r),
      });
    });

    const osMap = new Map<string, Card>();
    (data?.os || []).forEach((r) => {
      if (!isOpenOsSituation(r)) return;
      const id = String(r.gc_os_id || "");
      if (!id || osMap.has(id)) return;
      const ov = overrides[id];
      osMap.set(id, {
        key: `os-${id}`,
        tipo: "os",
        cliente: String(r.gc_os_cliente || r.cliente || "Cliente não informado"),
        codigo: String(r.gc_os_codigo || id),
        valor: parseValor(r.gc_os_valor_total),
        equipamento: nomeEquipamento(r),
        situacao: String(r.gc_os_situacao || ""),
        situacaoId: String(r.gc_os_situacao_id || ""),
        data: ov?.data || r.data_tarefa || null,
        tecnico: ov?.tecnico || String(r.tecnico || ""),
        local: String(r.gc_os_local_reparo || ""),
        link: String(r.gc_os_link || ""),
        auvoLink: String(r.auvo_link || ""),
        alvo: toAlvo(r),
      });
    });

    return { orcCards: Array.from(orcMap.values()), osCards: Array.from(osMap.values()) };
  }, [data, overrides]);

  const termo = busca.trim().toLowerCase();
  const filtra = (c: Card) =>
    !termo ||
    [c.cliente, c.codigo, c.equipamento, c.tecnico, c.situacao].some((v) => v.toLowerCase().includes(termo));

  const orcFiltrados = orcCards.filter(filtra);
  const osFiltrados = osCards.filter(filtra);

  const orcPorSituacao = ORC_PECA_SITUACOES.map((s) => ({
    ...s,
    cards: orcFiltrados
      .filter((c) => c.situacaoId === s.id)
      .sort((a, b) => b.valor - a.valor),
  }));

  const osPorBucket = AGENDA_BUCKETS.map((b) => ({
    ...b,
    cards: osFiltrados
      .filter((c) => getAgendaBucket(c.data, c.tecnico) === b.id)
      .sort((a, b2) => b2.valor - a.valor),
  }));

  const boardSummary = useMemo(() => {
    const linha = (c: Card) =>
      `- ${c.tipo === "os" ? "OS" : "ORC"} ${c.codigo} | ${c.cliente} | ${formatBRL(c.valor)} | ${c.equipamento} | situação: ${c.situacao}` +
      `${c.data ? ` | data: ${String(c.data).slice(0, 10)}` : " | sem data"}${c.tecnico ? ` | téc: ${c.tecnico}` : ""}`;
    const partes: string[] = [];
    orcPorSituacao.forEach((g) => {
      partes.push(`\n[ORÇAMENTOS · ${g.label}] (${g.cards.length})`);
      partes.push(...g.cards.slice(0, 25).map(linha));
    });
    osPorBucket.forEach((g) => {
      partes.push(`\n[OS ABERTAS · ${g.label}] (${g.cards.length})`);
      partes.push(...g.cards.slice(0, 30).map(linha));
    });
    return partes.join("\n");
  }, [orcPorSituacao, osPorBucket]);

  const totalOrc = orcFiltrados.reduce((s, c) => s + c.valor, 0);
  const totalOs = osFiltrados.reduce((s, c) => s + c.valor, 0);

  const abrirAgendamento = (c: Card) => {
    setAlvo(c.alvo);
    setDialogOpen(true);
  };

  const bucketTone: Record<AgendaBucket, string> = {
    nao_agendada: "border-slate-300",
    atrasada: "border-amber-400",
    hoje: "border-emerald-300",
    futura: "border-green-500",
  };

  const renderCard = (c: Card, tone?: string) => {
    const idade = diasDesde(c.tipo === "os" ? c.data : c.data);
    return (
      <div
        key={c.key}
        className={cn(
          "rounded-md border-l-4 border border-border bg-card p-2.5 shadow-sm transition hover:shadow-md",
          tone,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{c.cliente}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {c.tipo === "os" ? "OS" : "Orçamento"} {c.codigo}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{formatBRL(c.valor)}</span>
        </div>

        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.equipamento}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {c.situacao && (
            <Badge variant="outline" className="text-[10px]">
              {c.situacao}
            </Badge>
          )}
          {c.tecnico && <Badge variant="secondary" className="text-[10px]">{c.tecnico}</Badge>}
          {c.data && (
            <Badge variant="outline" className="text-[10px]">
              {String(c.data).slice(0, 10).split("-").reverse().join("/")}
            </Badge>
          )}
          {idade !== null && idade > 30 && (
            <Badge variant="destructive" className="text-[10px]">{idade}d parado</Badge>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1">
          <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => abrirAgendamento(c)}>
            <CalendarClock className="mr-1 h-3 w-3" /> Agendar
          </Button>
          {c.link && (
            <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
              <a href={c.link} target="_blank" rel="noreferrer" aria-label="Abrir no GestãoClick">
                <ExternalLink className="h-3 w-3" />
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
          <h1 className="text-lg font-semibold text-foreground">Agendamento</h1>
          <p className="text-xs text-muted-foreground">
            Peças em compra/chegada e OS prontas para execução, com copiloto de decisão.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Cliente, OS, equipamento..."
              className="h-8 w-64 pl-7 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando quadro...
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {/* Faixa 1 — orçamentos aguardando peça */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Peças · orçamentos aprovados</h2>
                <Badge variant="secondary" className="text-[10px]">
                  {orcFiltrados.length} · {formatBRL(totalOrc)}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {orcPorSituacao.map((col) => (
                  <div key={col.id} className="rounded-lg border border-border bg-muted/30 p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">{col.short}</span>
                      <Badge variant="outline" className="text-[10px]">{col.cards.length}</Badge>
                    </div>
                    <div className="max-h-[320px] space-y-2 overflow-y-auto">
                      {col.cards.length === 0 ? (
                        <p className="py-6 text-center text-[11px] text-muted-foreground">Nada aqui</p>
                      ) : (
                        col.cards.map((c) => renderCard(c, "border-l-primary"))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Faixa 2 — OS disponíveis */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">OS disponíveis para agendar</h2>
                <Badge variant="secondary" className="text-[10px]">
                  {osFiltrados.length} · {formatBRL(totalOs)}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {osPorBucket.map((col) => (
                  <div key={col.id} className="rounded-lg border border-border bg-muted/30 p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold" title={col.hint}>{col.label}</span>
                      <Badge variant="outline" className="text-[10px]">{col.cards.length}</Badge>
                    </div>
                    <div className="max-h-[420px] space-y-2 overflow-y-auto">
                      {col.cards.length === 0 ? (
                        <p className="py-6 text-center text-[11px] text-muted-foreground">Nada aqui</p>
                      ) : (
                        col.cards.map((c) => renderCard(c, bucketTone[col.id]))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="min-h-0 xl:h-full">
            <AgendamentoAiPanel
              boardSummary={boardSummary}
              contexto={{
                orcamentos_aguardando_peca: orcFiltrados.length,
                valor_orcamentos: totalOrc,
                os_disponiveis: osFiltrados.length,
                valor_os: totalOs,
              }}
            />
          </div>
        </div>
      )}

      <AgendarTarefaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        alvo={alvo}
        onSaved={({ dataTarefa, tecnico }) => {
          if (alvo?.gc_os_id) {
            setOverrides((prev) => ({ ...prev, [String(alvo.gc_os_id)]: { data: dataTarefa, tecnico } }));
          }
          refetch();
        }}
      />
    </div>
  );
}