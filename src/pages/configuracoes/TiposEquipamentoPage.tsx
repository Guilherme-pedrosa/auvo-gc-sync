import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search } from "lucide-react";

type Tipo = {
  id: string;
  nome: string;
  categoria: string | null;
  horas_por_tecnico: number;
  qtd_tecnicos: number;
  periodicidade: string;
  criticidade: string;
  palavras_chave: string[];
  observacoes: string | null;
  ativo: boolean;
};

const PERIODICIDADES = ["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL", "FILA"];
const CRITICIDADES = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];

const emptyForm: Partial<Tipo> = {
  nome: "",
  categoria: "",
  horas_por_tecnico: 2.5,
  qtd_tecnicos: 1,
  periodicidade: "BIMESTRAL",
  criticidade: "MEDIA",
  palavras_chave: [],
  observacoes: "",
  ativo: true,
};

export default function TiposEquipamentoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Tipo> | null>(null);
  const [keywordsText, setKeywordsText] = useState("");

  const { data: tipos = [], isLoading } = useQuery({
    queryKey: ["tipos_equipamento"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tipos_equipamento")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data || []) as Tipo[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (payload: Partial<Tipo>) => {
      const row = {
        ...payload,
        palavras_chave: keywordsText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        horas_por_tecnico: Number(payload.horas_por_tecnico) || 0,
        qtd_tecnicos: Math.max(1, Number(payload.qtd_tecnicos) || 1),
      };
      if (payload.id) {
        const { error } = await (supabase as any).from("tipos_equipamento").update(row).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("tipos_equipamento").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Tipo salvo");
      qc.invalidateQueries({ queryKey: ["tipos_equipamento"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || "Erro ao salvar"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("tipos_equipamento").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tipo removido");
      qc.invalidateQueries({ queryKey: ["tipos_equipamento"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao remover"),
  });

  const openNew = () => {
    setEditing({ ...emptyForm });
    setKeywordsText("");
    setOpen(true);
  };

  const openEdit = (t: Tipo) => {
    setEditing(t);
    setKeywordsText((t.palavras_chave || []).join(", "));
    setOpen(true);
  };

  const filtered = tipos.filter(
    (t) =>
      !search ||
      t.nome.toLowerCase().includes(search.toLowerCase()) ||
      (t.categoria || "").toLowerCase().includes(search.toLowerCase()) ||
      (t.palavras_chave || []).some((k) => k.includes(search.toLowerCase())),
  );

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tipos de Equipamento</h1>
          <p className="text-sm text-muted-foreground">
            Define HT, periodicidade e palavras-chave para auto-match com equipamentos Auvo.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo tipo
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, categoria ou palavra-chave..."
          className="pl-9"
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">HT/téc</TableHead>
              <TableHead className="text-right">Qtd téc</TableHead>
              <TableHead className="text-right">HT total</TableHead>
              <TableHead>Periodicidade</TableHead>
              <TableHead>Criticidade</TableHead>
              <TableHead>Palavras-chave</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhum tipo cadastrado</TableCell></TableRow>
            ) : filtered.map((t) => (
              <TableRow key={t.id} className={!t.ativo ? "opacity-50" : ""}>
                <TableCell className="font-medium">{t.nome}</TableCell>
                <TableCell>{t.categoria || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(t.horas_por_tecnico).toFixed(2)}h</TableCell>
                <TableCell className="text-right tabular-nums">{t.qtd_tecnicos}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{(Number(t.horas_por_tecnico) * t.qtd_tecnicos).toFixed(2)}h</TableCell>
                <TableCell><Badge variant="secondary">{t.periodicidade}</Badge></TableCell>
                <TableCell>
                  <Badge variant={t.criticidade === "CRITICA" ? "destructive" : t.criticidade === "ALTA" ? "default" : "outline"}>
                    {t.criticidade}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs">
                  <div className="flex flex-wrap gap-1">
                    {(t.palavras_chave || []).slice(0, 4).map((k) => (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 bg-muted rounded">{k}</span>
                    ))}
                    {(t.palavras_chave || []).length > 4 && (
                      <span className="text-[10px] text-muted-foreground">+{t.palavras_chave.length - 4}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remover "${t.nome}"?`)) deleteMut.mutate(t.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar tipo" : "Novo tipo"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Nome *</Label>
                <Input value={editing.nome || ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
              </div>
              <div>
                <Label>Categoria</Label>
                <Input value={editing.categoria || ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} placeholder="Refrigeração, Cocção..." />
              </div>
              <div>
                <Label>Periodicidade</Label>
                <Select value={editing.periodicidade} onValueChange={(v) => setEditing({ ...editing, periodicidade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PERIODICIDADES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Horas por técnico</Label>
                <Input type="number" step="0.25" value={editing.horas_por_tecnico ?? 0} onChange={(e) => setEditing({ ...editing, horas_por_tecnico: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Qtd. técnicos</Label>
                <Input type="number" min={1} value={editing.qtd_tecnicos ?? 1} onChange={(e) => setEditing({ ...editing, qtd_tecnicos: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Criticidade</Label>
                <Select value={editing.criticidade} onValueChange={(v) => setEditing({ ...editing, criticidade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CRITICIDADES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ativo</Label>
                <Select value={editing.ativo ? "1" : "0"} onValueChange={(v) => setEditing({ ...editing, ativo: v === "1" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Sim</SelectItem>
                    <SelectItem value="0">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="ex: camara fria, freezer vertical, geladeira" />
                <p className="text-[11px] text-muted-foreground mt-1">Usadas pra auto-match com nomes vindos do Auvo. Sem acentos, minúsculas.</p>
              </div>
              <div className="col-span-2">
                <Label>Observações</Label>
                <Textarea value={editing.observacoes || ""} onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })} rows={2} />
              </div>
              <div className="col-span-2 bg-muted/50 rounded-md p-3 text-sm">
                <strong>HT total calculado:</strong>{" "}
                {((Number(editing.horas_por_tecnico) || 0) * (Number(editing.qtd_tecnicos) || 1)).toFixed(2)}h por visita
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate(editing!)} disabled={saveMut.isPending || !editing?.nome}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}