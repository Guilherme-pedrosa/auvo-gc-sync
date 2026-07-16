import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Search, RefreshCw, ListChecks, Trash2 } from "lucide-react";
import { useRhClientes, useSaveRhCliente, useSyncClientesGc, useDeleteRhCliente, type RhCliente } from "@/hooks/rh/useRh";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const originBadge = (o: string) =>
  o === "manual" ? <Badge variant="secondary">manual</Badge> :
  o === "gc" ? <Badge>GC sync</Badge> :
  <Badge variant="outline">cache</Badge>;

export default function ClientesRhPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: clientes = [], isLoading } = useRhClientes(search);
  const save = useSaveRhCliente();
  const sync = useSyncClientesGc();
  const del = useDeleteRhCliente();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<RhCliente>>({});

  const stats = useMemo(() => ({
    total: clientes.length,
    gc: clientes.filter((c) => c.origem === "gc").length,
    manual: clientes.filter((c) => c.origem === "manual").length,
    pendentes: clientes.filter((c) => !c.gc_cliente_id && c.origem !== "manual").length,
  }), [clientes]);

  const submit = async () => {
    if (!form.nome) return;
    await save.mutateAsync(form);
    setOpen(false); setForm({});
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">Cadastro central de clientes: requisitos, integrações e (em breve) validação de aptidão.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`} />
            Sincronizar com GC
          </Button>
          <Button onClick={() => { setForm({}); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Novo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total", value: stats.total },
          { label: "Enriquecidos (GC)", value: stats.gc },
          { label: "Manuais", value: stats.manual },
          { label: "Pendentes sync", value: stats.pendentes },
        ].map((s) => (
          <div key={s.label} className="border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : clientes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium uppercase">{c.nome}</TableCell>
                <TableCell className="font-mono text-xs uppercase">{c.cpf_cnpj ?? "—"}</TableCell>
                <TableCell className="text-xs uppercase">{[c.cidade, c.uf].filter(Boolean).join(" / ") || "—"}</TableCell>
                <TableCell>{originBadge(c.origem)}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/rh/clientes/${c.id}/requisitos`)}>
                    <ListChecks className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setForm(c); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{c.nome}" e seus requisitos serão removidos. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
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
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input className="uppercase" value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value.toUpperCase() })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fantasia</Label><Input className="uppercase" value={form.nome_fantasia ?? ""} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value.toUpperCase() })} /></div>
              <div><Label>CPF/CNPJ</Label><Input className="uppercase" value={form.cpf_cnpj ?? ""} onChange={(e) => setForm({ ...form, cpf_cnpj: e.target.value.toUpperCase() })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input className="uppercase" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value.toUpperCase() })} /></div>
              <div><Label>Telefone</Label><Input value={form.telefone ?? ""} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
            </div>
            <div><Label>Endereço</Label><Input className="uppercase" value={form.endereco ?? ""} onChange={(e) => setForm({ ...form, endereco: e.target.value.toUpperCase() })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Cidade</Label><Input className="uppercase" value={form.cidade ?? ""} onChange={(e) => setForm({ ...form, cidade: e.target.value.toUpperCase() })} /></div>
              <div><Label>UF</Label><Input className="uppercase" value={form.uf ?? ""} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} /></div>
              <div><Label>CEP</Label><Input value={form.cep ?? ""} onChange={(e) => setForm({ ...form, cep: e.target.value })} /></div>
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