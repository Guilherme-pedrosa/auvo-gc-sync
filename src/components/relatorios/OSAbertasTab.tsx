import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowDownWideNarrow, ExternalLink } from "lucide-react";

interface Props {
  data: any[];
  isLoading: boolean;
  allClientes: string[];
}

export default function OSAbertasTab({ data, isLoading, allClientes }: Props) {
  const [search, setSearch] = useState("");

  // Group by client, sum values
  const clienteSummary = useMemo(() => {
    const map = new Map<string, { cliente: string; count: number; total: number; items: any[] }>();
    for (const item of data) {
      const cliente = item.cliente || item.gc_os_cliente || "Sem cliente";
      const entry = map.get(cliente) || { cliente, count: 0, total: 0, items: [] };
      entry.count++;
      entry.total += Number(item.gc_os_valor_total) || 0;
      entry.items.push(item);
      map.set(cliente, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [data]);

  const filtered = useMemo(() => {
    if (!search) return clienteSummary;
    const s = search.toLowerCase();
    return clienteSummary.filter((c) => c.cliente.toLowerCase().includes(s));
  }, [clienteSummary, search]);

  const grandTotal = useMemo(() => filtered.reduce((sum, c) => sum + c.total, 0), [filtered]);
  const grandCount = useMemo(() => filtered.reduce((sum, c) => sum + c.count, 0), [filtered]);

  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total de OS</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{grandCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">
              {grandTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Clientes</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">OS em Aberto</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Valor Total <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    Nenhuma OS em aberto encontrada
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <>
                    <TableRow
                      key={row.cliente}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpanded(expanded === row.cliente ? null : row.cliente)}
                    >
                      <TableCell className="font-medium">{row.cliente}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{row.count}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {row.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </TableCell>
                    </TableRow>
                    {expanded === row.cliente && (
                      <TableRow key={`${row.cliente}-detail`}>
                        <TableCell colSpan={3} className="p-0">
                          <div className="bg-muted/30 px-6 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">OS Código</TableHead>
                                  <TableHead className="text-xs">Situação</TableHead>
                                  <TableHead className="text-xs">Técnico</TableHead>
                                  <TableHead className="text-xs">Data</TableHead>
                                  <TableHead className="text-xs text-right">Valor</TableHead>
                                  <TableHead className="text-xs w-8"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {row.items
                                  .sort((a: any, b: any) => (Number(b.gc_os_valor_total) || 0) - (Number(a.gc_os_valor_total) || 0))
                                  .map((item: any) => (
                                    <TableRow key={item.auvo_task_id} className="text-xs">
                                      <TableCell>{item.gc_os_codigo || "—"}</TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className="text-[10px]"
                                          style={{
                                            borderColor: item.gc_os_cor_situacao || undefined,
                                            color: item.gc_os_cor_situacao || undefined,
                                          }}
                                        >
                                          {item.gc_os_situacao || "—"}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>{item.tecnico || "—"}</TableCell>
                                      <TableCell>{item.data_tarefa || "—"}</TableCell>
                                      <TableCell className="text-right font-medium">
                                        {(Number(item.gc_os_valor_total) || 0).toLocaleString("pt-BR", {
                                          style: "currency",
                                          currency: "BRL",
                                        })}
                                      </TableCell>
                                      <TableCell>
                                        {item.gc_os_link && (
                                          <a href={item.gc_os_link} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                                          </a>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
