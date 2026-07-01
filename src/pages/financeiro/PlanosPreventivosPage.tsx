import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Download, FileText, Pencil, Trash2, Save, Loader2, Search, Plus, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type PlanoItem = {
  id: string;
  grupo_id: string;
  ano_referencia: number;
  equipamento_nome: string;
  equipamento_auvo_id: string | null;
  periodicidade: string | null;
  periodicidade_meses: number | null;
  horas_total: number | null;
  meses_planejados: number[] | null;
  proxima_data: string | null;
  ultima_execucao_data: string | null;
  ativo: boolean;
  _new?: boolean;
  categoria?: string | null;
  criticidade?: string | null;
};

type Grupo = { id: string; nome: string };
type Contrato = { grupo_id: string | null; cliente_nome: string | null; horas_mes_contratadas: number };

const MES_LABEL = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type Aggregate = {
  grupo_id: string;
  grupo_nome: string;
  ano_referencia: number;
  itens: PlanoItem[];
  ht_ano: number;
  ht_contrato_mes: number;
  ht_contrato_ano: number;
  saldo_ano: number;
  ht_por_mes: number[];
  meses_estourados: number;
  identificadorPorEquip: Map<string, string>;
};

function htPorOcorrencia(it: PlanoItem): number {
  const n = (it.meses_planejados?.length ?? 0);
  if (!n) return 0;
  return (Number(it.horas_total) || 0) / n;
}

function calcProxima(meses: number[], ano: number): string | null {
  if (!meses.length) return null;
  const sorted = [...meses].sort((a, b) => a - b);
  const hoje = new Date();
  let mesProx: number;
  if (ano > hoje.getFullYear()) mesProx = sorted[0];
  else if (ano < hoje.getFullYear()) mesProx = sorted[sorted.length - 1];
  else mesProx = sorted.find(m => m >= hoje.getMonth() + 1) ?? sorted[0];
  return `${ano}-${String(mesProx).padStart(2, "0")}-01`;
}

