import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { CalendarIcon, Search, Filter, Download, ChevronsUpDown, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExternalLink, FileSpreadsheet, FileText } from "lucide-react";

interface Props {
  data: any[];
  isLoading: boolean;
  allClientes: string[];
  allTecnicos: string[];
  allTiposTarefa: string[];
  grupos: any[];
  membros: any[];
  valorHoraConfigs: any[];
  dateFrom: Date;
  dateTo: Date;
  onDateFromChange: (d: Date) => void;
  onDateToChange: (d: Date) => void;
  equipamentoTaskMap?: Record<string, { nome: string; id_serie: string }>;
}

const CHART_COLORS = [
  "hsl(220, 70%, 50%)", "hsl(152, 60%, 40%)", "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)", "hsl(262, 60%, 55%)", "hsl(190, 70%, 45%)",
  "hsl(330, 65%, 50%)", "hsl(45, 85%, 50%)",
];

export default function HorasTrabalhadasTab({
  data, isLoading, allClientes, allTecnicos, allTiposTarefa,
  grupos, membros, valorHoraConfigs,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  equipamentoTaskMap = {},
}: Props) {
  const [filterTecnico, setFilterTecnico] = useState("todos");
  const [filterCliente, setFilterCliente] = useState("todos");
  const [filterGrupo, setFilterGrupo] = useState("todos");
  const [grupoOpen, setGrupoOpen] = useState(false);
  const [selectedTipos, setSelectedTipos] = useState<Set<string>>(new Set());
  const [allTiposSelected, setAllTiposSelected] = useState(true);
  const [searchTipo, setSearchTipo] = useState("");
  const [clienteModal, setClienteModal] = useState<string | null>(null);

  // Get task hours: use Auvo's durationDecimal (already deducts pauses)
  const getTaskHoras = (t: any): number => {
    return Number(t.duracao_decimal) || 0;
  };

  const isExcessiveTask = (horas: number) => horas > 12;

  // Normalize client name for matching (strip LTDA, ME, SA, EPP, EIRELI, etc.)
  const normalizeName = (name: string) =>
    name
      .toUpperCase()
      .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
      .replace(/[.\-\/]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const getTipoLabel = (tipo: string | null | undefined) => {
    const normalized = (tipo || "").replace(/\s+/g, " ").trim();
    return normalized || "Sem tipo";
  };

  const getTipoKey = (tipo: string | null | undefined) => {
    return getTipoLabel(tipo)
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  };

  // Resolve group members
  const grupoClienteMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of grupos) {
      const ms = membros.filter((m: any) => m.grupo_id === g.id).map((m: any) => m.cliente_nome);
      map.set(g.id, ms);
    }
    return map;
  }, [grupos, membros]);

  // Filter data - use data_conclusao (checkout date) for monthly accounting, fallback to data_tarefa
  const filtered = useMemo(() => {
    const fromStr = format(dateFrom, "yyyy-MM-dd");
    const toStr = format(dateTo, "yyyy-MM-dd");

    return data.filter((t) => {
      if (!t.hora_inicio && !t.hora_fim && t.duracao_decimal == null) return false;

      // Use completion date (data_conclusao) when available, otherwise data_tarefa
      const dateRef = t.data_conclusao || t.data_tarefa;
      if (!dateRef) return false;
      if (dateRef < fromStr || dateRef > toStr) return false;

      // Must have check_out (completed work)
      if (!t.check_out) return false;

      if (filterTecnico !== "todos" && t.tecnico !== filterTecnico) return false;

      const cliente = t.cliente || t.gc_os_cliente || "";
      if (filterCliente !== "todos" && cliente !== filterCliente) return false;

      if (filterGrupo !== "todos") {
        const grupoClientes = grupoClienteMap.get(filterGrupo) || [];
        const clienteAuvo = normalizeName(t.cliente || "");
        const clienteGc = normalizeName(t.gc_os_cliente || "");
        const matched = grupoClientes.some((gc: string) => {
          const nGc = normalizeName(gc);
          return nGc === clienteAuvo || nGc === clienteGc;
        });
        if (!matched) return false;
      }

      if (!allTiposSelected && selectedTipos.size > 0) {
        const tipoTarefaKey = getTipoKey(t.descricao);
        if (!selectedTipos.has(tipoTarefaKey)) return false;
      }

      return true;
    });
  }, [data, dateFrom, dateTo, filterTecnico, filterCliente, filterGrupo, selectedTipos, allTiposSelected, grupoClienteMap]);

  // When filtering by group, resolve which side (Auvo or GC) matched the group
  // so the display name comes from the group member, not the unrelated other side.
  const resolveDisplayCliente = (t: any): string => {
    if (filterGrupo !== "todos") {
      const grupoClientes = grupoClienteMap.get(filterGrupo) || [];
      const clienteAuvo = t.cliente || "";
      const clienteGc = t.gc_os_cliente || "";
      const nAuvo = normalizeName(clienteAuvo);
      const nGc = normalizeName(clienteGc);
      // Prefer the side that strictly matches a group member
      const auvoIsMember = grupoClientes.some((gc: string) => normalizeName(gc) === nAuvo);
      const gcIsMember = grupoClientes.some((gc: string) => normalizeName(gc) === nGc);
      if (auvoIsMember) return clienteAuvo;
      if (gcIsMember) return clienteGc;
    }
    return t.cliente || t.gc_os_cliente || "Sem cliente";
  };

  // Build hourly rate lookup - checks both auvo and gc client names against group members
  const getHourlyRate = (tecnico: string, clienteAuvo: string, clienteGc?: string): number => {
    // First check direct client config (try both names)
    for (const nome of [clienteAuvo, clienteGc].filter(Boolean)) {
      const directConfig = valorHoraConfigs.find(
        (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "cliente" && c.referencia_nome === nome
      );
      if (directConfig) return Number(directConfig.valor_hora) || 0;
    }

    // Check group config - match if either client name is in the group (normalized)
    for (const g of grupos) {
      const gClientes = grupoClienteMap.get(g.id) || [];
      const nAuvo = normalizeName(clienteAuvo);
      const nGc = normalizeName(clienteGc || "");
      const isInGroup = gClientes.some((gc: string) => {
        const n = normalizeName(gc);
        return n === nAuvo || n === nGc || (nAuvo && n.includes(nAuvo)) || (nAuvo && nAuvo.includes(n));
      });
      if (isInGroup) {
        const groupConfig = valorHoraConfigs.find(
          (c: any) => c.tecnico_nome === tecnico && c.tipo_referencia === "grupo" && c.grupo_id === g.id
        );
        if (groupConfig) return Number(groupConfig.valor_hora) || 0;
      }
    }
    return 0;
  };

  // Calculate task value: only hourly rate (no GC values)
  const getTaskValor = (t: any, tecnico: string): number => {
    const horas = getTaskHoras(t);
    const cliente = t.cliente || t.gc_os_cliente || "";
    const clienteGc = t.gc_os_cliente || "";
    const rate = getHourlyRate(tecnico, cliente, clienteGc);
    return horas * rate;
  };

  // Summary by technician
  type TaskDetail = {
    auvo_task_id: string;
    descricao: string;
    orientacao: string;
    pendencia: string;
    hora_inicio: string;
    hora_fim: string;
    horas: number;
    deslocamento: number;
    data_tarefa: string;
    data_conclusao: string;
    valor: number;
    tecnico: string;
    equipamento: string;
    equipamento_id_serie: string;
    auvo_link: string;        // app2.auvo.com.br/relatorioTarefas/DetalheTarefa/{id} — RELATÓRIO da tarefa
    auvo_task_url: string;    // app.auvo.com.br/informacoes/tarefa/{uuid} — tela da tarefa no app
    auvo_survey_url: string;  // pesquisa de satisfação (uso secundário)
    status_auvo: string;
    cliente_gc: string;
    gc_os_codigo: string;
    gc_os_link: string;
  };
  type ClienteData = { horas: number; deslocamento: number; tarefas: number; valor: number; tipos: Map<string, number>; tasks: TaskDetail[] };
  const tecnicoSummary = useMemo(() => {
    const map = new Map<string, { tecnico: string; horas: number; deslocamento: number; tarefas: number; valor: number; byCliente: Map<string, ClienteData> }>();
    for (const t of filtered) {
      const tec = t.tecnico || "Desconhecido";
      const cliente = resolveDisplayCliente(t);
      const horas = getTaskHoras(t);
      const deslocamento = Number(t.duracao_deslocamento) || 0;
      const valor = getTaskValor(t, tec);

      let entry = map.get(tec);
      if (!entry) {
        entry = { tecnico: tec, horas: 0, deslocamento: 0, tarefas: 0, valor: 0, byCliente: new Map() };
        map.set(tec, entry);
      }
      entry.horas += horas;
      entry.deslocamento += deslocamento;
      entry.tarefas++;
      entry.valor += valor;

      let clienteEntry = entry.byCliente.get(cliente);
      if (!clienteEntry) {
        clienteEntry = { horas: 0, deslocamento: 0, tarefas: 0, valor: 0, tipos: new Map(), tasks: [] };
        entry.byCliente.set(cliente, clienteEntry);
      }
      clienteEntry.horas += horas;
      clienteEntry.deslocamento += deslocamento;
      clienteEntry.tarefas++;
      clienteEntry.valor += valor;

      const tipo = getTipoLabel(t.descricao);
      clienteEntry.tipos.set(tipo, (clienteEntry.tipos.get(tipo) || 0) + horas);
      clienteEntry.tasks.push({
        auvo_task_id: t.auvo_task_id || "",
        descricao: getTipoLabel(t.descricao),
        orientacao: t.orientacao || "",
        pendencia: t.pendencia || "",
        hora_inicio: t.hora_inicio || "",
        hora_fim: t.hora_fim || "",
        horas,
        deslocamento,
        data_tarefa: t.data_tarefa || "",
        data_conclusao: t.data_conclusao || "",
        valor,
        tecnico: tec,
        equipamento: t.equipamento_nome || equipamentoTaskMap[t.auvo_task_id]?.nome || "",
        equipamento_id_serie:
          t.equipamento_id_serie || equipamentoTaskMap[t.auvo_task_id]?.id_serie || "",
        auvo_link: t.auvo_link || "",
        auvo_task_url: t.auvo_task_url || "",
        auvo_survey_url: t.auvo_survey_url || "",
        status_auvo: t.status_auvo || "",
        cliente_gc: t.gc_os_cliente || "",
        gc_os_codigo: t.gc_os_codigo || "",
        gc_os_link: t.gc_os_link || "",
      });
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [filtered, valorHoraConfigs, grupos, grupoClienteMap, filterGrupo, equipamentoTaskMap]);

  // Summary by client (across all technicians)
  const clienteSummary = useMemo(() => {
    const map = new Map<string, { cliente: string; horas: number; deslocamento: number; tarefas: number; valor: number; tecnicos: Set<string>; tasks: TaskDetail[] }>();
    for (const tec of tecnicoSummary) {
      for (const [cliente, cd] of tec.byCliente) {
        let entry = map.get(cliente);
        if (!entry) {
          entry = { cliente, horas: 0, deslocamento: 0, tarefas: 0, valor: 0, tecnicos: new Set(), tasks: [] };
          map.set(cliente, entry);
        }
        entry.horas += cd.horas;
        entry.deslocamento += cd.deslocamento;
        entry.tarefas += cd.tarefas;
        entry.valor += cd.valor;
        entry.tecnicos.add(tec.tecnico);
        entry.tasks.push(...cd.tasks);
      }
    }
    // sort each client's tasks by date asc
    for (const e of map.values()) {
      e.tasks.sort((a, b) =>
        Number(isExcessiveTask(b.horas)) - Number(isExcessiveTask(a.horas)) ||
        (a.data_conclusao || a.data_tarefa).localeCompare(b.data_conclusao || b.data_tarefa) ||
        (a.hora_inicio || "").localeCompare(b.hora_inicio || "")
      );
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [tecnicoSummary]);

  const clienteSelecionado = useMemo(
    () => (clienteModal ? clienteSummary.find((c) => c.cliente === clienteModal) : null),
    [clienteModal, clienteSummary]
  );

  const totalHoras = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.horas, 0), [tecnicoSummary]);
  const totalDeslocamento = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.deslocamento, 0), [tecnicoSummary]);
  const totalValor = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.valor, 0), [tecnicoSummary]);
  const totalTarefas = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.tarefas, 0), [tecnicoSummary]);

  // Chart data
  const chartData = useMemo(() =>
    tecnicoSummary.map((t) => ({
      name: t.tecnico.split(" ")[0],
      horas: Math.round(t.horas * 100) / 100,
    })),
  [tecnicoSummary]);

  const [expanded, setExpanded] = useState<string | null>(null);

  // Detect negative-duration tasks
  const negativeTasks = useMemo(() => {
    return filtered.filter((t) => getTaskHoras(t) < 0).map((t) => ({
      id: t.auvo_task_id,
      cliente: t.cliente || t.gc_os_cliente || "?",
      horas: getTaskHoras(t),
    }));
  }, [filtered]);

  const tipoOptions = useMemo(() => {
    const map = new Map<string, string>();

    for (const tipo of allTiposTarefa) {
      const label = getTipoLabel(tipo);
      const key = getTipoKey(label);
      if (!map.has(key)) map.set(key, label);
    }

    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [allTiposTarefa]);

  const filteredTipos = useMemo(() => {
    if (!searchTipo) return tipoOptions;
    const term = searchTipo.toLocaleLowerCase("pt-BR");
    return tipoOptions.filter((t) => t.label.toLocaleLowerCase("pt-BR").includes(term));
  }, [tipoOptions, searchTipo]);

  const fmtBRL = (v: number) => v > 0 ? "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const periodoStr = `${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}`;

    // ── Header ──
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Relatório de Horas Trabalhadas", 14, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${periodoStr}`, 14, 28);

    // ── Resumo Geral ──
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo Geral", 14, 40);

    autoTable(doc, {
      startY: 44,
      head: [["Horas Trabalhadas", "Horas Deslocamento", "Tarefas", "Técnicos", "Valor Total"]],
      body: [[
        `${totalHoras.toFixed(1)}h`,
        `${totalDeslocamento.toFixed(1)}h`,
        String(totalTarefas),
        String(tecnicoSummary.length),
        fmtBRL(totalValor),
      ]],
      styles: { fontSize: 9, halign: "center" },
      headStyles: { fillColor: [37, 99, 235], halign: "center" },
      theme: "grid",
    });

    let curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Resumo por Cliente ──
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo por Cliente", 14, curY);
    curY += 4;

    const clienteRows = clienteSummary.map((c) => [
      c.cliente,
      String(c.tarefas),
      `${c.horas.toFixed(1)}h`,
      `${c.deslocamento.toFixed(1)}h`,
      String(c.tecnicos.size),
      fmtBRL(c.valor),
    ]);
    clienteRows.push([
      "TOTAL",
      String(totalTarefas),
      `${totalHoras.toFixed(1)}h`,
      `${totalDeslocamento.toFixed(1)}h`,
      "",
      fmtBRL(totalValor),
    ]);

    autoTable(doc, {
      startY: curY,
      head: [["Cliente", "Tarefas", "Horas", "Desloc.", "Técnicos", "Valor"]],
      body: clienteRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 0: { cellWidth: 55 }, 5: { halign: "right" } },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === clienteRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [230, 237, 250];
        }
      },
    });

    curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Resumo por Técnico ──
    if (curY > 240) { doc.addPage(); curY = 20; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo por Técnico", 14, curY);
    curY += 4;

    const tecRows = tecnicoSummary.map((t) => [
      t.tecnico,
      String(t.tarefas),
      `${t.horas.toFixed(1)}h`,
      `${t.deslocamento.toFixed(1)}h`,
      fmtBRL(t.valor),
    ]);
    tecRows.push([
      "TOTAL",
      String(totalTarefas),
      `${totalHoras.toFixed(1)}h`,
      `${totalDeslocamento.toFixed(1)}h`,
      fmtBRL(totalValor),
    ]);

    autoTable(doc, {
      startY: curY,
      head: [["Técnico", "Tarefas", "Horas", "Desloc.", "Valor"]],
      body: tecRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 4: { halign: "right" } },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === tecRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [230, 237, 250];
        }
      },
    });

    curY = (doc as any).lastAutoTable.finalY + 12;

    // ── Detalhamento Técnico × Cliente ──
    if (curY > 240) { doc.addPage(); curY = 20; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhamento por Técnico e Cliente", 14, curY);
    curY += 4;

    const detailRows: any[] = [];
    for (const tec of tecnicoSummary) {
      for (const [cliente, cd] of Array.from(tec.byCliente.entries()).sort(([, a], [, b]) => b.valor - a.valor)) {
        detailRows.push([
          tec.tecnico,
          cliente,
          String(cd.tarefas),
          `${cd.horas.toFixed(2)}h`,
          `${cd.deslocamento.toFixed(2)}h`,
          fmtBRL(cd.valor),
        ]);
      }
    }

    autoTable(doc, {
      startY: curY,
      head: [["Técnico", "Cliente", "Tarefas", "Horas", "Desloc.", "Valor"]],
      body: detailRows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 50 }, 5: { halign: "right" } },
    });

    // ── Detalhe por OS (todas as ordens, agrupadas por cliente) ──
    doc.addPage("a4", "landscape");
    const pageWLand = doc.internal.pageSize.getWidth();
    curY = 18;
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhe Completo por Ordem de Serviço", 14, curY);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${periodoStr}`, 14, curY + 6);
    curY += 14;

    for (const c of clienteSummary) {
      // Header do cliente
      if (curY > 180) { doc.addPage("a4", "landscape"); curY = 18; }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(230, 237, 250);
      doc.rect(14, curY - 4, pageWLand - 28, 7, "F");
      doc.text(`${c.cliente}  ·  ${c.tarefas} OS  ·  ${c.horas.toFixed(1)}h  ·  ${fmtBRL(c.valor)}`, 16, curY + 1);
      curY += 6;

      const osRows = c.tasks.map((t) => [
        t.data_conclusao || t.data_tarefa,
        `#${t.auvo_task_id}`,
        t.tecnico,
        t.descricao,
        t.equipamento || "—",
        t.hora_inicio && t.hora_fim ? `${t.hora_inicio}–${t.hora_fim}` : (t.hora_inicio || "—"),
        `${t.horas.toFixed(2)}h`,
        t.deslocamento > 0 ? `${t.deslocamento.toFixed(2)}h` : "—",
        fmtBRL(t.valor),
      ]);

      autoTable(doc, {
        startY: curY,
        head: [["Data", "ID", "Técnico", "Tipo de Tarefa", "Equipamento", "Horário", "Horas", "Desloc.", "Valor"]],
        body: osRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 22 }, 1: { cellWidth: 18 }, 2: { cellWidth: 35 },
          3: { cellWidth: 55 }, 4: { cellWidth: 55 },
          5: { cellWidth: 24 }, 6: { cellWidth: 18, halign: "right" },
          7: { cellWidth: 18, halign: "right" }, 8: { halign: "right" },
        },
        margin: { left: 14, right: 14 },
      });

      curY = (doc as any).lastAutoTable.finalY + 8;
    }

    // ── Footer ──
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(130);
      const w = doc.internal.pageSize.getWidth();
      doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")} · Página ${i}/${pages}`, w / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });
      doc.setTextColor(0);
    }

    doc.save(`horas-trabalhadas-${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}.pdf`);
  };

  // ── Excel export: Resumo Cliente | Detalhe OS | Resumo Técnico ──
  const handleExportExcel = () => {
    const periodoStr = `${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}`;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Resumo por Cliente
    const resumoClienteRows: any[] = [
      ["Relatório de Horas Trabalhadas — Resumo por Cliente"],
      [`Período: ${periodoStr}`],
      [],
      ["Cliente", "Tarefas", "Horas", "Deslocamento (h)", "Técnicos", "Valor (R$)"],
      ...clienteSummary.map((c) => [
        c.cliente,
        c.tarefas,
        Number(c.horas.toFixed(2)),
        Number(c.deslocamento.toFixed(2)),
        c.tecnicos.size,
        Number(c.valor.toFixed(2)),
      ]),
      ["TOTAL", totalTarefas, Number(totalHoras.toFixed(2)), Number(totalDeslocamento.toFixed(2)), tecnicoSummary.length, Number(totalValor.toFixed(2))],
    ];
    const wsCli = XLSX.utils.aoa_to_sheet(resumoClienteRows);
    wsCli["!cols"] = [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsCli, "Resumo Cliente");

    // Sheet 2: Detalhe por OS (todas as ordens)
    const detalheHeader = [
      "Cliente", "Cliente GC", "Data Conclusão", "Data Tarefa", "ID Tarefa", "Cód. OS GC",
      "Técnico", "Tipo de Tarefa", "Equipamento", "ID/Série",
      "Status Auvo", "Início", "Fim", "Horas", "Deslocamento (h)", "Valor (R$)",
      "Orientação", "Pendência", "Relatório Auvo", "Tarefa Auvo", "Pesquisa Satisfação", "Link OS GC",
    ];
    const detalheRows: any[] = [
      ["Detalhe Completo por OS"],
      [`Período: ${periodoStr}`],
      [],
      detalheHeader,
    ];
    for (const c of clienteSummary) {
      for (const t of c.tasks) {
        detalheRows.push([
          c.cliente,
          t.cliente_gc,
          t.data_conclusao,
          t.data_tarefa,
          t.auvo_task_id,
          t.gc_os_codigo,
          t.tecnico,
          t.descricao,
          t.equipamento,
          t.equipamento_id_serie,
          t.status_auvo,
          t.hora_inicio,
          t.hora_fim,
          Number(t.horas.toFixed(2)),
          Number(t.deslocamento.toFixed(2)),
          Number(t.valor.toFixed(2)),
          t.orientacao,
          t.pendencia,
          t.auvo_link,
          t.auvo_task_url,
          t.auvo_survey_url,
          t.gc_os_link,
        ]);
      }
    }
    const wsDet = XLSX.utils.aoa_to_sheet(detalheRows);
    wsDet["!cols"] = [
      { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 22 }, { wch: 28 }, { wch: 30 }, { wch: 16 },
      { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
      { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDet, "Detalhe OS");

    // Sheet 3: Resumo por Técnico
    const tecRows: any[] = [
      ["Resumo por Técnico"],
      [`Período: ${periodoStr}`],
      [],
      ["Técnico", "Tarefas", "Horas", "Deslocamento (h)", "Valor (R$)"],
      ...tecnicoSummary.map((t) => [
        t.tecnico,
        t.tarefas,
        Number(t.horas.toFixed(2)),
        Number(t.deslocamento.toFixed(2)),
        Number(t.valor.toFixed(2)),
      ]),
      ["TOTAL", totalTarefas, Number(totalHoras.toFixed(2)), Number(totalDeslocamento.toFixed(2)), Number(totalValor.toFixed(2))],
    ];
    const wsTec = XLSX.utils.aoa_to_sheet(tecRows);
    wsTec["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsTec, "Resumo Técnico");

    XLSX.writeFile(wb, `horas-trabalhadas-${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}.xlsx`);
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Date range */}
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px] justify-start text-xs">
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {format(dateFrom, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50 bg-popover pointer-events-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(d) => d && onDateFromChange(d)}
                    locale={ptBR}
                    initialFocus
                    defaultMonth={dateFrom}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[130px] justify-start text-xs">
                    <CalendarIcon className="h-3 w-3 mr-1.5" />
                    {format(dateTo, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-50 bg-popover pointer-events-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(d) => d && onDateToChange(d)}
                    locale={ptBR}
                    initialFocus
                    defaultMonth={dateTo}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Technician filter */}
            <div className="space-y-1">
              <Label className="text-xs">Técnico</Label>
              <Select value={filterTecnico} onValueChange={setFilterTecnico}>
                <SelectTrigger className="w-[160px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {allTecnicos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Client filter */}
            <div className="space-y-1">
              <Label className="text-xs">Cliente</Label>
              <Select value={filterCliente} onValueChange={setFilterCliente}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {allClientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Group filter - searchable */}
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Popover open={grupoOpen} onOpenChange={setGrupoOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[200px] h-9 justify-between text-xs font-normal">
                    {filterGrupo === "todos"
                      ? "Todos"
                      : grupos.find((g: any) => g.id === filterGrupo)?.nome || "Todos"}
                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar grupo..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>Nenhum grupo.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="todos"
                          onSelect={() => { setFilterGrupo("todos"); setGrupoOpen(false); }}
                          className="text-xs"
                        >
                          <Check className={cn("mr-2 h-3 w-3", filterGrupo === "todos" ? "opacity-100" : "opacity-0")} />
                          Todos
                        </CommandItem>
                        {grupos.map((g: any) => (
                          <CommandItem
                            key={g.id}
                            value={g.nome}
                            onSelect={() => { setFilterGrupo(g.id); setGrupoOpen(false); }}
                            className="text-xs"
                          >
                            <Check className={cn("mr-2 h-3 w-3", filterGrupo === g.id ? "opacity-100" : "opacity-0")} />
                            {g.nome}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Task type filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Tipos de Tarefa
                  {!allTiposSelected && selectedTipos.size > 0 && (
                    <Badge variant="secondary" className="ml-1 text-[10px]">{selectedTipos.size}</Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <div className="space-y-2">
                  <Input
                    placeholder="Buscar tipo..."
                    value={searchTipo}
                    onChange={(e) => setSearchTipo(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <div className="flex items-center gap-2 pb-1">
                    <Checkbox
                      checked={allTiposSelected}
                      onCheckedChange={(checked) => {
                        setAllTiposSelected(!!checked);
                        if (checked) setSelectedTipos(new Set());
                      }}
                    />
                    <span className="text-xs font-medium">Todos</span>
                  </div>
                  <ScrollArea className="h-48">
                    <div className="space-y-1">
                      {filteredTipos.map((tipo) => (
                        <div key={tipo.key} className="flex items-center gap-2">
                          <Checkbox
                            checked={allTiposSelected || selectedTipos.has(tipo.key)}
                            onCheckedChange={() => {
                              if (allTiposSelected) {
                                // Sai do modo "Todos": seleciona todos exceto o clicado
                                const next = new Set(tipoOptions.map((t) => t.key));
                                next.delete(tipo.key);
                                setAllTiposSelected(false);
                                setSelectedTipos(next);
                              } else {
                                setSelectedTipos((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tipo.key)) next.delete(tipo.key);
                                  else next.add(tipo.key);
                                  return next;
                                });
                              }
                            }}
                          />
                          <span className="text-xs truncate">{tipo.label}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}>
              <FileText className="h-3.5 w-3.5" />
              Exportar PDF
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportExcel}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exportar Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Horas Trabalhadas</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{totalHoras.toFixed(1)}h</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Horas Deslocamento</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{totalDeslocamento.toFixed(1)}h</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tarefas Executadas</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{totalTarefas}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Técnicos</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{tecnicoSummary.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {totalValor > 0 ? totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Warning for negative durations */}
      {negativeTasks.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>⚠️ {negativeTasks.length} tarefa(s) com duração negativa</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="text-xs mb-2">
              Essas tarefas vieram do Auvo com horas negativas e estão distorcendo os totais. Corrija no Auvo:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {negativeTasks.map((t) => (
                <Badge key={t.id} variant="destructive" className="text-[10px] font-mono">
                  #{t.id} · {t.cliente} · {t.horas.toFixed(1)}h
                </Badge>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Horas por Técnico</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RechartsTooltip
                  formatter={(value: number) => [`${value}h`, "Horas"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="horas" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Summary by Client */}
      {clienteSummary.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Resumo por Cliente</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-center">Tarefas</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Desloc.</TableHead>
                  <TableHead className="text-center">Técnicos</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clienteSummary.map((c) => (
                  <TableRow
                    key={c.cliente}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setClienteModal(c.cliente)}
                  >
                    <TableCell className="font-medium text-sm text-primary hover:underline">
                      {c.cliente}
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{c.tarefas}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">{c.horas.toFixed(1)}h</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{c.deslocamento > 0 ? `${c.deslocamento.toFixed(1)}h` : "—"}</TableCell>
                    <TableCell className="text-center text-sm">{c.tecnicos.size}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {c.valor > 0 ? c.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-center"><Badge>{totalTarefas}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{totalHoras.toFixed(1)}h</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{totalDeslocamento.toFixed(1)}h</TableCell>
                  <TableCell className="text-center">{tecnicoSummary.length}</TableCell>
                  <TableCell className="text-right">
                    {totalValor > 0 ? totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-center">Tarefas</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Deslocamento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tecnicoSummary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhuma tarefa encontrada no período
                  </TableCell>
                </TableRow>
              ) : (
                tecnicoSummary.map((tec) => (
                  <>
                    <TableRow
                      key={tec.tecnico}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpanded(expanded === tec.tecnico ? null : tec.tecnico)}
                    >
                      <TableCell className="font-medium">{tec.tecnico}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{tec.tarefas}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{tec.horas.toFixed(2)}h</TableCell>
                      <TableCell className="text-right text-muted-foreground">{tec.deslocamento > 0 ? `${tec.deslocamento.toFixed(2)}h` : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {tec.valor > 0 ? tec.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </TableCell>
                    </TableRow>
                    {expanded === tec.tecnico && (
                      <TableRow key={`${tec.tecnico}-detail`}>
                          <TableCell colSpan={6} className="p-0">
                          <div className="bg-muted/30 px-6 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Cliente</TableHead>
                                  <TableHead className="text-xs">Tarefas (ID · Horário)</TableHead>
                                  <TableHead className="text-xs text-center">Qtd</TableHead>
                                  <TableHead className="text-xs text-right">Horas</TableHead>
                                  <TableHead className="text-xs text-right">Desloc.</TableHead>
                                  <TableHead className="text-xs text-right">Valor</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {Array.from(tec.byCliente.entries())
                                  .sort(([, a], [, b]) => b.horas - a.horas)
                                  .map(([cliente, cd]) => (
                                    <TableRow key={cliente} className="text-xs align-top">
                                      <TableCell className="font-medium">{cliente}</TableCell>
                                      <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                          {cd.tasks
                                            .sort((a, b) => a.data_tarefa.localeCompare(b.data_tarefa) || a.hora_inicio.localeCompare(b.hora_inicio))
                                            .map((task, idx) => (
                                              <Badge
                                                key={idx}
                                                variant={task.horas < 0 ? "destructive" : "outline"}
                                                className={cn(
                                                  "text-[9px] font-mono gap-1",
                                                  task.horas < 0 && "animate-pulse"
                                                )}
                                              >
                                                #{task.auvo_task_id}
                                                {task.hora_inicio && task.hora_fim
                                                  ? ` ${task.hora_inicio}–${task.hora_fim}`
                                                  : task.hora_inicio
                                                  ? ` ${task.hora_inicio}`
                                                  : ""}
                                                {" · "}{task.horas.toFixed(1)}h
                                                {task.horas < 0 && " ⚠️"}
                                              </Badge>
                                            ))}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center">{cd.tarefas}</TableCell>
                                      <TableCell className={cn("text-right font-medium", cd.horas < 0 && "text-destructive font-bold")}>{cd.horas.toFixed(2)}h</TableCell>
                                      <TableCell className="text-right text-muted-foreground text-xs">{cd.deslocamento > 0 ? `${cd.deslocamento.toFixed(2)}h` : "—"}</TableCell>
                                      <TableCell className="text-right font-medium">
                                        {cd.valor > 0 ? cd.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modal: Detalhe de OS por Cliente */}
      <Dialog open={!!clienteModal} onOpenChange={(open) => !open && setClienteModal(null)}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">{clienteSelecionado?.cliente}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-3 text-xs">
              <span><strong>{clienteSelecionado?.tarefas}</strong> OS</span>
              <span><strong>{clienteSelecionado?.horas.toFixed(1)}h</strong> trabalhadas</span>
              <span><strong>{clienteSelecionado?.deslocamento.toFixed(1)}h</strong> deslocamento</span>
              <span><strong>{clienteSelecionado?.tecnicos.size}</strong> técnico(s)</span>
              <span className="text-foreground">
                <strong>
                  {(clienteSelecionado?.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </strong>
              </span>
              <span className="text-muted-foreground">
                · {format(dateFrom, "dd/MM/yyyy")} a {format(dateTo, "dd/MM/yyyy")}
              </span>
            </DialogDescription>
            {(clienteSelecionado?.tasks.some((t) => isExcessiveTask(t.horas))) && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="destructive" className="text-[10px]">
                  Horas excessivas no topo
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  Tarefas com mais de 12h foram destacadas para facilitar a conferência.
                </span>
              </div>
            )}
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="overflow-x-auto">
            <Table className="min-w-[1100px]">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Técnico</TableHead>
                  <TableHead className="text-xs">Tipo de Tarefa</TableHead>
                  <TableHead className="text-xs">Equipamento</TableHead>
                  <TableHead className="text-xs">Horário</TableHead>
                  <TableHead className="text-xs text-right">Horas</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                  <TableHead className="text-xs text-center">Auvo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clienteSelecionado?.tasks.map((t, idx) => (
                  <TableRow key={`${t.auvo_task_id}-${idx}`} className={cn("text-xs", isExcessiveTask(t.horas) && "bg-destructive/5") }>
                    <TableCell className="font-mono whitespace-nowrap">
                      {(t.data_conclusao || t.data_tarefa)
                        ? format(new Date((t.data_conclusao || t.data_tarefa) + "T12:00:00"), "dd/MM/yy")
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono">#{t.auvo_task_id}</TableCell>
                    <TableCell>{t.tecnico}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="font-medium truncate" title={t.descricao}>{t.descricao}</div>
                      {t.orientacao && (
                        <div className="text-[10px] text-muted-foreground truncate" title={t.orientacao}>
                          {t.orientacao}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate" title={t.equipamento}>{t.equipamento || "—"}</div>
                      {t.equipamento_id_serie && (
                        <div className="text-[10px] text-muted-foreground font-mono">{t.equipamento_id_serie}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {t.hora_inicio && t.hora_fim ? `${t.hora_inicio}–${t.hora_fim}` : (t.hora_inicio || "—")}
                    </TableCell>
                    <TableCell className={cn("text-right font-medium", (t.horas < 0 || isExcessiveTask(t.horas)) && "text-destructive")}>
                      <div className="flex items-center justify-end gap-2">
                        {isExcessiveTask(t.horas) && (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                            +12h
                          </Badge>
                        )}
                        <span>{t.horas.toFixed(2)}h</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {t.valor > 0 ? t.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {t.auvo_link && (
                          <a
                            href={t.auvo_link}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir relatório da tarefa no Auvo"
                            className="text-primary hover:underline inline-flex items-center gap-1 text-[11px] font-medium"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Relatório
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
