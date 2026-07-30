import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, ExternalLink, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";

const STATUS_ANALISE = [
  { value: "nova", label: "Nova" },
  { value: "em_analise", label: "Em análise" },
  { value: "aguardando_definicao", label: "Aguardando definição" },
  { value: "concluida", label: "Concluída" },
  { value: "descartada", label: "Descartada" },
];

const PRIORIDADES = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

const statusLabel = (v?: string | null) => STATUS_ANALISE.find((s) => s.value === v)?.label || v || "—";
const prioLabel = (v?: string | null) => PRIORIDADES.find((p) => p.value === v)?.label || v || "—";

const prioClass = (v?: string | null) =>
  v === "critica"
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : v === "alta"
      ? "bg-orange-500/15 text-orange-600 border-orange-500/30"
      : v === "media"
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";

const statusClass = (v?: string | null) =>
  v === "concluida"
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
    : v === "descartada"
      ? "bg-muted text-muted-foreground border-border"
      : v === "em_analise"
        ? "bg-primary/15 text-primary border-primary/30"
        : v === "aguardando_definicao"
          ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
          : "bg-sky-500/15 text-sky-600 border-sky-500/30";

const semPendencia = (p?: string | null) => !p || /sem pend/i.test(p);

const fmtDate = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR") : "—");

