import { useState } from "react";
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

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 07:00 to 18:00

export default function AgendamentoEquipePage() {
  const [date, setDate] = useState<Date>(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  const nextDay = () => setDate(prev => addDays(prev, 1));
  const prevDay = () => setDate(prev => subDays(prev, 1));

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
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Agendamento
          </Button>
        </div>
      </header>

      {/* Main Content - Scrollable Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-[1200px] border rounded-xl bg-card shadow-sm">
          <div className="grid grid-cols-[100px_repeat(5,1fr)] border-b bg-muted/30">
            <div className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r">Horário</div>
            {/* Mock Vehicle Columns */}
            {["ABC-1234 (Hilux)", "DEF-5678 (Saveiro)", "GHI-9012 (Strada)", "JKL-3456 (Van)", "MNO-7890 (Mobi)"].map((v) => (
              <div key={v} className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0 text-center">
                {v}
              </div>
            ))}
          </div>

          <div className="divide-y">
            {HOURS.map((hour) => (
              <div key={hour} className="grid grid-cols-[100px_repeat(5,1fr)] min-h-[80px]">
                <div className="p-3 text-sm font-medium border-r bg-muted/5 flex items-start justify-center pt-4">
                  {String(hour).padStart(2, '0')}:00
                </div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="border-r last:border-r-0 relative group hover:bg-muted/30 transition-colors">
                    {/* Placeholder for dropped items */}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <AgendamentoEquipeDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        initialDate={date} 
      />
    </div>
  );
}
