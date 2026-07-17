import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useClinicas, useSaveClinica, useDeleteClinica, type MedClinica } from "@/hooks/medSeg/useMedSeg";

export default function ClinicasPage() {
  const { data: list = [], isLoading } = useClinicas();
  const save = useSaveClinica();
  const del = useDeleteClinica();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<MedClinica>>({ ativo: true });

  const submit = async () => {
    if (!form.nome) return;
    await save.mutateAsync(form);
    setOpen(false);
    setForm({ ativo: true });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Clínicas</h1>
          <p className="text-sm text-muted-foreground">Prestadores de serviço médico ocupacional.</p>
        </div>
        <Button onClick={() => { setForm({ ativo: true }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nova
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : list.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.nome}</TableCell>
                <TableCell>{c.contato ?? "—"}</TableCell>
                <TableCell className="max-w-md truncate">{c.endereco ?? "—"}</TableCell>
                <TableCell>{c.ativo ? <Badge>ativa</Badge> : <Badge variant="secondary">inativa</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setForm(c); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir "{c.nome}"?</AlertDialogTitle>
                        <AlertDialogDescription>Registros vinculados podem impedir a exclusão — nesse caso desative.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(c.id)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Nova"} clínica</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label>Contato</Label><Input value={form.contato ?? ""} onChange={(e) => setForm({ ...form, contato: e.target.value })} /></div>
            <div><Label>Endereço</Label><Input value={form.endereco ?? ""} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
            <div><Label>Observações</Label><Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ativo ?? true} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}