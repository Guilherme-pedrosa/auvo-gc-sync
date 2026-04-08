import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ExternalLink, RefreshCw, Search, AlertTriangle,
  CheckCircle2, Clock, Flame, Loader2,
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

type EquipmentRow = {
  id: string;
  nome: string;
  identificador: string | null;
  cliente: string | null;
  status: string | null;
  ultima_data: string | null;
  ultimo_tecnico: string | null;
  ultimo_link: string | null;
  dias_desde: number | null;
};

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
      .select("equipamento_nome, equipamento_id_serie, data_tarefa, tecnico, auvo_link")
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

  // 3. Build a map of equipment name (lowercase) → latest task
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

  // 4. Match each registered equipment to its latest task
  const result: EquipmentRow[] = (equipamentos || []).map((eq) => {
    const nameKey = eq.nome.toLowerCase().trim();
    // Try exact match first, then partial match
    let match = taskMap.get(nameKey);
    if (!match) {
      for (const [taskName, taskData] of taskMap) {
        if (nameKey.includes(taskName) || taskName.includes(nameKey)) {
          match = taskData;
          break;
        }
      }
    }

    const dias = match?.data_tarefa
      ? differenceInDays(new Date(), parseISO(match.data_tarefa))
      : null;

    return {
      id: eq.id,
      nome: eq.nome,
      identificador: eq.identificador,
      cliente: eq.cliente,
      status: eq.status,
      ultima_data: match?.data_tarefa || null,
      ultimo_tecnico: match?.tecnico || null,
      ultimo_link: match?.auvo_link || null,
      dias_desde: dias,
    };
  });

  // Sort: nulls first, then by days descending
  return result.sort((a, b) => {
    if (a.dias_desde === null && b.dias_desde === null) return 0;
    if (a.dias_desde === null) return -1;
    if (b.dias_desde === null) return 1;
    return b.dias_desde - a.dias_desde;
  });
}

export default function EquipamentosPreventivosPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  const { data: equipments = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["equipamentos-preventivos"],
    queryFn: fetchEquipmentData,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    let result = equipments;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          (e.cliente || "").toLowerCase().includes(q) ||
          (e.identificador || "").toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "todos") {
      result = result.filter((e) => {
        const info = getStatusInfo(e.dias_desde);
        return info.label.toLowerCase() === statusFilter;
      });
    }

    return result;
  }, [equipments, search, statusFilter]);

  const stats = useMemo(() => {
    const emDia = equipments.filter((e) => e.dias_desde !== null && e.dias_desde <= 90).length;
    const atencao = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 90 && e.dias_desde <= 120).length;
    const vencido = equipments.filter((e) => e.dias_desde !== null && e.dias_desde > 120).length;
    const semRegistro = equipments.filter((e) => e.dias_desde === null).length;
    return { emDia, atencao, vencido, semRegistro, total: equipments.length };
  }, [equipments]);

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
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por equipamento, cliente ou série..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="em dia">✅ Em dia</SelectItem>
            <SelectItem value="atenção">⚠️ Atenção</SelectItem>
            <SelectItem value="vencido">🔴 Vencido</SelectItem>
            <SelectItem value="sem registro">⏳ Sem registro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Status</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Última Intervenção</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
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
                      <TableCell className="font-medium max-w-[300px] truncate" title={eq.nome}>
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