type Analise = {
  id: string;
  auvo_task_id: string;
  equipamento_nome: string | null;
  identificador: string | null;
  cliente: string | null;
  grupo_nome: string | null;
  marca: string | null;
  categoria: string | null;
  tecnico: string | null;
  data_preventiva: string | null;
  status_tarefa: string | null;
  status_analise: string;
  prioridade: string;
  diagnostico_ia: string | null;
  pendencia: string | null;
  acao_sugerida: string | null;
  satisfacao: number | null;
  auvo_link: string | null;
  contexto: any;
  observacoes_gerenciais: string | null;
  data_analise: string;
};

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function AnalisesOperacionaisPage() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();

  const [inicio, setInicio] = useState(firstDayOfMonth());
  const [fim, setFim] = useState(new Date().toISOString().slice(0, 10));
  const [busca, setBusca] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fGrupo, setFGrupo] = useState("");
  const [fEquip, setFEquip] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fTecnico, setFTecnico] = useState("");
  const [fPrioridade, setFPrioridade] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fStatusTarefa, setFStatusTarefa] = useState("");
  const [fPendencia, setFPendencia] = useState("");
  const [fSatisfacao, setFSatisfacao] = useState("");
  const [cardFilter, setCardFilter] = useState<string>("");
  const [gerando, setGerando] = useState(false);
  const [selected, setSelected] = useState<Analise | null>(null);

  const { data: analises = [], isFetching, refetch } = useQuery({
    queryKey: ["analises-operacionais", inicio, fim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analises_operacionais")
        .select("*")
        .gte("data_preventiva", inicio)
        .lte("data_preventiva", fim)
        .order("data_preventiva", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Analise[];
    },
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["analise-log", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analises_operacionais_log")
        .select("*")
        .eq("analise_id", selected!.id)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const uniq = (key: keyof Analise) =>
    [...new Set(analises.map((a) => (a[key] as string) || "").filter(Boolean))]
      .sort()
      .map((v) => ({ value: v, label: v }));

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return analises.filter((a) => {
      if (fCliente && a.cliente !== fCliente) return false;
      if (fGrupo && a.grupo_nome !== fGrupo) return false;
      if (fEquip && a.equipamento_nome !== fEquip) return false;
      if (fMarca && a.marca !== fMarca) return false;
      if (fTecnico && a.tecnico !== fTecnico) return false;
      if (fPrioridade && a.prioridade !== fPrioridade) return false;
      if (fStatus && a.status_analise !== fStatus) return false;
      if (fStatusTarefa && a.status_tarefa !== fStatusTarefa) return false;
      if (fPendencia && a.pendencia !== fPendencia) return false;
      if (fSatisfacao) {
        const s = a.satisfacao ?? -1;
        if (fSatisfacao === "alta" && s < 80) return false;
        if (fSatisfacao === "media" && (s < 50 || s >= 80)) return false;
        if (fSatisfacao === "baixa" && (s < 0 || s >= 50)) return false;
      }
      if (cardFilter) {
        if (cardFilter === "sem_pendencia" && !semPendencia(a.pendencia)) return false;
        if (cardFilter === "com_pendencia" && semPendencia(a.pendencia)) return false;
        if (cardFilter === "critica" && a.prioridade !== "critica") return false;
        if (STATUS_ANALISE.some((s) => s.value === cardFilter) && a.status_analise !== cardFilter) return false;
      }
      if (q) {
        const hay = [a.cliente, a.equipamento_nome, a.identificador, a.tecnico, a.diagnostico_ia, a.pendencia, a.auvo_task_id]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [analises, busca, fCliente, fGrupo, fEquip, fMarca, fTecnico, fPrioridade, fStatus, fStatusTarefa, fPendencia, fSatisfacao, cardFilter]);

  const stats = useMemo(() => {
    const by = (s: string) => analises.filter((a) => a.status_analise === s).length;
    const sats = analises.map((a) => a.satisfacao).filter((s): s is number => typeof s === "number");
    return {
      total: analises.length,
      nova: by("nova"),
      em_analise: by("em_analise"),
      aguardando_definicao: by("aguardando_definicao"),
      concluida: by("concluida"),
      descartada: by("descartada"),
      sem_pendencia: analises.filter((a) => semPendencia(a.pendencia)).length,
      com_pendencia: analises.filter((a) => !semPendencia(a.pendencia)).length,
      critica: analises.filter((a) => a.prioridade === "critica").length,
      satisfacao: sats.length ? Math.round(sats.reduce((s, v) => s + v, 0) / sats.length) : null,
    };
  }, [analises]);

  const gerarAnalises = async (force = false) => {
    setGerando(true);
    try {
      let restantes = 1;
      let total = 0;
      let voltas = 0;
      while (restantes > 0 && voltas < 25) {
        voltas++;
        const { data, error } = await supabase.functions.invoke("analises-operacionais", {
          body: { inicio, fim, force: force && voltas === 1, limit: 20 },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Falha ao gerar análises");
        total += data.processadas || 0;
        restantes = data.restantes || 0;
        if (data.falhas?.length) console.warn("Falhas IA:", data.falhas);
        if (!data.processadas && !restantes) break;
        await refetch();
      }
      toast.success(total ? `${total} análise(s) geradas pela IA` : "Nenhuma preventiva nova para analisar");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar análises");
    } finally {
      setGerando(false);
      qc.invalidateQueries({ queryKey: ["analises-operacionais"] });
    }
  };

  const alterarStatus = async (analise: Analise, novo: string) => {
    const anterior = analise.status_analise;
    if (anterior === novo) return;
    const { error } = await supabase.from("analises_operacionais").update({ status_analise: novo }).eq("id", analise.id);
    if (error) return toast.error("Não foi possível alterar o status");
    await supabase.from("analises_operacionais_log").insert({
      analise_id: analise.id,
      status_anterior: anterior,
      status_novo: novo,
      user_id: user?.id ?? null,
      user_nome: profile?.nome ?? user?.email ?? null,
    });
    setSelected((prev) => (prev && prev.id === analise.id ? { ...prev, status_analise: novo } : prev));
    qc.invalidateQueries({ queryKey: ["analises-operacionais"] });
    qc.invalidateQueries({ queryKey: ["analise-log", analise.id] });
    toast.success("Status atualizado");
  };

  const salvarObs = async (analise: Analise, texto: string) => {
    const { error } = await supabase
      .from("analises_operacionais")
      .update({ observacoes_gerenciais: texto })
      .eq("id", analise.id);
    if (error) return toast.error("Não foi possível salvar a observação");
    qc.invalidateQueries({ queryKey: ["analises-operacionais"] });
    toast.success("Observação salva");
  };

  const cards = [
    { key: "", label: "Total de análises", value: stats.total },
    { key: "nova", label: "Novas", value: stats.nova },
    { key: "em_analise", label: "Em análise", value: stats.em_analise },
    { key: "aguardando_definicao", label: "Aguardando definição", value: stats.aguardando_definicao },
    { key: "concluida", label: "Concluídas", value: stats.concluida },
    { key: "descartada", label: "Descartadas", value: stats.descartada },
    { key: "sem_pendencia", label: "Sem pendências", value: stats.sem_pendencia },
    { key: "com_pendencia", label: "Com pendências", value: stats.com_pendencia },
    { key: "critica", label: "Prioridade crítica", value: stats.critica },
    { key: "__sat", label: "Satisfação média", value: stats.satisfacao === null ? "—" : `${stats.satisfacao}%` },
  ];

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-6 py-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <Brain className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Análises Operacionais</h1>
            <p className="text-xs text-muted-foreground">Camada de inteligência sobre as preventivas realizadas</p>
          </div>
        </div>
        <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-[150px]" />
        <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-[150px]" />
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4 mr-1.5", isFetching && "animate-spin")} /> Atualizar
        </Button>
        <Button size="sm" onClick={() => gerarAnalises(false)} disabled={gerando}>
          {gerando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
          Gerar análises
        </Button>
        <Button variant="outline" size="sm" onClick={() => gerarAnalises(true)} disabled={gerando}>
          Reprocessar período
        </Button>
      </header>

      <div className="px-6 py-4 space-y-4 flex-1 overflow-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {cards.map((c) => {
            const active = c.key !== "__sat" && cardFilter === c.key;
            return (
              <Card
                key={c.label}
                onClick={() => c.key !== "__sat" && setCardFilter(c.key)}
                className={cn(
                  "p-3 transition-colors",
                  c.key !== "__sat" && "cursor-pointer hover:border-primary/50",
                  active && "border-primary bg-primary/5",
                )}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{c.label}</p>
                <p className="text-xl font-semibold mt-1">{c.value}</p>
              </Card>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-[240px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
          </div>
          <SearchableSelect className="w-[180px]" options={uniq("cliente")} value={fCliente} onValueChange={setFCliente} placeholder="Cliente" />
          <SearchableSelect className="w-[160px]" options={uniq("grupo_nome")} value={fGrupo} onValueChange={setFGrupo} placeholder="Grupo" />
          <SearchableSelect className="w-[180px]" options={uniq("equipamento_nome")} value={fEquip} onValueChange={setFEquip} placeholder="Equipamento" />
          <SearchableSelect className="w-[140px]" options={uniq("marca")} value={fMarca} onValueChange={setFMarca} placeholder="Marca" />
          <SearchableSelect className="w-[170px]" options={uniq("tecnico")} value={fTecnico} onValueChange={setFTecnico} placeholder="Técnico" />
          <SearchableSelect className="w-[150px]" options={PRIORIDADES} value={fPrioridade} onValueChange={setFPrioridade} placeholder="Prioridade" />
          <SearchableSelect className="w-[180px]" options={STATUS_ANALISE} value={fStatus} onValueChange={setFStatus} placeholder="Status da análise" />
          <SearchableSelect className="w-[160px]" options={uniq("status_tarefa")} value={fStatusTarefa} onValueChange={setFStatusTarefa} placeholder="Status da tarefa" />
          <SearchableSelect className="w-[190px]" options={uniq("pendencia")} value={fPendencia} onValueChange={setFPendencia} placeholder="Pendência" />
          <SearchableSelect
            className="w-[160px]"
            options={[
              { value: "alta", label: "Satisfação ≥ 80%" },
              { value: "media", label: "Satisfação 50–79%" },
              { value: "baixa", label: "Satisfação < 50%" },
            ]}
            value={fSatisfacao}
            onValueChange={setFSatisfacao}
            placeholder="Satisfação"
          />
          <SearchableSelect className="w-[170px]" options={uniq("categoria")} value={""} onValueChange={() => {}} placeholder="Tipo de plano" />
          {(cardFilter || fCliente || fGrupo || fEquip || fMarca || fTecnico || fPrioridade || fStatus || fStatusTarefa || fPendencia || fSatisfacao || busca) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCardFilter(""); setFCliente(""); setFGrupo(""); setFEquip(""); setFMarca(""); setFTecnico("");
                setFPrioridade(""); setFStatus(""); setFStatusTarefa(""); setFPendencia(""); setFSatisfacao(""); setBusca("");
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status análise</TableHead>
                <TableHead>Prior.</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Últ. preventiva</TableHead>
                <TableHead>Status tarefa</TableHead>
                <TableHead className="min-w-[280px]">Diagnóstico IA</TableHead>
                <TableHead>Pendência</TableHead>
                <TableHead>Ação sugerida</TableHead>
                <TableHead>Satisf.</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Análise</TableHead>
                <TableHead className="text-right">Tarefa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-sm text-muted-foreground py-10">
                    {isFetching ? "Carregando..." : "Nenhuma análise no período. Clique em \"Gerar análises\"."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                  <TableCell>
                    <Badge variant="outline" className={statusClass(a.status_analise)}>{statusLabel(a.status_analise)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={prioClass(a.prioridade)}>{prioLabel(a.prioridade)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">{a.cliente || "—"}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{a.equipamento_nome || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{a.identificador || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(a.data_preventiva)}</TableCell>
                  <TableCell className="text-xs">{a.status_tarefa || "—"}</TableCell>
                  <TableCell className="text-xs max-w-[320px]"><span className="line-clamp-2">{a.diagnostico_ia || "—"}</span></TableCell>
                  <TableCell className="text-xs">{a.pendencia || "—"}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate">{a.acao_sugerida || "—"}</TableCell>
                  <TableCell className="text-xs">{a.satisfacao === null ? "—" : `${a.satisfacao}%`}</TableCell>
                  <TableCell className="text-xs max-w-[140px] truncate">{a.tecnico || "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(a.data_analise)}</TableCell>
                  <TableCell className="text-right">
                    {a.auvo_link && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); window.open(a.auvo_link!, "_blank"); }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <DetalhePainel
              analise={selected}
              historico={historico as any[]}
              onStatus={(s) => alterarStatus(selected, s)}
              onSalvarObs={(t) => salvarObs(selected, t)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="text-sm whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function DetalhePainel({
  analise,
  historico,
  onStatus,
  onSalvarObs,
}: {
  analise: Analise;
  historico: any[];
  onStatus: (s: string) => void;
  onSalvarObs: (t: string) => void;
}) {
  const [obs, setObs] = useState(analise.observacoes_gerenciais || "");
  useEffect(() => setObs(analise.observacoes_gerenciais || ""), [analise.id, analise.observacoes_gerenciais]);
  const ctx = analise.contexto || {};

  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-8">{analise.equipamento_nome || "Equipamento"}</SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={statusClass(analise.status_analise)}>{statusLabel(analise.status_analise)}</Badge>
          <Badge variant="outline" className={prioClass(analise.prioridade)}>{prioLabel(analise.prioridade)}</Badge>
          {analise.satisfacao !== null && <Badge variant="outline">Satisfação {analise.satisfacao}%</Badge>}
          {analise.auvo_link && (
            <Button variant="outline" size="sm" onClick={() => window.open(analise.auvo_link!, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir tarefa no Auvo
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Bloco titulo="Cliente">{analise.cliente || "—"}</Bloco>
          <Bloco titulo="Grupo">{analise.grupo_nome || "—"}</Bloco>
          <Bloco titulo="Identificador">{analise.identificador || "—"}</Bloco>
          <Bloco titulo="Marca / Categoria">{[analise.marca, analise.categoria].filter(Boolean).join(" / ") || "—"}</Bloco>
          <Bloco titulo="Última preventiva">{fmtDate(analise.data_preventiva)}</Bloco>
          <Bloco titulo="Status da tarefa">{analise.status_tarefa || "—"}</Bloco>
          <Bloco titulo="Técnico">{analise.tecnico || "—"}</Bloco>
          <Bloco titulo="Tarefa Auvo">{analise.auvo_task_id}</Bloco>
        </div>

        <Bloco titulo="Resumo da IA">{analise.diagnostico_ia || "—"}</Bloco>
        <Bloco titulo="Pendência identificada">{analise.pendencia || "—"}</Bloco>
        <Bloco titulo="Ação sugerida">{analise.acao_sugerida || "—"}</Bloco>
        <Bloco titulo="Relato do cliente">{ctx.relato_cliente || "—"}</Bloco>
        <Bloco titulo="Relato do técnico">{ctx.relato_tecnico || "—"}</Bloco>
        <Bloco titulo="Pendência registrada na tarefa">{ctx.pendencia_registrada || "—"}</Bloco>
        <Bloco titulo="Ordem de Serviço Simplificada">
          <pre className="text-xs bg-muted/40 rounded-md p-2 max-h-64 overflow-auto whitespace-pre-wrap">
            {typeof ctx.os_simplificada === "string" ? ctx.os_simplificada : JSON.stringify(ctx.os_simplificada ?? {}, null, 2)}
          </pre>
        </Bloco>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status da análise</p>
          <Select value={analise.status_analise} onValueChange={onStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_ANALISE.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações gerenciais</p>
          <Textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} />
          <Button size="sm" onClick={() => onSalvarObs(obs)}>Salvar observação</Button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Histórico de status</p>
          {historico.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>}
          <div className="space-y-1.5">
            {historico.map((h) => (
              <div key={h.id} className="text-xs border border-border rounded-md p-2">
                <span className="font-medium">{statusLabel(h.status_anterior)} → {statusLabel(h.status_novo)}</span>
                <span className="text-muted-foreground"> · {fmtDateTime(h.criado_em)} · {h.user_nome || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
