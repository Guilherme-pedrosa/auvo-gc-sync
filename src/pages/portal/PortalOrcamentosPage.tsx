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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, LogOut, CheckCircle2, MessageSquare, FileText, Clock, ExternalLink, Package, Wrench } from "lucide-react";

interface OrcamentoItem {
  gc_orcamento_id: string;
  gc_orcamento_codigo: string;
  cliente: string;
  vendedor: string;
  valor_total: number;
  data: string;
  situacao: string;
  cor_situacao?: string;
  equipamento?: string;
  gc_orc_link?: string;
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

const parseData = (s: string): number => {
  if (!s) return 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10)).getTime();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime();
  return new Date(s).getTime() || 0;
};

type SortKey = "recente" | "antigo" | "caro" | "barato" | "codigo";

export default function PortalOrcamentosPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [casaFilter, setCasaFilter] = useState<string>("all");
  const [equipFilter, setEquipFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recente");
  const [selected, setSelected] = useState<OrcamentoItem | null>(null);
  const [mode, setMode] = useState<"view" | "approve" | "observation">("view");
  const [termo, setTermo] = useState(false);
  const [obs, setObs] = useState("");

  const detailQuery = useQuery({
    queryKey: ["portal-orcamento-detail", selected?.gc_orcamento_id],
    enabled: !!selected?.gc_orcamento_id,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60, // 1h em memória
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

  const allCasas = useMemo(() => {
    const set = new Set<string>();
    (data || []).forEach((i) => i.cliente && set.add(i.cliente));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const allEquipamentos = useMemo(() => {
    const set = new Set<string>();
    (data || []).forEach((i) => i.equipamento && set.add(i.equipamento));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data]);

  const itens = useMemo(() => {
    const list = data || [];
    const q = search.trim().toLowerCase();
    let out = list.filter((i) => {
      if (casaFilter !== "all" && i.cliente !== casaFilter) return false;
      if (equipFilter !== "all" && (i.equipamento || "") !== equipFilter) return false;
      if (!q) return true;
      return (
        i.gc_orcamento_codigo.toLowerCase().includes(q) ||
        i.cliente.toLowerCase().includes(q) ||
        (i.vendedor || "").toLowerCase().includes(q) ||
        (i.equipamento || "").toLowerCase().includes(q)
      );
    });
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "caro":
          return Number(b.valor_total || 0) - Number(a.valor_total || 0);
        case "barato":
          return Number(a.valor_total || 0) - Number(b.valor_total || 0);
        case "antigo":
          return parseData(a.data) - parseData(b.data);
        case "codigo":
          return String(a.gc_orcamento_codigo).localeCompare(String(b.gc_orcamento_codigo), "pt-BR", { numeric: true });
        case "recente":
        default:
          return parseData(b.data) - parseData(a.data);
      }
    });
    return out;
  }, [data, search, casaFilter, equipFilter, sortKey]);

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
        <Card className="p-3 space-y-3">
          <Input
            placeholder="Buscar por código, casa, vendedor ou equipamento…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Casa</label>
              <Select value={casaFilter} onValueChange={setCasaFilter}>
                <SelectTrigger><SelectValue placeholder="Todas as casas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as casas</SelectItem>
                  {allCasas.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Equipamento</label>
              <Select value={equipFilter} onValueChange={setEquipFilter}>
                <SelectTrigger><SelectValue placeholder="Todos os equipamentos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os equipamentos</SelectItem>
                  {allEquipamentos.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ordenar por</label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recente">Mais recente</SelectItem>
                  <SelectItem value="antigo">Mais antigo</SelectItem>
                  <SelectItem value="caro">Mais caro</SelectItem>
                  <SelectItem value="barato">Mais barato</SelectItem>
                  <SelectItem value="codigo">Código</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{itens.length} orçamento(s)</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>
        </Card>

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
                    {o.equipamento && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Wrench className="h-3 w-3" /> {o.equipamento}
                      </p>
                    )}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
                    <div><span className="text-muted-foreground">Equipamento:</span> {selected.equipamento || "—"}</div>
                    <div><span className="text-muted-foreground">Valor total:</span> <strong>{brl(selected.valor_total)}</strong></div>
                    {selected.gc_orc_link && (
                      <a
                        href={selected.gc_orc_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 pt-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir orçamento no GestãoClick
                      </a>
                    )}
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
                        const mapItem = (it: any, tipo: "Produto" | "Serviço") => {
                          const qtd = Number(it.quantidade || 0);
                          const valor = Number(it.valor_venda ?? it.valor ?? 0);
                          const desconto = Number(it.desconto || 0);
                          const tipoDesc = String(it.tipo_desconto || "$");
                          const totalApi = it.valor_total != null ? Number(it.valor_total) : null;
                          const descontoValor =
                            tipoDesc === "%" ? (qtd * valor) * (desconto / 100) : desconto;
                          const total =
                            totalApi != null ? totalApi : Math.max(qtd * valor - descontoValor, 0);
                          return {
                            nome: it.nome_produto || it.nome_servico || it.nome || tipo,
                            detalhes: it.detalhes || "",
                            qtd, valor, desconto, tipoDesc, descontoValor, total, tipo,
                          };
                        };
                        const itens = [
                          ...produtos.map((p: any) => mapItem(p, "Produto")),
                          ...servicos.map((s: any) => mapItem(s, "Serviço")),
                        ];
                        const subtotal = itens.reduce((s, i) => s + i.qtd * i.valor, 0);
                        const descontoItens = itens.reduce((s, i) => s + i.descontoValor, 0);
                        const descontoOrcRaw = Number(orc?.desconto || 0);
                        const tipoDescOrc = String(orc?.tipo_desconto || "$");
                        const descontoOrc =
                          tipoDescOrc === "%" ? (subtotal - descontoItens) * (descontoOrcRaw / 100) : descontoOrcRaw;
                        const totalCalc = itens.reduce((s, i) => s + i.total, 0) - descontoOrc;
                        const totalOrc = Number(orc?.valor_total ?? totalCalc);
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
                                    <p>{brl(it.valor)} <span className="text-xs text-muted-foreground">un.</span></p>
                                    {it.desconto > 0 && (
                                      <p className="text-xs text-destructive">
                                        - {it.tipoDesc === "%" ? `${it.desconto}%` : brl(it.desconto)} desc.
                                      </p>
                                    )}
                                    <p className="text-xs font-semibold">
                                      Total {brl(it.total)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-md border p-2 text-sm space-y-1 bg-muted/30">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>{brl(subtotal)}</span>
                              </div>
                              {(descontoItens + descontoOrc) > 0 && (
                                <div className="flex justify-between text-destructive">
                                  <span>Descontos</span>
                                  <span>- {brl(descontoItens + descontoOrc)}</span>
                                </div>
                              )}
                              <div className="flex justify-between font-semibold text-base pt-1 border-t">
                                <span>Total do orçamento</span>
                                <span>{brl(totalOrc)}</span>
                              </div>
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