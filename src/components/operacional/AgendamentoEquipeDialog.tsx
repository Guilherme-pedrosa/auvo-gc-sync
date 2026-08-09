import { useEffect, useState } from "react";
import { format } from "date-fns";
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
import { useColaboradores } from "@/hooks/rh/useRh";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAgendaVeiculos,
  useSaveAgendamento,
  useDeleteAgendamento,
  type AgendaAgendamento,
} from "@/hooks/operacional/useAgendamentoEquipe";
import { Trash2 } from "lucide-react";

interface AgendamentoEquipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
  initialColaboradorId?: string | null;
  agendamento?: AgendaAgendamento | null;
}

const isTecnico = (c: { cargo?: string | null; funcao?: string | null }) => {
  const txt = `${c.cargo ?? ""} ${c.funcao ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return txt.includes("tecnico");
};

export default function AgendamentoEquipeDialog({
  open,
  onOpenChange,
  initialDate,
  initialColaboradorId,
  agendamento,
}: AgendamentoEquipeDialogProps) {
  const { data: colaboradores = [], isLoading } = useColaboradores();
  const { data: veiculos = [] } = useAgendaVeiculos();
  const save = useSaveAgendamento();
  const del = useDeleteAgendamento();

  const [data, setData] = useState("");
  const [horaInicio, setHoraInicio] = useState("08:00");
  const [horaFim, setHoraFim] = useState("09:00");
  const [colaboradorId, setColaboradorId] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [cliente, setCliente] = useState("");
  const [descricao, setDescricao] = useState("");

  useEffect(() => {
    if (!open) return;
    if (agendamento) {
      setData(agendamento.data);
      setHoraInicio(agendamento.hora_inicio.slice(0, 5));
      setHoraFim(agendamento.hora_fim.slice(0, 5));
      setColaboradorId(agendamento.colaborador_id ?? "");
      setVeiculoId(agendamento.veiculo_id ?? "");
      setCliente(agendamento.cliente);
      setDescricao(agendamento.descricao ?? "");
    } else {
      setData(initialDate ? format(initialDate, "yyyy-MM-dd") : "");
      setHoraInicio("08:00");
      setHoraFim("09:00");
      setColaboradorId(initialColaboradorId || "");
      setVeiculoId("");
      setCliente("");
      setDescricao("");
    }
  }, [open, agendamento, initialDate]);

  const tecnicos = colaboradores.filter((c) => c.ativo && isTecnico(c));
  const lista = tecnicos.length > 0 ? tecnicos : colaboradores.filter((c) => c.ativo);

  const handleSave = async () => {
    const nome = lista.find((c) => c.id === colaboradorId)?.nome ?? "";
    if (!data || !colaboradorId || !cliente.trim()) return;
    await save.mutateAsync({
      id: agendamento?.id,
      data,
      hora_inicio: horaInicio,
      hora_fim: horaFim,
      colaborador_id: colaboradorId,
      colaborador_nome: nome,
      veiculo_id: veiculoId || null,
      cliente: cliente.trim(),
      descricao: descricao.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{agendamento ? "Editar Agendamento" : "Adicionar Novo Agendamento"}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start">Hora Início</Label>
              <Input id="start" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">Hora Fim</Label>
              <Input id="end" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tech">Técnico</Label>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={colaboradorId} onValueChange={setColaboradorId}>
                <SelectTrigger id="tech">
                  <SelectValue placeholder="Selecione um técnico" />
                </SelectTrigger>
                <SelectContent>
                  {lista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                  {lista.length === 0 && (
                    <SelectItem value="none" disabled>
                      Nenhum técnico ativo encontrado
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vehicle">Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId}>
              <SelectTrigger id="vehicle">
                <SelectValue placeholder="Selecione um veículo" />
              </SelectTrigger>
              <SelectContent>
                {veiculos.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nome}
                    {v.placa ? ` - ${v.placa}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client">Cliente</Label>
            <Input
              id="client"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome do cliente"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Descrição do serviço</Label>
            <Textarea 
              id="desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes do serviço"
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {agendamento ? (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={async () => {
                await del.mutateAsync(agendamento.id);
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending || !data || !colaboradorId || !cliente.trim()}>
              {save.isPending ? "Salvando..." : "Salvar Agendamento"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
