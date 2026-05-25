import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trophy, Wrench, Package, Calculator, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
              2% sobre peças trocadas + 15% sobre serviços executados (exceto deslocamento).
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
            <KpiCard label="Comissão peças (2%)" value={brl(totais.comissao_pecas)} />
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
                          <TableRow key={o.gc_os_id}>
                            <TableCell className="font-mono text-xs">{o.gc_os_codigo || o.gc_os_id}</TableCell>
                            <TableCell className="text-sm truncate max-w-[220px]">{o.cliente}</TableCell>
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