import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil } from "lucide-react";
import { useDocumentTypes, useSaveDocumentType, type DocumentType } from "@/hooks/rh/useRh";

export default function TiposDocumentoPage() {
  const { data: tipos = [], isLoading } = useDocumentTypes();
  const save = useSaveDocumentType();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<DocumentType>>({
    scope: "TECHNICIAN", requires_expiry: true, ativo: true,
  });

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
              <TableHead>Vence?</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : tipos.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell><Badge variant="outline">{t.scope}</Badge></TableCell>
                <TableCell>{t.requires_expiry ? "Sim" : "Não"}</TableCell>
                <TableCell>{t.ativo ? <Badge>ativo</Badge> : <Badge variant="secondary">inativo</Badge>}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => { setForm(t); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
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