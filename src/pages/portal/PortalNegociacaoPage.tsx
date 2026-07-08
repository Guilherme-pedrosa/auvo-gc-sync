import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, LogOut, ExternalLink, HandshakeIcon, DollarSign, AlertTriangle,
  ListChecks, Wallet, FileText, CalendarCheck, Clock, Building2,
} from "lucide-react";

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (s: string) => {
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

interface OSItem {
  gc_os_id: string;
  codigo: string;
  cliente: string;
  situacao: string;
  cor_situacao?: string;
  data: string;
  valor_total: number;
  descricao: string;
  vendedor: string;
  link: string;
}

interface RecebItem {
  gc_recebimento_id: string;
  codigo: string;
  descricao: string;
  cliente: string;
  valor: number;
  valor_pago: number;
  valor_pendente: number;
  data_vencimento: string;
  liquidado: string;
  atrasado: boolean;
  os_codigo: string;
  forma_pagamento: string;
  parcela: string;
}

interface Totals {
  qtd_os: number;
  valor_os: number;
  qtd_recebimentos: number;
  valor_recebimentos: number;
  valor_atrasado: number;
  qtd_atrasado: number;
}

export default function PortalNegociacaoPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"os" | "financeiro">("os");

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["portal-negociacao"],
    enabled: !!user && role === "cliente",
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("portal-negociacao-fetch", {
        body: {},
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error || "Falha ao carregar");
      return data as { os_list: OSItem[]; recebimentos: RecebItem[]; totals: Totals };
    },
  });

  const totals = data?.totals;

  const filteredOs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.os_list || [];
    if (!q) return list;
    return list.filter((o) =>
      o.codigo.toLowerCase().includes(q) ||
      o.cliente.toLowerCase().includes(q) ||
      o.descricao.toLowerCase().includes(q) ||
      o.situacao.toLowerCase().includes(q),
    );
  }, [data, search]);

  const filteredRec = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.recebimentos || [];
    if (!q) return list;
    return list.filter((r) =>
      r.codigo.toLowerCase().includes(q) ||
      r.cliente.toLowerCase().includes(q) ||
      r.descricao.toLowerCase().includes(q) ||
      r.os_codigo.toLowerCase().includes(q),
    );
  }, [data, search]);

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
              <HandshakeIcon className="h-5 w-5 text-primary" />
              Negociação Financeira
            </h1>
            <p className="text-sm text-muted-foreground">
              Olá, {profile?.nome || profile?.email}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/horas")}>
              <Clock className="h-4 w-4 mr-1" /> Horas
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/orcamentos")}>
              <FileText className="h-4 w-4 mr-1" /> Orçamentos
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/portal/planos-preventivos")}>
              <CalendarCheck className="h-4 w-4 mr-1" /> Preventivas
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ListChecks className="h-4 w-4" /> OS ag. negociação
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_os ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_os ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-sky-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-4 w-4" /> Títulos pendentes
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_recebimentos ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_recebimentos ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-red-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> Em atraso
            </div>
            <p className="text-2xl font-semibold mt-1">{totals?.qtd_atrasado ?? 0}</p>
            <p className="text-xs text-muted-foreground">{brl(totals?.valor_atrasado ?? 0)}</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-4 w-4" /> Total geral pendente
            </div>
            <p className="text-2xl font-semibold mt-1">
              {brl((totals?.valor_os ?? 0) + (totals?.valor_recebimentos ?? 0))}
            </p>
            <p className="text-xs text-muted-foreground">OS + títulos</p>
          </Card>
        </div>

        <Card className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar por código, casa, descrição ou OS…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "os" | "financeiro")}>
            <TabsList>
              <TabsTrigger value="os">
                OS Ag. Negociação ({filteredOs.length})
              </TabsTrigger>
              <TabsTrigger value="financeiro">
                Financeiro Pendente ({filteredRec.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="os" className="mt-3">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredOs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhuma OS aguardando negociação encontrada.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredOs.map((o) => (
                    <div
                      key={o.gc_os_id}
                      className="border rounded-md p-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">OS #{o.codigo}</span>
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              style={o.cor_situacao ? { borderColor: o.cor_situacao, color: o.cor_situacao } : {}}
                            >
                              {o.situacao}
                            </Badge>
                          </div>
                          <p className="text-sm mt-1 flex items-center gap-1 text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {o.cliente}
                          </p>
                          {o.descricao && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{o.descricao}</p>
                          )}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                            <span>Abertura: {fmtData(o.data)}</span>
                            {o.vendedor && <span>Vendedor: {o.vendedor}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-primary whitespace-nowrap">
                            {brl(o.valor_total)}
                          </p>
                          <a
                            href={o.link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            Ver no GC <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="financeiro" className="mt-3">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredRec.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhum título pendente encontrado.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRec.map((r) => (
                    <div
                      key={r.gc_recebimento_id}
                      className={`border rounded-md p-3 hover:bg-muted/40 transition-colors ${
                        r.atrasado ? "border-red-300 bg-red-50/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              Título #{r.codigo || r.gc_recebimento_id}
                            </span>
                            {r.atrasado ? (
                              <Badge variant="destructive" className="text-[10px]">EM ATRASO</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">EM ABERTO</Badge>
                            )}
                            {r.parcela && (
                              <Badge variant="outline" className="text-[10px]">Parc. {r.parcela}</Badge>
                            )}
                            {r.os_codigo && (
                              <Badge variant="outline" className="text-[10px]">OS {r.os_codigo}</Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1 flex items-center gap-1 text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {r.cliente}
                          </p>
                          {r.descricao && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.descricao}</p>
                          )}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                            <span>Vencimento: {fmtData(r.data_vencimento)}</span>
                            {r.forma_pagamento && <span>{r.forma_pagamento}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-semibold whitespace-nowrap ${r.atrasado ? "text-red-600" : "text-primary"}`}>
                            {brl(r.valor_pendente)}
                          </p>
                          {r.valor_pago > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              Pago: {brl(r.valor_pago)} / {brl(r.valor)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </main>
    </div>
  );
}