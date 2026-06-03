import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Target, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Meta = { id: string; nome_tecnico: string; meta_faturamento: number; ativo: boolean };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function MetasManager({
  tecnicos,
  onChanged,
}: {
  tecnicos: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Target className="h-4 w-4 mr-1.5" /> Metas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> Metas de Faturamento
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            75%–99% da meta: <b>+7,5%</b> · 100%–110%: <b>+10%</b> · 111% ou mais: <b>+13,5%</b> sobre a comissão bruta.
          </p>
        </DialogHeader>
        <MetasInner tecnicos={tecnicos} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}

function MetasInner({ tecnicos, onChanged }: { tecnicos: string[]; onChanged: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [meta, setMeta] = useState("");

  const { data: metas = [], refetch } = useQuery<Meta[]>({
    queryKey: ["metas_tecnicos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("metas_tecnicos").select("*").order("nome_tecnico");
      if (error) throw error;
      return (data || []) as Meta[];
    },
  });

  const invalidate = () => {
    refetch();
    onChanged();
    qc.invalidateQueries({ queryKey: ["premiacao"] });
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const v = Number(meta);
      if (!nome.trim() || !Number.isFinite(v) || v <= 0) throw new Error("Informe técnico e meta válida");
      const { error } = await supabase
        .from("metas_tecnicos")
        .insert({ nome_tecnico: nome.trim(), meta_faturamento: v });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Meta cadastrada"); setNome(""); setMeta(""); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updMut = useMutation({
    mutationFn: async (m: Meta) => {
      const { error } = await supabase
        .from("metas_tecnicos")
        .update({ meta_faturamento: m.meta_faturamento, ativo: m.ativo, atualizado_em: new Date().toISOString() })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("metas_tecnicos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removida"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const jaCadastrados = new Set(metas.map((m) => m.nome_tecnico));
  const disponiveis = tecnicos.filter((t) => !jaCadastrados.has(t));

  return (
    <div className="space-y-4 mt-2">
      <Card>
        <CardHeader className="p-3"><CardTitle className="text-sm">Nova meta</CardTitle></CardHeader>
        <CardContent className="p-3 pt-0 grid gap-3 md:grid-cols-[1fr_160px_auto]">
          <div>
            <Label className="text-xs">Técnico</Label>
            {disponiveis.length > 0 ? (
              <select
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione ou digite</option>
                {disponiveis.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do técnico" />
            )}
          </div>
          <div>
            <Label className="text-xs">Meta R$/mês</Label>
            <Input value={meta} onChange={(e) => setMeta(e.target.value)} type="number" min={0} step={100} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Criar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {metas.map((m) => (
          <MetaRow key={m.id} meta={m} onUpdate={(x) => updMut.mutate(x)} onDelete={() => delMut.mutate(m.id)} />
        ))}
        {metas.length === 0 && <p className="text-xs text-muted-foreground italic">Nenhuma meta cadastrada.</p>}
      </div>
    </div>
  );
}

function MetaRow({ meta, onUpdate, onDelete }: { meta: Meta; onUpdate: (m: Meta) => void; onDelete: () => void }) {
  const [local, setLocal] = useState(meta);
  const dirty = local.meta_faturamento !== meta.meta_faturamento || local.ativo !== meta.ativo;
  return (
    <div className="flex items-center gap-2 border rounded p-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{meta.nome_tecnico}</div>
        <div className="text-[10px] text-muted-foreground">Atual: {brl(meta.meta_faturamento)}</div>
      </div>
      <Input
        type="number"
        value={local.meta_faturamento}
        onChange={(e) => setLocal({ ...local, meta_faturamento: Number(e.target.value) })}
        className="w-32"
        min={0}
        step={100}
      />
      <div className="flex items-center gap-1.5 px-2">
        <Switch checked={local.ativo} onCheckedChange={(v) => setLocal({ ...local, ativo: v })} />
        <span className="text-xs">{local.ativo ? "Ativa" : "Inativa"}</span>
      </div>
      {dirty && (
        <Button size="sm" onClick={() => onUpdate(local)}>Salvar</Button>
      )}
      <Button size="icon" variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}