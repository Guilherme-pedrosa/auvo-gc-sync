import { useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Plus, 
  Search,
  Filter,
  RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import AgendamentoEquipeDialog from "@/components/operacional/AgendamentoEquipeDialog";
import {
  useAgendaVeiculos,
  useAgendamentos,
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { Skeleton } from "@/components/ui/skeleton";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 07:00 to 18:00

const COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F59E0B", // Amber
  "#EF4444", // Red
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

// Helper to get color based on client name
const getClientColor = (clientName: string) => {
  let hash = 0;
  for (let i = 0; i < clientName.length; i++) {
    hash = clientName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

export default function AgendamentoEquipePage() {
  const [date, setDate] = useState<Date>(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selected, setSelected] = useState<AgendaAgendamento | null>(null);
  const [search, setSearch] = useState("");

  const dateStr = format(date, "yyyy-MM-dd");
  const { data: VEHICLES = [], isLoading: loadingVeiculos } = useAgendaVeiculos();
  const { data: agendamentos = [], isLoading, refetch, isFetching } = useAgendamentos(dateStr);

  const nextDay = () => setDate(prev => addDays(prev, 1));
  const prevDay = () => setDate(prev => subDays(prev, 1));

  const filteredAgendamentos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agendamentos;
    return agendamentos.filter(
      (a) =>
        a.cliente.toLowerCase().includes(q) ||
        a.colaborador_nome.toLowerCase().includes(q) ||
        (a.descricao ?? "").toLowerCase().includes(q),
    );
  }, [agendamentos, search]);

  const openNew = () => {
    setSelected(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Fixed Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-foreground">Agendamento de Equipe e Frota</h1>
          <div className="flex items-center bg-muted rounded-md p-1 gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevDay}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "h-8 justify-start text-left font-normal px-2 text-sm",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {date ? format(date, "PPP", { locale: ptBR }) : <span>Selecione uma data</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextDay}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar agendamento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm"
            />
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Agendamento
          </Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </header>

      {/* Main Content - Scrollable Grid */}
      <div className="flex-1 overflow-auto p-6">
        {loadingVeiculos ? (
          <Skeleton className="h-96 w-full" />
        ) : (
        <div className="min-w-[1200px] border rounded-xl bg-card shadow-sm overflow-hidden">
          <div
            className="grid border-b bg-muted/30"
            style={{ gridTemplateColumns: `100px repeat(${VEHICLES.length}, 1fr)` }}
          >
            <div className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r flex items-center justify-center">
              Horário
            </div>
            {VEHICLES.map((v) => (
              <div key={v.id} className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0 text-center">
                {v.nome}
                {v.placa ? ` (${v.placa})` : ""}
              </div>
            ))}
          </div>

          <div className="relative">
            {/* Grid background lines */}
            <div className="divide-y">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="grid h-20"
                  style={{ gridTemplateColumns: `100px repeat(${VEHICLES.length}, 1fr)` }}
                >
                  <div className="p-3 text-xs font-medium border-r bg-muted/5 flex items-start justify-center pt-2 text-muted-foreground">
                    {String(hour).padStart(2, '0')}:00
                  </div>
                  {VEHICLES.map((v) => (
                    <div key={v.id} className="border-r last:border-r-0 relative hover:bg-muted/10 transition-colors" />
                  ))}
                </div>
              ))}
            </div>

            {/* Overlaid Agendamentos */}
            {filteredAgendamentos.map((a) => {
              const startHour = parseInt(a.hora_inicio.split(":")[0]);
              const startMin = parseInt(a.hora_inicio.split(":")[1]);
              const endHour = parseInt(a.hora_fim.split(":")[0]);
              const endMin = parseInt(a.hora_fim.split(":")[1]);
              
              const startOffset = (startHour - 7) * 80 + (startMin / 60) * 80;
              const duration = ((endHour - startHour) * 80) + ((endMin - startMin) / 60 * 80);
              
              const vehicleIndex = VEHICLES.findIndex(v => v.id === a.veiculo_id);
              if (vehicleIndex === -1) return null;

              const color = getClientColor(a.cliente);

              return (
                <div
                  key={a.id}
                  className="absolute z-10 rounded-md border-l-4 p-2 text-xs shadow-sm cursor-pointer hover:brightness-95 transition-all overflow-hidden"
                  style={{
                    top: `${startOffset}px`,
                    height: `${duration}px`,
                    left: `calc(100px + (${vehicleIndex} * (100% - 100px) / ${VEHICLES.length}) + 4px)`,
                    width: `calc(((100% - 100px) / ${VEHICLES.length}) - 8px)`,
                    backgroundColor: `${color}15`,
                    borderColor: color,
                    color: color,
                  }}
                  onClick={() => {
                    setSelected(a);
                    setIsDialogOpen(true);
                  }}
                >
                  <div className="font-bold truncate uppercase">{a.cliente}</div>
                  <div className="font-medium truncate opacity-90">{a.colaborador_nome}</div>
                  <div className="mt-1 opacity-80 text-[10px]">
                    {a.hora_inicio.slice(0, 5)} - {a.hora_fim.slice(0, 5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}
        {!isLoading && filteredAgendamentos.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">Nenhum agendamento para esta data.</p>
        )}
      </div>

      <AgendamentoEquipeDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        initialDate={date} 
        agendamento={selected}
      />
    </div>
  );
}
