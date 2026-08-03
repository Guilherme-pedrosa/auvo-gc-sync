import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export type Vinculo = {
  id: string;
  auvo_user_id: string;
  auvo_user_nome: string | null;
  gc_vendedor_id: string | null;
  gc_vendedor_nome: string | null;
  ativo: boolean | null;
};

export function useVinculosAuvoGc() {
  return useQuery({
    queryKey: ["auvo-gc-mapeamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("auvo_gc_usuario_map").select("*").order("auvo_user_nome");
      if (error) throw error;
      return (data || []) as Vinculo[];
    },
  });
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  colaboradorId: string;
  colaboradorNome: string;
  auvoUserId?: string | null;
  vinculo?: Vinculo | null;
};

export function VinculoAuvoGcDialog({ open, onOpenChange, colaboradorId, colaboradorNome, auvoUserId, vinculo }: Props) {
  const qc = useQueryClient();
  const [auvoId, setAuvoId] = useState("");
  const [gcId, setGcId] = useState("");

  useEffect(() => {
    if (open) {
      setAuvoId(vinculo?.auvo_user_id || auvoUserId || "");
      setGcId(vinculo?.gc_vendedor_id || "");
    }
  }, [open, vinculo, auvoUserId]);

  const { data: auvoUsers, isLoading: loadingAuvo } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", { body: { action: "list_auvo_users" } });
      if (error) throw error;
      return (data?.users || []) as Array<{ userID: number; name: string }>;
    },
    enabled: open,
  });

  const { data: gcFuncionarios, isLoading: loadingGc } = useQuery({
    queryKey: ["gc-vendedores"],
    queryFn: async () => {
      const todos: Array<{ id: string; nome: string }> = [];
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const { data, error } = await supabase.functions.invoke("gc-proxy", {
          body: { endpoint: "/api/funcionarios", method: "GET", params: { limite: "100", pagina: String(pagina) } },
        });
        if (error) throw error;
        const payload = data?.data;
        const lista: any[] = Array.isArray(payload?.data) ? payload.data : Array.isArray(data?.data) ? data.data : [];
        const meta = payload?.meta;
        todos.push(...lista.map((f: any) => ({ id: String(f.id || ""), nome: String(f.nome || f.name || "") })));
        totalPaginas = Number(meta?.total_paginas || 1);
        pagina += 1;
      } while (pagina <= totalPaginas);
      return todos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
    enabled: open,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!auvoId || !gcId) throw new Error("Selecione o técnico no Auvo e o funcionário no GC.");
      const auvoNome = auvoUsers?.find((u) => String(u.userID) === auvoId)?.name || vinculo?.auvo_user_nome || colaboradorNome;
      const gcNome = gcFuncionarios?.find((f) => f.id === gcId)?.nome || vinculo?.gc_vendedor_nome || "";
      const { error } = await supabase.from("auvo_gc_usuario_map").upsert(
        {
          auvo_user_id: auvoId,
          auvo_user_nome: auvoNome,
          gc_vendedor_id: gcId,
          gc_vendedor_nome: gcNome,
          ativo: true,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "auvo_user_id" },
      );
      if (error) throw error;
      const { error: err2 } = await supabase.from("rh_colaboradores").update({ auvo_user_id: auvoId }).eq("id", colaboradorId);
      if (err2) throw err2;
    },
    onSuccess: () => {
      toast.success("Vínculo salvo!");
      qc.invalidateQueries({ queryKey: ["auvo-gc-mapeamentos"] });
      qc.invalidateQueries({ queryKey: ["rh_colaboradores"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async () => {
      if (!vinculo?.id) return;
      const { error } = await supabase.from("auvo_gc_usuario_map").delete().eq("id", vinculo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vínculo removido");
      qc.invalidateQueries({ queryKey: ["auvo-gc-mapeamentos"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vínculo Auvo ↔ GC — {colaboradorNome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1 block">Técnico no Auvo</Label>
            {loadingAuvo ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando usuários do Auvo…</div>
            ) : (
              <SearchableSelect
                options={(auvoUsers || []).map((u) => ({ value: String(u.userID), label: u.name }))}
                value={auvoId}
                onValueChange={setAuvoId}
                placeholder="Selecionar técnico do Auvo…"
                searchPlaceholder="Buscar técnico…"
                emptyText="Nenhum usuário encontrado."
                className="w-full"
              />
            )}
          </div>
          <div>
            <Label className="mb-1 block">Funcionário / Vendedor no GestãoClick</Label>
            {loadingGc ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando funcionários do GC…</div>
            ) : (
              <SearchableSelect
                options={(gcFuncionarios || []).map((f) => ({ value: f.id, label: f.nome }))}
                value={gcId}
                onValueChange={setGcId}
                placeholder="Selecionar funcionário do GC…"
                searchPlaceholder="Buscar funcionário…"
                emptyText="Nenhum funcionário encontrado."
                className="w-full"
              />
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          {vinculo?.id && (
            <Button variant="ghost" className="text-destructive" onClick={() => remover.mutate()} disabled={remover.isPending}>
              Remover vínculo
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}