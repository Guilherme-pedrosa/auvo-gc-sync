import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, MessageSquarePlus, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface ObservacaoRow {
  id: string;
  gc_os_id: string | null;
  gc_os_codigo: string | null;
  cliente: string | null;
  texto: string;
  autor_nome: string | null;
  sincronizado_gc: boolean;
  erro_gc: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Linha do Controle OS (item da tabela) */
  item: any | null;
  /** Cliente para carregar o histórico completo */
  cliente: string;
  onSaved?: () => void;
}

export function ObservacoesOsDialog({ open, onOpenChange, item, cliente, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resyncId, setResyncId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [rows, setRows] = useState<ObservacaoRow[]>([]);
  const [escopo, setEscopo] = useState<"os" | "cliente">("os");

  const gcOsId = item?.gc_os_id ? String(item.gc_os_id) : null;
  const gcOsCodigo = item?.gc_os_codigo ? String(item.gc_os_codigo) : null;

  const carregar = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      let query = supabase
        .from("os_observacoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (cliente) query = query.eq("cliente", cliente);
      else if (gcOsId) query = query.eq("gc_os_id", gcOsId);

      const { data, error } = await query;
      if (error) throw error;
      setRows((data as unknown as ObservacaoRow[]) ?? []);
    } catch (err: any) {
      toast.error(`Falha ao carregar observações: ${err?.message ?? err}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [open, cliente, gcOsId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (open) { setTexto(""); setEscopo("os"); } }, [open]);

  const visiveis = escopo === "os" && gcOsId
    ? rows.filter((r) => String(r.gc_os_id ?? "") === gcOsId)
    : rows;

  const salvar = async () => {
    const limpo = texto.trim();
    if (limpo.length < 2) {
      toast.error("Escreva a observação antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("os-observacoes", {
        body: {
          action: "create",
          gc_os_id: gcOsId,
          gc_os_codigo: gcOsCodigo,
          auvo_task_id: item?.auvo_task_id ? String(item.auvo_task_id) : null,
          cliente: cliente || item?.gc_os_cliente || item?.cliente || null,
          texto: limpo,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao salvar observação");

      if (data.sincronizado_gc) {
        toast.success("Observação salva e enviada para a OBS interna do GC.");
      } else {
        toast.warning(`Observação salva, mas não foi para o GC: ${data.erro_gc ?? "erro desconhecido"}`);
      }
      setTexto("");
      await carregar();
      onSaved?.();
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const reenviar = async (id: string) => {
    setResyncId(id);
    try {
      const { data, error } = await supabase.functions.invoke("os-observacoes", {
        body: { action: "resync", id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.erro_gc || data?.error || "Falha ao reenviar");
      toast.success("Observação reenviada ao GC.");
      await carregar();
      onSaved?.();
    } catch (err: any) {
      toast.error(`Erro ao reenviar: ${err?.message ?? err}`);
    } finally {
      setResyncId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-4 w-4" />
            Observações {gcOsCodigo ? `— OS ${gcOsCodigo}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {cliente || "Sem cliente"} · a observação é gravada aqui e adicionada à{" "}
            <strong>OBS interna</strong> da OS no GestãoClick.
          </p>

          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva a observação desta OS…"
            rows={3}
            disabled={saving}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={salvar} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5 mr-1" />}
              Salvar e enviar ao GC
            </Button>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant={escopo === "os" ? "default" : "outline"}
              onClick={() => setEscopo("os")}
              disabled={!gcOsId}
            >
              Desta OS
            </Button>
            <Button
              size="sm"
              variant={escopo === "cliente" ? "default" : "outline"}
              onClick={() => setEscopo("cliente")}
            >
              Do cliente
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {visiveis.length} registro{visiveis.length === 1 ? "" : "s"}
            </span>
          </div>

          <ScrollArea className="h-[280px] rounded-md border p-2">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : visiveis.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                Nenhuma observação registrada ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {visiveis.map((obs) => (
                  <div key={obs.id} className="rounded-md border bg-muted/30 p-2">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{obs.autor_nome || "Sistema"}</span>
                      <span>
                        {(() => {
                          try {
                            return format(new Date(obs.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
                          } catch { return obs.created_at; }
                        })()}
                      </span>
                      {obs.gc_os_codigo && (
                        <Badge variant="outline" className="text-[9px]">OS {obs.gc_os_codigo}</Badge>
                      )}
                      {obs.sincronizado_gc ? (
                        <Badge variant="outline" className="text-[9px] text-emerald-700 border-emerald-300">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" /> No GC
                        </Badge>
                      ) : (
                        <>
                          <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-0.5" /> Fora do GC
                          </Badge>
                          {obs.gc_os_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px]"
                              disabled={resyncId === obs.id}
                              onClick={() => reenviar(obs.id)}
                            >
                              {resyncId === obs.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <><RefreshCw className="h-3 w-3 mr-0.5" /> Reenviar</>}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap mt-1">{obs.texto}</p>
                    {!obs.sincronizado_gc && obs.erro_gc && (
                      <p className="text-[10px] text-amber-700 mt-1">Motivo: {obs.erro_gc}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
