import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft, ExternalLink, RefreshCw, Search, AlertTriangle,
  CheckCircle2, Clock, Flame, Loader2, SlidersHorizontal,
  ArrowUpDown, Download, ListFilter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const EQUIPMENT_KEYWORDS = [
  "rational", "pratica", "prática", "klimaquip", "klimakiip",
  "genesis", "gênesis", "unox", "câmara fria", "camara fria",
  "câmara refrigerada", "camara refrigerada", "câmara resfriada", "camara resfriada",
  "área climatizada", "area climatizada", "adega",
  "ivario", "ivariopro", "forno combinado", "miniconv",
];

type TaskRaw = {
  equipamento_nome: string | null;
  equipamento_id_serie: string | null;
  cliente: string | null;
  data_tarefa: string | null;
  data_conclusao: string | null;
  status_auvo: string | null;
  tecnico: string | null;
  auvo_link: string | null;
  descricao: string | null;
  orientacao: string | null;
};

type EquipmentRaw = {
  id: string;
  nome: string;
  identificador: string | null;
  cliente: string | null;
  status: string | null;
  categoria: string | null;
  descricao: string | null;
};

type EquipmentRow = {
  id: string;
  nome: string;
  identificador: string | null;
  cliente: string | null;
  equipStatus: string | null;
  ultima_data: string | null;
  ultimo_tecnico: string | null;
  ultimo_link: string | null;
  dias_desde: number | null;
  tipo: string;
  tipo_tarefa: string | null;
};

type TaskCandidate = {
  data_referencia: string;
  tecnico: string | null;
  auvo_link: string | null;
  descricao: string | null;
  nameKey: string;
  serialKey: string;
  clientKey: string;
  searchKey: string;
};

const IGNORED_NAME_TOKENS = new Set([
  "equipamento",
  "serial",
  "serie",
  "patrimonio",
  "patrimonioo",
  "modelo",
  "ref",
  "refrigerado",
  "refrigerada",
  "frontal",
  "inox",
  "aco",
  "cozinha",
]);

function normalizeComparable(text: unknown): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getSearchTokens(text: string): string[] {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !IGNORED_NAME_TOKENS.has(token))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
}

function detectTipo(nome: string): string {
  const lower = nome.toLowerCase();
  if (lower.includes("rational")) return "Rational";
  if (lower.includes("pratica") || lower.includes("prática")) return "Prática";
  if (lower.includes("unox")) return "Unox";
  if (lower.includes("klimaquip") || lower.includes("klimakiip")) return "Klimaquip";
  if (lower.includes("genesis") || lower.includes("gênesis")) return "Genesis";
  if (lower.includes("ivario") || lower.includes("ivariopro")) return "Ivario";
  if (lower.includes("câmara") || lower.includes("camara")) return "Câmara Fria";
  if (lower.includes("climatizada") || lower.includes("adega")) return "Climatização";
  if (lower.includes("forno combinado") || lower.includes("miniconv")) return "Forno Combinado";
  return "Outro";
}

