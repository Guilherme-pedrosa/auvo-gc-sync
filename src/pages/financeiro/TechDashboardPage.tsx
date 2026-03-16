import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarIcon, RefreshCw, Users, CheckCircle, Clock, TrendingUp, AlertTriangle, DollarSign, Navigation } from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import LastSyncBadge from "@/components/LastSyncBadge";

type TecnicoData = {
  id: string;
  nome: string;
  tarefas_total: number;
  tarefas_finalizadas: number;
  tarefas_abertas: number;
  tarefas_com_pendencia: number;
  taxa_finalizacao: number;
  media_execucoes_dia: number;
  tempo_horas: number;
  deslocamento_horas: number;
  tempo_atividade_pct: number;
  dias_trabalhados: number;
  valor_total: number;
  faturamento_hora: number;
  tarefas_por_dia: Record<string, number>;
  finalizadas_por_dia: Record<string, number>;
};

type DashboardData = {
  resumo: {
    periodo: { inicio: string; fim: string };
    total_tarefas: number;
    total_finalizadas: number;
    total_tecnicos: number;
  };
  tecnicos: TecnicoData[];
  auvo_error?: string | null;
  error?: string;
};

const METAS = {
  taxa_finalizacao: 70,
  execucoes_dia: 1,
  tempo_atividade: 70,
};

