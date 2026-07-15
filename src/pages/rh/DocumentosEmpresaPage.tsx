import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCompanyDocs, useSaveCompanyDoc, useDeleteCompanyDoc, useDocumentTypes, computeDocStatus, type CompanyDoc } from "@/hooks/rh/useRh";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const statusColor = (s: string) =>
  s === "expired" ? "destructive" : s === "expiring" ? "secondary" : s === "missing" ? "outline" : "default";

export default function DocumentosEmpresaPage() {
  const { data: docs = [], isLoading } = useCompanyDocs();
  const { data: types = [] } = useDocumentTypes();
  const save = useSaveCompanyDoc();
  const del = useDeleteCompanyDoc();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<CompanyDoc>>({});
  const [uploading, setUploading] = useState(false);

  const companyTypes = useMemo(() => types.filter((t) => t.scope === "COMPANY" && t.ativo), [types]);
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const openArquivo = async (url: string) => {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = `empresa/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("rh-documentos").upload(path, file, { upsert: false });
      if (error) throw error;
      setForm((f) => ({ ...f, arquivo_url: path, arquivo_nome: f.arquivo_nome || file.name }));
      toast.success("Arquivo enviado");
    } catch (e) {
      toast.error("Falha no upload: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!form.document_type_id) return;
    await save.mutateAsync(form);
    setOpen(false); setForm({});
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Documentos da Empresa</h1>
          <p className="text-sm text-muted-foreground">Contrato social, certificados, alvarás.</p>
        </div>
        <Button onClick={() => { setForm({}); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Número</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : docs.map((d) => {
              const st = computeDocStatus(d);
              return (
                <TableRow key={d.id}>
                  <TableCell>{typeMap.get(d.document_type_id)?.name ?? "—"}</TableCell>
                  <TableCell>{d.numero ?? "—"}</TableCell>
                  <TableCell>{d.data_emissao ?? "—"}</TableCell>
                  <TableCell>{d.data_vencimento ?? "—"}</TableCell>
                  <TableCell><Badge variant={statusColor(st) as never}>{st}</Badge></TableCell>
                  <TableCell>
                    {d.arquivo_url ? (
                      <button type="button" onClick={() => openArquivo(d.arquivo_url!)} className="text-primary underline text-xs">
                        {d.arquivo_nome ?? "abrir"}
                      </button>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setForm(d); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{typeMap.get(d.document_type_id)?.name ?? "Documento"}" será removido. Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(d.id)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} documento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.document_type_id} onValueChange={(v) => setForm({ ...form, document_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {companyTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Número</Label><Input value={form.numero ?? ""} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Emissão</Label><Input type="date" value={form.data_emissao ?? ""} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} /></div>
              <div><Label>Vencimento</Label><Input type="date" value={form.data_vencimento ?? ""} onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} /></div>
            </div>
            <div>
              <Label>Anexo</Label>
              <Input type="file" onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} disabled={uploading} />
              {form.arquivo_url && (
                <p className="text-xs text-muted-foreground mt-1">
                  {uploading ? "Enviando..." : `Arquivo: ${form.arquivo_nome ?? form.arquivo_url}`}
                </p>
              )}
            </div>
            <div><Label>Nome do arquivo</Label><Input value={form.arquivo_nome ?? ""} onChange={(e) => setForm({ ...form, arquivo_nome: e.target.value })} placeholder="Opcional" /></div>
            <div><Label className="text-xs text-muted-foreground">Ou URL externa</Label><Input value={/^https?:\/\//i.test(form.arquivo_url ?? "") ? (form.arquivo_url ?? "") : ""} onChange={(e) => setForm({ ...form, arquivo_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Observações</Label><Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
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