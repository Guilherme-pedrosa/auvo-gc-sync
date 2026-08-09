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
  RefreshCw,
  Users
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useColaboradores } from "@/hooks/rh/useRh";
import { Skeleton } from "@/components/ui/skeleton";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 07:00 to 18:00

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico");
};

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
  const { data: colaboradores = [] } = useColaboradores();
  const { data: agendamentos = [], isLoading, refetch, isFetching } = useAgendamentos(dateStr);

  const activeTechnicians = useMemo(() => {
    return colaboradores.filter(c => c.ativo && isTecnico(c));
  }, [colaboradores]);

  const listToDisplay = activeTechnicians.length > 0 ? activeTechnicians : colaboradores.filter(c => c.ativo);

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
          <h1 className="text-xl font-bold text-foreground">Escala Diária de Técnicos</h1>
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

      {/* Main Content - Per Technician Cards */}
      <div className="flex-1 overflow-auto p-6">
        {loadingVeiculos ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {listToDisplay.map((t) => {
              const techAgendamentos = filteredAgendamentos.filter(a => a.colaborador_id === t.id);
              
              return (
                <Card 
                  key={t.id} 
                  className="flex flex-col h-[400px] shadow-sm hover:shadow-md transition-shadow border-t-4 border-t-primary"
                >
                  <CardHeader className="pb-3 bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-bold truncate">{t.nome}</CardTitle>
                        <p className="text-[10px] text-muted-foreground truncate uppercase tracking-wider font-medium">
                          {t.cargo || t.funcao || "Colaborador"}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                    {techAgendamentos.length > 0 ? (
                      techAgendamentos.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio)).map((a) => {
                        const vehicle = VEHICLES.find(v => v.id === a.veiculo_id);
                        const color = getClientColor(a.cliente);
                        
                        return (
                          <div
                            key={a.id}
                            className="group relative rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => {
                              setSelected(a);
                              setIsDialogOpen(true);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div 
                                  className="text-xs font-bold uppercase truncate"
                                  style={{ color }}
                                >
                                  {a.cliente}
                                </div>
                                <div className="text-[11px] font-medium mt-1 line-clamp-2 text-foreground/80">
                                  {a.descricao || "Sem descrição"}
                                </div>
                              </div>
                              <div className="shrink-0 text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded">
                                {a.hora_inicio.slice(0, 5)}
                              </div>
                            </div>
                            
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground border-t pt-2">
                              <div className="truncate flex-1">
                                {vehicle ? `${vehicle.nome} (${vehicle.placa || 'S/P'})` : 'Sem veículo'}
                              </div>
                              <div className="shrink-0">
                                {a.hora_fim.slice(0, 5)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-10">
                        <CalendarIcon className="h-8 w-8 mb-2" />
                        <p className="text-xs">Nenhum cliente agendado</p>
                      </div>
                    )}
                  </CardContent>
                  <div className="p-3 border-t bg-muted/5">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-[10px] h-8 gap-1.5"
                      onClick={() => {
                        setSelected(null);
                        // We could pass the technician ID here if the dialog supported it
                        setIsDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                      Agendar Cliente
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {!isLoading && listToDisplay.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground text-center">Nenhum técnico disponível para esta data.</p>
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