function getStatusInfo(dias: number | null) {
  if (dias === null) return { label: "Sem registro", color: "text-muted-foreground", bg: "bg-muted", icon: Clock };
  if (dias <= 90) return { label: "Em dia", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", icon: CheckCircle2 };
  if (dias <= 120) return { label: "Atenção", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", icon: AlertTriangle };
  return { label: "Vencido", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", icon: Flame };
}

function clientsMatch(taskClientKey: string, equipmentClientKey: string): boolean {
  // Both must be present and equal for a valid match
  // If equipment has a client, the task MUST be from the same client
  if (!equipmentClientKey) return true; // no client on equipment = can't filter
  if (!taskClientKey) return false; // equipment has client but task doesn't = reject
  return taskClientKey === equipmentClientKey;
}

async function fetchRawData(): Promise<{ equipamentos: EquipmentRaw[]; tasks: TaskRaw[] }> {
  let equipamentos: EquipmentRaw[] = [];
  let eqFrom = 0;
  const EQ_PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("equipamentos_auvo")
      .select("id, nome, identificador, cliente, status, categoria, descricao")
      .order("nome")
      .range(eqFrom, eqFrom + EQ_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    equipamentos.push(...data);
    if (data.length < EQ_PAGE) break;
    eqFrom += EQ_PAGE;
  }

  let allTasks: TaskRaw[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tarefas_central")
      .select("equipamento_nome, equipamento_id_serie, cliente, data_tarefa, data_conclusao, status_auvo, tecnico, auvo_link, descricao, orientacao")
      .order("data_tarefa", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allTasks.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return { equipamentos, tasks: allTasks };
}

function buildEquipmentRows(equipamentos: EquipmentRaw[], tasks: TaskRaw[], tipoTarefaFilter: string): EquipmentRow[] {
  const candidates: TaskCandidate[] = tasks
    .filter((task) => {
      const taskType = String(task.descricao || "").trim();
      if (tipoTarefaFilter !== "todos" && taskType !== tipoTarefaFilter) return false;

      const dataReferencia = task.data_conclusao || task.data_tarefa;
      const isCompleted = task.status_auvo === "Finalizada" || !!task.data_conclusao;
      const hasEquipmentSignal = Boolean(
        normalizeComparable(task.equipamento_id_serie) ||
        normalizeComparable(task.equipamento_nome) ||
        normalizeComparable(task.orientacao)
      );

      return Boolean(dataReferencia && isCompleted && hasEquipmentSignal);
    })
    .map((task) => ({
      data_referencia: (task.data_conclusao || task.data_tarefa) as string,
      tecnico: task.tecnico,
      auvo_link: task.auvo_link,
      descricao: task.descricao,
      nameKey: normalizeComparable(task.equipamento_nome),
      serialKey: normalizeComparable(task.equipamento_id_serie),
      clientKey: normalizeComparable(task.cliente),
      searchKey: normalizeComparable(`${task.equipamento_nome || ""} ${task.equipamento_id_serie || ""} ${task.orientacao || ""}`),
    }))
    .sort((a, b) => b.data_referencia.localeCompare(a.data_referencia));

  const taskBySerial = new Map<string, TaskCandidate>();
  for (const task of candidates) {
    if (task.serialKey && !taskBySerial.has(task.serialKey)) {
      taskBySerial.set(task.serialKey, task);
    }
  }

  const result: EquipmentRow[] = equipamentos.map((eq) => {
    const serialKey = normalizeComparable(eq.identificador);
    const nameKey = normalizeComparable(eq.nome);
    const clientKey = normalizeComparable(eq.cliente);

    let match = serialKey ? taskBySerial.get(serialKey) : undefined;

    if (!match && serialKey) {
      match = candidates.find((task) => clientsMatch(task.clientKey, clientKey) && task.searchKey.includes(serialKey));
    }

    if (!match && nameKey) {
      match = candidates.find((task) => clientsMatch(task.clientKey, clientKey) && task.nameKey === nameKey);
    }

    if (!match && nameKey) {
      match = candidates.find(
        (task) =>
          clientsMatch(task.clientKey, clientKey) &&
          task.nameKey &&
          (task.searchKey.includes(nameKey) || nameKey.includes(task.nameKey))
      );
    }

    if (!match) {
      const tokens = getSearchTokens(eq.nome);
      const hitsNeeded = tokens.length >= 2 ? 2 : tokens.length;
      if (hitsNeeded > 0) {
        match = candidates.find((task) => {
          if (!clientsMatch(task.clientKey, clientKey)) return false;
          let hits = 0;
          for (const token of tokens) {
            if (task.searchKey.includes(token)) hits += 1;
            if (hits >= hitsNeeded) return true;
          }
          return false;
        });
      }
    }

    const ultimaData = match?.data_referencia || null;
    const dias = ultimaData ? differenceInDays(new Date(), parseISO(ultimaData)) : null;

    return {
      id: eq.id,
      nome: eq.nome,
      identificador: eq.identificador,
      cliente: eq.cliente,
      equipStatus: eq.status,
      ultima_data: ultimaData,
      ultimo_tecnico: match?.tecnico || null,
      ultimo_link: match?.auvo_link || null,
      dias_desde: dias,
      tipo: detectTipo(eq.nome),
      tipo_tarefa: match?.descricao || null,
    };
  });

  return result.sort((a, b) => {
    if (a.dias_desde === null && b.dias_desde === null) return 0;
    if (a.dias_desde === null) return -1;
    if (b.dias_desde === null) return 1;
    return b.dias_desde - a.dias_desde;
  });
}

type SortField = "nome" | "cliente" | "dias" | "tipo";
type SortDir = "asc" | "desc";

export default function EquipamentosPreventivosPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [clienteFilter, setClienteFilter] = useState<string>("todos");
  const [tipoTarefaFilter, setTipoTarefaFilter] = useState<string>("todos");
  const [sortField, setSortField] = useState<SortField>("dias");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [syncing, setSyncing] = useState(false);

  const { data: rawData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["equipamentos-preventivos-raw"],
    queryFn: fetchRawData,
    staleTime: 5 * 60 * 1000,
  });

  // Extract unique task types from raw tasks
  const tiposTarefa = useMemo(() => {
    if (!rawData?.tasks) return [];
    const s = new Set<string>();
    for (const t of rawData.tasks) {
      if (t.descricao && t.descricao.trim()) s.add(t.descricao.trim());
    }
    return Array.from(s).sort();
  }, [rawData?.tasks]);

  // Recompute equipment rows when tipoTarefaFilter changes
  const equipments = useMemo(() => {
    if (!rawData) return [];
    return buildEquipmentRows(rawData.equipamentos, rawData.tasks, tipoTarefaFilter);
  }, [rawData, tipoTarefaFilter]);

  const tipos = useMemo(() => {
    const s = new Set(equipments.map((e) => e.tipo));
    return Array.from(s).sort();
  }, [equipments]);

  const clientes = useMemo(() => {
    const s = new Set(equipments.map((e) => e.cliente).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [equipments]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("equipment-sync");
      if (error) throw error;
      toast.success(`Sincronização concluída! ${data.total_auvo || 0} equipamentos no Auvo, ${data.inserted || 0} novos, ${data.updated || 0} atualizados`);
      refetch();
    } catch (err: any) {
      toast.error("Erro na sincronização: " + (err.message || "desconhecido"));
    } finally {
      setSyncing(false);
    }
  }, [refetch]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "dias" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let result = equipments;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          (e.cliente || "").toLowerCase().includes(q) ||
          (e.identificador || "").toLowerCase().includes(q) ||
          (e.ultimo_tecnico || "").toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "todos") {
      result = result.filter((e) => {
        const info = getStatusInfo(e.dias_desde);
        return info.label.toLowerCase() === statusFilter;
      });
    }

    if (tipoFilter !== "todos") {
      result = result.filter((e) => e.tipo === tipoFilter);
    }

    if (clienteFilter !== "todos") {
      result = result.filter((e) => e.cliente === clienteFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "nome":
          return dir * a.nome.localeCompare(b.nome);
        case "cliente":
          return dir * (a.cliente || "").localeCompare(b.cliente || "");
        case "tipo":
          return dir * a.tipo.localeCompare(b.tipo);
        case "dias":
        default:
          if (a.dias_desde === null && b.dias_desde === null) return 0;
          if (a.dias_desde === null) return -dir;
          if (b.dias_desde === null) return dir;
          return dir * (a.dias_desde - b.dias_desde);
      }
    });

    return result;
  }, [equipments, search, statusFilter, tipoFilter, clienteFilter, sortField, sortDir]);

  const stats = useMemo(() => {
    const emDia = equipments.filter((e) => e.dias_desde !== null && e.dias_desde <= 90).length;
    const atencao = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 90 && e.dias_desde <= 120).length;
    const vencido = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 120).length;
    const semRegistro = equipments.filter((e) => e.dias_desde === null).length;
    return { emDia, atencao, vencido, semRegistro, total: equipments.length };
  }, [equipments]);

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
      {children}
      <ArrowUpDown className={cn("h-3 w-3", sortField === field ? "text-primary" : "text-muted-foreground/50")} />
    </button>
  );

  const hasFilters = statusFilter !== "todos" || tipoFilter !== "todos" || clienteFilter !== "todos" || tipoTarefaFilter !== "todos" || search;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Preventiva de Equipamentos</h1>
          <p className="text-sm text-muted-foreground">
            Controle de manutenção preventiva — ideal a cada 3 meses
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <Download className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
          {syncing ? "Sincronizando..." : "Sync Auvo"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total" value={stats.total} className="bg-card" />
        <StatCard label="Em dia" value={stats.emDia} className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" onClick={() => setStatusFilter(statusFilter === "em dia" ? "todos" : "em dia")} active={statusFilter === "em dia"} />
        <StatCard label="Atenção" value={stats.atencao} className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400" onClick={() => setStatusFilter(statusFilter === "atenção" ? "todos" : "atenção")} active={statusFilter === "atenção"} />
        <StatCard label="Vencido" value={stats.vencido} className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" onClick={() => setStatusFilter(statusFilter === "vencido" ? "todos" : "vencido")} active={statusFilter === "vencido"} />
        <StatCard label="Sem registro" value={stats.semRegistro} className="bg-muted text-muted-foreground" onClick={() => setStatusFilter(statusFilter === "sem registro" ? "todos" : "sem registro")} active={statusFilter === "sem registro"} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar equipamento, cliente, série, técnico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="em dia">✅ Em dia</SelectItem>
            <SelectItem value="atenção">⚠️ Atenção</SelectItem>
            <SelectItem value="vencido">🔴 Vencido</SelectItem>
            <SelectItem value="sem registro">⏳ Sem registro</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {tipos.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipoTarefaFilter} onValueChange={setTipoTarefaFilter}>
          <SelectTrigger className={cn("w-[240px]", tipoTarefaFilter !== "todos" && "border-primary ring-1 ring-primary")}>
            <ListFilter className="h-4 w-4 mr-1 shrink-0" />
            <SelectValue placeholder="Tipo de tarefa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos de tarefa</SelectItem>
            {tiposTarefa.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clienteFilter} onValueChange={setClienteFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("todos"); setTipoFilter("todos"); setClienteFilter("todos"); setTipoTarefaFilter("todos"); }}>
            Limpar filtros
          </Button>
        )}
      </div>

      {tipoTarefaFilter !== "todos" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2 border">
          <ListFilter className="h-4 w-4 text-primary" />
          <span>
            Contadores e datas calculados apenas para tarefas do tipo: <strong className="text-foreground">{tipoTarefaFilter}</strong>
          </span>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Status</TableHead>
                <TableHead><SortButton field="tipo">Tipo</SortButton></TableHead>
                <TableHead><SortButton field="nome">Equipamento</SortButton></TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead><SortButton field="cliente">Cliente</SortButton></TableHead>
                <TableHead>Última Intervenção</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-right"><SortButton field="dias">Dias</SortButton></TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    Nenhum equipamento encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((eq) => {
                  const info = getStatusInfo(eq.dias_desde);
                  const Icon = info.icon;
                  return (
                    <TableRow key={eq.id} className={cn(info.bg)}>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger>
                            <Icon className={cn("h-5 w-5", info.color)} />
                          </TooltipTrigger>
                          <TooltipContent>{info.label}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs whitespace-nowrap">{eq.tipo}</Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[280px] truncate" title={eq.nome}>
                        {eq.nome}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {eq.identificador || "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={eq.cliente || ""}>
                        {eq.cliente || "—"}
                      </TableCell>
                      <TableCell>
                        {eq.ultima_data ? (
                          <span className={cn("text-sm", info.color)}>
                            {format(parseISO(eq.ultima_data), "dd/MM/yyyy", { locale: ptBR })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{eq.ultimo_tecnico || "—"}</TableCell>
                      <TableCell className="text-right">
                        {eq.dias_desde !== null ? (
                          <Badge variant="outline" className={cn("font-mono", info.color)}>
                            {eq.dias_desde}d
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {eq.ultimo_link && (
                          <a href={eq.ultimo_link} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-right">
        {filtered.length} equipamento{filtered.length !== 1 ? "s" : ""} exibido{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== equipments.length && ` de ${equipments.length} total`}
      </p>
    </div>
  );
}

function StatCard({ label, value, className, onClick, active }: {
  label: string; value: number; className?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        active && "ring-2 ring-primary",
        onClick && "cursor-pointer hover:shadow-md",
        className,
      )}
    >
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </button>
  );
}
