import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, Wand2, AlertTriangle, Sparkles } from "lucide-react";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const [clienteNome, setClienteNome] = useState("");
  const [ano, setAno] = useState(anoAtual);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErrCode(null);
      setErrMsg(null);
    }
  }, [open]);

  const onPreview = async () => {
    if (!clienteNome) return toast.error("Selecione um cliente");
    setLoading(true);
    setErrCode(null);
    setErrMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("plano-preventivo-gerar", {
        body: { mode: "preview", cliente_nome: clienteNome, ano_referencia: ano },
      });
      if (error) throw error;
      if (!data?.ok) {
        setErrCode(data?.code ?? null);
        setErrMsg(data?.error ?? "Falha");
        setPreview(null);
        return;
      }
      setPreview(data as PreviewResp);
      toast.success(`${data.resumo.total} equipamentos processados`);
    } catch (e: any) {
      toast.error(e?.message || "Erro");
    } finally {
      setLoading(false);
    }
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
      // Mantém os agendamentos ANTERIORES ao mês arrastado, regenera cadeia a partir de `para`
      const anteriores = it.meses_planejados.filter((m) => m < de && m < para);
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
    if (!confirm("Remover este equipamento do plano?")) return;
    const itens = preview.itens.filter((it) => it.equip_id !== equipId);
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
      if (!data?.ok) throw new Error(data?.error || "Falha");
      toast.success(`${data.gravados} planos gravados`);
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
            <Button onClick={onPreview} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Gerar plano
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

            <div className="border rounded-md overflow-auto max-h-[65vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
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
                  {preview.itens.map((it) => {
                    const setMes = new Set(it.meses_planejados);
                    const totalLinha = it.meses_planejados.length * it.ht_por_ocorrencia;
                    return (
                      <TableRow key={it.equip_id}>
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
                        <TableCell><Badge variant="outline" className="text-[10px]">{it.periodicidade}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{it.ht_por_ocorrencia}</TableCell>
                        {MES_LABEL.map((_, i) => {
                          const m = i + 1;
                          const on = setMes.has(m);
                          return (
                            <TableCell key={m} className={cn(
                              "text-center text-xs font-medium hover:ring-2 hover:ring-primary/40 transition select-none",
                              on ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                              on && statusBg[it.status],
                            )}
                              draggable={on}
                              onDragStart={(e) => {
                                if (!on) return;
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", JSON.stringify({ equipId: it.equip_id, from: m }));
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
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
                                if (on) toggleMes(it.equip_id, m);
                                else adicionarMes(it.equip_id, m);
                              }}
                              title={
                                on
                                  ? "Arraste para mover (regenera a cadeia) · clique para remover"
                                  : "Clique para adicionar preventiva neste mês"
                              }
                            >
                              {on ? it.ht_por_ocorrencia : ""}
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
                    <td colSpan={6} className="p-2 text-right text-xs font-semibold">TOTAL MÊS (h)</td>
                    {totMes.map((m) => (
                      <td key={m.mes} className="p-2 text-center text-xs font-semibold">{m.ht_agendada.toFixed(1)}</td>
                    ))}
                    <td className="p-2 text-right text-xs font-semibold">
                      {totMes.reduce((a, b) => a + b.ht_agendada, 0).toFixed(1)}
                    </td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="p-2 text-right text-xs text-muted-foreground">META (h)</td>
                    {totMes.map((m) => (
                      <td key={m.mes} className="p-2 text-center text-xs text-muted-foreground">{m.teto.toFixed(1)}</td>
                    ))}
                    <td className="p-2 text-right text-xs text-muted-foreground">
                      {(preview.contrato.horas_mes_contratadas * 12).toFixed(1)}
                    </td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="p-2 text-right text-xs font-semibold">SALDO (h)</td>
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
              </Table>
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
