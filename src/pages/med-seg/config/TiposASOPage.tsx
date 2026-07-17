import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTiposASO, useSaveTipoASO, useDeleteTipoASO, type MedTipoASO } from "@/hooks/medSeg/useMedSeg";

export default function TiposASOPage() {
  const { data: tipos = [], isLoading } = useTiposASO();
  const save = useSaveTipoASO();
  const del = useDeleteTipoASO();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<MedTipoASO>>({ ativo: true });

  const submit = async () => {
    if (!form.nome || !form.codigo) return;
    await save.mutateAsync(form);
    setOpen(false);
    setForm({ ativo: true });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Tipos de ASO / Periodicidade</h1>
          <p className="text-sm text-muted-foreground">
            Cada tipo pode ter uma periodicidade padrão (em meses) usada para calcular a próxima validade.
          </p>
        </div>
        <Button onClick={() => { setForm({ ativo: true }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Periodicidade</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : tipos.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.codigo}</TableCell>
                <TableCell>{t.nome}</TableCell>
                <TableCell>{t.periodicidade_meses ? `${t.periodicidade_meses} meses` : "sem validade"}</TableCell>
                <TableCell>{t.ativo ? <Badge>ativo</Badge> : <Badge variant="secondary">inativo</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setForm(t); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir "{t.nome}"?</AlertDialogTitle>
                        <AlertDialogDescription>Se houver ASOs vinculados a exclusão pode falhar — nesse caso, desative.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(t.id)}>Excluir</AlertDialogAction>
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
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} tipo de ASO</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Código</Label>
              <Input value={form.codigo ?? ""} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Periodicidade (meses)</Label>
              <Input
                type="number"
                min={0}
                value={form.periodicidade_meses ?? ""}
                onChange={(e) => setForm({ ...form, periodicidade_meses: e.target.value ? Number(e.target.value) : null })}
                placeholder="Deixe em branco para 'sem validade'"
              />
            </div>
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