import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink, RefreshCw, Download } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  equipamento: {
    nome: string;
    cliente: string | null;
    identificador: string | null;
    auvo_equipment_id: string | null;
    auvo_task_id?: string | null;
  };
};

const brl = (v: number) =>
  (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (d: string | null) => {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : d;
};

export default function EquipamentoPecasDialog({ open, onOpenChange, equipamento }: Props) {
  const [busca, setBusca] = useState("");

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: [
      "equipamento-pecas",
      equipamento.auvo_equipment_id,
      equipamento.identificador,
      equipamento.auvo_task_id ?? null,
    ],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("equipamento-pecas", {
        body: {
          auvo_equipment_id: equipamento.auvo_equipment_id,
          identificador: equipamento.identificador,
          auvo_task_id: equipamento.auvo_task_id ?? null,
          nome: equipamento.nome,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao varrer o GestãoClick");
      return data as any;
    },
  });

  const filtro = busca.trim().toLowerCase();
  const match = (...vals: (string | null | undefined)[]) =>
    !filtro || vals.some((v) => String(v || "").toLowerCase().includes(filtro));

  const consolidado = (data?.consolidado || []).filter((p: any) => match(p.descricao, p.codigo));
  const pecas = (data?.pecas || []).filter((p: any) =>
    match(p.descricao, p.codigo, p.documento_codigo, p.situacao)
  );
  const pecasOs = pecas.filter((p: any) => p.origem === "os");
  const pecasOrc = pecas.filter((p: any) => p.origem === "orcamento");

  const exportarCsv = () => {
    const linhas = [
      ["Código", "Peça", "Qtd orçada", "Valor orçado", "Qtd vendida", "Valor vendido", "Ocorrências", "Última"],
      ...consolidado.map((p: any) => [
        p.codigo || "", p.descricao, p.qtd_orcada, String(p.valor_orcado).replace(".", ","),
        p.qtd_vendida, String(p.valor_vendido).replace(".", ","), p.ocorrencias, fmtData(p.ultima_data),
      ]),
    ];
    const csv = "\uFEFF" + linhas.map((l) => l.map((c) => `"${String(c ?? "")}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pecas-${(equipamento.identificador || equipamento.nome || "equipamento").replace(/\W+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Peças do equipamento</DialogTitle>
          <DialogDescription>
            {equipamento.nome}
            {equipamento.identificador ? ` · ${equipamento.identificador}` : ""}
            {equipamento.cliente ? ` · ${equipamento.cliente}` : ""}
          </DialogDescription>
        </DialogHeader>

        {!isFetching && data?.cobertura && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground -mt-2">
            <span>
              ID do equipamento (chapa/série):{" "}
              <span className="font-mono text-foreground">
                {equipamento.identificador || (data.cobertura.series || []).join(", ") || "—"}
              </span>
            </span>
            <span>
              ID interno Auvo:{" "}
              <span className="font-mono text-foreground">
                {(data.cobertura.equipamentos || []).join(", ") || "—"}
              </span>
            </span>
            <span>
              Tarefas Auvo vinculadas:{" "}
              <span className="text-foreground">{data.tarefas}</span>
            </span>
          </div>
        )}

        {isFetching && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Varrendo OS e orçamentos no GestãoClick...
          </div>
        )}

        {!isFetching && error && (
          <div className="text-sm text-destructive py-6 text-center">{(error as Error).message}</div>
        )}

        {!isFetching && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
              {[
                { l: "Tarefas Auvo", v: data.tarefas },
                { l: "OS", v: data.totais.os },
                { l: "Orçamentos", v: data.totais.orcamentos },
                { l: "Vendido", v: brl(data.totais.valor_vendido) },
                { l: "Orçado (não vendido)", v: brl(data.totais.valor_orcado) },
              ].map((c) => (
                <div key={c.l} className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">{c.l}</div>
                  <div className="text-sm font-semibold">{c.v}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {data?.cobertura && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Histórico completo (sem corte de período) · docs de{" "}
                  {fmtData(data.cobertura.data_inicial)} → {fmtData(data.cobertura.data_final)} ·{" "}
                  {data.cobertura.tarefas_com_dados} tarefas
                </span>
              )}
              <Input
                placeholder="Buscar peça, OS, situação..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-8"
              />
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
              </Button>
              <Button variant="outline" size="sm" onClick={exportarCsv}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>

            <Tabs defaultValue="consolidado" className="flex-1 min-h-0 flex flex-col">
              <TabsList>
                <TabsTrigger value="consolidado">Consolidado ({consolidado.length})</TabsTrigger>
                <TabsTrigger value="os">OS ({pecasOs.length})</TabsTrigger>
                <TabsTrigger value="orcamento">Orçamento ({pecasOrc.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="consolidado" className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Peça</TableHead>
                      <TableHead className="text-right">Qtd vendida</TableHead>
                      <TableHead className="text-right">Valor vendido</TableHead>
                      <TableHead className="text-right">Qtd orçada</TableHead>
                      <TableHead className="text-right">Valor orçado</TableHead>
                      <TableHead className="text-right">Última</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consolidado.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma peça encontrada</TableCell></TableRow>
                    ) : consolidado.map((p: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{p.codigo || "—"}</TableCell>
                        <TableCell className="text-sm">{p.descricao}</TableCell>
                        <TableCell className="text-right text-sm">{p.qtd_vendida || "—"}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{p.valor_vendido ? brl(p.valor_vendido) : "—"}</TableCell>
                        <TableCell className="text-right text-sm">{p.qtd_orcada || "—"}</TableCell>
                        <TableCell className="text-right text-sm">{p.valor_orcado ? brl(p.valor_orcado) : "—"}</TableCell>
                        <TableCell className="text-right text-sm">{fmtData(p.ultima_data)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              {([
                { value: "os", rows: pecasOs, label: "OS" },
                { value: "orcamento", rows: pecasOrc, label: "Orçamento" },
              ] as const).map((tab) => (
                <TabsContent key={tab.value} value={tab.value} className="flex-1 min-h-0 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>{tab.label}</TableHead>
                        <TableHead>Código</TableHead>
                        <TableHead>Peça</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tab.rows.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhum item</TableCell></TableRow>
                      ) : tab.rows.map((p: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{fmtData(p.data)}</TableCell>
                          <TableCell className="text-sm">
                            <span className="flex items-center gap-1">
                              {p.documento_codigo}
                              {p.link && (
                                <a href={p.link} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                </a>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{p.codigo || "—"}</TableCell>
                          <TableCell className="text-sm">{p.descricao}</TableCell>
                          <TableCell className="text-right text-sm">{p.quantidade}</TableCell>
                          <TableCell className="text-right text-sm">{brl(p.valor_total)}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={p.vendida ? "default" : "outline"} className="text-[10px]">
                              {p.situacao || (p.vendida ? "Vendida" : "Orçada")}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}