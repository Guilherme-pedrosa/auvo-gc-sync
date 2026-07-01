import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Wand2, AlertTriangle, Sparkles, RefreshCw } from "lucide-react";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Item = {
  equip_id: string;
  codigo_barras_auvo: string;
  nome: string;
  cliente: string | null;
  categoria: string;
  criticidade: "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
  periodicidade: string;
  horas_por_tecnico: number;
  qtd_tecnicos: number;
  ht_por_ocorrencia: number;
  freq: number;
  ht_total_ano: number;
  mes_inicio_ciclo: number;
  meses_planejados: number[];
  meses_forcados?: number[];
  ultima_preventiva: string | null;
  status: "nunca" | "vencido" | "em_dia";
  atraso_meses: number;
  tipo_source: string;
  keyword_match: string | null;
};

type PreviewResp = {
  ok: true;
  ano_referencia: number;
  cliente_nome: string;
  contrato: { horas_mes_contratadas: number; vigencia_inicio: string | null; fonte: "cliente" | "grupo" };
  resumo: {
    total: number; nunca: number; vencidos: number; em_dia: number;
    sem_tipo_count: number; ht_ano: number; ht_contrato_ano: number;
    saldo_ano: number; meses_negativos: number;
  };
  sem_tipo: Array<{ equip_id: string; nome: string; cliente: string | null }>;
  warnings?: Array<{ equip_id: string; nome: string; motivo: string }>;
  fonte_ultima_preventiva?: "consolidado" | "scan";
  tabela_meses: Array<{ mes: number; ht_agendada: number; teto: number; saldo: number }>;
  itens: Item[];
};

const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const PERIOD_MESES: Record<string, number> = {
  MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, QUADRIMESTRAL: 4, SEMESTRAL: 6, ANUAL: 12,
};
const periodMeses = (p: string) => PERIOD_MESES[(p || "").toUpperCase()] ?? 6;

// Regenera cadeia a partir de um mês inicial usando a periodicidade
const chainFrom = (inicio: number, p: string): number[] => {
  const step = periodMeses(p);
  const out: number[] = [];
  for (let m = inicio; m >= 1 && m <= 12; m += step) out.push(m);
  return out;
};

// Gera cadeia bidirecional (pra frente E pra trás) a partir de um mês âncora
const chainAround = (anchor: number, p: string): number[] => {
  const step = periodMeses(p);
  const set = new Set<number>();
  for (let m = anchor; m >= 1; m -= step) set.add(m);
  for (let m = anchor; m <= 12; m += step) set.add(m);
  return Array.from(set).sort((a, b) => a - b);
};

// Retorna o mês (1-12) da última preventiva executada, se estiver dentro do ano de referência
const executedMonthOf = (ultima: string | null, ano: number): number | null => {
  if (!ultima) return null;
  const s = String(ultima).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y !== ano || mo < 1 || mo > 12) return null;
  return mo;
};

const statusBg: Record<string, string> = {
  nunca: "bg-red-100 text-red-900",
  vencido: "bg-amber-100 text-amber-900",
  em_dia: "bg-emerald-100 text-emerald-900",
};

const statusLabel = (s: string, atraso: number) => {
  if (s === "nunca") return `Nunca fez (${atraso}m)`;
  if (s === "vencido") return `Vencido há ${atraso}m`;
  return "Em dia";
};