export default function PlanosPreventivosPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingKey, setEditingKey] = useState<{ grupo_id: string; ano: number } | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["planos-preventivos-all"],
    queryFn: async () => {
      const itens: PlanoItem[] = [];
      let from = 0; const PAGE = 1000;
      while (true) {
        const { data, error } = await (supabase as any)
          .from("plano_preventivo_item")
          .select("id, grupo_id, ano_referencia, equipamento_nome, equipamento_auvo_id, periodicidade, periodicidade_meses, horas_total, meses_planejados, proxima_data, ultima_execucao_data, ativo")
          .eq("ativo", true)
          .order("ano_referencia", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        itens.push(...(data as PlanoItem[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const [{ data: grupos }, { data: contratos }, { data: membros }] = await Promise.all([
        supabase.from("grupos_clientes").select("id, nome"),
        supabase.from("contratos").select("grupo_id, cliente_nome, horas_mes_contratadas, ativo").eq("ativo", true),
        supabase.from("grupo_cliente_membros").select("grupo_id, cliente_nome"),
      ]);
      // identificadores dos equipamentos (para exibir "ID" no plano)
      const equipIds = Array.from(new Set(itens.map(i => i.equipamento_auvo_id).filter(Boolean))) as string[];
      const identMap = new Map<string, string>();
      for (let i = 0; i < equipIds.length; i += 500) {
        const slice = equipIds.slice(i, i + 500);
        const { data: eqs } = await (supabase as any)
          .from("equipamentos_auvo")
          .select("id, identificador")
          .in("id", slice);
        for (const e of (eqs ?? [])) if (e.identificador) identMap.set(e.id, e.identificador);
      }
      return {
        itens,
        grupos: (grupos ?? []) as Grupo[],
        contratos: (contratos ?? []) as Contrato[],
        membros: (membros ?? []) as { grupo_id: string; cliente_nome: string }[],
        identMap,
      };
    },
    staleTime: 30_000,
  });

  const aggregates = useMemo<Aggregate[]>(() => {
    if (!data) return [];
    const grupoById = new Map(data.grupos.map(g => [g.id, g.nome]));
    const membrosPorGrupo = new Map<string, string[]>();
    for (const m of data.membros) {
      if (!membrosPorGrupo.has(m.grupo_id)) membrosPorGrupo.set(m.grupo_id, []);
      membrosPorGrupo.get(m.grupo_id)!.push(m.cliente_nome);
    }
    const contratoPorGrupo = (gid: string) => {
      let total = 0;
      for (const c of data.contratos) {
        if (c.grupo_id === gid) total += Number(c.horas_mes_contratadas) || 0;
      }
      const clientes = new Set(membrosPorGrupo.get(gid) ?? []);
      for (const c of data.contratos) {
        if (!c.grupo_id && c.cliente_nome && clientes.has(c.cliente_nome)) {
          total += Number(c.horas_mes_contratadas) || 0;
        }
      }
      return total;
    };

    const map = new Map<string, Aggregate>();
    for (const it of data.itens) {
      const k = `${it.grupo_id}::${it.ano_referencia}`;
      if (!map.has(k)) {
        const ht_contrato_mes = contratoPorGrupo(it.grupo_id);
        map.set(k, {
          grupo_id: it.grupo_id,
          grupo_nome: grupoById.get(it.grupo_id) ?? "(Sem grupo)",
          ano_referencia: it.ano_referencia,
          itens: [],
          ht_ano: 0,
          ht_contrato_mes,
          ht_contrato_ano: ht_contrato_mes * 12,
          saldo_ano: 0,
          ht_por_mes: Array(12).fill(0),
          meses_estourados: 0,
          identificadorPorEquip: data.identMap,
        });
      }
      const agg = map.get(k)!;
      agg.itens.push(it);
      const ht_oc = htPorOcorrencia(it);
      for (const m of it.meses_planejados ?? []) {
        if (m >= 1 && m <= 12) agg.ht_por_mes[m - 1] += ht_oc;
      }
      agg.ht_ano += Number(it.horas_total) || 0;
    }
    for (const a of map.values()) {
      a.saldo_ano = a.ht_contrato_ano - a.ht_ano;
      a.meses_estourados = a.ht_por_mes.filter(v => v > a.ht_contrato_mes).length;
    }
    return Array.from(map.values()).sort((a, b) =>
      b.ano_referencia - a.ano_referencia || a.grupo_nome.localeCompare(b.grupo_nome)
    );
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return aggregates;
    return aggregates.filter(a =>
      a.grupo_nome.toLowerCase().includes(q) || String(a.ano_referencia).includes(q)
    );
  }, [aggregates, search]);

  const exportExcel = (agg: Aggregate) => {
    const wb = XLSX.utils.book_new();
    const rows = agg.itens.map(it => {
      const mesesSet = new Set(it.meses_planejados ?? []);
      const linha: any = {
        Equipamento: it.equipamento_nome,
        Periodicidade: it.periodicidade ?? "",
        "HT/ocorrência": Number(htPorOcorrencia(it).toFixed(2)),
        "HT total ano": Number(it.horas_total ?? 0),
        "Próxima": it.proxima_data ? format(parseISO(it.proxima_data), "dd/MM/yyyy") : "",
        "Última execução": it.ultima_execucao_data ? format(parseISO(it.ultima_execucao_data), "dd/MM/yyyy") : "",
      };
      MES_LABEL.forEach((m, i) => { linha[m] = mesesSet.has(i + 1) ? Number(htPorOcorrencia(it).toFixed(2)) : ""; });
      return linha;
    });
    const resumo: any = { Equipamento: "TOTAL MÊS", "HT total ano": Number(agg.ht_ano.toFixed(2)) };
    MES_LABEL.forEach((m, i) => { resumo[m] = Number(agg.ht_por_mes[i].toFixed(2)); });
    const meta: any = { Equipamento: "META CONTRATO", "HT total ano": Number(agg.ht_contrato_ano.toFixed(2)) };
    MES_LABEL.forEach(m => { meta[m] = Number(agg.ht_contrato_mes.toFixed(2)); });
    const saldo: any = { Equipamento: "SALDO", "HT total ano": Number(agg.saldo_ano.toFixed(2)) };
    MES_LABEL.forEach((m, i) => { saldo[m] = Number((agg.ht_contrato_mes - agg.ht_por_mes[i]).toFixed(2)); });
    const ws = XLSX.utils.json_to_sheet([...rows, {}, resumo, meta, saldo]);
    XLSX.utils.book_append_sheet(wb, ws, `Plano ${agg.ano_referencia}`);
    XLSX.writeFile(wb, `plano-preventiva-${agg.grupo_nome.replace(/[^\w]+/g, "_")}-${agg.ano_referencia}.xlsx`);
    toast.success("Excel gerado");
  };

  const exportPdf = (agg: Aggregate) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Plano de Preventivas — ${agg.grupo_nome} (${agg.ano_referencia})`, 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Contrato: ${agg.ht_contrato_mes.toFixed(1)}h/mês (${agg.ht_contrato_ano.toFixed(0)}h/ano) · Plano: ${agg.ht_ano.toFixed(0)}h · Saldo: ${agg.saldo_ano.toFixed(0)}h · Meses estourados: ${agg.meses_estourados}`,
      40, 58,
    );
    const head = [["Equipamento", "Period.", "HT", ...MES_LABEL, "Total", "Próxima"]];
    const body: any[] = agg.itens.map(it => {
      const set = new Set(it.meses_planejados ?? []);
      const ht = htPorOcorrencia(it);
      return [
        it.equipamento_nome,
        it.periodicidade ?? "",
        ht.toFixed(1),
        ...MES_LABEL.map((_, i) => set.has(i + 1) ? "•" : ""),
        (Number(it.horas_total ?? 0)).toFixed(1),
        it.proxima_data ? format(parseISO(it.proxima_data), "dd/MM/yyyy") : "—",
      ];
    });
    body.push(["TOTAL MÊS", "", "", ...agg.ht_por_mes.map(v => v.toFixed(1)), agg.ht_ano.toFixed(1), ""]);
    body.push(["SALDO (Meta − Plano)", "", "", ...agg.ht_por_mes.map(v => (agg.ht_contrato_mes - v).toFixed(1)), agg.saldo_ano.toFixed(1), ""]);
    autoTable(doc, {
      startY: 74, head, body,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 0: { cellWidth: 160 } },
      didParseCell: (d: any) => {
        if (d.section !== "body") return;
        const isTotal = d.row.index >= agg.itens.length;
        if (isTotal) {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = [241, 245, 249];
        }
        if (isTotal && d.row.index === agg.itens.length + 1 && d.column.index >= 3 && d.column.index <= 14) {
          const v = parseFloat(String(d.cell.raw));
          if (!Number.isNaN(v) && v < 0) d.cell.styles.textColor = [185, 28, 28];
        }
      },
      margin: { left: 20, right: 20 },
    });
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Página ${i} de ${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
    }
    doc.save(`plano-preventiva-${agg.grupo_nome.replace(/[^\w]+/g, "_")}-${agg.ano_referencia}.pdf`);
    toast.success("PDF gerado");
  };

  const inativarPlano = async (agg: Aggregate) => {
    if (!confirm(`Inativar TODO o plano de "${agg.grupo_nome}" (${agg.ano_referencia})? Os equipamentos voltam a ficar "sem plano".`)) return;
    const ids = agg.itens.map(i => i.id);
    const { error } = await (supabase as any).from("plano_preventivo_item").update({ ativo: false }).in("id", ids);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Plano inativado");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["planos-preventivos-all"] }),
      qc.invalidateQueries({ queryKey: ["plano-proximas-by-eq"] }),
      qc.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw", "v2-only-ativos"] }),
    ]);
  };

  const editingAgg = editingKey
    ? aggregates.find(a => a.grupo_id === editingKey.grupo_id && a.ano_referencia === editingKey.ano)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => nav(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Planos de Preventiva</h1>
            <p className="text-sm text-muted-foreground">
              Todos os planos salvos. Edite meses, HT e próxima data — reflete imediatamente na tela de Equipamentos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Atualizar
          </Button>
          <Button size="sm" onClick={() => nav("/financeiro/equipamentos-preventivos")}>
            <Plus className="h-4 w-4 mr-1" /> Gerar novo plano
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por grupo ou ano..." className="pl-10" />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupo</TableHead>
              <TableHead className="text-center">Ano</TableHead>
              <TableHead className="text-right">Equipamentos</TableHead>
              <TableHead className="text-right">HT ano (plano)</TableHead>
              <TableHead className="text-right">HT ano (contrato)</TableHead>
              <TableHead className="text-right">Saldo ano</TableHead>
              <TableHead className="text-center">Meses estourados</TableHead>
              <TableHead className="w-[240px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhum plano salvo. Vá em "Preventiva Equip." → "Gerar plano de preventivas".
                </TableCell>
              </TableRow>
            ) : filtered.map((a) => (
              <TableRow key={`${a.grupo_id}-${a.ano_referencia}`}>
                <TableCell className="font-medium">{a.grupo_nome}</TableCell>
                <TableCell className="text-center">{a.ano_referencia}</TableCell>
                <TableCell className="text-right tabular-nums">{a.itens.length}</TableCell>
                <TableCell className="text-right tabular-nums">{a.ht_ano.toFixed(0)}h</TableCell>
                <TableCell className="text-right tabular-nums">{a.ht_contrato_ano.toFixed(0)}h</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", a.saldo_ano < 0 ? "text-red-700" : "text-emerald-700")}>
                  {a.saldo_ano.toFixed(0)}h
                </TableCell>
                <TableCell className="text-center">
                  {a.meses_estourados > 0
                    ? <Badge variant="destructive">{a.meses_estourados}</Badge>
                    : <Badge variant="secondary">0</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setEditingKey({ grupo_id: a.grupo_id, ano: a.ano_referencia })}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportExcel(a)} title="Excel">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportPdf(a)} title="PDF">
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => inativarPlano(a)} title="Inativar plano">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingAgg && (
        <EditarPlanoDialog
          agg={editingAgg}
          onClose={() => setEditingKey(null)}
          onSaved={() => {
            setEditingKey(null);
            qc.invalidateQueries({ queryKey: ["planos-preventivos-all"] });
            qc.invalidateQueries({ queryKey: ["plano-proximas-by-eq"] });
            qc.invalidateQueries({ queryKey: ["equipamentos-preventivos-raw", "v2-only-ativos"] });
          }}
        />
      )}
    </div>
  );
}

