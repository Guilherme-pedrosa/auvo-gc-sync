import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, LogOut, Loader2, Search, Download, FileText, Clock,
  ChevronRight, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
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
};

type UltimaInfo = {
  data: string | null;
  link: string | null;
  task_id: string | null;
};

type Grupo = { id: string; nome: string };
type Contrato = { grupo_id: string | null; cliente_nome: string | null; horas_mes_contratadas: number };

const MES_LABEL = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type Aggregate = {
  grupo_id: string;
  grupo_nome: string;
  cliente_nome: string; // nome "amigável" (sem prefixo [Auto])
  ano_referencia: number;
  itens: PlanoItem[];
  ultimaByAuvoId: Map<string, UltimaInfo>;
  ht_ano: number;
  ht_contrato_mes: number;
  ht_contrato_ano: number;
  saldo_ano: number;
  ht_por_mes: number[];
  meses_estourados: number;
};

const normalize = (s: string) =>
  (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|MEI)\s*/g, "")
    .replace(/[.\-\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function htPorOcorrencia(it: PlanoItem): number {
  const n = (it.meses_planejados?.length ?? 0);
  if (!n) return 0;
  return (Number(it.horas_total) || 0) / n;
}

function stripAutoPrefix(name: string): string {
  return name.replace(/^\s*\[Auto\]\s*/i, "").trim();
}

export default function PortalPlanosPreventivosPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openAgg, setOpenAgg] = useState<Aggregate | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-planos-preventivos", profile?.grupo_id],
    enabled: !!profile?.grupo_id,
    queryFn: async () => {
      const grupoId = profile!.grupo_id!;
      // 1) grupo principal + membros (clientes da rede)
      const [{ data: grupoPrinc }, { data: membros }] = await Promise.all([
        supabase.from("grupos_clientes").select("id, nome").eq("id", grupoId).maybeSingle(),
        supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", grupoId),
      ]);
      const memberNames = (membros ?? []).map(m => m.cliente_nome as string);
      const memberNamesNorm = new Set(memberNames.map(normalize));

      // 2) buscar todos os grupos e filtrar os "[Auto] <cliente>" cujos clientes pertençam à rede
      const { data: allGrupos } = await supabase.from("grupos_clientes").select("id, nome");
      const grupos = (allGrupos ?? []) as Grupo[];
      const autoGrupos = grupos.filter(g => {
        if (g.id === grupoId) return true;
        if (!/^\s*\[Auto\]/i.test(g.nome)) return false;
        const cliente = normalize(stripAutoPrefix(g.nome));
        return memberNamesNorm.has(cliente);
      });
      const allowedGroupIds = new Set(autoGrupos.map(g => g.id));

      // 3) itens
      const itens: PlanoItem[] = [];
      let from = 0; const PAGE = 1000;
      const ids = Array.from(allowedGroupIds);
      if (ids.length) {
        while (true) {
          const { data: page, error } = await (supabase as any)
            .from("plano_preventivo_item")
            .select("id, grupo_id, ano_referencia, equipamento_nome, equipamento_auvo_id, periodicidade, periodicidade_meses, horas_total, meses_planejados, proxima_data, ultima_execucao_data, ativo")
            .eq("ativo", true)
            .in("grupo_id", ids)
            .order("ano_referencia", { ascending: false })
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!page?.length) break;
          itens.push(...(page as PlanoItem[]));
          if (page.length < PAGE) break;
          from += PAGE;
        }
      }

      // 4) contratos (para meta de horas)
      const { data: contratos } = await supabase
        .from("contratos")
        .select("grupo_id, cliente_nome, horas_mes_contratadas, ativo")
        .eq("ativo", true);

      // 5) consolidado (última preventiva + link do relatório no Auvo)
      const auvoIds = Array.from(new Set(
        itens.map(i => i.equipamento_auvo_id).filter(Boolean) as string[],
      ));
      const ultimaByAuvoId = new Map<string, UltimaInfo>();
      if (auvoIds.length) {
        const CHUNK = 500;
        for (let i = 0; i < auvoIds.length; i += CHUNK) {
          const slice = auvoIds.slice(i, i + CHUNK);
          const { data: cons } = await (supabase as any)
            .from("equipamento_preventiva_consolidado")
            .select("auvo_equipment_id, ultima_preventiva, ultima_preventiva_link, ultima_preventiva_task_id")
            .in("auvo_equipment_id", slice);
          for (const r of (cons ?? []) as any[]) {
            if (!r.auvo_equipment_id) continue;
            ultimaByAuvoId.set(String(r.auvo_equipment_id), {
              data: r.ultima_preventiva ?? null,
              link: r.ultima_preventiva_link ?? null,
              task_id: r.ultima_preventiva_task_id ?? null,
            });
          }
        }
      }

      return {
        grupoPrincipal: grupoPrinc as Grupo | null,
        memberNames,
        grupos: autoGrupos,
        itens,
        contratos: (contratos ?? []) as Contrato[],
        ultimaByAuvoId,
      };
    },
    staleTime: 60_000,
  });

  const aggregates = useMemo<Aggregate[]>(() => {
    if (!data) return [];
    const grupoById = new Map(data.grupos.map(g => [g.id, g.nome]));

    const contratoPorGrupo = (gid: string): number => {
      let total = 0;
      for (const c of data.contratos) {
        if (c.grupo_id === gid) total += Number(c.horas_mes_contratadas) || 0;
      }
      // fallback: buscar por cliente_nome (grupo [Auto] X → cliente X)
      const grupoNome = grupoById.get(gid) || "";
      const clienteNorm = normalize(stripAutoPrefix(grupoNome));
      if (clienteNorm) {
        for (const c of data.contratos) {
          if (!c.grupo_id && c.cliente_nome && normalize(c.cliente_nome) === clienteNorm) {
            total += Number(c.horas_mes_contratadas) || 0;
          }
        }
      }
      return total;
    };

    const map = new Map<string, Aggregate>();
    for (const it of data.itens) {
      const k = `${it.grupo_id}::${it.ano_referencia}`;
      if (!map.has(k)) {
        const grupoNome = grupoById.get(it.grupo_id) ?? "(Sem grupo)";
        const clienteNome = stripAutoPrefix(grupoNome);
        const ht_contrato_mes = contratoPorGrupo(it.grupo_id);
        map.set(k, {
          grupo_id: it.grupo_id,
          grupo_nome: grupoNome,
          cliente_nome: clienteNome,
          ano_referencia: it.ano_referencia,
          itens: [],
          ultimaByAuvoId: data.ultimaByAuvoId,
          ht_ano: 0,
          ht_contrato_mes,
          ht_contrato_ano: ht_contrato_mes * 12,
          saldo_ano: 0,
          ht_por_mes: Array(12).fill(0),
          meses_estourados: 0,
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
      a.meses_estourados = a.ht_por_mes.filter(v => v > a.ht_contrato_mes && a.ht_contrato_mes > 0).length;
    }
    return Array.from(map.values()).sort((a, b) =>
      b.ano_referencia - a.ano_referencia || a.cliente_nome.localeCompare(b.cliente_nome, "pt-BR")
    );
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return aggregates;
    return aggregates.filter(a =>
      a.cliente_nome.toLowerCase().includes(q) ||
      String(a.ano_referencia).includes(q),
    );
  }, [aggregates, search]);

  // Agrupar por cliente
  const porCliente = useMemo(() => {
    const m = new Map<string, Aggregate[]>();
    for (const a of filtered) {
      if (!m.has(a.cliente_nome)) m.set(a.cliente_nome, []);
      m.get(a.cliente_nome)!.push(a);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [filtered]);

  const exportExcel = (agg: Aggregate) => {
    const wb = XLSX.utils.book_new();
    const rows = agg.itens.map(it => {
      const set = new Set(it.meses_planejados ?? []);
      const linha: any = {
        Equipamento: it.equipamento_nome,
        Periodicidade: it.periodicidade ?? "",
        "HT/ocorrência": Number(htPorOcorrencia(it).toFixed(2)),
        "HT total ano": Number(it.horas_total ?? 0),
        "Próxima": it.proxima_data ? format(parseISO(it.proxima_data), "dd/MM/yyyy") : "",
        "Última execução": it.ultima_execucao_data ? format(parseISO(it.ultima_execucao_data), "dd/MM/yyyy") : "",
      };
      MES_LABEL.forEach((m, i) => { linha[m] = set.has(i + 1) ? Number(htPorOcorrencia(it).toFixed(2)) : ""; });
      return linha;
    });
    const resumo: any = { Equipamento: "TOTAL MÊS", "HT total ano": Number(agg.ht_ano.toFixed(2)) };
    MES_LABEL.forEach((m, i) => { resumo[m] = Number(agg.ht_por_mes[i].toFixed(2)); });
    const meta: any = { Equipamento: "META CONTRATO", "HT total ano": Number(agg.ht_contrato_ano.toFixed(2)) };
    MES_LABEL.forEach(m => { meta[m] = Number(agg.ht_contrato_mes.toFixed(2)); });
    const ws = XLSX.utils.json_to_sheet([...rows, {}, resumo, meta]);
    XLSX.utils.book_append_sheet(wb, ws, `Plano ${agg.ano_referencia}`);
    XLSX.writeFile(wb, `plano-${agg.cliente_nome.replace(/[^\w]+/g, "_")}-${agg.ano_referencia}.xlsx`);
    toast.success("Excel gerado");
  };

  const exportPdf = (agg: Aggregate) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Plano de Preventivas — ${agg.cliente_nome} (${agg.ano_referencia})`, 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Contrato: ${agg.ht_contrato_mes.toFixed(1)}h/mês (${agg.ht_contrato_ano.toFixed(0)}h/ano) · Plano: ${agg.ht_ano.toFixed(0)}h · Saldo: ${agg.saldo_ano.toFixed(0)}h`,
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
    doc.save(`plano-${agg.cliente_nome.replace(/[^\w]+/g, "_")}-${agg.ano_referencia}.pdf`);
    toast.success("PDF gerado");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile?.grupo_id) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto pt-20 text-center space-y-4">
          <h1 className="text-2xl font-semibold">Sem grupo liberado</h1>
          <p className="text-muted-foreground">
            Seu usuário ainda não foi vinculado a um grupo de clientes. Entre em contato com o responsável.
          </p>
          <Button variant="outline" onClick={() => signOut().then(() => navigate("/portal/login"))}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/portal/horas")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">W</span>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Portal do Cliente</p>
              <p className="text-xs text-muted-foreground leading-tight">{data?.grupoPrincipal?.nome}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{profile?.nome || profile?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/portal/login"))}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Planos de Preventiva</h1>
            <p className="text-sm text-muted-foreground">
              Um cartão por unidade. Clique num plano para ver o cronograma detalhado.
            </p>
          </div>
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar unidade ou ano..." className="pl-10" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando planos...
          </div>
        ) : porCliente.length === 0 ? (
          <div className="border rounded-lg p-10 text-center text-muted-foreground">
            Nenhum plano de preventiva disponível para a sua rede ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {porCliente.map(([cliente, planos]) => (
              <Card key={cliente} className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-start justify-between gap-2">
                    <span className="truncate" title={cliente}>{cliente}</span>
                    <Badge variant="secondary" className="shrink-0">{planos.length} plano{planos.length > 1 ? "s" : ""}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-2">
                  {planos.map(p => (
                    <button
                      key={`${p.grupo_id}-${p.ano_referencia}`}
                      onClick={() => setOpenAgg(p)}
                      className="w-full text-left border rounded-md p-3 hover:bg-muted/40 transition group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Ano {p.ano_referencia}</div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition" />
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Equip.</div>
                          <div className="font-medium">{p.itens.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">HT plano</div>
                          <div className="font-medium">{p.ht_ano.toFixed(0)}h</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Contrato</div>
                          <div className="font-medium">{p.ht_contrato_ano.toFixed(0)}h</div>
                        </div>
                      </div>
                      {p.ht_contrato_mes > 0 && (
                        <div className="mt-2 flex items-center justify-between text-[11px]">
                          <span className={cn(
                            "flex items-center gap-1",
                            p.saldo_ano < 0 ? "text-red-700" : "text-emerald-700",
                          )}>
                            <Clock className="h-3 w-3" />
                            Saldo {p.saldo_ano.toFixed(0)}h
                          </span>
                          {p.meses_estourados > 0 && (
                            <Badge variant="destructive" className="text-[10px] py-0">
                              {p.meses_estourados} mês(es) acima da meta
                            </Badge>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {openAgg && (
        <PlanoViewDialog
          agg={openAgg}
          onClose={() => setOpenAgg(null)}
          onExportExcel={() => exportExcel(openAgg)}
          onExportPdf={() => exportPdf(openAgg)}
        />
      )}
    </div>
  );
}

function PlanoViewDialog({
  agg, onClose, onExportExcel, onExportPdf,
}: {
  agg: Aggregate;
  onClose: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agg.itens;
    return agg.itens.filter(it => it.equipamento_nome.toLowerCase().includes(q));
  }, [agg.itens, search]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{agg.cliente_nome} — Plano {agg.ano_referencia}</DialogTitle>
          <DialogDescription>
            Contrato: <strong>{agg.ht_contrato_mes.toFixed(1)}h/mês</strong> ({agg.ht_contrato_ano.toFixed(0)}h/ano) ·
            Plano: <strong>{agg.ht_ano.toFixed(0)}h</strong> ·
            Saldo: <strong className={cn(agg.saldo_ano < 0 ? "text-red-700" : "text-emerald-700")}>{agg.saldo_ano.toFixed(0)}h</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Buscar equipamento..." value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-7 h-8 w-64" />
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={onExportExcel}>
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={onExportPdf}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const set = new Set(it.meses_planejados ?? []);
                const ht_oc = htPorOcorrencia(it);
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-2 py-1">
                      <div className="text-sm">{it.equipamento_nome}</div>
                      {(() => {
                        const info = it.equipamento_auvo_id ? agg.ultimaByAuvoId.get(it.equipamento_auvo_id) : null;
                        const ultimaISO = info?.data ?? it.ultima_execucao_data;
                        if (!ultimaISO && !info?.link) return null;
                        return (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                            {ultimaISO && <span>Última: {format(parseISO(ultimaISO), "dd/MM/yyyy")}</span>}
                            {info?.link && (
                              <a
                                href={info.link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                title="Abrir relatório da última preventiva"
                              >
                                <ExternalLink className="h-3 w-3" /> relatório
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant="outline" className="text-[10px]">{it.periodicidade ?? "—"}</Badge>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-xs">{ht_oc.toFixed(1)}</td>
                    {MES_LABEL.map((_, i) => {
                      const m = i + 1;
                      const on = set.has(m);
                      return (
                        <td key={m} className={cn(
                          "text-center text-xs font-medium",
                          on ? "bg-emerald-100 text-emerald-900" : "text-muted-foreground",
                        )}>
                          {on ? ht_oc.toFixed(1) : "·"}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right tabular-nums text-xs">
                      {(Number(it.horas_total) || 0).toFixed(1)}h
                    </td>
                    <td className="px-2 py-1 text-xs">
                      {it.proxima_data ? format(parseISO(it.proxima_data), "dd/MM/yyyy") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold text-xs sticky bottom-0">
                <td className="px-2 py-1" colSpan={3}>TOTAL / MÊS</td>
                {agg.ht_por_mes.map((v, i) => (
                  <td key={i} className={cn(
                    "text-center",
                    agg.ht_contrato_mes > 0 && v > agg.ht_contrato_mes ? "text-red-700" : "",
                  )}>
                    {v.toFixed(1)}
                  </td>
                ))}
                <td className="text-right px-2 py-1">{agg.ht_ano.toFixed(1)}h</td>
                <td></td>
              </tr>
              {agg.ht_contrato_mes > 0 && (
                <tr className="bg-muted/20 text-xs">
                  <td className="px-2 py-1" colSpan={3}>SALDO (meta {agg.ht_contrato_mes.toFixed(1)}h)</td>
                  {agg.ht_por_mes.map((v, i) => {
                    const s = agg.ht_contrato_mes - v;
                    return <td key={i} className={cn("text-center", s < 0 ? "text-red-700 font-semibold" : "text-emerald-700")}>{s.toFixed(1)}</td>;
                  })}
                  <td className="text-right px-2 py-1">{agg.saldo_ano.toFixed(1)}h</td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
