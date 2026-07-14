import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import {
  useColaborador, useColaboradorDocs, useSaveColabDoc, useDeleteColabDoc,
  useDocumentTypes, computeDocStatus, type ColabDoc,
} from "@/hooks/rh/useRh";

const statusColor = (s: string) =>
  s === "expired" ? "destructive" : s === "expiring" ? "secondary" : s === "missing" ? "outline" : "default";

export default function ColaboradorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: colab } = useColaborador(id);
  const { data: docs = [] } = useColaboradorDocs(id);
  const { data: types = [] } = useDocumentTypes();
  const save = useSaveColabDoc();
  const del = useDeleteColabDoc();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<ColabDoc>>({});

  const techTypes = useMemo(() => types.filter((t) => t.scope === "TECHNICIAN" && t.ativo), [types]);
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const submit = async () => {
    if (!form.document_type_id || !id) return;
    await save.mutateAsync({ ...form, colaborador_id: id });
    setOpen(false); setForm({});
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/colaboradores")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <Card className="p-6">
        <h1 className="text-xl font-semibold">{colab?.nome ?? "..."}</h1>
        <div className="text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <div><span className="text-xs">Tipo:</span> {colab?.tipo_pessoa}</div>
          <div><span className="text-xs">CPF/CNPJ:</span> {colab?.cpf_cnpj ?? "—"}</div>
          <div><span className="text-xs">Cargo:</span> {colab?.cargo ?? "—"}</div>
          <div><span className="text-xs">Função:</span> {colab?.funcao ?? "—"}</div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Prontuário de documentos</h2>
        <Button onClick={() => { setForm({}); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Adicionar
        </Button>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => {
              const st = computeDocStatus(d);
              return (
                <TableRow key={d.id}>
                  <TableCell>{typeMap.get(d.document_type_id)?.name ?? "—"}</TableCell>
                  <TableCell>{d.data_emissao ?? "—"}</TableCell>
                  <TableCell>{d.data_vencimento ?? "—"}</TableCell>
                  <TableCell><Badge variant={statusColor(st) as never}>{st}</Badge></TableCell>
                  <TableCell>
                    {d.arquivo_url ? <a href={d.arquivo_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">{d.arquivo_nome ?? "abrir"}</a> : "—"}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setForm(d); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => id && del.mutate({ id: d.id, colaborador_id: id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {docs.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem documentos.</TableCell></TableRow>
            )}
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
                  {techTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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