import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trophy, Wrench, Package, Calculator, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ItemRow = {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  deslocamento?: boolean;
};
type OsRow = {
  gc_os_id: string;
  gc_os_codigo: string;
  cliente: string;
  data_saida: string;
  valor_pecas: number;
  valor_servicos: number;
  comissao_pecas: number;
  comissao_servicos: number;
  comissao_total: number;
  pecas_count: number;
  servicos_count: number;
  situacao?: string;
  cor_situacao?: string;
  gc_link?: string;
  itens_pecas?: ItemRow[];
  itens_servicos?: ItemRow[];
  contrato?: { nome: string; valor_hora: number; taxa: number; horas: number; base_servico: number } | null;
};
type Tech = {
  tecnico: string;
  tecnico_id: string;
  os_count: number;
  valor_pecas: number;
  valor_servicos: number;
  comissao_pecas: number;
  comissao_servicos: number;
  comissao_total: number;
  ordens: OsRow[];
};
type Resp = {
  ok: boolean;
  error?: string;
  month: string;
  os_total: number;
  os_detalhadas: number;
  tecnicos: Tech[];
  totais: {
    os_count: number;
    valor_pecas: number;
    valor_servicos: number;
    comissao_pecas: number;
    comissao_servicos: number;
    comissao_total: number;
  };
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function PremiacaoPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [activeMonth, setActiveMonth] = useState<string>(currentMonth());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedOs, setSelectedOs] = useState<OsRow | null>(null);

  const { data, isFetching, refetch, error } = useQuery<Resp>({
    queryKey: ["premiacao", activeMonth],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("premiacao", {
        body: { month: activeMonth },
      });
      if (error) throw error;
      return data as Resp;
    },
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const handleCalc = () => {
    setActiveMonth(month);
    setTimeout(() => refetch(), 0);
  };

  const tecnicos = data?.tecnicos || [];
  const totais = data?.totais;

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Trophy className="h-6 w-6 text-primary" /> Premiação Técnicos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              1% sobre peças trocadas + 15% sobre serviços executados (exceto deslocamento).
              Base: OS do GestãoClick com <strong>data de saída</strong> no mês selecionado.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Mês de referência</label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={handleCalc} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Calcular
            </Button>
          </div>
        </div>

        {error && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Erro: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {data && !data.ok && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Erro: {data.error}
            </CardContent>
          </Card>
        )}

        {totais && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="OS no mês" value={String(totais.os_count)} icon={<Wrench className="h-4 w-4" />} />
            <KpiCard label="Valor peças" value={brl(totais.valor_pecas)} icon={<Package className="h-4 w-4" />} />
            <KpiCard label="Valor serviços" value={brl(totais.valor_servicos)} icon={<Wrench className="h-4 w-4" />} />
            <KpiCard label="Comissão peças (1%)" value={brl(totais.comissao_pecas)} />
            <KpiCard label="Comissão total" value={brl(totais.comissao_total)} highlight />
          </div>
        )}

        {isFetching && !data && (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Buscando OS e calculando comissões…
          </div>
        )}

        {data?.ok && tecnicos.length === 0 && !isFetching && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              Nenhuma OS encontrada com data de saída em {activeMonth}.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {tecnicos.map((t) => {
            const key = t.tecnico_id || t.tecnico;
            const isOpen = expanded.has(key);
            return (
              <Card key={key}>
                <CardHeader className="p-4 cursor-pointer" onClick={() => toggle(key)}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{t.tecnico}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t.os_count} OS · Peças {brl(t.valor_pecas)} · Serviços {brl(t.valor_servicos)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs text-muted-foreground">Comissão</div>
                      <div className="text-xl font-semibold text-primary">{brl(t.comissao_total)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {brl(t.comissao_pecas)} peças + {brl(t.comissao_servicos)} serv.
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="p-0 border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>OS</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Saída</TableHead>
                          <TableHead className="text-right">Peças</TableHead>
                          <TableHead className="text-right">Serviços</TableHead>
                          <TableHead className="text-right">Com. peças</TableHead>
                          <TableHead className="text-right">Com. serv.</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {t.ordens.map((o) => (
                          <TableRow
                            key={o.gc_os_id}
                            className="cursor-pointer"
                            onClick={() => setSelectedOs(o)}
                          >
                            <TableCell className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                              {o.gc_os_codigo || o.gc_os_id}
                            </TableCell>
                            <TableCell className="text-sm truncate max-w-[220px]">
                              <div className="flex items-center gap-2">
                                <span className="truncate">{o.cliente}</span>
                                {o.contrato && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0">Contrato</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{o.data_saida}</TableCell>
                            <TableCell className="text-right text-sm">{brl(o.valor_pecas)}</TableCell>
                            <TableCell className="text-right text-sm">{brl(o.valor_servicos)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{brl(o.comissao_pecas)}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{brl(o.comissao_servicos)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold">{brl(o.comissao_total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        <OsDetailDialog os={selectedOs} onClose={() => setSelectedOs(null)} />
      </div>
    </div>
  );
}

function OsDetailDialog({ os, onClose }: { os: OsRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!os} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {os && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 flex-wrap">
                <span>OS #{os.gc_os_codigo || os.gc_os_id}</span>
                {os.situacao && (
                  <Badge
                    variant="outline"
                    style={os.cor_situacao ? { borderColor: os.cor_situacao, color: os.cor_situacao } : undefined}
                  >
                    {os.situacao}
                  </Badge>
                )}
                {os.gc_link && (
                  <a
                    href={os.gc_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Abrir no GC <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {os.cliente} · Saída {os.data_saida}
              </p>
            </DialogHeader>

            <div className="space-y-5 mt-2">
              <ItemSection
                title="Peças"
                icon={<Package className="h-4 w-4" />}
                items={os.itens_pecas || []}
                totalLabel="Total peças"
                total={os.valor_pecas}
                commissionLabel="Comissão (1%)"
                commission={os.comissao_pecas}
                emptyMsg="Sem peças nesta OS"
              />
              <ItemSection
                title="Serviços"
                icon={<Wrench className="h-4 w-4" />}
                items={os.itens_servicos || []}
                totalLabel="Total serviços (sem deslocamento)"
                total={os.valor_servicos}
                commissionLabel="Comissão (15%)"
                commission={os.comissao_servicos}
                emptyMsg="Sem serviços nesta OS"
                highlightDeslocamento
              />

              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-sm font-medium">Comissão total da OS</span>
                <span className="text-lg font-semibold text-primary">{brl(os.comissao_total)}</span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemSection({
  title, icon, items, totalLabel, total, commissionLabel, commission, emptyMsg, highlightDeslocamento,
}: {
  title: string; icon: React.ReactNode; items: ItemRow[];
  totalLabel: string; total: number;
  commissionLabel: string; commission: number;
  emptyMsg: string; highlightDeslocamento?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm font-medium">
        {icon} {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic p-3 border rounded">{emptyMsg}</div>
      ) : (
        <div className="border rounded overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right w-20">Qtd</TableHead>
                <TableHead className="text-right w-28">Unitário</TableHead>
                <TableHead className="text-right w-28">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={i} className={cn(highlightDeslocamento && it.deslocamento && "opacity-60")}>
                  <TableCell className="text-sm">
                    {it.descricao}
                    {highlightDeslocamento && it.deslocamento && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">não comissionado</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">{it.quantidade}</TableCell>
                  <TableCell className="text-right text-xs">{brl(it.valor_unitario)}</TableCell>
                  <TableCell className="text-right text-sm">{brl(it.valor_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        <span>{totalLabel}: <strong className="text-foreground">{brl(total)}</strong></span>
        <span>{commissionLabel}: <strong className="text-primary">{brl(commission)}</strong></span>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, highlight }: { label: string; value: string; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className={cn(highlight && "border-primary/50 bg-primary/5")}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div className={cn("text-lg font-semibold mt-1", highlight && "text-primary")}>{value}</div>
      </CardContent>
    </Card>
  );
}