import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, addDays, isWeekend, eachDayOfInterval, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Gauge,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useTechnicianDashboard } from "@/hooks/useTechnicianDashboard";

const decimal = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v || 0);

export default function ProdutividadeTecnicosPage() {
  const [mesReferencia, setMesReferencia] = useState(() => format(new Date(), "yyyy-MM"));
  const [search, setSearch] = useState("");

  const dates = useMemo(() => {
    const start = `${mesReferencia}-01`;
    const end = format(endOfMonth(new Date(`${start}T12:00:00`)), "yyyy-MM-dd");
    return { start, end };
  }, [mesReferencia]);

  const { data, isLoading, refetch, isFetching } = useTechnicianDashboard(dates.start, dates.end);

  const technicians = useMemo(() => {
    if (!data?.tecnicos) return [];
    const query = search.trim().toLowerCase();
    return data.tecnicos
      .filter(t => !query || t.nome.toLowerCase().includes(query))
      .sort((a, b) => b.produtividade_pct - a.produtividade_pct);
  }, [data, search]);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="bg-background"><Gauge className="mr-1 h-3 w-3" /> Eficiência Operacional</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Produtividade dos Técnicos</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Cálculo baseado em 8h diárias (seg-sex), descontando finais de semana. 
              Horas produtivas = horas registradas em tarefas do Auvo.
            </p>
          </div>
          <div className="flex items-center gap-2">
             <Input 
                type="month" 
                value={mesReferencia} 
                onChange={(e) => setMesReferencia(e.target.value)} 
                className="w-44 bg-background"
             />
             <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={isFetching ? "animate-spin mr-2 h-4 w-4" : "mr-2 h-4 w-4"} /> 
                Atualizar
             </Button>
          </div>
        </header>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Buscar técnico..." 
            className="bg-background pl-9" 
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-[600px] w-full rounded-xl" />
        ) : (
          <Card className="shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Técnico</TableHead>
                  <TableHead className="text-center">Dias Úteis</TableHead>
                  <TableHead className="text-center">H. Disponíveis</TableHead>
                  <TableHead className="text-center">H. Produtivas</TableHead>
                  <TableHead className="w-64">Produtividade (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technicians.map((t) => (
                  <TableRow key={t.nome}>
                    <TableCell className="font-bold uppercase py-4">{t.nome}</TableCell>
                    <TableCell className="text-center font-medium">{t.dias_uteis}</TableCell>
                    <TableCell className="text-center font-medium">{decimal(t.horas_disponiveis)}h</TableCell>
                    <TableCell className="text-center font-bold text-primary">{decimal(t.horas_produtivas_liquidas)}h</TableCell>
                    <TableCell>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className={t.produtividade_pct >= 70 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                            {t.produtividade_pct}%
                          </span>
                          <span className="text-muted-foreground">meta 75%</span>
                        </div>
                        <Progress 
                          value={t.produtividade_pct} 
                          className="h-2" 
                          indicatorClassName={t.produtividade_pct >= 75 ? "bg-emerald-500" : t.produtividade_pct >= 50 ? "bg-amber-500" : "bg-rose-500"}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {technicians.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      Nenhum técnico encontrado para o período.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
