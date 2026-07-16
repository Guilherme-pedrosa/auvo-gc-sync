import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, GraduationCap } from "lucide-react";
import { useTreinamentoTipos, useSaveTreinamentoTipo, useDeleteTreinamentoTipo, type TreinamentoTipo } from "@/hooks/rh/useRh";

export default function TiposTreinamentoPage() {
  const { data: tipos = [], isLoading } = useTreinamentoTipos();
  const save = useSaveTreinamentoTipo();
  const del = useDeleteTreinamentoTipo();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<TreinamentoTipo>>({ ativo: true });

  const sorted = useMemo(() => [...tipos].sort((a, b) => a.name.localeCompare(b.name)), [tipos]);

  const submit = async () => {
    if (!form.code || !form.name) return;
    await save.mutateAsync({
      ...form,
      code: form.code.toUpperCase().replace(/\s+/g, "_"),
      name: form.name.toUpperCase(),
    });
    setOpen(false); setForm({ ativo: true });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5" /> Tipos de Treinamento
          </h1>
          <p className="text-sm text-muted-foreground">Catálogo dos tipos de treinamento e validade padrão em meses.</p>
        </div>
        <Button onClick={() => { setForm({ ativo: true }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo tipo
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-40">Código</TableHead>
              <TableHead className="w-32">Validade</TableHead>
              <TableHead className="w-24">Ativo</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum tipo cadastrado.</TableCell></TableRow>
            ) : sorted.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium uppercase">{t.name}</TableCell>
                <TableCell><code className="text-xs">{t.code}</code></TableCell>
                <TableCell>{t.validade_meses != null ? `${t.validade_meses} meses` : "sem vencimento"}</TableCell>
                <TableCell>{t.ativo ? <Badge>ativo</Badge> : <Badge variant="secondary">inativo</Badge>}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => { setForm(t); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir tipo?</AlertDialogTitle>
                          <AlertDialogDescription>"{t.name}" — só é possível excluir se não houver treinamentos usando este tipo.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(t.id)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} tipo de treinamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} className="uppercase" /></div>
            <div><Label>Código *</Label><Input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })} placeholder="Ex.: NR10, NR35, PRIMEIROS_SOCORROS" /></div>
            <div>
              <Label>Validade padrão (meses)</Label>
              <Input type="number" min={1} value={form.validade_meses ?? ""} onChange={(e) => setForm({ ...form, validade_meses: e.target.value === "" ? null : Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground mt-1">Deixe vazio para treinamentos sem vencimento (ex.: integração interna).</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ativo ?? true} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending || !form.name || !form.code}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}