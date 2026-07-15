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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [uploading, setUploading] = useState(false);

  const techTypes = useMemo(() => types.filter((t) => t.scope === "TECHNICIAN" && t.ativo), [types]);
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const REQUIRE_DATES_CODES = ["ASO", "FICHA_EPI", "CNH", "CNH_SOCIO"];
  const selectedType = form.document_type_id ? typeMap.get(form.document_type_id) : undefined;
  const requiresDates = !!selectedType && REQUIRE_DATES_CODES.includes(selectedType.code);

  const AUTO_EXPIRY_MONTHS: Record<string, number> = {
    FICHA_EPI: 3,
    NR10: 12, NR12: 12, NR35: 12,
    PCMSO: 12, PGR: 12, LTCAT: 12,
  };
  const addMonths = (iso: string, months: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setMonth(dt.getMonth() + months);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const handleEmissaoChange = (value: string) => {
    const code = selectedType?.code;
    const months = code ? AUTO_EXPIRY_MONTHS[code] : undefined;
    setForm((f) => ({
      ...f,
      data_emissao: value,
      data_vencimento: value && months ? addMonths(value, months) : f.data_vencimento,
    }));
  };

  const submit = async () => {
    if (!form.document_type_id || !id) return;
    if (requiresDates && (!form.data_emissao || !form.data_vencimento)) {
      toast.error(`${selectedType?.name}: data de emissão e vencimento são obrigatórias.`);
      return;
    }
    await save.mutateAsync({ ...form, colaborador_id: id });
    setOpen(false); setForm({});
  };

  const openArquivo = async (url: string) => {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !id) return;
    setUploading(true);
    try {
      const path = `colaborador/${id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/colaboradores")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <Card className="p-6">
        <h1 className="text-xl font-semibold uppercase">{colab?.nome ?? "..."}</h1>
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
              <div>
                <Label>Emissão {requiresDates && <span className="text-destructive">*</span>}</Label>
                <Input type="date" required={requiresDates} value={form.data_emissao ?? ""} onChange={(e) => handleEmissaoChange(e.target.value)} />
              </div>
              <div>
                <Label>Vencimento {requiresDates && <span className="text-destructive">*</span>}</Label>
                <Input type="date" required={requiresDates} value={form.data_vencimento ?? ""} onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} />
              </div>
            </div>
            {requiresDates && (
              <p className="text-xs text-destructive">
                {selectedType?.name} exige data de emissão e vencimento.
              </p>
            )}
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
            <Button onClick={submit} disabled={save.isPending || (requiresDates && (!form.data_emissao || !form.data_vencimento))}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}