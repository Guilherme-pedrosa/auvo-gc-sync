import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil } from "lucide-react";
import { useCompanyDocs, useSaveCompanyDoc, useDocumentTypes, computeDocStatus, type CompanyDoc } from "@/hooks/rh/useRh";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const statusColor = (s: string) =>
  s === "expired" ? "destructive" : s === "expiring" ? "secondary" : s === "missing" ? "outline" : "default";

export default function DocumentosEmpresaPage() {
  const { data: docs = [], isLoading } = useCompanyDocs();
  const { data: types = [] } = useDocumentTypes();
  const save = useSaveCompanyDoc();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<CompanyDoc>>({});

  const companyTypes = useMemo(() => types.filter((t) => t.scope === "COMPANY" && t.ativo), [types]);
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const openArquivo = async (url: string) => {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
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
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => { setForm(d); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
            <div><Label>URL do arquivo</Label><Input value={form.arquivo_url ?? ""} onChange={(e) => setForm({ ...form, arquivo_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Nome do arquivo</Label><Input value={form.arquivo_nome ?? ""} onChange={(e) => setForm({ ...form, arquivo_nome: e.target.value })} /></div>
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