function EditarPlanoDialog({
  agg, onClose, onSaved,
}: {
  agg: Aggregate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [itens, setItens] = useState<PlanoItem[]>(() => agg.itens.map(i => ({ ...i, meses_planejados: [...(i.meses_planejados ?? [])] })));
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const setItem = (id: string, patch: Partial<PlanoItem>) => {
    setItens(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  };

  const toggleMes = (id: string, mes: number) => {
    setItens(prev => prev.map(it => {
      if (it.id !== id) return it;
      const cur = it.meses_planejados ?? [];
      const has = cur.includes(mes);
      const ht_oc = cur.length > 0 ? (Number(it.horas_total) || 0) / cur.length : 0;
      const meses = has ? cur.filter(m => m !== mes) : [...cur, mes].sort((a, b) => a - b);
      const horas_total = ht_oc * meses.length;
      const proxima = calcProxima(meses, it.ano_referencia);
      return { ...it, meses_planejados: meses, horas_total, proxima_data: proxima };
    }));
  };

  const setHT = (id: string, ht: number) => {
    setItens(prev => prev.map(it => {
      if (it.id !== id) return it;
      const n = (it.meses_planejados ?? []).length;
      return { ...it, horas_total: ht * n };
    }));
  };

  const setProxima = (id: string, iso: string) => setItem(id, { proxima_data: iso || null });

  const remover = (id: string) => {
    setItens(prev => prev.filter(it => it.id !== id));
  };

  const totMes = useMemo(() => {
    const arr = Array(12).fill(0);
    for (const it of itens) {
      const n = (it.meses_planejados ?? []).length;
      const ht_oc = n > 0 ? (Number(it.horas_total) || 0) / n : 0;
      for (const m of it.meses_planejados ?? []) if (m >= 1 && m <= 12) arr[m - 1] += ht_oc;
    }
    return arr;
  }, [itens]);

  const ht_ano = totMes.reduce((a, b) => a + b, 0);
  const saldo_ano = agg.ht_contrato_ano - ht_ano;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(it => it.equipamento_nome.toLowerCase().includes(q));
  }, [itens, search]);

  const salvar = async () => {
    setSaving(true);
    try {
      const originalIds = new Set(agg.itens.map(i => i.id));
      const keptIds = new Set(itens.filter(i => !i._new).map(i => i.id));
      const removed = [...originalIds].filter(id => !keptIds.has(id));
      if (removed.length) {
        const { error } = await (supabase as any).from("plano_preventivo_item").update({ ativo: false }).in("id", removed);
        if (error) throw error;
      }
      const novos = itens.filter(i => i._new);
      if (novos.length) {
        const inserts = novos.map(it => ({
          grupo_id: agg.grupo_id,
          ano_referencia: agg.ano_referencia,
          equipamento_nome: it.equipamento_nome,
          equipamento_auvo_id: it.equipamento_auvo_id,
          categoria: it.categoria ?? null,
          criticidade: it.criticidade ?? null,
          periodicidade: it.periodicidade ?? "Semestral",
          periodicidade_meses: it.periodicidade_meses ?? 6,
          horas_total: Number(it.horas_total) || 0,
          meses_planejados: it.meses_planejados ?? [],
          proxima_data: it.proxima_data,
          ultima_execucao_data: it.ultima_execucao_data,
          ativo: true,
        }));
        const { error } = await (supabase as any)
          .from("plano_preventivo_item")
          .upsert(inserts, { onConflict: "grupo_id,ano_referencia,equipamento_auvo_id" });
        if (error) throw error;
      }
      for (const it of itens.filter(i => !i._new)) {
        const payload = {
          meses_planejados: it.meses_planejados ?? [],
          horas_total: Number(it.horas_total) || 0,
          proxima_data: it.proxima_data,
          periodicidade: it.periodicidade,
          periodicidade_meses: it.periodicidade_meses,
        };
        const { error } = await (supabase as any).from("plano_preventivo_item").update(payload).eq("id", it.id);
        if (error) throw error;
      }
      toast.success("Plano salvo");
      onSaved();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{agg.grupo_nome} — Plano {agg.ano_referencia}</DialogTitle>
          <DialogDescription>
            Contrato: <strong>{agg.ht_contrato_mes.toFixed(1)}h/mês</strong> · Ano: <strong>{agg.ht_contrato_ano.toFixed(0)}h</strong>.
            Clique numa célula de mês para adicionar/remover.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 border rounded-md p-2 bg-muted/30 text-sm flex-wrap">
          <div>Equipamentos: <strong>{itens.length}</strong></div>
          <div>HT plano: <strong>{ht_ano.toFixed(0)}h</strong></div>
          <div>Saldo: <strong className={cn(saldo_ano < 0 ? "text-red-700" : "text-emerald-700")}>{saldo_ano.toFixed(0)}h</strong></div>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar equipamento
          </Button>
          <div className="ml-auto relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar equipamento..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-8 w-64" />
          </div>
        </div>

        <div className="border rounded-md flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:bg-background [&>th]:z-10 [&>th]:shadow-[0_1px_0_hsl(var(--border))] [&>th]:text-left [&>th]:px-2 [&>th]:py-2 [&>th]:text-xs">
                <th className="min-w-[240px]">Equipamento</th>
                <th>Period.</th>
                <th className="text-right">HT</th>
                {MES_LABEL.map(m => <th key={m} className="text-center w-12">{m}</th>)}
                <th className="text-right">Total</th>
                <th>Próxima</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const set = new Set(it.meses_planejados ?? []);
                const n = set.size;
                const ht_oc = n > 0 ? (Number(it.horas_total) || 0) / n : 0;
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-2 py-1">
                      <div className="text-sm">{it.equipamento_nome}</div>
                      {it.ultima_execucao_data && (
                        <div className="text-[10px] text-muted-foreground">
                          Última: {format(parseISO(it.ultima_execucao_data), "dd/MM/yyyy")}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1"><Badge variant="outline" className="text-[10px]">{it.periodicidade ?? "—"}</Badge></td>
                    <td className="px-2 py-1 text-right">
                      <Input
                        type="number" step="0.5" min="0"
                        value={Number(ht_oc.toFixed(2))}
                        onChange={(e) => setHT(it.id, Number(e.target.value) || 0)}
                        className="h-7 w-16 text-right text-xs px-1"
                      />
                    </td>
                    {MES_LABEL.map((_, i) => {
                      const m = i + 1;
                      const on = set.has(m);
                      return (
                        <td key={m}
                          className={cn(
                            "text-center text-xs font-medium select-none cursor-pointer hover:ring-2 hover:ring-primary/40 transition",
                            on ? "bg-emerald-100 text-emerald-900" : "text-muted-foreground",
                          )}
                          onClick={() => toggleMes(it.id, m)}
                        >
                          {on ? ht_oc.toFixed(1) : "·"}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right tabular-nums text-xs">{(Number(it.horas_total) || 0).toFixed(1)}h</td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={it.proxima_data ? it.proxima_data.slice(0, 10) : ""}
                        onChange={(e) => setProxima(it.id, e.target.value)}
                        className="h-7 w-36 text-xs px-1"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Button size="icon" variant="ghost" onClick={() => remover(it.id)} title="Remover">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold text-xs sticky bottom-0">
                <td className="px-2 py-1" colSpan={3}>TOTAL / MÊS</td>
                {totMes.map((v, i) => (
                  <td key={i} className={cn("text-center", v > agg.ht_contrato_mes ? "text-red-700" : "")}>
                    {v.toFixed(1)}
                  </td>
                ))}
                <td className="text-right px-2 py-1">{ht_ano.toFixed(1)}h</td>
                <td colSpan={2}></td>
              </tr>
              <tr className="bg-muted/20 text-xs">
                <td className="px-2 py-1" colSpan={3}>SALDO (meta {agg.ht_contrato_mes.toFixed(1)}h)</td>
                {totMes.map((v, i) => {
                  const s = agg.ht_contrato_mes - v;
                  return <td key={i} className={cn("text-center", s < 0 ? "text-red-700 font-semibold" : "text-emerald-700")}>{s.toFixed(1)}</td>;
                })}
                <td className="text-right px-2 py-1">{saldo_ano.toFixed(1)}h</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar plano
          </Button>
        </DialogFooter>

        {addOpen && (
          <AdicionarEquipamentoDialog
            grupoId={agg.grupo_id}
            anoReferencia={agg.ano_referencia}
            jaNoPlano={new Set(itens.map(i => i.equipamento_auvo_id).filter(Boolean) as string[])}
            onClose={() => setAddOpen(false)}
            onAdd={(novos) => {
              setItens(prev => [...prev, ...novos]);
              setAddOpen(false);
              toast.success(`${novos.length} equipamento(s) adicionado(s). Ajuste meses e clique em "Salvar plano".`);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdicionarEquipamentoDialog({
  grupoId, anoReferencia, jaNoPlano, onClose, onAdd,
}: {
  grupoId: string;
  anoReferencia: number;
  jaNoPlano: Set<string>;
  onClose: () => void;
  onAdd: (novos: PlanoItem[]) => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["consolidado-por-grupo", grupoId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("equipamento_preventiva_consolidado")
        .select("equip_id, nome, identificador, cliente, categoria, tipo_nome, criticidade, periodicidade, periodicidade_meses, ht_por_ocorrencia, ultima_preventiva, equip_status")
        .eq("grupo_id", grupoId)
        .order("cliente", { ascending: true })
        .order("nome", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const disponiveis = useMemo(() => {
    const rows = (data ?? []).filter((r: any) => {
      if (jaNoPlano.has(r.equip_id)) return false;
      const s = String(r.equip_status ?? "").toLowerCase();
      if (s && s.includes("inativ")) return false;
      return true;
    });
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r: any) =>
      (r.nome ?? "").toLowerCase().includes(term) ||
      (r.identificador ?? "").toLowerCase().includes(term) ||
      (r.cliente ?? "").toLowerCase().includes(term) ||
      (r.tipo_nome ?? "").toLowerCase().includes(term) ||
      (r.categoria ?? "").toLowerCase().includes(term)
    );
  }, [data, jaNoPlano, q]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === disponiveis.length) setSelected(new Set());
    else setSelected(new Set(disponiveis.map((r: any) => r.equip_id)));
  };

  const confirmar = () => {
    const novos: PlanoItem[] = disponiveis
      .filter((r: any) => selected.has(r.equip_id))
      .map((r: any) => {
        const periodMeses = Number(r.periodicidade_meses) || 6;
        const period = r.periodicidade ?? (periodMeses === 12 ? "Anual" : periodMeses === 6 ? "Semestral" : periodMeses === 3 ? "Trimestral" : periodMeses === 1 ? "Mensal" : "Semestral");
        const htOc = Number(r.ht_por_ocorrencia) || 0;
        return {
          id: `new-${crypto.randomUUID()}`,
          grupo_id: grupoId,
          ano_referencia: anoReferencia,
          equipamento_nome: `${r.identificador ? r.identificador + " - " : ""}${r.nome ?? ""} (${r.cliente ?? ""})`.trim(),
          equipamento_auvo_id: r.equip_id,
          periodicidade: period,
          periodicidade_meses: periodMeses,
          horas_total: htOc,
          meses_planejados: [],
          proxima_data: null,
          ultima_execucao_data: r.ultima_preventiva ?? null,
          ativo: true,
          categoria: r.tipo_nome ?? r.categoria ?? null,
          criticidade: r.criticidade ?? null,
          _new: true,
        };
      });
    if (!novos.length) { toast.error("Selecione ao menos 1 equipamento"); return; }
    onAdd(novos);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar equipamentos ao plano</DialogTitle>
          <DialogDescription>
            Equipamentos ativos do grupo que ainda não estão neste plano. Marque os que quer adicionar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, ID, cliente, tipo..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Button variant="outline" size="sm" onClick={toggleAll} disabled={!disponiveis.length}>
            {selected.size === disponiveis.length && disponiveis.length > 0 ? "Desmarcar todos" : "Marcar todos"}
          </Button>
        </div>

        <div className="border rounded-md flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-left text-xs [&>th]:px-2 [&>th]:py-2">
                <th className="w-8"></th>
                <th>Equipamento</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Period.</th>
                <th className="text-right">HT/oc</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Carregando...</td></tr>
              ) : disponiveis.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Nenhum equipamento disponível.</td></tr>
              ) : disponiveis.map((r: any) => (
                <tr key={r.equip_id}
                    className={cn("border-t cursor-pointer hover:bg-muted/50", selected.has(r.equip_id) && "bg-primary/5")}
                    onClick={() => toggle(r.equip_id)}>
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selected.has(r.equip_id)} onChange={() => toggle(r.equip_id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-2 py-1">
                    <div>{r.nome}</div>
                    {r.identificador && <div className="text-[10px] text-muted-foreground">ID: {r.identificador}</div>}
                  </td>
                  <td className="px-2 py-1 text-xs">{r.cliente ?? "—"}</td>
                  <td className="px-2 py-1 text-xs">{r.tipo_nome ?? "—"}</td>
                  <td className="px-2 py-1 text-xs">{r.periodicidade ?? "—"}</td>
                  <td className="px-2 py-1 text-right text-xs tabular-nums">{Number(r.ht_por_ocorrencia ?? 0).toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground">
          {selected.size} selecionado(s) · {disponiveis.length} disponível(is)
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!selected.size}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar {selected.size ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
