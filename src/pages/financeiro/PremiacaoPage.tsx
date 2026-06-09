import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trophy, Wrench, Package, Calculator, ChevronDown, ChevronRight, ExternalLink, FileText, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Users2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DemeritosManager } from "@/components/financeiro/DemeritosManager";
import { MetasManager } from "@/components/financeiro/MetasManager";
import { gerarPdfsTelemetrias, gerarPdfTecnico } from "@/lib/pdf/telemetriaPdf";
import { toast } from "@/hooks/use-toast";

type ItemRow = {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  deslocamento?: boolean;
  nao_comissionado?: boolean;
};
type OsRow = {
  gc_os_id: string;
  gc_os_codigo: string;
  cliente: string;
  data_saida: string;
  valor_pecas: number;
  valor_servicos: number;
  comissao_pecas: number;
  comissao_servicos: number;
  comissao_total: number;
  pecas_count: number;
  servicos_count: number;
  situacao?: string;
  cor_situacao?: string;
  gc_link?: string;
  auvo_link?: string | null;
  itens_pecas?: ItemRow[];
  itens_servicos?: ItemRow[];
  contrato?: { nome: string; valor_hora: number; taxa: number; taxa_peca?: number; horas: number; base_servico: number } | null;
  retorno?: { tecnico: string } | null;
  tecnico_execucao?: string | null;
  divergente_execucao?: boolean;
  compartilhada_com?: string | null;
};
type Tech = {
  tecnico: string;
  tecnico_id: string;
  os_count: number;
  valor_pecas: number;
  valor_servicos: number;
  faturamento?: number;
  comissao_pecas: number;
  comissao_servicos: number;
  comissao_total: number;
  ordens: OsRow[];
  km_total?: number;
  telemetrias?: number;
  km_por_telemetria?: number | null;
  km_motorista_match?: string | null;
  reducao_pct?: number;
  reducao_valor?: number;
  reducoes?: Array<{ motivo: string; pct: number; valor: number }>;
  comissao_final?: number;
  meta?: number | null;
  meta_atingida?: boolean;
  bonus_meta_pct?: number;
  bonus_meta_valor?: number;
  preventivas?: {
    count: number;
    horas: number;
    valor: number;
    atividades: Array<{
      auvo_task_id: string;
      data: string;
      cliente: string;
      contrato?: string | null;
      horas: number;
      valor_hora: number;
      valor: number;
      auvo_link?: string | null;
      pendencia?: string | null;
    }>;
  };
};
type Resp = {
  ok: boolean;
  error?: string;
  month: string;
  os_total: number;
  os_detalhadas: number;
  tecnicos: Tech[];
  totais: {
    os_count: number;
    valor_pecas: number;
    valor_servicos: number;
    comissao_pecas: number;
    comissao_servicos: number;
    comissao_total: number;
    reducao_valor?: number;
    comissao_final?: number;
  };
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatBonusMetaPct = (t: Tech) => {
  const pct = t.bonus_meta_pct && t.bonus_meta_pct > 0
    ? t.bonus_meta_pct
    : (t.comissao_total > 0 ? (t.bonus_meta_valor || 0) / t.comissao_total : 0);
  const percent = Math.round(pct * 1000) / 10;
  return percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PREMIACAO_MONTH_STORAGE_KEY = "premiacao:active-month";

function initialMonth(): string {
  try {
    const stored = window.localStorage.getItem(PREMIACAO_MONTH_STORAGE_KEY);
    if (stored && /^\d{4}-\d{2}$/.test(stored)) return stored;
  } catch {
    // Ignora indisponibilidade do localStorage e usa o mês atual.
  }
  return currentMonth();
}

function persistMonth(month: string) {
  try {
    window.localStorage.setItem(PREMIACAO_MONTH_STORAGE_KEY, month);
  } catch {
    // Persistência é apenas conveniência para não resetar ao voltar para a aba.
  }
}

function monthChunks(month: string, chunkSizeDays = 7): Array<{ start: string; end: string }> {
  const [year, mon] = month.split("-").map(Number);
  const endDate = new Date(Date.UTC(year, mon, 0));
  const cursor = new Date(Date.UTC(year, mon - 1, 1));
  const chunks: Array<{ start: string; end: string }> = [];

  while (cursor <= endDate) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkSizeDays - 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    chunks.push({
      start: chunkStart.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    cursor.setUTCDate(cursor.getUTCDate() + chunkSizeDays);
  }

  return chunks;
}

export default function PremiacaoPage() {
  const [month, setMonth] = useState<string>(() => initialMonth());
  const [activeMonth, setActiveMonth] = useState<string>(() => initialMonth());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedOs, setSelectedOs] = useState<OsRow | null>(null);
  const [syncingTelemetry, setSyncingTelemetry] = useState(false);
  const [telemetryProgress, setTelemetryProgress] = useState<string | null>(null);
  const [syncingGc, setSyncingGc] = useState(false);

  const { data, isFetching, refetch, error } = useQuery<Resp>({
    queryKey: ["premiacao", activeMonth],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("premiacao", {
        body: { month: activeMonth },
      });
      if (error) throw error;
      return data as Resp;
    },
    refetchOnWindowFocus: false,
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const handleCalc = () => {
    persistMonth(month);
    if (activeMonth === month) {
      void refetch();
      return;
    }
    setActiveMonth(month);
  };

  const handleSyncTelemetry = async () => {
    if (syncingTelemetry) return;
    const chunks = monthChunks(month);
    setSyncingTelemetry(true);
    setTelemetryProgress(`0/${chunks.length}`);

    let insertedEvents = 0;
    let insertedSessions = 0;
    let errors = 0;

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        setTelemetryProgress(`${i + 1}/${chunks.length}`);
        const { data, error } = await supabase.functions.invoke("sync-tvh-telemetrias", {
          body: { start_date: chunk.start, end_date: chunk.end },
        });
        if (error) throw error;
        const result = data as { ok?: boolean; error?: string; inserted_events?: number; inserted_sessions?: number; failed?: number; persist_failures?: unknown[] };
        if (result?.ok === false) throw new Error(result.error || "Falha ao sincronizar telemetrias");
        insertedEvents += result?.inserted_events ?? 0;
        insertedSessions += result?.inserted_sessions ?? 0;
        errors += (result?.failed ?? 0) + (result?.persist_failures?.length ?? 0);
      }

      toast({
        title: "Telemetrias sincronizadas",
        description: `${insertedEvents} eventos e ${insertedSessions} sessões atualizadas${errors ? ` · ${errors} falhas` : ""}.`,
      });
      persistMonth(month);
      if (activeMonth === month) await refetch();
      else setActiveMonth(month);
    } catch (err) {
      toast({
        title: "Erro ao sincronizar telemetrias",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncingTelemetry(false);
      setTelemetryProgress(null);
    }
  };

  const handleSyncGc = async () => {
    if (syncingGc) return;
    setSyncingGc(true);
    try {
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      const endDate = new Date(y, m, 0).getDate();
      const end = `${month}-${String(endDate).padStart(2, "0")}`;
      const { data, error } = await supabase.functions.invoke("central-sync", {
        body: { start_date: start, end_date: end, gc_status_only: true, wait: true },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any)?.error || "Falha ao sincronizar GC");
      toast({
        title: "GestãoClick sincronizado",
        description: `${(data as any)?.gc_os_updated ?? 0} registros atualizados para ${month}.`,
      });
      if (activeMonth === month) await refetch();
      else setActiveMonth(month);
    } catch (err) {
      toast({
        title: "Erro ao sincronizar GC",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncingGc(false);
    }
  };

  const tecnicos = data?.tecnicos || [];
  const totais = data?.totais;

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Trophy className="h-6 w-6 text-primary" /> Premiação Técnicos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              1% sobre peças trocadas + 15% sobre serviços executados (exceto deslocamento).
              Base: OS do GestãoClick com <strong>data de saída</strong> no mês selecionado.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Mês de referência</label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={handleCalc} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Calcular
            </Button>
            <Button variant="outline" onClick={handleSyncTelemetry} disabled={syncingTelemetry}>
              <RefreshCw className={cn("h-4 w-4", syncingTelemetry && "animate-spin")} />
              {syncingTelemetry ? `Sincronizando ${telemetryProgress || ""}` : "Sincronizar telemetrias"}
            </Button>
            <Button variant="outline" onClick={handleSyncGc} disabled={syncingGc}>
              <RefreshCw className={cn("h-4 w-4", syncingGc && "animate-spin")} />
              {syncingGc ? "Sincronizando GC..." : "Sincronizar GC"}
            </Button>
            <DemeritosManager
              month={activeMonth}
              tecnicos={tecnicos.map((t) => t.tecnico)}
              onChanged={() => refetch()}
            />
            <MetasManager
              tecnicos={tecnicos.map((t) => t.tecnico)}
              onChanged={() => refetch()}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!tecnicos.length}
              onClick={() => gerarPdfsTelemetrias(activeMonth, tecnicos as any)}
            >
              <FileText className="h-4 w-4 mr-1.5" /> Espelhos (ZIP por técnico)
            </Button>
          </div>
        </div>

        {error && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Erro: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {data && !data.ok && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Erro: {data.error}
            </CardContent>
          </Card>
        )}

        {totais && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="OS no mês" value={String(totais.os_count)} icon={<Wrench className="h-4 w-4" />} />
            <KpiCard label="Valor peças" value={brl(totais.valor_pecas)} icon={<Package className="h-4 w-4" />} />
            <KpiCard label="Valor serviços" value={brl(totais.valor_servicos)} icon={<Wrench className="h-4 w-4" />} />
            <KpiCard label="Premiação peças (1%)" value={brl(totais.comissao_pecas)} />
            <KpiCard
              label="Premiação final"
              value={brl(totais.comissao_final ?? totais.comissao_total)}
              highlight
            />
          </div>
        )}
        {totais && (totais.reducao_valor ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground -mt-3">
            Bruto {brl(totais.comissao_total)} − reduções {brl(totais.reducao_valor || 0)}
          </p>
        )}

        {isFetching && !data && (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Buscando OS e calculando premiações…
          </div>
        )}

        {data?.ok && tecnicos.length === 0 && !isFetching && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              Nenhuma OS encontrada com data de saída em {activeMonth}.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {tecnicos.map((t) => {
            const key = t.tecnico_id || t.tecnico;
            const isOpen = expanded.has(key);
            return (
              <Card key={key}>
                <CardHeader className="p-4 cursor-pointer" onClick={() => toggle(key)}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{t.tecnico}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.os_count} OS · Peças {brl(t.valor_pecas)} · Serviços {brl(t.valor_servicos)}
                        </p>
                        {t.preventivas && t.preventivas.count > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            🛠 Preventivas: {t.preventivas.count} visitas · {t.preventivas.horas.toFixed(1)}h · {brl(t.preventivas.valor)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="flex items-start justify-end gap-6">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); gerarPdfTecnico(activeMonth, t as any); }}
                          title="Baixar espelho deste técnico"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <div>
                          <div className="text-xs text-muted-foreground">Faturamento</div>
                          <div className="text-xl font-semibold">{brl(t.faturamento ?? (t.valor_pecas + t.valor_servicos))}</div>
                          <div className="text-[10px] text-muted-foreground">excl. deslocamento/hosp.</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Premiação</div>
                          <div className="text-xl font-semibold text-primary">
                            {brl(t.comissao_final ?? t.comissao_total)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {brl(t.comissao_pecas)} peças + {brl(t.comissao_servicos)} serv.
                          </div>
                          {(t.reducao_valor ?? 0) > 0 && (
                            <div className="text-[10px] text-destructive mt-0.5">
                              −{brl(t.reducao_valor || 0)} ({Math.round((t.reducao_pct || 0) * 100)}% redução)
                            </div>
                          )}
                          {(t.bonus_meta_valor ?? 0) > 0 && (
                            <div className="text-[10px] text-emerald-600 mt-0.5">
                              +{brl(t.bonus_meta_valor || 0)} (bônus meta {formatBonusMetaPct(t)}%)
                            </div>
                          )}
                          {t.meta != null && t.meta > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Meta: {brl(t.meta)} · {t.meta_atingida ? "✅ atingida" : `${Math.round(((t.faturamento ?? 0) / t.meta) * 100)}%`}
                            </div>
                          )}
                          {t.km_por_telemetria != null && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              KM/telem.: {t.km_por_telemetria.toFixed(1)} km
                              {t.km_por_telemetria < 120 && " ⚠ <120"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="p-0 border-t">
                    {t.preventivas && t.preventivas.count > 0 && (
                      <div className="p-4 border-b bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <Wrench className="h-4 w-4" /> Visitas Preventivas de Contrato
                            <Badge variant="secondary" className="text-[10px]">{t.preventivas.count}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Total: <strong className="text-foreground">{t.preventivas.horas.toFixed(2)}h</strong> ·
                            Premiação: <strong className="text-primary">{brl(t.preventivas.valor)}</strong>
                          </div>
                        </div>
                        <div className="border rounded overflow-hidden bg-background">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-24">Data</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right w-20">Horas</TableHead>
                                <TableHead className="text-right w-28">R$/hora</TableHead>
                                <TableHead className="text-right w-28">Valor</TableHead>
                                <TableHead className="w-16"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {t.preventivas.atividades.map((a) => (
                                <TableRow key={a.auvo_task_id}>
                                  <TableCell className="text-xs">{a.data}</TableCell>
                                  <TableCell className="text-sm truncate max-w-[260px]">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate">{a.cliente}</span>
                                      {a.contrato && <Badge variant="secondary" className="text-[10px] shrink-0">Contrato</Badge>}
                                      {a.pendencia && (
                                        <Badge variant="destructive" className="text-[10px] shrink-0" title={a.pendencia}>
                                          Pendência
                                        </Badge>
                                      )}
                                    </div>
                                    {a.pendencia && (
                                      <p className="text-[10px] text-destructive mt-0.5 truncate" title={a.pendencia}>
                                        {a.pendencia}
                                      </p>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right text-xs">{a.horas.toFixed(2)}</TableCell>
                                  <TableCell className="text-right text-xs">{a.valor_hora > 0 ? brl(a.valor_hora) : "—"}</TableCell>
                                  <TableCell className="text-right text-sm font-medium">{brl(a.valor)}</TableCell>
                                  <TableCell className="text-right">
                                    {a.auvo_link && (
                                      <a href={a.auvo_link} target="_blank" rel="noreferrer" className="text-primary inline-flex" title="Abrir no Auvo">
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>OS</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Saída</TableHead>
                          <TableHead className="text-right">Peças</TableHead>
                          <TableHead className="text-right">Serviços</TableHead>
                          <TableHead className="text-right">Prem. peças</TableHead>
                          <TableHead className="text-right">Prem. serv.</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {t.ordens.map((o) => (
                          <TableRow
                            key={o.gc_os_id}
                            className={`cursor-pointer ${o.divergente_execucao ? "bg-destructive/10 hover:bg-destructive/20" : ""}`}
                            onClick={() => setSelectedOs(o)}
                          >
                            <TableCell className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                              {o.gc_os_codigo || o.gc_os_id}
                            </TableCell>
                            <TableCell className="text-sm truncate max-w-[220px]">
                              <div className="flex items-center gap-2">
                                <span className="truncate">{o.cliente}</span>
                                {o.contrato && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0">Contrato</Badge>
                                )}
                                {o.retorno && (
                                  <Badge className="text-[10px] shrink-0" variant="outline">Retorno</Badge>
                                )}
                                {o.divergente_execucao && o.tecnico_execucao && (
                                  <Badge variant="destructive" className="text-[10px] shrink-0" title={`Executado por ${o.tecnico_execucao}`}>
                                    Exec: {o.tecnico_execucao.split(/\s+/)[0]}
                                  </Badge>
                                )}
                                {o.compartilhada_com && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0" title={`Compartilhada com ${o.compartilhada_com}`}>
                                    <Users2 className="h-3 w-3 mr-0.5" /> 50% c/ {o.compartilhada_com.split(/\s+/)[0]}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{o.data_saida}</TableCell>
                            <TableCell className="text-right text-sm">{brl(o.valor_pecas)}</TableCell>
                            <TableCell className="text-right text-sm">{brl(o.valor_servicos)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{brl(o.comissao_pecas)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{brl(o.comissao_servicos)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold">{brl(o.comissao_total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        <OsDetailDialog
          os={selectedOs}
          onClose={() => setSelectedOs(null)}
          tecnicos={tecnicos.map((t) => ({ value: t.tecnico, label: t.tecnico }))}
          onChanged={() => refetch()}
        />
      </div>
    </div>
  );
}

function OsDetailDialog({
  os,
  onClose,
  tecnicos,
  onChanged,
}: {
  os: OsRow | null;
  onClose: () => void;
  tecnicos: Array<{ value: string; label: string }>;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [tecRetorno, setTecRetorno] = useState("");
  const [obsRetorno, setObsRetorno] = useState("");
  const [tecCompart, setTecCompart] = useState("");

  const codigo = os?.gc_os_codigo || os?.gc_os_id || "";

  const { data: retornoAtual, isLoading: loadingRet } = useQuery({
    queryKey: ["os_retorno", codigo],
    enabled: !!codigo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_retornos")
        .select("*")
        .eq("gc_os_codigo", codigo)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; tecnico_retorno: string; observacao: string | null } | null;
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!codigo) throw new Error("OS inválida");
      if (!tecRetorno.trim()) throw new Error("Selecione o técnico do retorno");
      const { error } = await supabase.from("os_retornos").upsert(
        { gc_os_codigo: codigo, tecnico_retorno: tecRetorno.trim(), observacao: obsRetorno.trim() || null },
        { onConflict: "gc_os_codigo" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Retorno registrado", description: "A OS foi movida para o técnico do retorno." });
      setTecRetorno(""); setObsRetorno("");
      qc.invalidateQueries({ queryKey: ["os_retorno", codigo] });
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async () => {
      if (!retornoAtual?.id) return;
      const { error } = await supabase.from("os_retornos").delete().eq("id", retornoAtual.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Retorno removido" });
      qc.invalidateQueries({ queryKey: ["os_retorno", codigo] });
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const { data: compartAtual, isLoading: loadingCompart } = useQuery({
    queryKey: ["os_compartilhada", codigo],
    enabled: !!codigo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("premiacao_os_compartilhada")
        .select("id, tecnico_secundario, observacao")
        .eq("gc_os_codigo", codigo)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; tecnico_secundario: string; observacao: string | null } | null;
    },
  });

  const saveCompartMut = useMutation({
    mutationFn: async () => {
      if (!codigo) throw new Error("OS inválida");
      if (!tecCompart.trim()) throw new Error("Selecione o segundo técnico");
      const { error } = await supabase.from("premiacao_os_compartilhada").upsert(
        { gc_os_codigo: codigo, tecnico_secundario: tecCompart.trim() },
        { onConflict: "gc_os_codigo" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "OS compartilhada", description: "Valor dividido 50/50 entre os dois técnicos." });
      setTecCompart("");
      qc.invalidateQueries({ queryKey: ["os_compartilhada", codigo] });
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const delCompartMut = useMutation({
    mutationFn: async () => {
      if (!compartAtual?.id) return;
      const { error } = await supabase.from("premiacao_os_compartilhada").delete().eq("id", compartAtual.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Compartilhamento removido" });
      qc.invalidateQueries({ queryKey: ["os_compartilhada", codigo] });
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!os} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {os && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 flex-wrap">
                <span>OS #{os.gc_os_codigo || os.gc_os_id}</span>
                {os.situacao && (
                  <Badge
                    variant="outline"
                    style={os.cor_situacao ? { borderColor: os.cor_situacao, color: os.cor_situacao } : undefined}
                  >
                    {os.situacao}
                  </Badge>
                )}
                {os.gc_link && (
                  <a
                    href={os.gc_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Abrir no GC <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {os.auvo_link && (
                  <a
                    href={os.auvo_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Abrir no Auvo <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {os.cliente} · Saída {os.data_saida}
              </p>
            </DialogHeader>

            <div className="space-y-5 mt-2">
              <ItemSection
                title="Peças"
                icon={<Package className="h-4 w-4" />}
                items={os.itens_pecas || []}
                totalLabel="Total peças"
                total={os.valor_pecas}
                commissionLabel={os.contrato ? `Premiação contrato (${((os.contrato.taxa_peca ?? 0.02) * 100).toFixed(1)}%)` : "Premiação (1%)"}
                commission={os.comissao_pecas}
                emptyMsg="Sem peças nesta OS"
              />
              <ItemSection
                title="Serviços"
                icon={<Wrench className="h-4 w-4" />}
                items={os.itens_servicos || []}
                totalLabel="Total serviços GC (sem deslocamento)"
                total={os.valor_servicos}
                commissionLabel={os.contrato && os.contrato.base_servico > 0 ? `Premiação contrato (${(os.contrato.taxa * 100).toFixed(1)}%)` : "Premiação (15% / 10% / 5%)"}
                commission={os.comissao_servicos}
                emptyMsg="Sem serviços nesta OS"
                highlightDeslocamento
              />

              {os.contrato && os.contrato.base_servico > 0 && (
                <div className="border rounded-md p-3 bg-muted/30 text-sm space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <Badge variant="secondary">Contrato</Badge>
                    <span>{os.contrato.nome}</span>
                  </div>
                  <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                    <span>Valor/hora: <b>{brl(os.contrato.valor_hora)}</b></span>
                    <span>Horas trabalhadas: <b>{os.contrato.horas.toFixed(2)}h</b></span>
                    <span>Base de premiação: <b>{brl(os.contrato.base_servico)}</b></span>
                    <span>Taxa: <b>{(os.contrato.taxa * 100).toFixed(1)}%</b></span>
                  </div>
                </div>
              )}

              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-sm font-medium">Premiação total da OS</span>
                <span className="text-lg font-semibold text-primary">{brl(os.comissao_total)}</span>
              </div>

              <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <RotateCcw className="h-4 w-4" /> Retorno
                  {retornoAtual && (
                    <Badge variant="outline" className="text-[10px]">
                      Atribuído a {retornoAtual.tecnico_retorno}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Move esta OS (premiação + faturamento) para o técnico que atendeu o retorno.
                </p>
                {loadingRet ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
                  </div>
                ) : retornoAtual ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      Obs: {retornoAtual.observacao || "—"}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate()} disabled={delMut.isPending}>
                      <Trash2 className="h-4 w-4 text-destructive mr-1" /> Remover retorno
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Técnico do retorno</label>
                      <SearchableSelect
                        options={tecnicos}
                        value={tecRetorno}
                        onValueChange={setTecRetorno}
                        placeholder="Selecionar técnico…"
                        searchPlaceholder="Buscar técnico…"
                        emptyText="Nenhum técnico encontrado."
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Observação (opcional)</label>
                      <Input value={obsRetorno} onChange={(e) => setObsRetorno(e.target.value)} placeholder="Motivo do retorno…" />
                    </div>
                    <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !tecRetorno}>
                      {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Mover OS
                    </Button>
                  </div>
                )}
              </div>

              <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users2 className="h-4 w-4" /> Compartilhar serviço (higienização de coifa)
                  {compartAtual && (
                    <Badge variant="outline" className="text-[10px]">
                      50% com {compartAtual.tecnico_secundario}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Divide 50/50 todos os valores e a contagem desta OS com um segundo técnico.
                  Use para coifas feitas por dupla.
                </p>
                {loadingCompart ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
                  </div>
                ) : compartAtual ? (
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => delCompartMut.mutate()} disabled={delCompartMut.isPending}>
                      <Trash2 className="h-4 w-4 text-destructive mr-1" /> Remover divisão
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Segundo técnico</label>
                      <SearchableSelect
                        options={tecnicos}
                        value={tecCompart}
                        onValueChange={setTecCompart}
                        placeholder="Selecionar técnico…"
                        searchPlaceholder="Buscar técnico…"
                        emptyText="Nenhum técnico encontrado."
                        className="w-full"
                      />
                    </div>
                    <Button onClick={() => saveCompartMut.mutate()} disabled={saveCompartMut.isPending || !tecCompart}>
                      {saveCompartMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users2 className="h-4 w-4" />}
                      Dividir 50/50
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemSection({
  title, icon, items, totalLabel, total, commissionLabel, commission, emptyMsg, highlightDeslocamento,
}: {
  title: string; icon: React.ReactNode; items: ItemRow[];
  totalLabel: string; total: number;
  commissionLabel: string; commission: number;
  emptyMsg: string; highlightDeslocamento?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm font-medium">
        {icon} {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic p-3 border rounded">{emptyMsg}</div>
      ) : (
        <div className="border rounded overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right w-20">Qtd</TableHead>
                <TableHead className="text-right w-28">Unitário</TableHead>
                <TableHead className="text-right w-28">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={i} className={cn(highlightDeslocamento && it.nao_comissionado && "opacity-60")}>
                  <TableCell className="text-sm">
                    {it.descricao}
                    {highlightDeslocamento && it.nao_comissionado && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">não comissionado</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">{it.quantidade}</TableCell>
                  <TableCell className="text-right text-xs">{brl(it.valor_unitario)}</TableCell>
                  <TableCell className="text-right text-sm">{brl(it.valor_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        <span>{totalLabel}: <strong className="text-foreground">{brl(total)}</strong></span>
        <span>{commissionLabel}: <strong className="text-primary">{brl(commission)}</strong></span>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, highlight }: { label: string; value: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className={cn(highlight && "border-primary/50 bg-primary/5")}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div className={cn("text-lg font-semibold mt-1", highlight && "text-primary")}>{value}</div>
      </CardContent>
    </Card>
  );
}