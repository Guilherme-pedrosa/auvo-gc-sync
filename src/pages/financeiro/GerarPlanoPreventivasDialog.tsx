import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Download, Save, Wand2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Grupo = { id: string; nome: string };

type PreviewResp = {
  ok: true;
  ano_referencia: number;
  grupo_id: string | null;
  cliente_nome: string | null;
  resumo: {
    total_equipamentos: number;
    por_origem: { override_manual: number; tipo_atual: number; ia_keywords: number; fallback_padrao: number };
    ht_contrato_mes: number; ht_contrato_ano: number;
    ht_agenda_ano: number; ht_corretiva_ano: number; saldo_ano: number;
    pico_mes: number; vale_mes: number;
    respeita_contrato?: boolean;
    nao_encaixados?: number;
  };
  tabela_meses: Array<{ mes: number; ht_preventiva: number; ht_corretiva: number; ht_contrato: number; saldo: number }>;
  itens: Array<any>;
};

const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function GerarPlanoPreventivasDialog({
  open, onOpenChange, grupos, clientes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupos: Grupo[];
  clientes: string[];
}) {
  const anoAtual = new Date().getFullYear();
  const [escopo, setEscopo] = useState<"grupo" | "cliente">("grupo");
  const [grupoId, setGrupoId] = useState<string>("");
  const [clienteNome, setClienteNome] = useState<string>("");
  const [ano, setAno] = useState<number>(anoAtual);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todos");

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setFiltroOrigem("todos");
    }
  }, [open]);

  const callFn = async (mode: "preview" | "export" | "apply", extra: Record<string, unknown> = {}) => {
    const payload: any = { mode, ano_referencia: ano, ...extra };
    if (escopo === "grupo") payload.grupo_id = grupoId || null;
    else payload.cliente_nome = clienteNome || null;
    const { data, error } = await supabase.functions.invoke("plano-preventivo-gerar", { body: payload });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Falha");
    return data;
  };

  const onPreview = async () => {
    if (escopo === "grupo" && !grupoId) return toast.error("Selecione um grupo");
    if (escopo === "cliente" && !clienteNome) return toast.error("Selecione um cliente");
    setLoading(true);
    try {
      const data = await callFn("preview");
      setPreview(data as PreviewResp);
      toast.success(`Preview gerado: ${data.resumo.total_equipamentos} equipamentos`);
    } catch (e: any) {
      toast.error(e?.message || "Erro");
    } finally {
      setLoading(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const data = await callFn("export");
      const bin = atob(data.xlsx_base64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || `plano-preventivas-${ano}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel baixado");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao exportar");
    } finally {
      setExporting(false);
    }
  };

  const onApply = async () => {
    if (!preview) return;
    if (escopo === "grupo" && !grupoId) {
      toast.error("Selecione um grupo");
      return;
    }
    if (escopo === "cliente" && !clienteNome) {
      toast.error("Selecione um cliente");
      return;
    }
    if (!confirm(`Gravar plano para ${preview.itens.length} equipamentos (ano ${ano})? Isso substitui o plano atual desses equipamentos.`)) return;
    setSaving(true);
    try {
      const apply_rows = preview.itens.map((i) => ({
        codigo_barras_auvo: i.codigo_barras_auvo,
        periodicidade: i.periodicidade,
        criticidade: i.criticidade,
        horas_por_tecnico: i.horas_por_tecnico,
        qtd_tecnicos: i.qtd_tecnicos,
        horas_estimadas_total: i.ht_total_ano,
        mes_inicio_ciclo: i.mes_inicio_ciclo,
        meses_planejados: i.meses_planejados,
      }));
      const data = await callFn("apply", { apply_rows });
      toast.success(`${data.gravados} planos gravados`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const itensFiltrados = useMemo(() => {
    if (!preview) return [];
    if (filtroOrigem === "todos") return preview.itens;
    return preview.itens.filter((i) => i.tipo_source === filtroOrigem);
  }, [preview, filtroOrigem]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" /> Gerar plano de preventivas
          </DialogTitle>
          <DialogDescription>
            Classificação automática por palavras-chave, nivelamento mensal de HT e exportação em Excel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border rounded-md p-3 bg-muted/30">
          <div>
            <Label className="text-xs">Escopo</Label>
            <RadioGroup value={escopo} onValueChange={(v) => setEscopo(v as any)} className="flex gap-3 pt-1">
              <div className="flex items-center gap-1"><RadioGroupItem value="grupo" id="esc-g" /><Label htmlFor="esc-g" className="text-sm">Grupo</Label></div>
              <div className="flex items-center gap-1"><RadioGroupItem value="cliente" id="esc-c" /><Label htmlFor="esc-c" className="text-sm">Cliente</Label></div>
            </RadioGroup>
          </div>
          {escopo === "grupo" ? (
            <div className="md:col-span-2">
              <Label className="text-xs">Grupo</Label>
              <SearchableSelect
                value={grupoId}
                onValueChange={(v) => setGrupoId(v)}
                options={grupos.map((g) => ({ value: g.id, label: g.nome }))}
                placeholder="Selecione um grupo"
              />
            </div>
          ) : (
            <div className="md:col-span-2">
              <Label className="text-xs">Cliente</Label>
              <SearchableSelect
                value={clienteNome}
                onValueChange={(v) => setClienteNome(v)}
                options={clientes.map((c) => ({ value: c, label: c }))}
                placeholder="Selecione um cliente"
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Ano</Label>
            <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || anoAtual)} />
          </div>
          <div className="md:col-span-4 flex flex-wrap gap-2 pt-1">
            <Button onClick={onPreview} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Gerar preview
            </Button>
            <Button variant="outline" onClick={onExport} disabled={exporting || !preview}>
              {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Baixar Excel
            </Button>
            <Button variant="secondary" onClick={onApply} disabled={saving || !preview}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Implementar plano
            </Button>
          </div>
        </div>

        {preview && (
          <div className="space-y-4 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
              <StatCard label="Equipamentos" value={preview.resumo.total_equipamentos} />
              <StatCard label="HT contrato/ano" value={preview.resumo.ht_contrato_ano.toFixed(1)} />
              <StatCard label="HT preventiva/ano" value={preview.resumo.ht_agenda_ano.toFixed(1)} />
              <StatCard label="HT corretiva/ano" value={preview.resumo.ht_corretiva_ano.toFixed(1)} />
              <StatCard label="Saldo/ano" value={preview.resumo.saldo_ano.toFixed(1)}
                tone={preview.resumo.saldo_ano < 0 ? "danger" : "ok"} />
              <StatCard label="Pico mensal" value={preview.resumo.pico_mes.toFixed(1)} />
            </div>
            {(preview.resumo.nao_encaixados ?? 0) > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                <strong>{preview.resumo.nao_encaixados}</strong> equipamento(s) não encaixaram na carga contratual
                ({preview.resumo.ht_contrato_mes.toFixed(1)}h/mês). Foram deixados de fora do agendamento por prioridade
                (Crítica → Alta → Média → Baixa). Marcados como "Não encaixado" abaixo — revise contrato ou periodicidade.
              </div>
            )}

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    {MES_LABEL.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell className="font-medium">HT preventiva</TableCell>
                    {preview.tabela_meses.map((m) => <TableCell key={m.mes} className="text-right">{m.ht_preventiva.toFixed(1)}</TableCell>)}
                  </TableRow>
                  <TableRow><TableCell className="font-medium">HT corretiva</TableCell>
                    {preview.tabela_meses.map((m) => <TableCell key={m.mes} className="text-right">{m.ht_corretiva.toFixed(1)}</TableCell>)}
                  </TableRow>
                  <TableRow><TableCell className="font-medium">Contrato</TableCell>
                    {preview.tabela_meses.map((m) => <TableCell key={m.mes} className="text-right">{m.ht_contrato.toFixed(1)}</TableCell>)}
                  </TableRow>
                  <TableRow className="bg-muted/40"><TableCell className="font-semibold">Saldo</TableCell>
                    {preview.tabela_meses.map((m) => (
                      <TableCell key={m.mes} className={cn("text-right font-semibold", m.saldo < 0 ? "text-red-600" : "text-emerald-700")}>
                        {m.saldo.toFixed(1)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Origem do tipo:</span>
              {[
                ["todos", `Todos (${preview.itens.length})`],
                ["override_manual", `Override (${preview.resumo.por_origem.override_manual})`],
                ["tipo_atual", `Já definido (${preview.resumo.por_origem.tipo_atual})`],
                ["ia_keywords", `Palavras-chave (${preview.resumo.por_origem.ia_keywords})`],
                ["fallback_padrao", `Padrão (${preview.resumo.por_origem.fallback_padrao})`],
              ].map(([v, l]) => (
                <Badge key={v} variant={filtroOrigem === v ? "default" : "outline"} className="cursor-pointer"
                  onClick={() => setFiltroOrigem(v as string)}>{l}</Badge>
              ))}
            </div>

            <div className="border rounded-md overflow-auto max-h-[42vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Crit.</TableHead>
                    <TableHead>Period.</TableHead>
                    <TableHead className="text-right">HT/oc</TableHead>
                    <TableHead className="text-right">Freq</TableHead>
                    <TableHead className="text-right">HT/ano</TableHead>
                    <TableHead>Meses</TableHead>
                    <TableHead>Última prev.</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itensFiltrados.map((i) => (
                    <TableRow key={i.equip_id}>
                      <TableCell className="font-medium">{i.nome}</TableCell>
                      <TableCell className="text-xs">{i.cliente}</TableCell>
                      <TableCell className="text-xs">{i.categoria}</TableCell>
                      <TableCell><Badge variant="outline">{i.criticidade}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{i.periodicidade}</Badge></TableCell>
                      <TableCell className="text-right">{i.ht_por_ocorrencia}</TableCell>
                      <TableCell className="text-right">{i.freq}</TableCell>
                      <TableCell className="text-right">{i.ht_total_ano}</TableCell>
                      <TableCell className="text-xs">{i.meses_planejados.map((n: number) => MES_LABEL[n - 1]).join(", ")}</TableCell>
                      <TableCell className="text-xs">
                        {i.ultima_preventiva
                          ? new Date(i.ultima_preventiva + "T00:00:00").toLocaleDateString("pt-BR")
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {i.start_source === "ultima_preventiva" && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Última prev.</Badge>}
                        {i.start_source === "plano_anterior" && <Badge variant="outline">Plano anterior</Badge>}
                        {i.start_source === "leveling" && <Badge variant="secondary">Nivelamento</Badge>}
                        {i.start_source === "nao_encaixado" && <Badge variant="destructive">Não encaixado</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {i.tipo_source === "override_manual" && <Badge variant="secondary">Override</Badge>}
                        {i.tipo_source === "tipo_atual" && <Badge variant="outline">Definido</Badge>}
                        {i.tipo_source === "ia_keywords" && <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">{i.keyword_match}</Badge>}
                        {i.tipo_source === "fallback_padrao" && <Badge variant="destructive">Padrão</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "danger" }) {
  return (
    <div className={cn("rounded-md border p-2 bg-background", tone === "danger" && "border-red-300 bg-red-50", tone === "ok" && "border-emerald-300 bg-emerald-50")}>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}