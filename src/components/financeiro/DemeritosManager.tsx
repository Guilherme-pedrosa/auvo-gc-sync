import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AlertOctagon, Plus, Trash2, Settings2 } from "lucide-react";
import { toast } from "sonner";

type Motivo = { id: string; nome: string; percentual: number; ativo: boolean };
type Lanc = {
  id: string;
  tecnico_nome: string;
  mes: string;
  motivo_id: string | null;
  motivo_nome: string;
  percentual: number;
  observacao: string | null;
  criado_em: string;
};

export function DemeritosManager({
  month,
  tecnicos,
  onChanged,
}: {
  month: string;
  tecnicos: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <AlertOctagon className="h-4 w-4 mr-1.5" /> Deméritos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-destructive" /> Deméritos · {month}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="lancamentos" className="mt-2">
          <TabsList>
            <TabsTrigger value="lancamentos">Lançamentos do mês</TabsTrigger>
            <TabsTrigger value="motivos"><Settings2 className="h-3.5 w-3.5 mr-1" /> Motivos</TabsTrigger>
          </TabsList>
          <TabsContent value="lancamentos" className="mt-3">
            <LancamentosTab month={month} tecnicos={tecnicos} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="motivos" className="mt-3">
            <MotivosTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LancamentosTab({
  month,
  tecnicos,
  onChanged,
}: {
  month: string;
  tecnicos: string[];
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [tecnico, setTecnico] = useState("");
  const [motivoId, setMotivoId] = useState("");
  const [obs, setObs] = useState("");

  const { data: motivos = [] } = useQuery<Motivo[]>({
    queryKey: ["demerito_motivos_ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demerito_motivos")
        .select("*")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data || []) as Motivo[];
    },
  });

  const { data: lancs = [], refetch } = useQuery<Lanc[]>({
    queryKey: ["demerito_lancamentos", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demerito_lancamentos")
        .select("*")
        .eq("mes", month)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data || []) as Lanc[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!tecnico || !motivoId) throw new Error("Selecione técnico e motivo");
      const m = motivos.find((x) => x.id === motivoId);
      if (!m) throw new Error("Motivo inválido");
      const { error } = await supabase.from("demerito_lancamentos").insert({
        tecnico_nome: tecnico,
        mes: month,
        motivo_id: m.id,
        motivo_nome: m.nome,
        percentual: m.percentual,
        observacao: obs || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Demérito lançado");
      setObs("");
      setMotivoId("");
      refetch();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("demerito_lancamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      refetch();
      onChanged();
      qc.invalidateQueries({ queryKey: ["premiacao"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-3">
          <CardTitle className="text-sm">Novo lançamento</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label className="text-xs">Técnico</Label>
            <Select value={tecnico} onValueChange={setTecnico}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {tecnicos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Motivo</Label>
            <Select value={motivoId} onValueChange={setMotivoId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {motivos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome} ({m.percentual}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Lançar
            </Button>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Observação (opcional)</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} placeholder="Ex.: cliente X reclamou de atraso" />
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="text-sm font-medium mb-2">Lançamentos do mês ({lancs.length})</div>
        {lancs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nenhum demérito lançado neste mês.</p>
        ) : (
          <div className="space-y-2">
            {lancs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border rounded p-2.5 text-sm">
                <Badge variant="destructive" className="text-[10px]">−{l.percentual}%</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{l.tecnico_nome} · {l.motivo_nome}</div>
                  {l.observacao && <div className="text-xs text-muted-foreground truncate">{l.observacao}</div>}
                </div>
                <Button size="icon" variant="ghost" onClick={() => delMut.mutate(l.id)} disabled={delMut.isPending}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MotivosTab() {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [pct, setPct] = useState<string>("");

  const { data: motivos = [], refetch } = useQuery<Motivo[]>({
    queryKey: ["demerito_motivos_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("demerito_motivos").select("*").order("nome");
      if (error) throw error;
      return (data || []) as Motivo[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const p = Number(pct);
      if (!nome.trim() || !Number.isFinite(p) || p <= 0 || p > 100) {
        throw new Error("Informe nome e percentual entre 0 e 100");
      }
      const { error } = await supabase.from("demerito_motivos").insert({ nome: nome.trim(), percentual: p });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Motivo criado");
      setNome(""); setPct("");
      refetch();
      qc.invalidateQueries({ queryKey: ["demerito_motivos_ativos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updMut = useMutation({
    mutationFn: async (m: Motivo) => {
      const { error } = await supabase
        .from("demerito_motivos")
        .update({ nome: m.nome, percentual: m.percentual, ativo: m.ativo, atualizado_em: new Date().toISOString() })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["demerito_motivos_ativos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("demerito_motivos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      refetch();
      qc.invalidateQueries({ queryKey: ["demerito_motivos_ativos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível remover (motivo em uso). Desative em vez disso."),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-3"><CardTitle className="text-sm">Novo motivo</CardTitle></CardHeader>
        <CardContent className="p-3 pt-0 grid gap-3 md:grid-cols-[1fr_120px_auto]">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Ex.: Reclamação de cliente" />
          </div>
          <div>
            <Label className="text-xs">% desconto</Label>
            <Input value={pct} onChange={(e) => setPct(e.target.value)} type="number" min={0} max={100} step={0.5} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Criar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {motivos.map((m) => (
          <MotivoRow key={m.id} motivo={m} onUpdate={(x) => updMut.mutate(x)} onDelete={() => delMut.mutate(m.id)} />
        ))}
        {motivos.length === 0 && <p className="text-xs text-muted-foreground italic">Nenhum motivo cadastrado.</p>}
      </div>
    </div>
  );
}

function MotivoRow({ motivo, onUpdate, onDelete }: { motivo: Motivo; onUpdate: (m: Motivo) => void; onDelete: () => void }) {
  const [local, setLocal] = useState(motivo);
  const dirty = local.nome !== motivo.nome || local.percentual !== motivo.percentual || local.ativo !== motivo.ativo;
  return (
    <div className="flex items-center gap-2 border rounded p-2">
      <Input value={local.nome} onChange={(e) => setLocal({ ...local, nome: e.target.value })} className="flex-1" maxLength={120} />
      <Input
        type="number"
        value={local.percentual}
        onChange={(e) => setLocal({ ...local, percentual: Number(e.target.value) })}
        className="w-20"
        min={0}
        max={100}
        step={0.5}
      />
      <span className="text-xs text-muted-foreground">%</span>
      <div className="flex items-center gap-1.5 px-2">
        <Switch checked={local.ativo} onCheckedChange={(v) => setLocal({ ...local, ativo: v })} />
        <span className="text-xs">{local.ativo ? "Ativo" : "Inativo"}</span>
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