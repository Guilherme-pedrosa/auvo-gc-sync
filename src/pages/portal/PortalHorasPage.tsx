import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, LogOut, CalendarIcon, Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const normalizeClient = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(ltda|me|sa|s\.a\.|s\/a|eireli|epp)\s*\.?$/i, "")
    .replace(/\s+/g, " ");

const fmtDur = (h: number | null | undefined) => {
  if (h == null || isNaN(Number(h))) return "—";
  const total = Math.max(0, Number(h));
  const hh = Math.floor(total);
  const mm = Math.round((total - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

export default function PortalHorasPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));

  // Group name + member list
  const { data: grupoInfo } = useQuery({
    queryKey: ["portal-grupo", profile?.grupo_id],
    enabled: !!profile?.grupo_id,
    queryFn: async () => {
      const [{ data: grupo }, { data: membros }] = await Promise.all([
        supabase.from("grupos_clientes").select("nome").eq("id", profile!.grupo_id!).maybeSingle(),
        supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", profile!.grupo_id!),
      ]);
      return {
        nome: grupo?.nome || "Grupo",
        clientes: (membros || []).map((m) => m.cliente_nome),
        clientesNorm: new Set((membros || []).map((m) => normalizeClient(m.cliente_nome))),
      };
    },
  });

  const { data: tasksRaw, isLoading } = useQuery({
    queryKey: ["portal-horas", format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("horas-trabalhadas-fetch", {
        body: { startDate: format(dateFrom, "yyyy-MM-dd"), endDate: format(dateTo, "yyyy-MM-dd") },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error || "Erro");
      return (data?.tasks || []) as any[];
    },
    staleTime: 60_000,
  });

  // Review statuses to exclude
  const { data: revisaoMap } = useQuery({
    queryKey: ["portal-revisao"],
    queryFn: async () => {
      const { data } = await supabase
        .from("os_revisao")
        .select("auvo_task_id, status_revisao");
      const map = new Map<string, string>();
      for (const r of data || []) map.set(String(r.auvo_task_id), String(r.status_revisao));
      return map;
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    if (!tasksRaw || !grupoInfo) return [];
    const set = grupoInfo.clientesNorm;
    return tasksRaw
      .filter((t) => {
        const cli = normalizeClient(t.cliente || t.gc_os_cliente || "");
        if (!set.has(cli)) return false;
        // Exclude internal review states
        const st = revisaoMap?.get(String(t.auvo_task_id));
        if (st === "em_revisao" || st === "rejeitada") return false;
        // Only show tasks that have something meaningful (executed or with duration)
        return true;
      })
      .sort((a, b) => (b.data_tarefa || "").localeCompare(a.data_tarefa || ""));
  }, [tasksRaw, grupoInfo, revisaoMap]);

  const totalHoras = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.duracao_decimal) || 0), 0),
    [rows],
  );

  const exportCSV = () => {
    const data = rows.map((r) => ({
      Data: r.data_tarefa ? format(new Date(r.data_tarefa + "T00:00:00"), "dd/MM/yyyy") : "",
      Cliente: r.cliente || r.gc_os_cliente || "",
      "OS": r.gc_os_codigo || "",
      Técnico: r.tecnico || "",
      Descrição: r.orientacao || r.descricao || "",
      "Hora Início": r.hora_inicio || "",
      "Hora Fim": r.hora_fim || "",
      "Duração (h)": Number(r.duracao_decimal || 0).toFixed(2),
      Status: r.status_auvo || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Horas");
    XLSX.writeFile(wb, `horas_${format(dateFrom, "yyyy-MM-dd")}_${format(dateTo, "yyyy-MM-dd")}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Horas Trabalhadas — ${grupoInfo?.nome || ""}`, 14, 14);
    doc.setFontSize(10);
    doc.text(
      `Período: ${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}    |    Total: ${fmtDur(totalHoras)}`,
      14,
      21,
    );
    autoTable(doc, {
      startY: 26,
      head: [["Data", "Cliente", "OS", "Técnico", "Descrição", "Início", "Fim", "Duração"]],
      body: rows.map((r) => [
        r.data_tarefa ? format(new Date(r.data_tarefa + "T00:00:00"), "dd/MM/yyyy") : "",
        r.cliente || r.gc_os_cliente || "",
        r.gc_os_codigo || "",
        r.tecnico || "",
        (r.orientacao || r.descricao || "").slice(0, 80),
        r.hora_inicio || "",
        r.hora_fim || "",
        fmtDur(Number(r.duracao_decimal || 0)),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    doc.save(`horas_${format(dateFrom, "yyyy-MM-dd")}_${format(dateTo, "yyyy-MM-dd")}.pdf`);
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!profile?.grupo_id) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto pt-20 text-center space-y-4">
          <h1 className="text-2xl font-semibold">Sem grupo liberado</h1>
          <p className="text-muted-foreground">Seu usuário ainda não foi vinculado a um grupo de clientes. Entre em contato com o responsável.</p>
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
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">W</span>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Portal do Cliente</p>
              <p className="text-xs text-muted-foreground leading-tight">{grupoInfo?.nome}</p>
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

      <main className="max-w-7xl mx-auto p-6 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg">Horas Trabalhadas</CardTitle>
              <p className="text-sm text-muted-foreground">
                Total no período: <span className="font-semibold text-foreground">{fmtDur(totalHoras)}</span>
                {" · "}<span className="font-semibold text-foreground">{rows.length}</span> atendimento(s)
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {format(dateFrom, "dd/MM/yy", { locale: ptBR })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">→</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {format(dateTo, "dd/MM/yy", { locale: ptBR })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="sm" onClick={exportCSV} disabled={!rows.length}>
                <Download className="h-4 w-4 mr-1" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={!rows.length}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>OS</TableHead>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Fim</TableHead>
                    <TableHead className="text-right">Duração</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                        Nenhum atendimento no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r, idx) => (
                      <TableRow key={`${r.auvo_task_id}-${idx}`}>
                        <TableCell className="whitespace-nowrap">
                          {r.data_tarefa ? format(new Date(r.data_tarefa + "T00:00:00"), "dd/MM/yyyy") : "—"}
                        </TableCell>
                        <TableCell className="font-medium">{r.cliente || r.gc_os_cliente || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.gc_os_codigo || "—"}</TableCell>
                        <TableCell>{r.tecnico || "—"}</TableCell>
                        <TableCell className="max-w-md">
                          <span className="line-clamp-2 text-sm">{r.orientacao || r.descricao || "—"}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{r.hora_inicio || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{r.hora_fim || "—"}</TableCell>
                        <TableCell className={cn("text-right font-mono", Number(r.duracao_decimal || 0) > 0 ? "" : "text-muted-foreground")}>
                          {fmtDur(Number(r.duracao_decimal || 0))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}