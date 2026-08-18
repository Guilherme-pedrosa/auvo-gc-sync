import { useState } from "react";
import { Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface AgendaFiltersProps {
  filtroTexto: string;
  setFiltroTexto: (v: string) => void;
  tiposSelecionados: string[];
  setTiposSelecionados: (tipos: string[]) => void;
  mostrarPrevisoes: boolean;
  setMostrarPrevisoes: (v: boolean) => void;
  mostrarVisitasContratuais: boolean;
  setMostrarVisitasContratuais: (v: boolean) => void;
}

export function AgendaFilters({
  filtroTexto,
  setFiltroTexto,
  tiposSelecionados,
  setTiposSelecionados,
  mostrarPrevisoes,
  setMostrarPrevisoes,
  mostrarVisitasContratuais,
  setMostrarVisitasContratuais,
}: AgendaFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-muted/30 p-2 rounded-lg border border-border/50">
      <div className="relative w-full sm:w-64 md:w-80">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filtrar por cliente ou técnico..."
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          className="pl-9 pr-8 h-9 bg-background"
        />
        {filtroTexto && (
          <button
            onClick={() => setFiltroTexto("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Filter className="h-4 w-4" />
            Tipos
            {(mostrarPrevisoes || mostrarVisitasContratuais) && (
              <Badge variant="secondary" className="ml-1 px-1 h-4 min-w-[1.25rem] flex items-center justify-center">
                {[mostrarPrevisoes, mostrarVisitasContratuais].filter(Boolean).length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Filtrar por tipo</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={mostrarPrevisoes}
            onCheckedChange={setMostrarPrevisoes}
          >
            Previsões
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={mostrarVisitasContratuais}
            onCheckedChange={setMostrarVisitasContratuais}
          >
            Visitas Contratuais
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {(filtroTexto || !mostrarPrevisoes || !mostrarVisitasContratuais) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFiltroTexto("");
            setMostrarPrevisoes(true);
            setMostrarVisitasContratuais(true);
          }}
          className="h-9 text-muted-foreground text-xs"
        >
          Limpar todos
        </Button>
      )}
    </div>
  );
}