const TechDashboardPage = () => {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<"hoje" | "semana" | "mes" | "custom">("hoje");
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined);

  const getDates = () => {
    const today = new Date();
    switch (periodo) {
      case "hoje":
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "semana":
        return { start: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "mes":
        return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "custom":
        return {
          start: customStart ? format(customStart, "yyyy-MM-dd") : format(today, "yyyy-MM-dd"),
          end: customEnd ? format(customEnd, "yyyy-MM-dd") : format(today, "yyyy-MM-dd"),
        };
    }
  };

  const dates = getDates();

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ["tech-dashboard", dates.start, dates.end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("tech-dashboard", {
        body: { start_date: dates.start, end_date: dates.end },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as DashboardData;
    },
    refetchInterval: 60000,
    retry: false,
  });

  const metaBadge = (valor: number, meta: number) => {
    if (valor >= meta) return <Badge variant="default" className="text-xs">✅ {valor}%</Badge>;
    if (valor >= meta * 0.7) return <Badge variant="secondary" className="text-xs">⚠️ {valor}%</Badge>;
    return <Badge variant="destructive" className="text-xs">❌ {valor}%</Badge>;
  };

  const atingimento = (tecnico: TecnicoData) => {
    let pontos = 0;
    let total = 0;

    // Taxa finalização ≥ 70%
    total++;
    if (tecnico.taxa_finalizacao >= METAS.taxa_finalizacao) pontos++;

    // Execuções/dia > 1
    total++;
    if (tecnico.media_execucoes_dia >= METAS.execucoes_dia) pontos++;

    // Tempo atividade > 70%
    total++;
    if (tecnico.tempo_atividade_pct >= METAS.tempo_atividade) pontos++;

    // Sem pendências (0 pendências = bom)
    total++;
    if (tecnico.tarefas_com_pendencia === 0) pontos++;

    return Math.round((pontos / total) * 100);
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">📊 Dashboard de Técnicos</h1>
          <p className="text-muted-foreground">Indicadores de desempenho em tempo real via Auvo</p>
          <LastSyncBadge className="mt-1" />
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Período</label>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as any)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="semana">Esta Semana</SelectItem>
              <SelectItem value="mes">Este Mês</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {periodo === "custom" && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-36 justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customStart ? format(customStart, "dd/MM/yy") : "Início"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customStart} onSelect={setCustomStart} locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Fim</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-36 justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customEnd ? format(customEnd, "dd/MM/yy") : "Fim"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
          </>
        )}
        <Badge variant="outline" className="h-9 px-3">
          {dates.start === dates.end ? format(new Date(dates.start + "T12:00:00"), "dd/MM/yyyy") : `${format(new Date(dates.start + "T12:00:00"), "dd/MM")} → ${format(new Date(dates.end + "T12:00:00"), "dd/MM/yyyy")}`}
        </Badge>
      </div>

      {/* Error display */}
      {queryError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Erro ao consultar Auvo:</span>
              <span className="text-sm">{(queryError as Error).message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.auvo_error && (
        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Aviso Auvo:</span>
              <span className="text-sm truncate">{data.auvo_error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumo Cards */}
      {data?.resumo && (
        <div className="grid gap-4 md:grid-cols-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Técnicos Ativos</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.resumo.total_tecnicos}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tarefas</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.resumo.total_tarefas}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Finalizadas</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.resumo.total_finalizadas}</div>
              <p className="text-xs text-muted-foreground">
                {data.resumo.total_tarefas > 0 ? Math.round((data.resumo.total_finalizadas / data.resumo.total_tarefas) * 100) : 0}% do total
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Horas Deslocamento</CardTitle>
              <Navigation className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.tecnicos.reduce((sum, t) => sum + (t.deslocamento_horas || 0), 0).toFixed(1)}h
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.resumo.total_tarefas - data.resumo.total_finalizadas}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(() => {
                  const total = data.tecnicos.reduce((sum, t) => sum + (t.valor_total || 0), 0);
                  return total > 0 ? `R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";
                })()}
              </div>
              <p className="text-xs text-muted-foreground">
                {(() => {
                  const totalHoras = data.tecnicos.reduce((sum, t) => sum + (t.tempo_horas || 0), 0);
                  const totalValor = data.tecnicos.reduce((sum, t) => sum + (t.valor_total || 0), 0);
                  const mediaHora = totalHoras > 0 ? (totalValor / totalHoras) : 0;
                  return mediaHora > 0 ? `R$ ${mediaHora.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/h média` : "";
                })()}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela de técnicos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Desempenho por Técnico</CardTitle>
          <CardDescription>
            Metas: Finalização ≥ 70% | Execuções &gt; 1/dia | Tempo atividade &gt; 70% | 0 pendências
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando dados do Auvo...</p>
          ) : !data?.tecnicos?.length ? (
            <p className="text-sm text-muted-foreground">Nenhum técnico encontrado no período</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Técnico</TableHead>
                  <TableHead className="text-center">Tarefas</TableHead>
                  <TableHead className="text-center">Finalizadas</TableHead>
                  <TableHead className="text-center">Taxa Final.</TableHead>
                  <TableHead className="text-center">Exec/Dia</TableHead>
                  <TableHead className="text-center">Tempo (h)</TableHead>
                  <TableHead className="text-center">Desloc. (h)</TableHead>
                  <TableHead className="text-center">% Atividade</TableHead>
                   <TableHead className="text-center">Pendências</TableHead>
                   <TableHead className="text-right">Valor</TableHead>
                   <TableHead className="text-right">R$/Hora</TableHead>
                   <TableHead className="text-center">Atingimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tecnicos.map((tech) => {
                  const pct = atingimento(tech);
                  return (
                    <TableRow key={tech.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium text-sm">{tech.nome}</span>
                          <span className="text-xs text-muted-foreground block">{tech.dias_trabalhados} dia(s)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono">{tech.tarefas_total}</TableCell>
                      <TableCell className="text-center font-mono font-medium">{tech.tarefas_finalizadas}</TableCell>
                      <TableCell className="text-center">
                        {metaBadge(tech.taxa_finalizacao, METAS.taxa_finalizacao)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`font-mono text-sm ${tech.media_execucoes_dia >= METAS.execucoes_dia ? "text-foreground" : "text-destructive"}`}>
                          {tech.media_execucoes_dia}
                        </span>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">{tech.tempo_horas}h</TableCell>
                      <TableCell className="text-center font-mono text-sm text-muted-foreground">
                        {(tech.deslocamento_horas || 0) > 0 ? `${tech.deslocamento_horas}h` : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {metaBadge(tech.tempo_atividade_pct, METAS.tempo_atividade)}
                      </TableCell>
                      <TableCell className="text-center">
                        {tech.tarefas_com_pendencia === 0 ? (
                          <Badge variant="default" className="text-xs">✅ 0</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">⚠️ {tech.tarefas_com_pendencia}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {tech.valor_total > 0 ? `R$ ${tech.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {tech.faturamento_hora > 0 ? `R$ ${tech.faturamento_hora.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <Progress value={pct} className="w-16 h-2" />
                          <span className={`text-xs font-bold ${pct >= 70 ? "text-foreground" : "text-destructive"}`}>
                            {pct}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Legenda de metas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">📋 Critérios de Avaliação</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">Taxa Finalização</Badge>
                <span className="text-muted-foreground">Tarefas finalizadas / total ≥ 70%. Retornos por falha técnica impactam negativamente.</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">Execuções/Dia</Badge>
                <span className="text-muted-foreground">Serviços realizados &gt; 1 por dia. Mede produtividade.</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">Tempo Atividade</Badge>
                <span className="text-muted-foreground">Tempo entre check-in e check-out acima de 70% da jornada (8h).</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="shrink-0">Pendências</Badge>
                <span className="text-muted-foreground">0 pendências registradas. Mede comprometimento com padrões operacionais.</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
            <strong>Atingimento geral:</strong> ≥70% = percentual atingido | &lt;70% = 0 (não atinge meta mínima)
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TechDashboardPage;
