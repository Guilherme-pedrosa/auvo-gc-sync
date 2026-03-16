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
}: Props) {
  const [filterTecnico, setFilterTecnico] = useState("todos");
  const [filterCliente, setFilterCliente] = useState("todos");
  const [filterGrupo, setFilterGrupo] = useState("todos");
  const [grupoOpen, setGrupoOpen] = useState(false);
  const [selectedTipos, setSelectedTipos] = useState<Set<string>>(new Set());
  const [allTiposSelected, setAllTiposSelected] = useState(true);
  const [searchTipo, setSearchTipo] = useState("");

  // Normalize client name for matching (strip LTDA, ME, SA, EPP, EIRELI, etc.)
  const normalizeName = (name: string) =>
    name
      .toUpperCase()
      .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
      .replace(/[.\-\/]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  // Resolve group members
  const grupoClienteMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of grupos) {
      const ms = membros.filter((m: any) => m.grupo_id === g.id).map((m: any) => m.cliente_nome);
      map.set(g.id, ms);
    }
    return map;
  }, [grupos, membros]);

  // Filter data
  const filtered = useMemo(() => {
    const fromStr = format(dateFrom, "yyyy-MM-dd");
    const toStr = format(dateTo, "yyyy-MM-dd");

    return data.filter((t) => {
      if (!t.data_tarefa || !t.duracao_decimal) return false;
      if (t.data_tarefa < fromStr || t.data_tarefa > toStr) return false;

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
          return nGc === clienteAuvo || nGc === clienteGc || (clienteAuvo && nGc.includes(clienteAuvo)) || (clienteAuvo && clienteAuvo.includes(nGc));
        });
        if (!matched) return false;
      }

      if (!allTiposSelected && selectedTipos.size > 0) {
        if (!selectedTipos.has(t.descricao || "")) return false;
      }

      return true;
    });
  }, [data, dateFrom, dateTo, filterTecnico, filterCliente, filterGrupo, selectedTipos, allTiposSelected, grupoClienteMap]);

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

  // Summary by technician
  type TaskDetail = { auvo_task_id: string; descricao: string; hora_inicio: string; hora_fim: string; horas: number; data_tarefa: string };
  type ClienteData = { horas: number; tarefas: number; valor: number; tipos: Map<string, number>; tasks: TaskDetail[] };
  const tecnicoSummary = useMemo(() => {
    const map = new Map<string, { tecnico: string; horas: number; tarefas: number; valor: number; byCliente: Map<string, ClienteData> }>();
    for (const t of filtered) {
      const tec = t.tecnico || "Desconhecido";
      const cliente = t.cliente || t.gc_os_cliente || "Sem cliente";
      const clienteGc = t.gc_os_cliente || "";
      const horas = Number(t.duracao_decimal) || 0;
      const rate = getHourlyRate(tec, cliente, clienteGc);

      let entry = map.get(tec);
      if (!entry) {
        entry = { tecnico: tec, horas: 0, tarefas: 0, valor: 0, byCliente: new Map() };
        map.set(tec, entry);
      }
      entry.horas += horas;
      entry.tarefas++;
      entry.valor += horas * rate;

      let clienteEntry = entry.byCliente.get(cliente);
      if (!clienteEntry) {
        clienteEntry = { horas: 0, tarefas: 0, valor: 0, tipos: new Map(), tasks: [] };
        entry.byCliente.set(cliente, clienteEntry);
      }
      clienteEntry.horas += horas;
      clienteEntry.tarefas++;
      clienteEntry.valor += horas * rate;

      const tipo = t.descricao || "Sem tipo";
      clienteEntry.tipos.set(tipo, (clienteEntry.tipos.get(tipo) || 0) + horas);
      clienteEntry.tasks.push({
        auvo_task_id: t.auvo_task_id || "",
        descricao: t.descricao || "Sem tipo",
        hora_inicio: t.hora_inicio || "",
        hora_fim: t.hora_fim || "",
        horas,
        data_tarefa: t.data_tarefa || "",
      });
    }
    return Array.from(map.values()).sort((a, b) => b.horas - a.horas);
  }, [filtered, valorHoraConfigs, grupos, grupoClienteMap]);

  const totalHoras = useMemo(() => tecnicoSummary.reduce((s, t) => s + t.horas, 0), [tecnicoSummary]);
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

  const filteredTipos = useMemo(() => {
    if (!searchTipo) return allTiposTarefa;
    return allTiposTarefa.filter((t) => t.toLowerCase().includes(searchTipo.toLowerCase()));
  }, [allTiposTarefa, searchTipo]);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Relatório de Horas Trabalhadas", 14, 20);
    doc.setFontSize(10);
    doc.text(`Período: ${format(dateFrom, "dd/MM/yyyy")} a ${format(dateTo, "dd/MM/yyyy")}`, 14, 28);

    const tableData: any[] = [];
    for (const tec of tecnicoSummary) {
      for (const [cliente, cd] of tec.byCliente) {
        tableData.push([
          tec.tecnico,
          cliente,
          cd.tarefas,
          cd.horas.toFixed(2) + "h",
          cd.valor > 0 ? "R$ " + cd.valor.toFixed(2) : "—",
        ]);
      }
    }

    autoTable(doc, {
      startY: 34,
      head: [["Técnico", "Cliente", "Tarefas", "Horas", "Valor"]],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save(`horas-trabalhadas-${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}.pdf`);
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
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && onDateFromChange(d)} locale={ptBR} />
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
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={(d) => d && onDateToChange(d)} locale={ptBR} />
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
                        <div key={tipo} className="flex items-center gap-2">
                          <Checkbox
                            checked={allTiposSelected || selectedTipos.has(tipo)}
                            onCheckedChange={() => {
                              setAllTiposSelected(false);
                              setSelectedTipos((prev) => {
                                const next = new Set(prev);
                                if (next.has(tipo)) next.delete(tipo);
                                else next.add(tipo);
                                return next;
                              });
                            }}
                          />
                          <span className="text-xs truncate">{tipo}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}>
              <Download className="h-3.5 w-3.5" />
              Exportar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Horas Totais</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{totalHoras.toFixed(1)}h</p>
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

      {/* Detailed table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-center">Tarefas</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tecnicoSummary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
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
                      <TableCell className="text-right font-semibold">
                        {tec.valor > 0 ? tec.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </TableCell>
                    </TableRow>
                    {expanded === tec.tecnico && (
                      <TableRow key={`${tec.tecnico}-detail`}>
                        <TableCell colSpan={4} className="p-0">
                          <div className="bg-muted/30 px-6 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Cliente</TableHead>
                                  <TableHead className="text-xs">Tarefas (ID · Horário)</TableHead>
                                  <TableHead className="text-xs text-center">Qtd</TableHead>
                                  <TableHead className="text-xs text-right">Horas</TableHead>
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
                                              <Badge key={idx} variant="outline" className="text-[9px] font-mono gap-1">
                                                #{task.auvo_task_id}
                                                {task.hora_inicio && task.hora_fim
                                                  ? ` ${task.hora_inicio}–${task.hora_fim}`
                                                  : task.hora_inicio
                                                  ? ` ${task.hora_inicio}`
                                                  : ""}
                                                {" · "}{task.horas.toFixed(1)}h
                                              </Badge>
                                            ))}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center">{cd.tarefas}</TableCell>
                                      <TableCell className="text-right font-medium">{cd.horas.toFixed(2)}h</TableCell>
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
    </div>
  );
}
