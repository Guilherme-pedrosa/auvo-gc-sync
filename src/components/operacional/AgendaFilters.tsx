import { Search, X, Users, Calendar, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface AgendaFiltersProps {
  filtroTexto: string;
  setFiltroTexto: (value: string) => void;
  mostrarPrevisoes: boolean;
  setMostrarPrevisoes: (value: boolean) => void;
  mostrarVisitasContratuais: boolean;
  setMostrarVisitasContratuais: (value: boolean) => void;
  clienteId: string;
  setClienteId: (value: string) => void;
}

export function AgendaFilters({
  filtroTexto,
  setFiltroTexto,
  mostrarPrevisoes,
  setMostrarPrevisoes,
  mostrarVisitasContratuais,
  setMostrarVisitasContratuais,
  clienteId,
  setClienteId,
}: AgendaFiltersProps) {
  const { data: clientes = [] } = useQuery({
    queryKey: ["agenda-filters-clientes"],
    queryFn: async () => {
      // Buscamos contratos mas focamos nos nomes dos clientes vinculados
      const { data, error } = await supabase
        .from("contratos")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data || []).map(c => ({ value: c.id, label: c.nome }));
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4 bg-muted/30 rounded-lg border border-border/50 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-1 max-w-4xl">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar técnico ou cliente..."
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            className="pl-9 pr-9"
          />
          {filtroTexto && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setFiltroTexto("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="w-full sm:w-80">
          <SearchableSelect
            options={clientes}
            value={clienteId === "todos" ? "" : clienteId}
            onValueChange={(val) => setClienteId(val || "todos")}
            placeholder="Filtrar por Cliente (Lista Completa)"
            searchPlaceholder="Buscar cliente..."
            icon={<Filter className="h-4 w-4 opacity-50" />}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-6 self-end lg:self-center">
        <div className="flex items-center space-x-2">
          <Switch
            id="previsoes"
            checked={mostrarPrevisoes}
            onCheckedChange={setMostrarPrevisoes}
          />
          <Label htmlFor="previsoes" className="flex items-center gap-1.5 cursor-pointer text-sm font-medium">
            <Badge variant="outline" className="h-2 w-2 rounded-full p-0 bg-amber-500 border-amber-500" />
            Previsões
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="visitas"
            checked={mostrarVisitasContratuais}
            onCheckedChange={setMostrarVisitasContratuais}
          />
          <Label htmlFor="visitas" className="flex items-center gap-1.5 cursor-pointer text-sm font-medium">
            <Badge variant="outline" className="h-2 w-2 rounded-full p-0 bg-blue-500 border-blue-500" />
            Visitas
          </Label>
        </div>
      </div>
    </div>
  );
}

