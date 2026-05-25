import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Retorno = {
  id: string;
  gc_os_codigo: string;
  tecnico_retorno: string;
  observacao: string | null;
  criado_em: string;
};

export function OsRetornosManager({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [obs, setObs] = useState("");

  const { data, isLoading } = useQuery<Retorno[]>({
    queryKey: ["os_retornos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_retornos")
        .select("*")
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data || []) as Retorno[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const cod = codigo.trim();
      const tec = tecnico.trim();
      if (!cod || !tec) throw new Error("Informe o número da OS e o nome do técnico.");
      const { error } = await supabase.from("os_retornos").upsert(
        { gc_os_codigo: cod, tecnico_retorno: tec, observacao: obs.trim() || null },
        { onConflict: "gc_os_codigo" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setCodigo(""); setTecnico(""); setObs("");
      toast({ title: "Retorno registrado", description: "A premiação da OS será atribuída ao técnico do retorno." });
      qc.invalidateQueries({ queryKey: ["os_retornos"] });
      onChanged?.();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("os_retornos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["os_retornos"] });
      onChanged?.();
    },
  });

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className="text-base flex items-center gap-2">
          <RotateCcw className="h-4 w-4" /> Retornos de OS
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Quando uma OS recebe retorno, a premiação e o faturamento dela passam a contar para o técnico que atendeu o retorno.
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_1fr_auto] gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nº OS (GC)</label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex: 8752" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Técnico do retorno</label>
            <Input value={tecnico} onChange={(e) => setTecnico(e.target.value)} placeholder="Nome do técnico" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Observação (opcional)</label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo do retorno…" />
          </div>
          <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>
            {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Registrar
          </Button>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando…</div>
        ) : (data && data.length > 0) ? (
          <div className="border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Nº OS</TableHead>
                  <TableHead>Técnico do retorno</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.gc_os_codigo}</TableCell>
                    <TableCell className="text-sm">{r.tecnico_retorno}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.observacao || "—"}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => delMut.mutate(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">Nenhum retorno registrado.</div>
        )}
      </CardContent>
    </Card>
  );
}