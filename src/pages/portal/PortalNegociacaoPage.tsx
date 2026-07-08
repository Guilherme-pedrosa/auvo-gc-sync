import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, LogOut, ExternalLink, HandshakeIcon, DollarSign, AlertTriangle,
  ListChecks, Wallet, FileText, CalendarCheck, Clock, Building2,
  FileDown, FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (s: string) => {
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

// Extrai a chave YYYY-MM de uma data em formato ISO (yyyy-mm-dd) ou br (dd/mm/yyyy)
const monthKey = (s?: string): string => {
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}`;
  return "";
};

const MES_NOMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const monthLabel = (key: string): string => {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MES_NOMES[idx] || m}/${y}`;
};

interface OSItem {
  gc_os_id: string;
  codigo: string;
  cliente: string;
  situacao: string;
  cor_situacao?: string;
  data: string;
  data_saida?: string;
  valor_total: number;
  descricao: string;
  vendedor: string;
  link: string;
}

interface RecebItem {
  gc_recebimento_id: string;
  codigo: string;
  descricao: string;
  cliente: string;
  valor: number;
  valor_pago: number;
  valor_pendente: number;
  data_vencimento: string;
  liquidado: string;
  atrasado: boolean;
  os_codigo: string;
  forma_pagamento: string;
  parcela: string;
}

interface Totals {
  qtd_os: number;
  valor_os: number;
  qtd_recebimentos: number;
  valor_recebimentos: number;
  valor_atrasado: number;
  qtd_atrasado: number;
}

