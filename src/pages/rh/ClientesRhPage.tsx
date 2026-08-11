import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Search, RefreshCw, ListChecks, Trash2, Link2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  useAuvoClientesCache,
  useDeleteRhCliente,
  useLinkRhClienteAuvo,
  useRhClientes,
  useSaveRhCliente,
  useSyncClientesGc,
  type RhCliente,
} from "@/hooks/rh/useRh";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const linkBadge = (status: RhCliente["vinculo_status"]) => {
  if (status === "vinculado") return <Badge className="bg-emerald-600 hover:bg-emerald-600">GC ↔ Auvo</Badge>;
  if (status === "ambiguo") return <Badge className="bg-amber-500 hover:bg-amber-500">Revisar vínculo</Badge>;
  if (status === "erro") return <Badge variant="destructive">Erro no Auvo</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
};

export default function ClientesRhPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filterVinculo, setFilterVinculo] = useState<string>("all");
  const { data: clientes = [], isLoading } = useRhClientes(search, filterVinculo);
  const { data: auvoClientes = [] } = useAuvoClientesCache();
  const save = useSaveRhCliente();
  const linkAuvo = useLinkRhClienteAuvo();
  const sync = useSyncClientesGc();
  const del = useDeleteRhCliente();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<RhCliente>>({});
  const [auvoChoice, setAuvoChoice] = useState("");

  const stats = useMemo(() => ({
    total: clientes.length,
    linked: clientes.filter((c) => c.vinculo_status === "vinculado").length,
    auvoOnly: clientes.filter((c) => c.auvo_cliente_id && !c.gc_cliente_id).length,
    pendentes: clientes.filter((c) => c.vinculo_status !== "vinculado").length,
  }), [clientes]);

  const auvoOptions = useMemo(() => auvoClientes.map((c) => ({
    value: String(c.auvo_id),
    label: `${c.nome} · Auvo #${c.auvo_id}${c.cpf_cnpj ? ` · ${c.cpf_cnpj}` : ""}`,
  })), [auvoClientes]);

  const openEditor = (cliente?: RhCliente) => {
    setForm(cliente ?? {});
    setAuvoChoice(cliente?.auvo_cliente_id ? String(cliente.auvo_cliente_id) : "");
    setOpen(true);
  };

  const submit = async () => {
    if (!form.nome) return;
    await save.mutateAsync(form);
    if (form.id && auvoChoice !== String(form.auvo_cliente_id ?? "")) {
      await linkAuvo.mutateAsync({
        rhClientId: form.id,
        auvoCustomerId: auvoChoice ? Number(auvoChoice) : null,
      });
    }
    setOpen(false); setForm({});
  };

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">Cadastro central e vínculo entre GestãoClick e Auvo. O ID mantém a relação mesmo quando o nome muda.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`} />
            Sincronizar GC + Auvo
          </Button>
          <Button onClick={() => openEditor()}>
            <Plus className="h-4 w-4 mr-2" /> Novo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total", value: stats.total },
          { label: "Vinculados GC ↔ Auvo", value: stats.linked },
          { label: "Somente no Auvo", value: stats.auvoOnly },
          { label: "Revisar / pendentes", value: stats.pendentes },
        ].map((s) => (
          <div key={s.label} className="border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4 items-end">
        <div className="flex-1 max-w-md">
          <Label className="text-xs mb-1 block">Pesquisar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por nome, GC, Auvo, CPF/CNPJ..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        
        <div className="w-full sm:w-48">
          <Label className="text-xs mb-1 block">Situação do Vínculo</Label>
          <Select value={filterVinculo} onValueChange={setFilterVinculo}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              <SelectItem value="vinculado">Vinculados</SelectItem>
              <SelectItem value="nao_vinculado">Não vinculados (Pendente)</SelectItem>
              <SelectItem value="erro">Com erro</SelectItem>
              <SelectItem value="ambiguo">Ambiguidade</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente central</TableHead>
              <TableHead>GestãoClick</TableHead>
              <TableHead>Auvo</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Vínculo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : clientes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium uppercase">
                  <div className="whitespace-normal break-words">{c.nome}</div>
                  {c.auvo_sync_erro && <div className="text-[11px] text-destructive">{c.auvo_sync_erro}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  {c.gc_cliente_id ? <><div className="uppercase whitespace-normal break-words">{c.nome_gc || c.nome}</div><div className="text-muted-foreground">GC #{c.gc_cliente_id}</div></> : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {c.auvo_cliente_id ? <><div className="uppercase whitespace-normal break-words">{c.nome_auvo || c.nome}</div><div className="text-muted-foreground">Auvo #{c.auvo_cliente_id}</div></> : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs uppercase">{c.cpf_cnpj ?? "—"}</TableCell>
                <TableCell className="text-xs uppercase">{[c.cidade, c.uf].filter(Boolean).join(" / ") || "—"}</TableCell>
                <TableCell>{linkBadge(c.vinculo_status)}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/rh/clientes/${c.id}/requisitos`)}>
                    <ListChecks className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEditor(c)}>
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
        <DialogContent className="sm:max-w-2xl">
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
            {form.id && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Vínculo com o Auvo</Label>
                    <p className="text-xs text-muted-foreground">Selecione o cadastro correspondente. O vínculo ficará salvo pelo ID.</p>
                  </div>
                </div>
                <SearchableSelect
                  className="w-full"
                  options={auvoOptions}
                  value={auvoChoice}
                  onValueChange={setAuvoChoice}
                  placeholder="Selecionar cliente do Auvo..."
                  searchPlaceholder="Buscar por nome, documento ou ID..."
                  emptyText="Nenhum cliente encontrado no espelho do Auvo."
                />
                <div className="rounded-md bg-muted/40 p-2.5">
                  <Label htmlFor="auvo-id-direto" className="text-xs">ID direto do cliente no Auvo</Label>
                  <Input
                    id="auvo-id-direto"
                    inputMode="numeric"
                    className="mt-1 font-mono"
                    value={auvoChoice}
                    onChange={(event) => setAuvoChoice(event.target.value.replace(/\D/g, ""))}
                    placeholder="Ex.: 44527193"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Se não estiver no espelho, o sistema consulta esse ID diretamente no Auvo antes de vincular.
                  </p>
                </div>
                {form.nome_gc && form.nome_auvo && form.nome_gc !== form.nome_auvo && (
                  <p className="text-xs text-amber-700">Nomes diferentes são permitidos: GC “{form.nome_gc}” ↔ Auvo “{form.nome_auvo}”.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending || linkAuvo.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
