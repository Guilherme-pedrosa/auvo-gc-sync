import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, Play, Eye, ChevronDown, ChevronRight, ArrowLeft, Package, AlertTriangle, Plus, Link2, UserCheck, CalendarIcon, Undo2, ExternalLink, Settings2 } from "lucide-react";
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
  situacao_id_antes?: string;
  situacao_depois: string | null;
  data_os?: string;
  auvo_tecnico_id?: string | null;
  gc_vendedor_id?: string | null;
  gc_vendedor_nome?: string | null;
  vendedor_status?: string;
  pecas_orcamento?: Array<{ descricao: string; quantidade: number; codigo?: string }>;
  materiais_execucao?: Array<{ descricao: string; quantidade: number }>;
  itens_cobertos?: Array<{ descricao: string; match: string; score: number }>;
  itens_faltando?: Array<{ descricao: string; motivo: string }>;
  itens_parciais?: Array<{ descricao: string; melhor_match: string; score: number }>;
};

type UsuarioMap = {
  id: string;
  auvo_user_id: string;
  auvo_user_nome: string;
  gc_vendedor_id: string;
  gc_vendedor_nome: string;
  ativo: boolean;
};

const AuvoSyncPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAuvoUser, setSelectedAuvoUser] = useState("");
  const [selectedAuvoUserNome, setSelectedAuvoUserNome] = useState("");
  const [selectedGcVendedor, setSelectedGcVendedor] = useState("");
  const [selectedGcVendedorNome, setSelectedGcVendedorNome] = useState("");
  const [dataInicio, setDataInicio] = useState<Date | undefined>(undefined);
  const [dataFim, setDataFim] = useState<Date | undefined>(undefined);
  const [reverting, setReverting] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<Array<{ id: string; codigo: string; modificado_em: string }> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [batchReverting, setBatchReverting] = useState(false);
  const [revertSituacaoId, setRevertSituacaoId] = useState("7213493");
  const [revertModificadoApos, setRevertModificadoApos] = useState("2026-03-11 17:46:00");
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // ─── Queries ───
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

  const { data: mapeamentos, isLoading: loadingMap } = useQuery({
    queryKey: ["auvo-gc-mapeamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auvo_gc_usuario_map")
        .select("*")
        .order("auvo_user_nome");
      if (error) throw error;
      return data as UsuarioMap[];
    },
  });

  const { data: auvoUsers, isLoading: loadingAuvoUsers } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: { action: "list_auvo_users" },
      });
      if (error) throw error;
      return (data?.users || []) as Array<{ userID: number; name: string; email?: string }>;
    },
    enabled: dialogOpen,
  });

  const { data: gcVendedores, isLoading: loadingGcVendedores } = useQuery({
    queryKey: ["gc-vendedores"],
    queryFn: async () => {
      const todos: Array<{ id: string; nome: string }> = [];
      let pagina = 1;
      let totalPaginas = 1;

      do {
        const { data, error } = await supabase.functions.invoke("gc-proxy", {
          body: { endpoint: "/api/funcionarios", method: "GET", params: { limite: "100", pagina: String(pagina) } },
        });
        if (error) throw error;

        const payload = data?.data;
        const lista: any[] = Array.isArray(payload?.data) ? payload.data : Array.isArray(data?.data) ? data.data : [];
        const meta = payload?.meta;

        todos.push(
          ...lista.map((f: any) => ({ id: String(f.id || ""), nome: String(f.nome || f.name || "") }))
        );

        totalPaginas = Number(meta?.total_paginas || 1);
        pagina += 1;
      } while (pagina <= totalPaginas);

      return todos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
    enabled: dialogOpen,
  });

  const tecnicosSemMapa = (() => {
    const ids = new Set<string>();
    for (const log of (logs || [])) {
      for (const entry of (log.detalhes || [])) {
        if (entry.auvo_tecnico_id && entry.vendedor_status === "sem_mapeamento") {
          ids.add(entry.auvo_tecnico_id);
        }
      }
    }
    return Array.from(ids);
  })();

  // ─── Mutations ───
  const salvarMapeamento = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("auvo_gc_usuario_map").upsert({
        auvo_user_id: selectedAuvoUser,
        auvo_user_nome: selectedAuvoUserNome,
        gc_vendedor_id: selectedGcVendedor,
        gc_vendedor_nome: selectedGcVendedorNome,
        ativo: true,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "auvo_user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mapeamento salvo!");
      queryClient.invalidateQueries({ queryKey: ["auvo-gc-mapeamentos"] });
      setDialogOpen(false);
      setSelectedAuvoUser("");
      setSelectedGcVendedor("");
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("auvo_gc_usuario_map").update({ ativo, atualizado_em: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auvo-gc-mapeamentos"] });
      toast.success("Status atualizado");
    },
  });

  const executarSync = async (dryRun = false) => {
    setRunning(true);
    try {
      const syncBody: any = { dry_run: dryRun };
      if (dataInicio) syncBody.data_inicio = format(dataInicio, "yyyy-MM-dd");
      if (dataFim) syncBody.data_fim = format(dataFim, "yyyy-MM-dd");
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", { body: syncBody });
      if (error) throw error;
      toast.success(
        dryRun
          ? `Dry Run: ${data.osCandidatas} candidatas, ${data.semPendencia} prontas, ${data.divergenciaPecas || 0} div. peças`
          : `Sync: ${data.atualizadas} atualizadas, ${data.divergenciaPecas || 0} bloqueadas, ${data.erros} erros`
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
      com_pendencia: { variant: "outline", label: "⚠️ Pendência" },
      nao_finalizada: { variant: "outline", label: "⏳ Não Finalizada" },
      nao_encontrada: { variant: "secondary", label: "🔍 Não Encontrada" },
      erro_gc: { variant: "destructive", label: "❌ Erro GC" },
      divergencia_pecas: { variant: "destructive", label: "🔴 Div. Peças" },
      revertida: { variant: "outline", label: "↩️ Revertida" },
    };
    const m = map[resultado] || { variant: "outline" as const, label: resultado };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };


  const reverterOS = async (detail: LogDetail) => {
    if (!detail.situacao_id_antes || !detail.gc_os_id) {
      toast.error("Dados insuficientes para reverter (situacao_id_antes não disponível)");
      return;
    }
    const confirmed = window.confirm(
      `Reverter OS ${detail.gc_os_codigo} de "${detail.situacao_depois}" para "${detail.situacao_antes}" (ID: ${detail.situacao_id_antes})?`
    );
    if (!confirmed) return;
    
    setReverting(detail.gc_os_id);
    try {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_os",
          gc_os_id: detail.gc_os_id,
          gc_os_codigo: detail.gc_os_codigo,
          situacao_id_antes: detail.situacao_id_antes,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`OS ${detail.gc_os_codigo} revertida para "${detail.situacao_antes}"`);
        queryClient.invalidateQueries({ queryKey: ["auvo-sync-logs"] });
      } else {
        toast.error(`Erro ao reverter: ${JSON.stringify(data?.body || data)}`);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setReverting(null);
    }
  };

  const vendedorBadge = (status?: string) => {
    if (!status) return null;
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      mapeado: { variant: "default", label: "✅ Mapeado" },
      sem_mapeamento: { variant: "destructive", label: "⚠️ Sem Mapa" },
      sem_tecnico: { variant: "outline", label: "— Sem Técnico" },
    };
    const m = map[status] || { variant: "outline" as const, label: status };
    return <Badge variant={m.variant} className="text-xs">{m.label}</Badge>;
  };

  const lastSync = logs?.[0];

  const PecasDetail = ({ detail }: { detail: LogDetail }) => {
    if (detail.resultado !== "divergencia_pecas") return null;
    return (
      <div className="mt-3 space-y-3 border-t pt-3">
        <div className="flex items-center gap-2 text-sm font-medium"><Package className="h-4 w-4" /> Validação de Peças</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">📦 Orçamento GC ({detail.pecas_orcamento?.length || 0})</p>
            <ul className="text-xs space-y-1">{detail.pecas_orcamento?.map((p, i) => <li key={i} className="font-mono">{p.quantidade}x {p.descricao}</li>)}</ul>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">🔧 Execução Auvo ({detail.materiais_execucao?.length || 0})</p>
            <ul className="text-xs space-y-1">{detail.materiais_execucao?.length ? detail.materiais_execucao.map((m, i) => <li key={i} className="font-mono">{m.quantidade}x {m.descricao}</li>) : <li className="text-muted-foreground italic">Nenhum material</li>}</ul>
          </div>
        </div>
        <div className="space-y-1">
          {detail.itens_cobertos?.map((item, i) => <div key={`c-${i}`} className="text-xs">✅ {item.descricao} → "{item.match}" ({item.score}%)</div>)}
          {detail.itens_parciais?.map((item, i) => <div key={`p-${i}`} className="text-xs">⚠️ {item.descricao} → "{item.melhor_match}" ({item.score}%)</div>)}
          {detail.itens_faltando?.map((item, i) => <div key={`f-${i}`} className="text-xs">❌ {item.descricao} — {item.motivo}</div>)}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">🔄 Auvo → GC Sync</h1>
          <p className="text-muted-foreground">Automação de fechamento de OS com validação de peças e mapeamento de vendedores</p>
        </div>
      </div>

      <Tabs defaultValue="execucoes">
        <TabsList>
          <TabsTrigger value="execucoes">📊 Execuções</TabsTrigger>
          <TabsTrigger value="reversao">↩️ Reversão em Lote</TabsTrigger>
          <TabsTrigger value="mapeamento">🔗 Mapeamento de Técnicos</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: Execuções ─── */}
        <TabsContent value="execucoes" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-lg">Último Sync</CardTitle></CardHeader>
              <CardContent>
                {lastSync ? (
                  <div className="space-y-2 text-sm">
                    <p><span className="text-muted-foreground">Data:</span> {format(new Date(lastSync.executado_em), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
                    <p><span className="text-muted-foreground">OS Candidatas:</span> {lastSync.os_candidatas}</p>
                    <p><span className="text-muted-foreground">Atualizadas:</span> <span className="font-medium">{lastSync.os_atualizadas}</span></p>
                    {(lastSync.os_divergencia_pecas || 0) > 0 && (
                      <p className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-orange-500" /><span className="text-muted-foreground">Div. Peças:</span> <span className="font-medium text-orange-600">{lastSync.os_divergencia_pecas}</span></p>
                    )}
                    <p><span className="text-muted-foreground">Erros:</span> {lastSync.erros}</p>
                    <p><span className="text-muted-foreground">Duração:</span> {lastSync.duracao_ms}ms</p>
                    {lastSync.dry_run && <Badge variant="secondary">Dry Run</Badge>}
                  </div>
                ) : <p className="text-muted-foreground text-sm">Nenhuma execução</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Controles</CardTitle><CardDescription>Selecione o período e execute a sincronização</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Data Início</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dataInicio ? format(dataInicio, "dd/MM/yyyy") : "Selecione"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dataInicio} onSelect={setDataInicio} locale={ptBR} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground">Data Fim</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dataFim ? format(dataFim, "dd/MM/yyyy") : "Selecione"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dataFim} onSelect={setDataFim} locale={ptBR} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                {(dataInicio || dataFim) && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setDataInicio(undefined); setDataFim(undefined); }}>
                    Limpar datas (buscar todas)
                  </Button>
                )}
                <div className="space-y-2">
                  <Dialog open={confirmExecute} onOpenChange={(o) => { setConfirmExecute(o); setConfirmText(""); }}>
                    <DialogTrigger asChild>
                      <Button disabled={running} variant="destructive" className="w-full"><Play className="mr-2 h-4 w-4" />Executar Agora</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>⚠️ Confirmação de Execução Real</DialogTitle>
                        <DialogDescription>
                          Esta ação vai alterar situações de OS no GestãoClick. Digite <strong>EXECUTAR</strong> para confirmar.
                        </DialogDescription>
                      </DialogHeader>
                      <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder='Digite "EXECUTAR" para confirmar'
                      />
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmExecute(false)}>Cancelar</Button>
                        <Button
                          variant="destructive"
                          disabled={confirmText !== "EXECUTAR" || running}
                          onClick={() => { setConfirmExecute(false); setConfirmText(""); executarSync(false); }}
                        >
                          {running ? "Executando..." : "Confirmar Execução"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button onClick={() => executarSync(true)} disabled={running} variant="outline" className="w-full"><Eye className="mr-2 h-4 w-4" />Dry Run (simular)</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle className="text-lg">Histórico</CardTitle><CardDescription>Últimas 20 execuções</CardDescription></div>
              <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["auvo-sync-logs"] })}><RefreshCw className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : !logs?.length ? <p className="text-sm text-muted-foreground">Nenhum registro</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-center">Cand.</TableHead>
                      <TableHead className="text-center">✅</TableHead>
                      <TableHead className="text-center">⚠️</TableHead>
                      <TableHead className="text-center">🔴 Peças</TableHead>
                      <TableHead className="text-center">🔍</TableHead>
                      <TableHead className="text-center">❌</TableHead>
                      <TableHead className="text-center">Dry</TableHead>
                      <TableHead className="text-right">ms</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <Collapsible key={log.id} asChild open={expandedRow === log.id}>
                        <>
                          <CollapsibleTrigger asChild>
                            <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}>
                              <TableCell>{expandedRow === log.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                              <TableCell className="text-sm">{format(new Date(log.executado_em), "dd/MM HH:mm", { locale: ptBR })}</TableCell>
                              <TableCell className="text-center">{log.os_candidatas}</TableCell>
                              <TableCell className="text-center font-medium">{log.os_atualizadas}</TableCell>
                              <TableCell className="text-center">{log.os_com_pendencia}</TableCell>
                              <TableCell className="text-center">{(log.os_divergencia_pecas || 0) > 0 ? <Badge variant="destructive" className="text-xs">{log.os_divergencia_pecas}</Badge> : "0"}</TableCell>
                              <TableCell className="text-center">{log.os_nao_encontradas}</TableCell>
                              <TableCell className="text-center">{log.erros}</TableCell>
                              <TableCell className="text-center">{log.dry_run && <Badge variant="secondary">Sim</Badge>}</TableCell>
                              <TableCell className="text-right text-sm">{log.duracao_ms}</TableCell>
                            </TableRow>
                          </CollapsibleTrigger>
                          <CollapsibleContent asChild>
                            <TableRow>
                              <TableCell colSpan={11} className="bg-muted/30 p-4">
                                {Array.isArray(log.detalhes) && log.detalhes.length > 0 ? (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>OS</TableHead>
                                        <TableHead>Data OS</TableHead>
                                        <TableHead>Tarefa</TableHead>
                                        <TableHead>Resultado</TableHead>
                                        <TableHead>Vendedor</TableHead>
                                        <TableHead>Antes</TableHead>
                                        <TableHead>Depois</TableHead>
                                         <TableHead>Detalhe</TableHead>
                                         <TableHead>Ações</TableHead>
                                       </TableRow>
                                     </TableHeader>
                                     <TableBody>
                                       {(log.detalhes as LogDetail[]).map((d, i) => (
                                         <TableRow key={i}>
                                           <TableCell className="font-mono text-xs">{d.gc_os_codigo}</TableCell>
                                          <TableCell className="text-xs">{d.data_os ? (() => { try { return format(new Date(d.data_os), "dd/MM/yyyy"); } catch { return d.data_os; } })() : "—"}</TableCell>
                                          <TableCell className="font-mono text-xs">{d.auvo_task_id}</TableCell>
                                          <TableCell>{resultadoBadge(d.resultado)}</TableCell>
                                          <TableCell>
                                            <div className="space-y-1">
                                              {vendedorBadge(d.vendedor_status)}
                                              {d.gc_vendedor_nome && <span className="text-xs block">{d.gc_vendedor_nome}</span>}
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-xs">{d.situacao_antes}</TableCell>
                                          <TableCell className="text-xs">{d.situacao_depois || "—"}</TableCell>
                                           <TableCell className="text-xs max-w-xs">
                                            <span className="truncate block" title={d.detalhe}>{d.detalhe}</span>
                                            <PecasDetail detail={d} />
                                          </TableCell>
                                          <TableCell>
                                            {(d.resultado === "atualizada" || d.resultado === "dry_run_ok") && d.situacao_id_antes && !log.dry_run && (
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-xs"
                                                disabled={reverting === d.gc_os_id}
                                                onClick={(e) => { e.stopPropagation(); reverterOS(d); }}
                                              >
                                                <Undo2 className="h-3 w-3 mr-1" />
                                                {reverting === d.gc_os_id ? "Revertendo..." : "Reverter"}
                                              </Button>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : <p className="text-sm text-muted-foreground">Sem detalhes</p>}
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
        </TabsContent>

        {/* ─── TAB: Reversão em Lote ─── */}
        <TabsContent value="reversao" className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ferramenta de Emergência</AlertTitle>
            <AlertDescription>
              Reverte a situação de múltiplas OS no GestãoClick. Não restaura pagamentos, NFs ou outros dados — apenas a situação.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Undo2 className="h-5 w-5" /> Reversão em Lote</CardTitle>
              <CardDescription>Encontre e reverta OS alteradas indevidamente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Modificadas após (datetime)</label>
                  <Input
                    value={revertModificadoApos}
                    onChange={(e) => setRevertModificadoApos(e.target.value)}
                    placeholder="2026-03-11 17:46:00"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Situação de destino</label>
                  <Select value={revertSituacaoId} onValueChange={setRevertSituacaoId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7213493">SERVICO AGUARDANDO EXECUCAO</SelectItem>
                      <SelectItem value="7684665">RETIRADA PELO TECNICO</SelectItem>
                      <SelectItem value="7063581">PEDIDO EM CONFERENCIA</SelectItem>
                      <SelectItem value="7063705">PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO</SelectItem>
                      <SelectItem value="7063579">AGUARDANDO COMPRA DE PEÇAS</SelectItem>
                      <SelectItem value="7063580">AGUARDANDO CHEGADA DE PEÇAS</SelectItem>
                      <SelectItem value="7659440">AGUARDANDO FABRICAÇÃO</SelectItem>
                      <SelectItem value="8679279">IMPORTADO API CIGAM</SelectItem>
                      <SelectItem value="8685059">IMP CIGAM FATURADO TOTAL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    setScanning(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
                        body: { action: "batch_scan", modificado_apos: revertModificadoApos },
                      });
                      if (error) throw error;
                      setScanResult(data?.os_list || []);
                      toast.success(`${data?.total || 0} OS encontradas`);
                    } catch (err: any) {
                      toast.error(`Erro: ${err.message}`);
                    } finally {
                      setScanning(false);
                    }
                  }}
                  disabled={scanning}
                  variant="outline"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {scanning ? "Escaneando..." : "1. Escanear OS afetadas"}
                </Button>

                {scanResult && scanResult.length > 0 && (
                  <Button
                    onClick={async () => {
                      const confirmed = window.confirm(
                        `CONFIRMA reverter ${scanResult.length} OS para a situação selecionada? Esta ação NÃO pode ser desfeita.`
                      );
                      if (!confirmed) return;
                      setBatchReverting(true);
                      try {
                        const osList = scanResult.map(os => ({
                          id: os.id,
                          codigo: os.codigo,
                          situacao_destino_id: revertSituacaoId,
                        }));
                        const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
                          body: { action: "batch_revert", os_list: osList, dry_run: false },
                        });
                        if (error) throw error;
                        toast.success(`${data?.revertidas || 0} OS revertidas, ${data?.erros || 0} erros`);
                        queryClient.invalidateQueries({ queryKey: ["auvo-sync-logs"] });
                        setScanResult(null);
                      } catch (err: any) {
                        toast.error(`Erro: ${err.message}`);
                      } finally {
                        setBatchReverting(false);
                      }
                    }}
                    disabled={batchReverting}
                    variant="destructive"
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    {batchReverting ? "Revertendo..." : `2. Reverter ${scanResult.length} OS`}
                  </Button>
                )}
              </div>

              {scanResult && (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>OS</TableHead>
                        <TableHead>Modificado em</TableHead>
                        <TableHead>Situação atual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scanResult.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma OS encontrada</TableCell>
                        </TableRow>
                      ) : (
                        scanResult.map((os) => (
                          <TableRow key={os.id}>
                            <TableCell className="font-mono text-sm">{os.codigo}</TableCell>
                            <TableCell className="text-sm">{os.modificado_em}</TableCell>
                            <TableCell><Badge variant="destructive">EXECUTADO - AG. NEGOCIAÇÃO</Badge></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: Mapeamento ─── */}
        <TabsContent value="mapeamento" className="space-y-4">
          {tecnicosSemMapa.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Técnicos sem mapeamento</AlertTitle>
              <AlertDescription>
                {tecnicosSemMapa.length} técnico(s) detectados nas últimas execuções sem mapeamento GC:
                <span className="font-mono text-xs ml-1">{tecnicosSemMapa.join(", ")}</span>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2"><Link2 className="h-5 w-5" /> Mapeamento Auvo → GC</CardTitle>
                <CardDescription>Correspondência entre técnicos do Auvo e vendedores/funcionários do GC</CardDescription>
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Novo Mapeamento</DialogTitle>
                    <DialogDescription>Vincule um técnico do Auvo a um vendedor do GC</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Técnico Auvo</label>
                      <Select
                        value={selectedAuvoUser}
                        onValueChange={(v) => {
                          setSelectedAuvoUser(v);
                          const user = auvoUsers?.find(u => String(u.userID) === v);
                          setSelectedAuvoUserNome(user?.name || v);
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder={loadingAuvoUsers ? "Carregando..." : "Selecione"} /></SelectTrigger>
                        <SelectContent>
                          {auvoUsers?.map(u => (
                            <SelectItem key={u.userID} value={String(u.userID)}>
                              {u.name} (ID: {u.userID})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Vendedor GC</label>
                      <Select
                        value={selectedGcVendedor}
                        onValueChange={(v) => {
                          setSelectedGcVendedor(v);
                          const vend = gcVendedores?.find(f => f.id === v);
                          setSelectedGcVendedorNome(vend?.nome || v);
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder={loadingGcVendedores ? "Carregando..." : "Selecione"} /></SelectTrigger>
                        <SelectContent>
                          {gcVendedores?.map(f => (
                            <SelectItem key={f.id} value={f.id}>{f.nome} (ID: {f.id})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() => salvarMapeamento.mutate()}
                      disabled={!selectedAuvoUser || !selectedGcVendedor || salvarMapeamento.isPending}
                    >
                      {salvarMapeamento.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingMap ? <p className="text-sm text-muted-foreground">Carregando...</p> : !mapeamentos?.length ? (
                <p className="text-sm text-muted-foreground">Nenhum mapeamento configurado. Clique em "Adicionar" para começar.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Técnico Auvo</TableHead>
                      <TableHead>ID Auvo</TableHead>
                      <TableHead></TableHead>
                      <TableHead>Vendedor GC</TableHead>
                      <TableHead>ID GC</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mapeamentos.map(m => (
                      <TableRow key={m.id} className={!m.ativo ? "opacity-50" : ""}>
                        <TableCell className="font-medium">{m.auvo_user_nome}</TableCell>
                        <TableCell className="font-mono text-xs">{m.auvo_user_id}</TableCell>
                        <TableCell className="text-center text-muted-foreground">→</TableCell>
                        <TableCell className="font-medium">{m.gc_vendedor_nome}</TableCell>
                        <TableCell className="font-mono text-xs">{m.gc_vendedor_id}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={m.ativo ? "default" : "secondary"}>{m.ativo ? "✅ Ativo" : "Inativo"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleAtivo.mutate({ id: m.id, ativo: !m.ativo })}
                          >
                            {m.ativo ? "Desativar" : "Ativar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuvoSyncPage;
