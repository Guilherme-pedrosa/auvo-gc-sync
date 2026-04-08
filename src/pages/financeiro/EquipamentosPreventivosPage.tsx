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
  ArrowUpDown, Download,
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
};

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

function matchesKeywords(name: string): boolean {
  const lower = name.toLowerCase();
  return EQUIPMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function getStatusInfo(dias: number | null) {
  if (dias === null) return { label: "Sem registro", color: "text-muted-foreground", bg: "bg-muted", icon: Clock };
  if (dias <= 90) return { label: "Em dia", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", icon: CheckCircle2 };
  if (dias <= 120) return { label: "Atenção", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", icon: AlertTriangle };
  return { label: "Vencido", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", icon: Flame };
}

async function fetchEquipmentData(): Promise<EquipmentRow[]> {
  // 1. Fetch all registered equipment
  const { data: equipamentos, error: eqErr } = await supabase
    .from("equipamentos_auvo")
    .select("id, nome, identificador, cliente, status")
    .order("nome");
  if (eqErr) throw eqErr;

  // 2. Fetch all tasks with equipment info (paginated)
  let allTasks: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("tarefas_central")
      .select("equipamento_nome, equipamento_id_serie, cliente, data_tarefa, tecnico, auvo_link")
      .not("equipamento_nome", "is", null)
      .neq("equipamento_nome", "")
      .order("data_tarefa", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allTasks.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // 3. Build task map keyed by equipment name (lowercase)
  const taskMap = new Map<string, { data_tarefa: string; tecnico: string | null; auvo_link: string | null }>();
  for (const t of allTasks) {
    const nameKey = (t.equipamento_nome || "").toLowerCase().trim();
    if (!taskMap.has(nameKey)) {
      taskMap.set(nameKey, {
        data_tarefa: t.data_tarefa,
        tecnico: t.tecnico,
        auvo_link: t.auvo_link,
      });
    }
  }

  // 4. Also collect unique equipment from tasks that are NOT in the registry
  const registrySet = new Set<string>();
  for (const eq of equipamentos || []) {
    registrySet.add(eq.nome.toLowerCase().trim());
  }

  const extraFromTasks: EquipmentRow[] = [];
  const seenExtra = new Set<string>();
  for (const t of allTasks) {
    if (!matchesKeywords(t.equipamento_nome)) continue;
    const nameKey = (t.equipamento_nome || "").toLowerCase().trim();
    if (registrySet.has(nameKey) || seenExtra.has(nameKey)) continue;
    seenExtra.add(nameKey);
    const match = taskMap.get(nameKey);
    const dias = match?.data_tarefa ? differenceInDays(new Date(), parseISO(match.data_tarefa)) : null;
    extraFromTasks.push({
      id: `task-${nameKey}`,
      nome: t.equipamento_nome,
      identificador: t.equipamento_id_serie,
      cliente: t.cliente,
      equipStatus: "Ativo",
      ultima_data: match?.data_tarefa || null,
      ultimo_tecnico: match?.tecnico || null,
      ultimo_link: match?.auvo_link || null,
      dias_desde: dias,
      tipo: detectTipo(t.equipamento_nome),
    });
  }

  // 5. Map registered equipment to tasks
  const result: EquipmentRow[] = (equipamentos || []).map((eq) => {
    const nameKey = eq.nome.toLowerCase().trim();
    let match = taskMap.get(nameKey);
    // Try partial match
    if (!match) {
      for (const [taskName, taskData] of taskMap) {
        if (nameKey.includes(taskName) || taskName.includes(nameKey)) {
          match = taskData;
          break;
        }
      }
    }
    const dias = match?.data_tarefa ? differenceInDays(new Date(), parseISO(match.data_tarefa)) : null;
    return {
      id: eq.id,
      nome: eq.nome,
      identificador: eq.identificador,
      cliente: eq.cliente, // Always from registry
      equipStatus: eq.status,
      ultima_data: match?.data_tarefa || null,
      ultimo_tecnico: match?.tecnico || null,
      ultimo_link: match?.auvo_link || null,
      dias_desde: dias,
      tipo: detectTipo(eq.nome),
    };
  });

  const combined = [...result, ...extraFromTasks];

  return combined.sort((a, b) => {
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
  const [sortField, setSortField] = useState<SortField>("dias");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [syncing, setSyncing] = useState(false);

  const { data: equipments = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["equipamentos-preventivos"],
    queryFn: fetchEquipmentData,
    staleTime: 5 * 60 * 1000,
  });

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
      toast.success(`Sincronização concluída! ${data.inserted || 0} novos, ${data.clients_updated || 0} clientes atualizados`);
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
        {(statusFilter !== "todos" || tipoFilter !== "todos" || clienteFilter !== "todos" || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("todos"); setTipoFilter("todos"); setClienteFilter("todos"); }}>
            Limpar filtros
          </Button>
        )}
      </div>

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