export default function PortalNegociacaoPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"os" | "financeiro">("os");
  const [casaFilter, setCasaFilter] = useState<string>("__all__");
  const [mesSaidaFilter, setMesSaidaFilter] = useState<string>("__all__");
  const [selOs, setSelOs] = useState<Record<string, boolean>>({});
  const [selRec, setSelRec] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["portal-negociacao"],
    enabled: !!user && role === "cliente",
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("portal-negociacao-fetch", {
        body: {},
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error || "Falha ao carregar");
      return data as { os_list: OSItem[]; recebimentos: RecebItem[]; totals: Totals };
    },
  });

  const totals = data?.totals;

  const casasOs = useMemo(() => {
    const set = new Set<string>();
    (data?.os_list || []).forEach((o) => o.cliente && set.add(o.cliente));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const casasRec = useMemo(() => {
    const set = new Set<string>();
    (data?.recebimentos || []).forEach((r) => r.cliente && set.add(r.cliente));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const casasOpts = tab === "os" ? casasOs : casasRec;

  // Opções de mês da data de saída (somente da aba OS)
  const mesesSaida = useMemo(() => {
    const set = new Set<string>();
    (data?.os_list || []).forEach((o) => {
      const k = monthKey(o.data_saida || o.data);
      if (k) set.add(k);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data]);

  const filteredOs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.os_list || [];
    return list.filter((o) => {
      if (casaFilter !== "__all__" && o.cliente !== casaFilter) return false;
      if (mesSaidaFilter !== "__all__") {
        const k = monthKey(o.data_saida || o.data);
        if (k !== mesSaidaFilter) return false;
      }
      if (!q) return true;
      return (
        o.codigo.toLowerCase().includes(q) ||
        o.cliente.toLowerCase().includes(q) ||
        o.descricao.toLowerCase().includes(q) ||
        o.situacao.toLowerCase().includes(q)
      );
    });
  }, [data, search, casaFilter, mesSaidaFilter]);

  const filteredRec = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.recebimentos || [];
    return list.filter((r) => {
      if (casaFilter !== "__all__" && r.cliente !== casaFilter) return false;
      if (!q) return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.cliente.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q) ||
        r.os_codigo.toLowerCase().includes(q)
      );
    });
  }, [data, search, casaFilter]);

  // Somatórias por casa
  const sumOsByCasa = useMemo(() => {
    const map = new Map<string, { qtd: number; total: number }>();
    filteredOs.forEach((o) => {
      const c = o.cliente || "—";
      const cur = map.get(c) || { qtd: 0, total: 0 };
      cur.qtd += 1;
      cur.total += Number(o.valor_total || 0);
      map.set(c, cur);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [filteredOs]);

  const sumRecByCasa = useMemo(() => {
    const map = new Map<string, { qtd: number; total: number; atraso: number }>();
    filteredRec.forEach((r) => {
      const c = r.cliente || "—";
      const cur = map.get(c) || { qtd: 0, total: 0, atraso: 0 };
      cur.qtd += 1;
      cur.total += Number(r.valor_pendente || 0);
      if (r.atrasado) cur.atraso += Number(r.valor_pendente || 0);
      map.set(c, cur);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [filteredRec]);

  // Seleção
  const selectedOs = useMemo(
    () => filteredOs.filter((o) => selOs[o.gc_os_id]),
    [filteredOs, selOs],
  );
  const selectedRec = useMemo(
    () => filteredRec.filter((r) => selRec[r.gc_recebimento_id]),
    [filteredRec, selRec],
  );

  const toggleAllOs = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    if (checked) filteredOs.forEach((o) => (next[o.gc_os_id] = true));
    setSelOs(next);
  };
  const toggleAllRec = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    if (checked) filteredRec.forEach((r) => (next[r.gc_recebimento_id] = true));
    setSelRec(next);
  };

  const rowsOsExport = () => {
    const src = selectedOs.length > 0 ? selectedOs : filteredOs;
    return src.map((o) => ({
      Codigo: o.codigo,
      Casa: o.cliente,
      Situacao: o.situacao,
      Abertura: fmtData(o.data),
      Vendedor: o.vendedor || "",
      Descricao: o.descricao || "",
      Valor: Number(o.valor_total || 0),
      Link: o.link || "",
    }));
  };
  const rowsRecExport = () => {
    const src = selectedRec.length > 0 ? selectedRec : filteredRec;
    return src.map((r) => ({
      Titulo: r.codigo || r.gc_recebimento_id,
      Casa: r.cliente,
      OS: r.os_codigo || "",
      Parcela: r.parcela || "",
      Vencimento: fmtData(r.data_vencimento),
      Situacao: r.atrasado ? "EM ATRASO" : "EM ABERTO",
      Forma: r.forma_pagamento || "",
      Descricao: r.descricao || "",
      Valor: Number(r.valor || 0),
      Pago: Number(r.valor_pago || 0),
      Pendente: Number(r.valor_pendente || 0),
    }));
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    if (tab === "os") {
      const rows = rowsOsExport();
      if (!rows.length) return toast.error("Nada para exportar");
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "OS Ag. Negociação");
      const sumRows = sumOsByCasa.map(([c, v]) => ({ Casa: c, Qtd: v.qtd, Total: v.total }));
      sumRows.push({ Casa: "TOTAL", Qtd: rows.length, Total: rows.reduce((s, r) => s + r.Valor, 0) });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sumRows), "Somatória por Casa");
    } else {
      const rows = rowsRecExport();
      if (!rows.length) return toast.error("Nada para exportar");
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Financeiro Pendente");
      const sumRows = sumRecByCasa.map(([c, v]) => ({
        Casa: c, Qtd: v.qtd, Total: v.total, EmAtraso: v.atraso,
      }));
      sumRows.push({
        Casa: "TOTAL", Qtd: rows.length,
        Total: rows.reduce((s, r) => s + r.Pendente, 0),
        EmAtraso: rows.filter((r) => r.Situacao === "EM ATRASO").reduce((s, r) => s + r.Pendente, 0),
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sumRows), "Somatória por Casa");
    }
    const name = `negociacao_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, name);
    toast.success("Excel exportado");
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const title = tab === "os" ? "OS Aguardando Negociação" : "Financeiro Pendente";
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    doc.setFontSize(9);
    doc.text(`Cliente: ${profile?.nome || profile?.email || ""}`, 14, 20);
    doc.text(`Emissão: ${new Date().toLocaleString("pt-BR")}`, 14, 25);

    if (tab === "os") {
      const rows = rowsOsExport();
      if (!rows.length) return toast.error("Nada para exportar");
      autoTable(doc, {
        startY: 30,
        head: [["Código", "Casa", "Situação", "Abertura", "Vendedor", "Valor"]],
        body: rows.map((r) => [r.Codigo, r.Casa, r.Situacao, r.Abertura, r.Vendedor, brl(r.Valor)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });
      const total = rows.reduce((s, r) => s + r.Valor, 0);
      autoTable(doc, {
        head: [["Casa", "Qtd", "Total"]],
        body: [
          ...sumOsByCasa.map(([c, v]) => [c, String(v.qtd), brl(v.total)]),
          ["TOTAL", String(rows.length), brl(total)],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [16, 185, 129] },
      });
    } else {
      const rows = rowsRecExport();
      if (!rows.length) return toast.error("Nada para exportar");
      autoTable(doc, {
        startY: 30,
        head: [["Título", "Casa", "OS", "Venc.", "Situação", "Forma", "Pendente"]],
        body: rows.map((r) => [
          r.Titulo, r.Casa, r.OS, r.Vencimento, r.Situacao, r.Forma, brl(r.Pendente),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });
      const total = rows.reduce((s, r) => s + r.Pendente, 0);
      const atraso = rows.filter((r) => r.Situacao === "EM ATRASO").reduce((s, r) => s + r.Pendente, 0);
      autoTable(doc, {
        head: [["Casa", "Qtd", "Total", "Em Atraso"]],
        body: [
          ...sumRecByCasa.map(([c, v]) => [c, String(v.qtd), brl(v.total), brl(v.atraso)]),
          ["TOTAL", String(rows.length), brl(total), brl(atraso)],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [16, 185, 129] },
      });
    }
    doc.save(`negociacao_${tab}_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF exportado");
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <HandshakeIcon className="h-5 w-5 text-primary" />
              Negociação Financeira
            </h1>
            <p className="text-sm text-muted-foreground">
              Olá, {profile?.nome || profile?.email}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/horas")}>
              <Clock className="h-4 w-4 mr-1" /> Horas
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/orcamentos")}>
              <FileText className="h-4 w-4 mr-1" /> Orçamentos
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/planos-preventivos")}>
              <CalendarCheck className="h-4 w-4 mr-1" /> Preventivas
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ListChecks className="h-4 w-4" /> OS ag. negociação
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_os ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_os ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-sky-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-4 w-4" /> Títulos pendentes
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_recebimentos ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_recebimentos ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-red-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> Em atraso
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_atrasado ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_atrasado ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-4 w-4" /> Total geral pendente
            </div>
            <p className="text-2xl font-semibold mt-1">
              {brl((totals?.valor_os ?? 0) + (totals?.valor_recebimentos ?? 0))}
            </p>
            <p className="text-xs text-muted-foreground">OS + títulos</p>
          </Card>
        </div>

        <Card className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Buscar por código, casa, descrição ou OS…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[220px]"
            />
            <Select value={casaFilter} onValueChange={setCasaFilter}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Filtrar casa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as casas</SelectItem>
                {casasOpts.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tab === "os" && (
              <Select value={mesSaidaFilter} onValueChange={setMesSaidaFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Mês data de saída" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os meses</SelectItem>
                  {mesesSaida.map((k) => (
                    <SelectItem key={k} value={k}>{monthLabel(k)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>

          {/* Somatória por casa */}
          {tab === "os" && sumOsByCasa.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <div className="font-semibold mb-1 text-muted-foreground">Somatória por casa</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1">
                {sumOsByCasa.map(([c, v]) => (
                  <div key={c} className="flex justify-between gap-2 px-2 py-1 rounded hover:bg-background">
                    <span className="truncate">{c} <span className="text-muted-foreground">({v.qtd})</span></span>
                    <span className="font-medium whitespace-nowrap">{brl(v.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "financeiro" && sumRecByCasa.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <div className="font-semibold mb-1 text-muted-foreground">Somatória por casa</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1">
                {sumRecByCasa.map(([c, v]) => (
                  <div key={c} className="flex justify-between gap-2 px-2 py-1 rounded hover:bg-background">
                    <span className="truncate">
                      {c} <span className="text-muted-foreground">({v.qtd})</span>
                      {v.atraso > 0 && <span className="text-red-600"> · atraso {brl(v.atraso)}</span>}
                    </span>
                    <span className="font-medium whitespace-nowrap">{brl(v.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v as "os" | "financeiro")}>
            <TabsList>
              <TabsTrigger value="os">
                OS Ag. Negociação ({filteredOs.length})
              </TabsTrigger>
              <TabsTrigger value="financeiro">
                Financeiro Pendente ({filteredRec.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="os" className="mt-3">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredOs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhuma OS aguardando negociação encontrada.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={filteredOs.length > 0 && selectedOs.length === filteredOs.length}
                        onCheckedChange={(v) => toggleAllOs(!!v)}
                      />
                      Selecionar todos ({selectedOs.length}/{filteredOs.length})
                    </label>
                    {selectedOs.length > 0 && (
                      <span>
                        Selecionado: <strong>{brl(selectedOs.reduce((s, o) => s + Number(o.valor_total || 0), 0))}</strong>
                      </span>
                    )}
                  </div>
                  {filteredOs.map((o) => (
                    <div
                      key={o.gc_os_id}
                      className="border rounded-md p-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <Checkbox
                          checked={!!selOs[o.gc_os_id]}
                          onCheckedChange={(v) =>
                            setSelOs((s) => ({ ...s, [o.gc_os_id]: !!v }))
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">OS #{o.codigo}</span>
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              style={o.cor_situacao ? { borderColor: o.cor_situacao, color: o.cor_situacao } : {}}
                            >
                              {o.situacao}
                            </Badge>
                          </div>
                          <p className="text-sm mt-1 flex items-center gap-1 text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {o.cliente}
                          </p>
                          {o.descricao && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{o.descricao}</p>
                          )}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                            <span>Abertura: {fmtData(o.data)}</span>
                            {o.vendedor && <span>Vendedor: {o.vendedor}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-primary whitespace-nowrap">
                            {brl(o.valor_total)}
                          </p>
                          <a
                            href={o.link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            Ver no GC <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="financeiro" className="mt-3">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredRec.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhum título pendente encontrado.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={filteredRec.length > 0 && selectedRec.length === filteredRec.length}
                        onCheckedChange={(v) => toggleAllRec(!!v)}
                      />
                      Selecionar todos ({selectedRec.length}/{filteredRec.length})
                    </label>
                    {selectedRec.length > 0 && (
                      <span>
                        Selecionado: <strong>{brl(selectedRec.reduce((s, r) => s + Number(r.valor_pendente || 0), 0))}</strong>
                      </span>
                    )}
                  </div>
                  {filteredRec.map((r) => (
                    <div
                      key={r.gc_recebimento_id}
                      className={`border rounded-md p-3 hover:bg-muted/40 transition-colors ${
                        r.atrasado ? "border-red-300 bg-red-50/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <Checkbox
                          checked={!!selRec[r.gc_recebimento_id]}
                          onCheckedChange={(v) =>
                            setSelRec((s) => ({ ...s, [r.gc_recebimento_id]: !!v }))
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              Título #{r.codigo || r.gc_recebimento_id}
                            </span>
                            {r.atrasado ? (
                              <Badge variant="destructive" className="text-[10px]">EM ATRASO</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">EM ABERTO</Badge>
                            )}
                            {r.parcela && (
                              <Badge variant="outline" className="text-[10px]">Parc. {r.parcela}</Badge>
                            )}
                            {r.os_codigo && (
                              <Badge variant="outline" className="text-[10px]">OS {r.os_codigo}</Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1 flex items-center gap-1 text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {r.cliente}
                          </p>
                          {r.descricao && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.descricao}</p>
                          )}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                            <span>Vencimento: {fmtData(r.data_vencimento)}</span>
                            {r.forma_pagamento && <span>{r.forma_pagamento}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-semibold whitespace-nowrap ${r.atrasado ? "text-red-600" : "text-primary"}`}>
                            {brl(r.valor_pendente)}
                          </p>
                          {r.valor_pago > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              Pago: {brl(r.valor_pago)} / {brl(r.valor)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </main>
    </div>
  );
}