import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useTiposASO, useClinicas, useSaveAgendamento, useColaboradores,
  type MedAgendamento,
} from "@/hooks/medSeg/useMedSeg";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<MedAgendamento>;
  fixedColaboradorId?: string;
};

export default function AgendamentoDialog({ open, onOpenChange, initial, fixedColaboradorId }: Props) {
  const { data: tipos = [] } = useTiposASO();
  const { data: clinicas = [] } = useClinicas();
  const { data: colabs = [] } = useColaboradores();
  const save = useSaveAgendamento();
  const [form, setForm] = useState<Partial<MedAgendamento>>({ status: "agendado" });

  useEffect(() => {
    if (open) {
      setForm({
        status: "agendado",
        ...(fixedColaboradorId ? { colaborador_id: fixedColaboradorId } : {}),
        ...(initial ?? {}),
      });
    }
  }, [open, initial, fixedColaboradorId]);

  const submit = async () => {
    if (!form.colaborador_id || !form.tipo_id || !form.data) return;
    await save.mutateAsync(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} agendamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!fixedColaboradorId && (
            <div>
              <Label>Colaborador</Label>
              <Select value={form.colaborador_id ?? ""} onValueChange={(v) => setForm({ ...form, colaborador_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{colabs.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Tipo de exame</Label>
            <Select value={form.tipo_id ?? ""} onValueChange={(v) => setForm({ ...form, tipo_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data</Label>
              <Input type="date" value={form.data ?? ""} onChange={(e) => setForm({ ...form, data: e.target.value })} />
            </div>
            <div>
              <Label>Horário</Label>
              <Input type="time" value={form.hora ?? ""} onChange={(e) => setForm({ ...form, hora: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Clínica</Label>
            <Select value={form.clinica_id ?? ""} onValueChange={(v) => setForm({ ...form, clinica_id: v || null })}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>{clinicas.filter((c) => c.ativo).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status ?? "agendado"} onValueChange={(v) => setForm({ ...form, status: v as MedAgendamento["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="agendado">Agendado</SelectItem>
                <SelectItem value="confirmado">Confirmado</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}