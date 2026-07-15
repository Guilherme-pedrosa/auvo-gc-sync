import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useDocumentTypes, useSaveDocumentType, useDeleteDocumentType, type DocumentType } from "@/hooks/rh/useRh";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function TiposDocumentoPage() {
  const { data: tipos = [], isLoading } = useDocumentTypes();
  const save = useSaveDocumentType();
  const del = useDeleteDocumentType();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<DocumentType>>({
    scope: "TECHNICIAN", requires_expiry: true, ativo: true,
  });

  const PACOTES: { key: "COMPANY" | "MEI" | "CLT"; label: string }[] = [
    { key: "COMPANY", label: "Empresa" },
    { key: "MEI", label: "Téc. MEI" },
    { key: "CLT", label: "Téc. CLT" },
  ];
  const togglePacote = (k: "COMPANY" | "MEI" | "CLT") => {
    const cur = new Set(form.pacote_padrao ?? []);
    cur.has(k) ? cur.delete(k) : cur.add(k);
    setForm({ ...form, pacote_padrao: Array.from(cur) as DocumentType["pacote_padrao"] });
  };

  const submit = async () => {
    if (!form.name || !form.code) return;
    await save.mutateAsync(form);
    setOpen(false);
    setForm({ scope: "TECHNICIAN", requires_expiry: true, ativo: true });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Tipos de Documento</h1>
          <p className="text-sm text-muted-foreground">Catálogo de documentos exigidos para empresa e técnicos.</p>
        </div>
        <Button onClick={() => { setForm({ scope: "TECHNICIAN", requires_expiry: true, ativo: true }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead>Pacote Padrão</TableHead>
              <TableHead>Vence?</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : tipos.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell><Badge variant="outline">{t.scope}</Badge></TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(t.pacote_padrao ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (t.pacote_padrao ?? []).map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px]">
                        {p === "COMPANY" ? "Empresa" : p === "MEI" ? "MEI" : "CLT"}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{t.requires_expiry ? "Sim" : "Não"}</TableCell>
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
                        <AlertDialogTitle>Excluir tipo de documento?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{t.name}" será removido do catálogo. Se houver documentos vinculados, a exclusão pode falhar — nesse caso, desative em vez de excluir.
                        </AlertDialogDescription>
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
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} tipo de documento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Código</Label>
              <Input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Escopo</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as DocumentType["scope"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY">Empresa</SelectItem>
                  <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                  <SelectItem value="CLIENT">Cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.requires_expiry ?? true} onCheckedChange={(v) => setForm({ ...form, requires_expiry: v })} />
              <Label>Exige data de vencimento</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ativo ?? true} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
              <Label>Ativo</Label>
            </div>
            <div>
              <Label className="mb-2 block">Pacote Padrão WD</Label>
              <div className="flex gap-4">
                {PACOTES.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={(form.pacote_padrao ?? []).includes(p.key)}
                      onCheckedChange={() => togglePacote(p.key)}
                    />
                    <span className="text-sm">{p.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Marca este documento como exigido no pacote padrão de integração.
              </p>
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