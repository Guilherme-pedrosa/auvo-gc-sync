import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, LogOut, CheckCircle2, MessageSquare, FileText, Clock, ExternalLink, Package } from "lucide-react";

interface OrcamentoItem {
  gc_orcamento_id: string;
  gc_orcamento_codigo: string;
  cliente: string;
  vendedor: string;
  valor_total: number;
  data: string;
  situacao: string;
  cor_situacao?: string;
}

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (s: string) => {
  if (!s) return "—";
  // formatos do GC: yyyy-mm-dd ou dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

export default function PortalOrcamentosPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OrcamentoItem | null>(null);
  const [mode, setMode] = useState<"view" | "approve" | "observation">("view");
  const [termo, setTermo] = useState(false);
  const [obs, setObs] = useState("");

  const detailQuery = useQuery({
    queryKey: ["portal-orcamento-detail", selected?.gc_orcamento_id],
    enabled: !!selected?.gc_orcamento_id,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("portal-orcamentos", {
        body: { action: "detail", gc_orcamento_id: selected!.gc_orcamento_id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao carregar detalhes");
      return data as { orcamento: any; tarefas: any[] };
    },
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["portal-orcamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("portal-orcamentos", {
        body: { action: "list" },
      });
      if (error) throw error;
      return (data?.itens || []) as OrcamentoItem[];
    },
    enabled: !!user && role === "cliente",
  });

  const itens = useMemo(() => {
    const list = data || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (i) =>
        i.gc_orcamento_codigo.toLowerCase().includes(q) ||
        i.cliente.toLowerCase().includes(q) ||
        (i.vendedor || "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const mutation = useMutation({
    mutationFn: async (payload: {
      action: "approve" | "observation";
      gc_orcamento_id: string;
      gc_orcamento_codigo: string;
      observacao?: string;
      termo_aceito?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("portal-orcamentos", {
        body: payload,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao processar");
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.action === "approve"
          ? "Orçamento aprovado com sucesso!"
          : "Observação enviada com sucesso!",
      );
      setSelected(null);
      setTermo(false);
      setObs("");
      setMode("view");
      qc.invalidateQueries({ queryKey: ["portal-orcamentos"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Orçamentos para Aprovação
            </h1>
            <p className="text-sm text-muted-foreground">
              Olá, {profile?.nome || profile?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/horas")}>
              Horas trabalhadas
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar por código, cliente ou vendedor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {itens.length} orçamento(s)
          </span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : itens.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
            Nenhum orçamento aguardando sua aprovação no momento.
          </Card>
        ) : (
          <div className="grid gap-3">
            {itens.map((o) => (
              <Card
                key={o.gc_orcamento_id}
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => {
                  setSelected(o);
                  setMode("view");
                  setTermo(false);
                  setObs("");
                }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-primary">#{o.gc_orcamento_codigo}</span>
                      <Badge variant="outline" className="border-amber-500 text-amber-600">
                        Aguardando Aprovação
                      </Badge>
                    </div>
                    <p className="text-sm font-medium">{o.cliente}</p>
                    <p className="text-xs text-muted-foreground">
                      Vendedor: {o.vendedor || "—"} · Data: {fmtData(o.data)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{brl(o.valor_total)}</p>
                    <Button size="sm" className="mt-1">
                      Revisar
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Orçamento #{selected.gc_orcamento_codigo}</DialogTitle>
                <DialogDescription>
                  {selected.cliente} · {brl(selected.valor_total)}
                </DialogDescription>
              </DialogHeader>

              {mode === "view" && (
                <div className="space-y-3">
                  <div className="rounded-md border p-3 text-sm space-y-1">
                    <div><span className="text-muted-foreground">Vendedor:</span> {selected.vendedor || "—"}</div>
                    <div><span className="text-muted-foreground">Data:</span> {fmtData(selected.data)}</div>
                    <div><span className="text-muted-foreground">Valor total:</span> <strong>{brl(selected.valor_total)}</strong></div>
                  </div>

                  {detailQuery.isLoading && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}

                  {detailQuery.data && (
                    <>
                      {(() => {
                        const orc = detailQuery.data.orcamento;
                        const produtos = Array.isArray(orc?.produtos) ? orc.produtos.map((p: any) => p.produto || p) : [];
                        const servicos = Array.isArray(orc?.servicos) ? orc.servicos.map((s: any) => s.servico || s) : [];
                        const itens = [
                          ...produtos.map((p: any) => ({
                            nome: p.nome_produto || p.nome || "Produto",
                            detalhes: p.detalhes || "",
                            qtd: Number(p.quantidade || 0),
                            valor: Number(p.valor_venda || 0),
                            tipo: "Produto",
                          })),
                          ...servicos.map((s: any) => ({
                            nome: s.nome_servico || s.nome || "Serviço",
                            detalhes: s.detalhes || "",
                            qtd: Number(s.quantidade || 0),
                            valor: Number(s.valor_venda || 0),
                            tipo: "Serviço",
                          })),
                        ];
                        return itens.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                              <Package className="h-3.5 w-3.5" /> Itens do orçamento
                            </p>
                            <div className="rounded-md border divide-y max-h-60 overflow-auto">
                              {itens.map((it, i) => (
                                <div key={i} className="p-2 text-sm flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{it.nome}</p>
                                    {it.detalhes && (
                                      <p className="text-xs text-muted-foreground line-clamp-2">{it.detalhes}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {it.tipo} · Qtd: {it.qtd}
                                    </p>
                                  </div>
                                  <div className="text-right text-sm whitespace-nowrap">
                                    <p>{brl(it.valor)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Total {brl(it.qtd * it.valor)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Sem itens cadastrados no orçamento.</p>
                        );
                      })()}

                      {detailQuery.data.orcamento?.observacao && (
                        <div className="rounded-md border p-2 text-xs">
                          <p className="font-semibold mb-1">Observações:</p>
                          <p className="whitespace-pre-wrap text-muted-foreground">
                            {detailQuery.data.orcamento.observacao}
                          </p>
                        </div>
                      )}

                      {(() => {
                        const tarefas = (detailQuery.data.tarefas || []).filter(
                          (t: any) => t.auvo_task_url || t.auvo_link || t.auvo_survey_url,
                        );
                        if (tarefas.length === 0) return null;
                        return (
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-muted-foreground">Tarefas relacionadas</p>
                            {tarefas.map((t: any, i: number) => {
                              const url = t.auvo_task_url || t.auvo_link || t.auvo_survey_url;
                              return (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Tarefa #{t.auvo_task_id} {t.status_auvo ? `· ${t.status_auvo}` : ""}
                                </a>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Após a aprovação a situação do orçamento será alterada para
                    <strong> APROVADO CLIENTE - VIA LINK</strong>. Toda ação é registrada com
                    data/hora, usuário e IP.
                  </p>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setMode("observation")}>
                      <MessageSquare className="h-4 w-4 mr-1" /> Enviar observação
                    </Button>
                    <Button onClick={() => setMode("approve")}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {mode === "approve" && (
                <div className="space-y-3">
                  <div className="rounded-md border p-3 text-sm bg-muted/40 max-h-56 overflow-auto">
                    <p className="font-semibold mb-2">Termo de Aprovação</p>
                    <p>
                      Declaro, na qualidade de representante do cliente
                      <strong> {selected.cliente}</strong>, que li, revisei e aprovo
                      integralmente o orçamento <strong>#{selected.gc_orcamento_codigo}</strong> no
                      valor de <strong>{brl(selected.valor_total)}</strong>, autorizando a empresa
                      a executar os serviços e itens nele descritos. Esta aprovação é
                      registrada eletronicamente, com data, hora, identificação do usuário e
                      endereço de IP, para todos os fins legais.
                    </p>
                  </div>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={termo}
                      onCheckedChange={(v) => setTermo(Boolean(v))}
                      className="mt-0.5"
                    />
                    <span>Li e concordo com o Termo de Aprovação acima.</span>
                  </label>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setMode("view")}>
                      Voltar
                    </Button>
                    <Button
                      disabled={!termo || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          action: "approve",
                          gc_orcamento_id: selected.gc_orcamento_id,
                          gc_orcamento_codigo: selected.gc_orcamento_codigo,
                          termo_aceito: true,
                        })
                      }
                    >
                      {mutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                      )}
                      Confirmar aprovação
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {mode === "observation" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Descreva o ajuste necessário. A situação do orçamento será alterada para
                    <strong> Ag Informações / Correções</strong>.
                  </p>
                  <Textarea
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder="Sua observação para o vendedor…"
                    rows={5}
                  />
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setMode("view")}>
                      Voltar
                    </Button>
                    <Button
                      disabled={!obs.trim() || mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          action: "observation",
                          gc_orcamento_id: selected.gc_orcamento_id,
                          gc_orcamento_codigo: selected.gc_orcamento_codigo,
                          observacao: obs.trim(),
                        })
                      }
                    >
                      {mutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <MessageSquare className="h-4 w-4 mr-1" />
                      )}
                      Enviar observação
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}