import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AgendamentoEquipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
}

export default function AgendamentoEquipeDialog({ open, onOpenChange, initialDate }: AgendamentoEquipeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Adicionar Novo Agendamento</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                defaultValue={initialDate ? format(initialDate, "yyyy-MM-dd") : ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start">Hora Início</Label>
              <Input id="start" type="time" defaultValue="08:00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">Hora Fim</Label>
              <Input id="end" type="time" defaultValue="09:00" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tech">Técnico</Label>
            <Select>
              <SelectTrigger id="tech">
                <SelectValue placeholder="Selecione um técnico" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Filipe Carvalho</SelectItem>
                <SelectItem value="2">João Silva</SelectItem>
                <SelectItem value="3">Ricardo Oliveira</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vehicle">Veículo</Label>
            <Select>
              <SelectTrigger id="vehicle">
                <SelectValue placeholder="Selecione um veículo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hilux - ABC-1234</SelectItem>
                <SelectItem value="2">Saveiro - DEF-5678</SelectItem>
                <SelectItem value="3">Strada - GHI-9012</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client">Cliente / Serviço</Label>
            <Textarea 
              id="client" 
              placeholder="Descrição do serviço ou nome do cliente"
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit">Salvar Agendamento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