export default function GerarPlanoPreventivasDialog({
  open, onOpenChange, clientes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupos?: Array<{ id: string; nome: string }>;
  clientes: string[];
}) {
  const anoAtual = new Date().getFullYear();
  const queryClient = useQueryClient();
  const [clienteNome, setClienteNome] = useState("");
  const [ano, setAno] = useState(anoAtual);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const suppressCellClickUntilRef = useRef(0);
  const manualOverridesRef = useRef<Map<string, Override>>(new Map());

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErrCode(null);
      setErrMsg(null);
      setRemovidos(new Set());
      setBusca("");
      setSelecionados(new Set());
      manualOverridesRef.current.clear();
    }
  }, [open]);

  type Override = { periodicidade?: string; ht_por_ocorrencia?: number; horas_por_tecnico?: number };
  const onPreview = async (opts?: { keepRemovidos?: boolean; excluir?: string[]; overrides?: Map<string, Override> }) => {
    if (!clienteNome) return toast.error("Selecione um cliente");
    setLoading(true);
    setErrCode(null);
    setErrMsg(null);
    try {
      const excluir = opts?.excluir ?? (opts?.keepRemovidos ? Array.from(removidos) : []);
      const { data, error } = await supabase.functions.invoke("plano-preventivo-gerar", {
        body: { mode: "preview", cliente_nome: clienteNome, ano_referencia: ano, excluir_equip_ids: excluir },
      });
      if (error) throw error;
      if (!data?.ok) {
        setErrCode(data?.code ?? null);
        setErrMsg(data?.error ?? "Falha");
        setPreview(null);
        return;
      }
      let resp = data as PreviewResp;
      const ov = opts?.overrides;
      if (ov && ov.size) {
        let aplicados = 0;
        const itens = resp.itens.map((it) => {
          const o = ov.get(it.equip_id) ?? ov.get(it.codigo_barras_auvo);
          if (!o) return it;
          aplicados++;
          const periodicidade = o.periodicidade ?? it.periodicidade;
          const ht_por_ocorrencia = o.ht_por_ocorrencia ?? it.ht_por_ocorrencia;
          const horas_por_tecnico = o.horas_por_tecnico ?? it.horas_por_tecnico;
          // Se periodicidade mudou, regenera a cadeia a partir do primeiro mês agendado
          let meses = it.meses_planejados;
          if (o.periodicidade && o.periodicidade !== it.periodicidade) {
            const inicio = it.meses_planejados[0] ?? it.mes_inicio_ciclo ?? 1;
            meses = chainFrom(inicio, periodicidade);
          }
          return {
            ...it,
            periodicidade,
            ht_por_ocorrencia,
            horas_por_tecnico,
            meses_planejados: meses,
            mes_inicio_ciclo: meses[0] ?? it.mes_inicio_ciclo,
            ht_total_ano: meses.length * ht_por_ocorrencia,
          };
        });
        resp = recalcAggregates(itens, resp);
        if (aplicados > 0) toast.info(`${aplicados} edição(ões) manual(is) preservada(s) (HT/periodicidade)`);
      }
      // Ancora a cadeia no mês da última execução (quando ocorreu no ano de referência),
      // gerando a distribuição pra frente E pra trás a partir dela.
      {
        const itensAnc = resp.itens.map((it) => {
          const em = executedMonthOf(it.ultima_preventiva, resp.ano_referencia);
          if (em == null) return it;
          const meses = chainAround(em, it.periodicidade);
          return {
            ...it,
            meses_planejados: meses,
            mes_inicio_ciclo: meses[0] ?? em,
            ht_total_ano: meses.length * it.ht_por_ocorrencia,
          };
        });
        resp = recalcAggregates(itensAnc, resp);
      }
      setPreview(resp);
      if (!opts?.keepRemovidos) {
        setRemovidos(new Set());
        manualOverridesRef.current.clear();
      }
      toast.success(
        `${data.resumo.total} equipamentos processados${excluir.length ? ` (${excluir.length} excluídos)` : ""}`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Erro");
    } finally {
      setLoading(false);
    }
  };

  const onRefazer = () => {
    if (!preview) return;
    // Usa um ref atualizado no próprio onChange; assim, mesmo clicando em "Refazer"
    // logo após alterar o select/input, a edição manual não volta para o padrão.
    const overrides = new Map(manualOverridesRef.current);
    onPreview({ keepRemovidos: true, overrides });
  };

  const saveManualOverride = (it: Item, override: Override) => {
    const current = manualOverridesRef.current.get(it.equip_id)
      ?? manualOverridesRef.current.get(it.codigo_barras_auvo)
      ?? {};
    const next = { ...current, ...override };
    manualOverridesRef.current.set(it.equip_id, next);
    manualOverridesRef.current.set(it.codigo_barras_auvo, next);
  };

  // Recalcula tabela_meses e resumo a partir dos itens atuais
  const recalcAggregates = (itens: Item[], base: PreviewResp): PreviewResp => {
    const teto = base.contrato.horas_mes_contratadas;
    const tabela = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const ht = itens.reduce(
        (a, it) => a + (it.meses_planejados.includes(mes) ? it.ht_por_ocorrencia : 0),
        0,
      );
      return { mes, ht_agendada: ht, teto, saldo: teto - ht };
    });
    const ht_ano = tabela.reduce((a, b) => a + b.ht_agendada, 0);
    const ht_contrato_ano = teto * 12;
    return {
      ...base,
      itens,
      tabela_meses: tabela,
      resumo: {
        ...base.resumo,
        total: itens.length,
        ht_ano,
        ht_contrato_ano,
        saldo_ano: ht_contrato_ano - ht_ano,
        meses_negativos: tabela.filter((m) => m.saldo < 0).length,
      },
    };
  };

  const toggleMes = (equipId: string, mes: number) => {
    if (!preview) return;
    const itens = preview.itens.map((it) => {
      if (it.equip_id !== equipId) return it;
      const has = it.meses_planejados.includes(mes);
      const meses = has
        ? it.meses_planejados.filter((m) => m !== mes)
        : [...it.meses_planejados, mes].sort((a, b) => a - b);
      return {
        ...it,
        meses_planejados: meses,
        ht_total_ano: meses.length * it.ht_por_ocorrencia,
      };
    });
    setPreview(recalcAggregates(itens, preview));
  };

  // Move um mês agendado para outro, regenerando a cadeia a partir dali
  const moverMes = (equipId: string, de: number, para: number) => {
    if (!preview || de === para) return;
    const itens = preview.itens.map((it) => {
      if (it.equip_id !== equipId) return it;
      if (!it.meses_planejados.includes(de)) return it;
      // Mantém apenas os agendamentos anteriores ao mês arrastado e regenera a cadeia futura.
      // Ex.: Ago -> Set em trimestral: [Ago, Nov] vira [Set, Dez], sem apagar a próxima.
      const anteriores = it.meses_planejados.filter((m) => m < de);
      const nova = chainFrom(para, it.periodicidade);
      const merged = Array.from(new Set([...anteriores, ...nova])).sort((a, b) => a - b);
      return {
        ...it,
        meses_planejados: merged,
        mes_inicio_ciclo: merged[0] ?? it.mes_inicio_ciclo,
        ht_total_ano: merged.length * it.ht_por_ocorrencia,
      };
    });
    setPreview(recalcAggregates(itens, preview));
  };

  // Adiciona uma nova ocorrência isolada (sem regenerar cadeia)
  const adicionarMes = (equipId: string, mes: number) => {
    if (!preview) return;
    const itens = preview.itens.map((it) => {
      if (it.equip_id !== equipId) return it;
      if (it.meses_planejados.includes(mes)) return it;
      const meses = [...it.meses_planejados, mes].sort((a, b) => a - b);
      return { ...it, meses_planejados: meses, ht_total_ano: meses.length * it.ht_por_ocorrencia };
    });
    setPreview(recalcAggregates(itens, preview));
  };

  const removerEquip = (equipId: string) => {
    if (!preview) return;
    const itens = preview.itens.filter((it) => it.equip_id !== equipId);
    setRemovidos((prev) => {
      const next = new Set(prev);
      next.add(equipId);
      return next;
    });
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.delete(equipId);
      return next;
    });
    setPreview(recalcAggregates(itens, preview));
  };

  const removerSelecionados = () => {
    if (!preview || selecionados.size === 0) return;
    if (!confirm(`Remover ${selecionados.size} equipamento(s) do plano?`)) return;
    const ids = new Set(selecionados);
    const itens = preview.itens.filter((it) => !ids.has(it.equip_id));
    setRemovidos((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setSelecionados(new Set());
    setPreview(recalcAggregates(itens, preview));
  };

  const alterarHT = (equipId: string, novaHT: number) => {
    if (!preview) return;
    const ht = Math.max(0, Number(novaHT) || 0);
    const itens = preview.itens.map((it) => {
      if (it.equip_id !== equipId) return it;
      saveManualOverride(it, { ht_por_ocorrencia: ht });
      return {
        ...it,
        ht_por_ocorrencia: ht,
        ht_total_ano: it.meses_planejados.length * ht,
      };
    });
    setPreview(recalcAggregates(itens, preview));
  };

  const alterarPeriodicidade = (equipId: string, novaPer: string) => {
    if (!preview) return;
    const itens = preview.itens.map((it) => {
      if (it.equip_id !== equipId) return it;
      saveManualOverride(it, { periodicidade: novaPer });
      const inicio = it.meses_planejados[0] ?? it.mes_inicio_ciclo ?? 1;
      const meses = chainFrom(inicio, novaPer);
      return {
        ...it,
        periodicidade: novaPer,
        meses_planejados: meses,
        mes_inicio_ciclo: meses[0] ?? inicio,
        ht_total_ano: meses.length * it.ht_por_ocorrencia,
      };
    });
    setPreview(recalcAggregates(itens, preview));
  };

  const onApply = async () => {
    if (!preview) return;
    const agendaveis = preview.itens.filter((i) => i.meses_planejados.length > 0);
    if (!confirm(`Gravar plano para ${agendaveis.length} equipamentos (ano ${ano})? Isso substitui o plano atual.`)) return;
    setSaving(true);
    try {
      const apply_rows = agendaveis.map((i) => ({
        codigo_barras_auvo: i.codigo_barras_auvo,
        periodicidade: i.periodicidade,
        criticidade: i.criticidade,
        horas_por_tecnico: i.horas_por_tecnico,
        qtd_tecnicos: i.qtd_tecnicos,
        horas_estimadas_total: i.ht_total_ano,
        mes_inicio_ciclo: i.mes_inicio_ciclo,
        meses_planejados: i.meses_planejados,
      }));
      const { data, error } = await supabase.functions.invoke("plano-preventivo-gerar", {
        body: { mode: "apply", cliente_nome: clienteNome, ano_referencia: ano, apply_rows },
      });
      if (error) throw error;
      if (!data?.ok) {
        const detalhes = Array.isArray(data?.erros) && data.erros.length > 0
          ? `\nPrimeiros erros: ${data.erros.slice(0, 5).map((e: any) => `${e.codigo_barras_auvo}: ${e.erro}`).join(" | ")}`
          : "";
        throw new Error(`${data?.error || "Falha ao gravar plano"}${detalhes}`);
      }
      toast.success(`${data.gravados} planos gravados`);
      // força atualização das próximas preventivas na lista de equipamentos
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plano-proximas-by-eq"] }),
        queryClient.invalidateQueries({ queryKey: ["equipamentos-preventivos"] }),
        queryClient.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw"] }),
        queryClient.invalidateQueries({ queryKey: ["planos-preventivos-all"] }),
      ]);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const totMes = useMemo(() => preview?.tabela_meses ?? [], [preview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" /> Gerar plano de preventivas
          </DialogTitle>
          <DialogDescription>
            Por cliente. Fila única por atraso — descobertos ganham prioridade sobre em-dia.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border rounded-md p-3 bg-muted/30">
          <div className="md:col-span-2">
            <Label className="text-xs">Cliente</Label>
            <SearchableSelect
              value={clienteNome}
              onValueChange={setClienteNome}
              options={clientes.map((c) => ({ value: c, label: c }))}
              placeholder="Selecione um cliente"
            />
          </div>
          <div>
            <Label className="text-xs">Ano</Label>
            <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || anoAtual)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onPreview()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Gerar plano
            </Button>
            <Button
              variant="outline"
              onClick={onRefazer}
              disabled={loading || !preview || removidos.size === 0}
              title="Reprocessa distribuição de meses ignorando os equipamentos removidos"
            >
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refazer plano{removidos.size > 0 ? ` (−${removidos.size})` : ""}
            </Button>
            <Button variant="secondary" onClick={onApply} disabled={saving || !preview}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Implementar
            </Button>
          </div>
        </div>

        {errCode === "SEM_CONTRATO" && (
          <div className="border border-red-300 bg-red-50 text-red-900 rounded-md p-3 flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold">Sem contrato ativo com horas contratadas</div>
              <div>{errMsg}</div>
              <div className="mt-1 text-xs">Cadastre o contrato do cliente (ou do grupo) em Contratos com horas/mês &gt; 0.</div>
            </div>
          </div>
        )}
        {errCode && errCode !== "SEM_CONTRATO" && (
          <div className="border border-red-300 bg-red-50 text-red-900 rounded-md p-3 text-sm">{errMsg}</div>
        )}

        {preview && (
          <div className="space-y-4 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
              <StatCard label="Equipamentos" value={preview.resumo.total} />
              <StatCard label="Nunca fizeram" value={preview.resumo.nunca} tone={preview.resumo.nunca > 0 ? "danger" : undefined} />
              <StatCard label="Vencidos" value={preview.resumo.vencidos} tone={preview.resumo.vencidos > 0 ? "warn" : undefined} />
              <StatCard label="Em dia" value={preview.resumo.em_dia} tone="ok" />
              <StatCard label="HT ano / meta" value={`${preview.resumo.ht_ano.toFixed(0)} / ${preview.resumo.ht_contrato_ano.toFixed(0)}`}
                tone={preview.resumo.saldo_ano < 0 ? "danger" : "ok"} />
              <StatCard label="Meses estourados" value={preview.resumo.meses_negativos}
                tone={preview.resumo.meses_negativos > 0 ? "danger" : "ok"} />
            </div>

            {preview.sem_tipo.length > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  {preview.sem_tipo.length} equipamentos SEM TIPO — ficam fora do plano
                </div>
                <div className="text-xs text-amber-800 mt-1">
                  {preview.sem_tipo.slice(0, 8).map((s) => s.nome).join(" · ")}
                  {preview.sem_tipo.length > 8 && ` … +${preview.sem_tipo.length - 8}`}
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs text-amber-900">
                  <Sparkles className="h-3 w-3" />
                  Use "Revisar classificação (IA)" na tela principal filtrando por este cliente.
                </div>
              </div>
            )}

            {(preview.warnings?.length ?? 0) > 0 && (
              <div className="border border-orange-300 bg-orange-50 rounded-md p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-orange-900">
                  <AlertTriangle className="h-4 w-4" />
                  {preview.warnings!.length} avisos de periodicidade — tratados como ANUAL
                </div>
                <div className="text-xs text-orange-800 mt-1 max-h-24 overflow-auto">
                  {preview.warnings!.slice(0, 20).map((w) => (
                    <div key={w.equip_id}>• <b>{w.nome}</b> — {w.motivo}</div>
                  ))}
                  {preview.warnings!.length > 20 && <div>… +{preview.warnings!.length - 20}</div>}
                </div>
              </div>
            )}

            {preview.fonte_ultima_preventiva && (
              <div className="text-[11px] text-muted-foreground">
                Fonte "última preventiva": <b>{preview.fonte_ultima_preventiva === "consolidado" ? "tabela consolidada (fonte única)" : "scan histórico (fallback)"}</b>
              </div>
            )}

            <div className="border rounded-md max-h-[62vh] overflow-auto relative">
              <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 p-2 border-b bg-background">
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por ID, nome ou categoria…"
                  className="h-8 w-72 text-xs"
                />
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const q = busca.trim().toLowerCase();
                    const total = preview.itens.length;
                    const vis = q
                      ? preview.itens.filter((it) =>
                          `${it.codigo_barras_auvo} ${it.nome} ${it.categoria}`.toLowerCase().includes(q),
                        ).length
                      : total;
                    return `${vis} de ${total}`;
                  })()}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {selecionados.size > 0 ? `${selecionados.size} selecionado(s)` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={selecionados.size === 0}
                    onClick={() => setSelecionados(new Set())}
                  >
                    Limpar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    disabled={selecionados.size === 0}
                    onClick={removerSelecionados}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Remover selecionados
                  </Button>
                </div>
              </div>
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow className="[&>th]:sticky [&>th]:top-[49px] [&>th]:bg-background [&>th]:z-20 [&>th]:shadow-[0_1px_0_hsl(var(--border))]">
                    <TableHead className="w-8">
                      {(() => {
                        const q = busca.trim().toLowerCase();
                        const visiveis = q
                          ? preview.itens.filter((it) =>
                              `${it.codigo_barras_auvo} ${it.nome} ${it.categoria}`.toLowerCase().includes(q),
                            )
                          : preview.itens;
                        const allSel = visiveis.length > 0 && visiveis.every((it) => selecionados.has(it.equip_id));
                        return (
                          <Checkbox
                            checked={allSel}
                            onCheckedChange={(c) => {
                              setSelecionados((prev) => {
                                const next = new Set(prev);
                                if (c) for (const it of visiveis) next.add(it.equip_id);
                                else for (const it of visiveis) next.delete(it.equip_id);
                                return next;
                              });
                            }}
                            aria-label="Selecionar todos visíveis"
                          />
                        );
                      })()}
                    </TableHead>
                    <TableHead className="min-w-[110px]">ID</TableHead>
                    <TableHead className="min-w-[220px]">Equipamento</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Crit</TableHead>
                    <TableHead>Period.</TableHead>
                    <TableHead className="text-right">HT</TableHead>
                    {MES_LABEL.map((m) => <TableHead key={m} className="text-center w-14">{m}</TableHead>)}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.itens
                    .filter((it) => {
                      const q = busca.trim().toLowerCase();
                      if (!q) return true;
                      return `${it.codigo_barras_auvo} ${it.nome} ${it.categoria}`.toLowerCase().includes(q);
                    })
                    .map((it) => {
                    const setMes = new Set(it.meses_planejados);
                    const setForcados = new Set(it.meses_forcados ?? []);
                    const totalLinha = it.meses_planejados.length * it.ht_por_ocorrencia;
                    return (
                      <TableRow key={it.equip_id} className={selecionados.has(it.equip_id) ? "bg-primary/5" : ""}>
                        <TableCell className="w-8">
                          <Checkbox
                            checked={selecionados.has(it.equip_id)}
                            onCheckedChange={(c) => {
                              setSelecionados((prev) => {
                                const next = new Set(prev);
                                if (c) next.add(it.equip_id);
                                else next.delete(it.equip_id);
                                return next;
                              });
                            }}
                            aria-label="Selecionar"
                          />
                        </TableCell>
                        <TableCell className="text-xs font-mono">{it.codigo_barras_auvo}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{it.nome}</div>
                          <div className="mt-0.5">
                            <Badge className={cn("text-[10px]", statusBg[it.status])}>
                              {statusLabel(it.status, it.atraso_meses)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{it.categoria}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{it.criticidade}</Badge></TableCell>
                        <TableCell>
                          <Select
                            value={it.periodicidade}
                            onValueChange={(v) => alterarPeriodicidade(it.equip_id, v)}
                          >
                            <SelectTrigger className="h-7 w-[120px] text-[11px] px-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MENSAL">MENSAL</SelectItem>
                              <SelectItem value="BIMESTRAL">BIMESTRAL</SelectItem>
                              <SelectItem value="TRIMESTRAL">TRIMESTRAL</SelectItem>
                              <SelectItem value="QUADRIMESTRAL">QUADRIMESTRAL</SelectItem>
                              <SelectItem value="SEMESTRAL">SEMESTRAL</SelectItem>
                              <SelectItem value="ANUAL">ANUAL</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={it.ht_por_ocorrencia}
                            onChange={(e) => alterarHT(it.equip_id, Number(e.target.value))}
                            className="h-7 w-16 text-right text-xs px-1"
                            title="Horas técnicas por ocorrência"
                          />
                        </TableCell>
                        {MES_LABEL.map((_, i) => {
                          const m = i + 1;
                          const on = setMes.has(m);
                          const forced = setForcados.has(m);
                          return (
                            <TableCell key={m} className={cn(
                              "text-center text-xs font-medium hover:ring-2 hover:ring-primary/40 transition select-none",
                              on ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                              on && statusBg[it.status],
                              forced && "ring-2 ring-red-500 ring-inset bg-red-100 text-red-900",
                            )}
                              draggable={on}
                              onDragStart={(e) => {
                                if (!on) return;
                                suppressCellClickUntilRef.current = Date.now() + 800;
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", JSON.stringify({ equipId: it.equip_id, from: m }));
                              }}
                              onDragEnd={() => {
                                suppressCellClickUntilRef.current = Date.now() + 800;
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                suppressCellClickUntilRef.current = Date.now() + 800;
                                try {
                                  const raw = e.dataTransfer.getData("text/plain");
                                  if (!raw) return;
                                  const { equipId, from } = JSON.parse(raw);
                                  if (equipId === it.equip_id && typeof from === "number") {
                                    moverMes(it.equip_id, from, m);
                                  }
                                } catch {}
                              }}
                              onClick={() => {
                                if (Date.now() < suppressCellClickUntilRef.current) return;
                                if (on) toggleMes(it.equip_id, m);
                                else adicionarMes(it.equip_id, m);
                              }}
                              title={
                                on
                                  ? (forced
                                      ? "⚠ Encaixe forçado — este mês estourou o teto de HT"
                                      : "Arraste para mover (regenera a cadeia) · clique para remover")
                                  : "Clique para adicionar preventiva neste mês"
                              }
                            >
                              {on ? (forced ? `⚠${it.ht_por_ocorrencia}` : it.ht_por_ocorrencia) : ""}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right text-sm font-semibold">{totalLinha.toFixed(1)}</TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => removerEquip(it.equip_id)}
                            title="Remover do plano"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <tfoot className="sticky bottom-0 bg-background border-t-2">
                  <tr className="border-t">
                    <td colSpan={7} className="p-2 text-right text-xs font-semibold">TOTAL MÊS (h)</td>
                    {totMes.map((m) => (
                      <td key={m.mes} className="p-2 text-center text-xs font-semibold">{m.ht_agendada.toFixed(1)}</td>
                    ))}
                    <td className="p-2 text-right text-xs font-semibold">
                      {totMes.reduce((a, b) => a + b.ht_agendada, 0).toFixed(1)}
                    </td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="p-2 text-right text-xs text-muted-foreground">META (h)</td>
                    {totMes.map((m) => (
                      <td key={m.mes} className="p-2 text-center text-xs text-muted-foreground">{m.teto.toFixed(1)}</td>
                    ))}
                    <td className="p-2 text-right text-xs text-muted-foreground">
                      {(preview.contrato.horas_mes_contratadas * 12).toFixed(1)}
                    </td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="p-2 text-right text-xs font-semibold">SALDO (h)</td>
                    {totMes.map((m) => (
                      <td key={m.mes} className={cn(
                        "p-2 text-center text-xs font-semibold",
                        m.saldo < 0 ? "text-red-600 bg-red-50" : "text-emerald-700",
                      )}>{m.saldo.toFixed(1)}</td>
                    ))}
                    <td className={cn(
                      "p-2 text-right text-xs font-semibold",
                      preview.resumo.saldo_ano < 0 ? "text-red-600" : "text-emerald-700",
                    )}>
                      {preview.resumo.saldo_ano.toFixed(1)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="text-xs text-muted-foreground">
              Contrato: {preview.contrato.horas_mes_contratadas}h/mês
              {preview.contrato.fonte === "grupo" && " (via grupo)"}
              {preview.contrato.vigencia_inicio && ` · vigência: ${new Date(preview.contrato.vigencia_inicio + "T00:00:00").toLocaleDateString("pt-BR")}`}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={cn(
      "rounded-md border p-2 bg-background",
      tone === "danger" && "border-red-300 bg-red-50",
      tone === "warn" && "border-amber-300 bg-amber-50",
      tone === "ok" && "border-emerald-300 bg-emerald-50",
    )}>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
