import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { RefreshCw, Play, Eye, ChevronDown, ChevronRight, ArrowLeft, Package, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

type SyncLog = {
  id: string;
  executado_em: string;
  os_candidatas: number;
  os_atualizadas: number;
  os_com_pendencia: number;
  os_sem_pendencia: number;
  os_nao_encontradas: number;
  os_divergencia_pecas: number;
  erros: number;
  dry_run: boolean;
  duracao_ms: number;
  detalhes: any[];
  observacao: string | null;
};

type LogDetail = {
  gc_os_id: string;
  gc_os_codigo: string;
  auvo_task_id: string;
  resultado: string;
  detalhe: string;
  situacao_antes: string;
  situacao_depois: string | null;
  pecas_orcamento?: Array<{ descricao: string; quantidade: number; codigo?: string }>;
  materiais_execucao?: Array<{ descricao: string; quantidade: number }>;
  itens_cobertos?: Array<{ descricao: string; match: string; score: number }>;
  itens_faltando?: Array<{ descricao: string; motivo: string }>;
  itens_parciais?: Array<{ descricao: string; melhor_match: string; score: number }>;
};

const AuvoSyncPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["auvo-sync-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auvo_gc_sync_log")
        .select("*")
        .order("executado_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as SyncLog[];
    },
    refetchInterval: 30000,
  });

  const executarSync = async (dryRun = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: { dry_run: dryRun },
      });
      if (error) throw error;
      toast.success(
        dryRun
          ? `Dry Run concluído: ${data.osCandidatas} OS candidatas, ${data.semPendencia} prontas, ${data.divergenciaPecas || 0} com divergência de peças`
          : `Sync concluído: ${data.atualizadas} atualizadas, ${data.divergenciaPecas || 0} bloqueadas por peças, ${data.erros} erros`
      );
      queryClient.invalidateQueries({ queryKey: ["auvo-sync-logs"] });
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const resultadoBadge = (resultado: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      atualizada: { variant: "default", label: "✅ Atualizada" },
      dry_run_ok: { variant: "secondary", label: "🔍 Dry Run OK" },
      com_pendencia: { variant: "outline", label: "⚠️ Com Pendência" },
      nao_finalizada: { variant: "outline", label: "⏳ Não Finalizada" },
      nao_encontrada: { variant: "secondary", label: "🔍 Não Encontrada" },
      erro_gc: { variant: "destructive", label: "❌ Erro GC" },
      divergencia_pecas: { variant: "destructive", label: "🔴 Divergência Peças" },
    };
    const m = map[resultado] || { variant: "outline" as const, label: resultado };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const lastSync = logs?.[0];

  const PecasDetail = ({ detail }: { detail: LogDetail }) => {
    if (detail.resultado !== "divergencia_pecas") return null;
    return (
      <div className="mt-3 space-y-3 border-t pt-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4" />
          Validação de Peças
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">📦 Orçamento GC ({detail.pecas_orcamento?.length || 0} peças)</p>
            <ul className="text-xs space-y-1">
              {detail.pecas_orcamento?.map((p, i) => (
                <li key={i} className="font-mono">{p.quantidade}x {p.descricao}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">🔧 Execução Auvo ({detail.materiais_execucao?.length || 0} materiais)</p>
            <ul className="text-xs space-y-1">
              {detail.materiais_execucao?.length ? detail.materiais_execucao.map((m, i) => (
                <li key={i} className="font-mono">{m.quantidade}x {m.descricao}</li>
              )) : <li className="text-muted-foreground italic">Nenhum material registrado</li>}
            </ul>
          </div>
        </div>
        <div className="space-y-1">
          {detail.itens_cobertos?.map((item, i) => (
            <div key={`c-${i}`} className="text-xs flex items-center gap-1">
              <span className="text-green-600">✅</span>
              <span>{item.descricao}</span>
              <span className="text-muted-foreground">→ "{item.match}" ({item.score}%)</span>
            </div>
          ))}
          {detail.itens_parciais?.map((item, i) => (
            <div key={`p-${i}`} className="text-xs flex items-center gap-1">
              <span className="text-yellow-600">⚠️</span>
              <span>{item.descricao}</span>
              <span className="text-muted-foreground">→ "{item.melhor_match}" ({item.score}% — parcial)</span>
            </div>
          ))}
          {detail.itens_faltando?.map((item, i) => (
            <div key={`f-${i}`} className="text-xs flex items-center gap-1">
              <span className="text-red-600">❌</span>
              <span>{item.descricao}</span>
              <span className="text-muted-foreground">— {item.motivo}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">🔄 Auvo → GC Sync</h1>
          <p className="text-muted-foreground">
            Automação de fechamento de OS com validação de peças
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Último Sync</CardTitle>
          </CardHeader>
          <CardContent>
            {lastSync ? (
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Data:</span> {format(new Date(lastSync.executado_em), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
                <p><span className="text-muted-foreground">OS Candidatas:</span> {lastSync.os_candidatas}</p>
                <p><span className="text-muted-foreground">Atualizadas:</span> <span className="font-medium">{lastSync.os_atualizadas}</span></p>
                {(lastSync.os_divergencia_pecas || 0) > 0 && (
                  <p className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                    <span className="text-muted-foreground">Divergência Peças:</span>
                    <span className="font-medium text-orange-600">{lastSync.os_divergencia_pecas}</span>
                  </p>
                )}
                <p><span className="text-muted-foreground">Erros:</span> <span className={lastSync.erros > 0 ? "font-medium" : ""}>{lastSync.erros}</span></p>
                <p><span className="text-muted-foreground">Duração:</span> {lastSync.duracao_ms}ms</p>
                {lastSync.dry_run && <Badge variant="secondary">Dry Run</Badge>}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nenhuma execução registrada</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Controles</CardTitle>
            <CardDescription>Execute a sincronização manualmente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => executarSync(false)} disabled={running} className="w-full">
              <Play className="mr-2 h-4 w-4" />
              {running ? "Executando..." : "Executar Agora"}
            </Button>
            <Button onClick={() => executarSync(true)} disabled={running} variant="outline" className="w-full">
              <Eye className="mr-2 h-4 w-4" />
              Dry Run (simular)
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Histórico de Execuções</CardTitle>
            <CardDescription>Últimas 20 execuções</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["auvo-sync-logs"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !logs?.length ? (
            <p className="text-sm text-muted-foreground">Nenhum registro encontrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead className="text-center">Candidatas</TableHead>
                  <TableHead className="text-center">✅ Atualizadas</TableHead>
                  <TableHead className="text-center">⚠️ Pendência</TableHead>
                  <TableHead className="text-center">🔴 Div. Peças</TableHead>
                  <TableHead className="text-center">🔍 Não Encontr.</TableHead>
                  <TableHead className="text-center">❌ Erros</TableHead>
                  <TableHead className="text-center">Dry Run</TableHead>
                  <TableHead className="text-right">Duração</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <Collapsible key={log.id} asChild open={expandedRow === log.id}>
                    <>
                      <CollapsibleTrigger asChild>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                        >
                          <TableCell>
                            {expandedRow === log.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="text-sm">{format(new Date(log.executado_em), "dd/MM HH:mm", { locale: ptBR })}</TableCell>
                          <TableCell className="text-center">{log.os_candidatas}</TableCell>
                          <TableCell className="text-center font-medium">{log.os_atualizadas}</TableCell>
                          <TableCell className="text-center">{log.os_com_pendencia}</TableCell>
                          <TableCell className="text-center">
                            {(log.os_divergencia_pecas || 0) > 0 ? (
                              <Badge variant="destructive" className="text-xs">{log.os_divergencia_pecas}</Badge>
                            ) : "0"}
                          </TableCell>
                          <TableCell className="text-center">{log.os_nao_encontradas}</TableCell>
                          <TableCell className="text-center">
                            <span className={log.erros > 0 ? "font-medium" : ""}>{log.erros}</span>
                          </TableCell>
                          <TableCell className="text-center">{log.dry_run && <Badge variant="secondary">Sim</Badge>}</TableCell>
                          <TableCell className="text-right text-sm">{log.duracao_ms}ms</TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={10} className="bg-muted/30 p-4">
                            {Array.isArray(log.detalhes) && log.detalhes.length > 0 ? (
                              <div className="space-y-4">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>OS Código</TableHead>
                                      <TableHead>Tarefa Auvo</TableHead>
                                      <TableHead>Resultado</TableHead>
                                      <TableHead>Situação Antes</TableHead>
                                      <TableHead>Situação Depois</TableHead>
                                      <TableHead>Detalhe</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {(log.detalhes as LogDetail[]).map((d, i) => (
                                      <TableRow key={i}>
                                        <TableCell className="font-mono text-xs">{d.gc_os_codigo}</TableCell>
                                        <TableCell className="font-mono text-xs">{d.auvo_task_id}</TableCell>
                                        <TableCell>{resultadoBadge(d.resultado)}</TableCell>
                                        <TableCell className="text-xs">{d.situacao_antes}</TableCell>
                                        <TableCell className="text-xs">{d.situacao_depois || "—"}</TableCell>
                                        <TableCell className="text-xs max-w-xs">
                                          <span className="truncate block" title={d.detalhe}>{d.detalhe}</span>
                                          <PecasDetail detail={d} />
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">Sem detalhes</p>
                            )}
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuvoSyncPage;
