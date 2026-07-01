import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Trash2, Plus, RefreshCw, Loader2 } from "lucide-react";

type Tipo = {
  id: string;
  auvo_task_type_id: string;
  descricao: string;
  aplica_a_categoria: string | null;
  ativo: boolean;
};

export default function TiposTarefaPreventivaPage() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tipos-tarefa-preventiva"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tipos_tarefa_preventiva")
        .select("*")
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as Tipo[];
    },
  });

  const [novo, setNovo] = useState({ auvo_task_type_id: "", descricao: "", aplica_a_categoria: "" });
  const [saving, setSaving] = useState(false);
  const [reconsolidating, setReconsolidating] = useState(false);

  const salvarLinha = async (t: Tipo, patch: Partial<Tipo>) => {
    const { error } = await supabase.from("tipos_tarefa_preventiva").update(patch).eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tipos-tarefa-preventiva"] });
  };

  const excluir = async (t: Tipo) => {
    if (!confirm(`Remover tipo ${t.auvo_task_type_id} — ${t.descricao}?`)) return;
    const { error } = await supabase.from("tipos_tarefa_preventiva").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tipos-tarefa-preventiva"] });
  };

  const adicionar = async () => {
    if (!novo.auvo_task_type_id.trim() || !novo.descricao.trim()) {
      return toast.error("ID e descrição obrigatórios");
    }
    setSaving(true);
    const { error } = await supabase.from("tipos_tarefa_preventiva").insert({
      auvo_task_type_id: novo.auvo_task_type_id.trim(),
      descricao: novo.descricao.trim(),
      aplica_a_categoria: novo.aplica_a_categoria.trim() || null,
      ativo: true,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setNovo({ auvo_task_type_id: "", descricao: "", aplica_a_categoria: "" });
    qc.invalidateQueries({ queryKey: ["tipos-tarefa-preventiva"] });
    toast.success("Tipo adicionado. Rode 'Reconsolidar' para aplicar na tela de preventivas.");
  };

  const reconsolidar = async () => {
    setReconsolidating(true);
    const { data, error } = await supabase.functions.invoke("preventiva-consolidar", { body: {} });
    setReconsolidating(false);
    if (error) return toast.error(error.message);
    toast.success(`Consolidado: ${data?.linhas_gravadas} equipamentos em ${data?.elapsed_ms}ms`);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tipos de Tarefa Preventiva</h1>
          <p className="text-sm text-muted-foreground">
            Cada tipo aqui é considerado "preventiva" na sincronização e no cálculo da próxima manutenção.
            <br />
            <b>Aplica a categoria</b> vazio = vale para todos os equipamentos. Preenchido = só conta para
            equipamentos com aquela categoria (ex.: "Coifa" para higienização).
          </p>
        </div>
        <Button onClick={reconsolidar} disabled={reconsolidating} variant="secondary">
          {reconsolidating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Reconsolidar agora
        </Button>
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <div className="text-sm font-medium">Adicionar tipo</div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label>Auvo Task Type ID</Label>
            <Input value={novo.auvo_task_type_id} onChange={(e) => setNovo({ ...novo, auvo_task_type_id: e.target.value })} placeholder="235724" />
          </div>
          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} placeholder="Higienização de Coifas" />
          </div>
          <div>
            <Label>Aplica à categoria (opcional)</Label>
            <Input value={novo.aplica_a_categoria} onChange={(e) => setNovo({ ...novo, aplica_a_categoria: e.target.value })} placeholder="Coifa" />
          </div>
        </div>
        <Button onClick={adicionar} disabled={saving}><Plus className="w-4 h-4 mr-2" />Adicionar</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID Auvo</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Ativo</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>
          ) : (data ?? []).map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono">{t.auvo_task_type_id}</TableCell>
              <TableCell>
                <Input defaultValue={t.descricao} onBlur={(e) => e.target.value !== t.descricao && salvarLinha(t, { descricao: e.target.value })} />
              </TableCell>
              <TableCell>
                <Input defaultValue={t.aplica_a_categoria ?? ""} placeholder="(todas)"
                  onBlur={(e) => (e.target.value || null) !== t.aplica_a_categoria && salvarLinha(t, { aplica_a_categoria: e.target.value.trim() || null })} />
              </TableCell>
              <TableCell>
                <Switch checked={t.ativo} onCheckedChange={(v) => salvarLinha(t, { ativo: v })} />
              </TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" onClick={() => excluir(t)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}