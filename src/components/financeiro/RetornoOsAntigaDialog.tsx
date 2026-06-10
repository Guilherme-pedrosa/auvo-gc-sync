import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Search, RotateCcw } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "@/hooks/use-toast";

type Preview = {
  ok: boolean;
  error?: string;
  gc_os_id: string;
  gc_os_codigo: string;
  cliente: string;
  data_saida: string | null;
  situacao: string;
  executada: boolean;
  tecnico_original: string | null;
  valor_pecas: number;
  valor_servicos: number;
  comissao_pecas: number;
  comissao_servicos: number;
  comissao_total: number;
};

const brl = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function RetornoOsAntigaDialog({
  month,
  onChanged,
}: {
  month: string;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tecRetorno, setTecRetorno] = useState("");
  const [obs, setObs] = useState("");

  const { data: tecnicos } = useQuery<Array<{ value: string; label: string }>>({
    queryKey: ["tecnicos_distinct"],
    queryFn: async () => {
      const set = new Set<string>();
      const pageSize = 1000;
      for (let from = 0; from < 100000; from += pageSize) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select("tecnico")
          .not("tecnico", "is", null)
          .neq("tecnico", "")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        data.forEach((r: any) => { if (r.tecnico) set.add(r.tecnico); });
        if (data.length < pageSize) break;
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t }));
    },
    enabled: open,
  });

  const searchMut = useMutation({
    mutationFn: async () => {
      const cod = codigo.trim();
      if (!cod) throw new Error("Informe o número da OS.");
      const { data, error } = await supabase.functions.invoke("os-retorno-preview", {
        body: { gc_os_codigo: cod },
      });
      if (error) throw error;
      const p = data as Preview;
      if (!p.ok) throw new Error(p.error || "Falha ao buscar OS");
      return p;
    },
    onSuccess: (p) => setPreview(p),
    onError: (e: Error) => {
      setPreview(null);
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Busque a OS antes.");
      if (!tecRetorno.trim()) throw new Error("Selecione o técnico do retorno.");
      if (!preview.tecnico_original) throw new Error("OS sem vendedor original — não é possível aplicar desconto.");
      const { error } = await supabase.from("os_retornos").upsert(
        {
          gc_os_codigo: preview.gc_os_codigo,
          tecnico_retorno: tecRetorno.trim(),
          observacao: obs.trim() || null,
          mes_desconto: month,
          tecnico_original: preview.tecnico_original,
          valor_desconto: preview.comissao_total,
          data_saida_original: preview.data_saida,
          cliente_original: preview.cliente,
        },
        { onConflict: "gc_os_codigo" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Retorno lançado",
        description: `Desconto de ${brl(preview!.comissao_total)} será aplicado a ${preview!.tecnico_original} em ${month}.`,
      });
      setOpen(false);
      setCodigo(""); setPreview(null); setTecRetorno(""); setObs("");
      qc.invalidateQueries({ queryKey: ["os_retornos"] });
      onChanged?.();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" /> Retorno OS antiga
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPreview(null); setCodigo(""); setTecRetorno(""); setObs(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" /> Lançar retorno em OS de mês anterior
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Busque a OS pelo número (qualquer mês). O valor da comissão original será descontado do
              técnico vendedor (<strong>{preview?.tecnico_original || "—"}</strong>) na premiação de <strong>{month}</strong>.
            </p>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">Nº OS (GestãoClick)</label>
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="Ex: 8752"
                  onKeyDown={(e) => { if (e.key === "Enter") searchMut.mutate(); }}
                />
              </div>
              <Button onClick={() => searchMut.mutate()} disabled={searchMut.isPending || !codigo.trim()}>
                {searchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
            </div>

            {preview && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Cliente</div>
                      <div className="font-medium">{preview.cliente || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Data de saída</div>
                      <div className="font-medium">{preview.data_saida ? preview.data_saida.split("-").reverse().join("/") : "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Situação</div>
                      <div className="font-medium text-xs">{preview.situacao || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Vendedor original</div>
                      <div className="font-medium">{preview.tecnico_original || "—"}</div>
                    </div>
                  </div>
                  <div className="border-t pt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Peças</div>
                      <div>{brl(preview.valor_pecas)}</div>
                      <div className="text-[10px] text-muted-foreground">comissão {brl(preview.comissao_pecas)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Serviços</div>
                      <div>{brl(preview.valor_servicos)}</div>
                      <div className="text-[10px] text-muted-foreground">comissão {brl(preview.comissao_servicos)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Desconto a aplicar</div>
                      <div className="font-semibold text-destructive">−{brl(preview.comissao_total)}</div>
                    </div>
                  </div>
                  {!preview.executada && (
                    <div className="text-xs text-amber-600">⚠ Esta OS não está com situação "Executado" — confirme antes de lançar.</div>
                  )}
                  {!preview.tecnico_original && (
                    <div className="text-xs text-destructive">⚠ OS sem vendedor original definido. Não é possível aplicar o desconto.</div>
                  )}

                  <div className="border-t pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Técnico do retorno (foi atender)</label>
                      <SearchableSelect
                        options={tecnicos || []}
                        value={tecRetorno}
                        onValueChange={setTecRetorno}
                        placeholder="Selecionar técnico…"
                        searchPlaceholder="Buscar técnico…"
                        emptyText="Nenhum técnico encontrado."
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Observação</label>
                      <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo do retorno…" />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button
                      onClick={() => saveMut.mutate()}
                      disabled={saveMut.isPending || !tecRetorno || !preview.tecnico_original}
                    >
                      {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Lançar desconto em {month}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}