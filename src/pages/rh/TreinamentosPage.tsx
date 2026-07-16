import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, FolderOpen, Search, GraduationCap } from "lucide-react";
import { useTreinamentos, useTreinamentoTipos, useSaveTreinamento, useDeleteTreinamento, computeTrainingStatus, type Treinamento } from "@/hooks/rh/useRh";

const statusVariant = (s: string) =>
  s === "expired" ? "destructive" : s === "expiring" ? "secondary" : "default";
const statusLabel = (s: string) =>
  s === "expired" ? "Vencido" : s === "expiring" ? "Vencendo" : "Vigente";

function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + months);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function TreinamentosPage() {
  const navigate = useNavigate();
  const { data: treinos = [], isLoading } = useTreinamentos();
  const { data: tipos = [] } = useTreinamentoTipos();
  const save = useSaveTreinamento();
  const del = useDeleteTreinamento();
  const tipoMap = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Treinamento>>({});

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return treinos;
    return treinos.filter((t) =>
      t.titulo.toLowerCase().includes(s) ||
      (tipoMap.get(t.tipo_id)?.name ?? "").toLowerCase().includes(s) ||
      (t.instrutor ?? "").toLowerCase().includes(s),
    );
  }, [treinos, search, tipoMap]);

  const selectedTipo = form.tipo_id ? tipoMap.get(form.tipo_id) : undefined;

  const handleTipoChange = (v: string) => {
    const tipo = tipoMap.get(v);
    setForm((f) => {
      const next: Partial<Treinamento> = { ...f, tipo_id: v };
      if (!next.titulo && tipo) next.titulo = tipo.name.toUpperCase();
      if (next.data_realizacao && tipo?.validade_meses) {
        next.data_validade = addMonths(next.data_realizacao, tipo.validade_meses);
      }
      return next;
    });
  };
  const handleDataChange = (v: string) => {
    setForm((f) => {
      const next: Partial<Treinamento> = { ...f, data_realizacao: v };
      const tipo = f.tipo_id ? tipoMap.get(f.tipo_id) : undefined;
      if (v && tipo?.validade_meses) next.data_validade = addMonths(v, tipo.validade_meses);
      return next;
    });
  };

  const submit = async () => {
    if (!form.tipo_id || !form.titulo || !form.data_realizacao) return;
    const id = await save.mutateAsync({
      ...form,
      titulo: form.titulo?.toUpperCase(),
      instrutor: form.instrutor ? form.instrutor.toUpperCase() : null,
      local: form.local ? form.local.toUpperCase() : null,
    });
    const wasNew = !form.id;
    setOpen(false); setForm({});
    if (id && wasNew) navigate(`/rh/treinamentos/${id}`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5" /> Treinamentos
          </h1>
          <p className="text-sm text-muted-foreground">Sessões de capacitação, certificados e vínculo com colaboradores.</p>
        </div>
        <Button onClick={() => { setForm({}); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo treinamento
        </Button>
      </div>

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Título, tipo, instrutor..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="w-32">Realização</TableHead>
              <TableHead className="w-32">Validade</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum treinamento cadastrado.</TableCell></TableRow>
            ) : filtered.map((t) => {
              const st = computeTrainingStatus(t);
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-medium uppercase">{t.titulo}</TableCell>
                  <TableCell><Badge variant="outline">{tipoMap.get(t.tipo_id)?.name ?? "—"}</Badge></TableCell>
                  <TableCell>{t.data_realizacao}</TableCell>
                  <TableCell>{t.data_validade ?? "—"}</TableCell>
                  <TableCell><Badge variant={statusVariant(st) as never}>{statusLabel(st)}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/rh/treinamentos/${t.id}`)} title="Abrir">
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setForm(t); setOpen(true); }} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir treinamento?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{t.titulo}" e todos os participantes vinculados serão removidos.
                            </AlertDialogDescription>
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} treinamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo *</Label>
              <Select value={form.tipo_id ?? ""} onValueChange={handleTipoChange}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tipos.filter((t) => t.ativo).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.validade_meses ? ` (valid. ${t.validade_meses} m)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Título *</Label>
              <Input value={form.titulo ?? ""} onChange={(e) => setForm({ ...form, titulo: e.target.value.toUpperCase() })} className="uppercase" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data da realização *</Label>
                <Input type="date" value={form.data_realizacao ?? ""} onChange={(e) => handleDataChange(e.target.value)} />
              </div>
              <div>
                <Label>Validade {selectedTipo?.validade_meses ? `(${selectedTipo.validade_meses}m)` : ""}</Label>
                <Input type="date" value={form.data_validade ?? ""} onChange={(e) => setForm({ ...form, data_validade: e.target.value || null })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Instrutor</Label><Input value={form.instrutor ?? ""} onChange={(e) => setForm({ ...form, instrutor: e.target.value.toUpperCase() })} className="uppercase" /></div>
              <div><Label>Carga horária (h)</Label><Input type="number" step="0.5" value={form.carga_horaria ?? ""} onChange={(e) => setForm({ ...form, carga_horaria: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            </div>
            <div><Label>Local</Label><Input value={form.local ?? ""} onChange={(e) => setForm({ ...form, local: e.target.value.toUpperCase() })} className="uppercase" /></div>
            <div><Label>Observações</Label><Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending || !form.tipo_id || !form.titulo || !form.data_realizacao}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}