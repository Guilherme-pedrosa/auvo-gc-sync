import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { RefreshCw, Play, Eye, ArrowLeft, AlertTriangle, Plus, Link2, CalendarIcon, ExternalLink, Settings2, CheckCircle2, Clock, Timer, Search, FileCheck, FileX, PackageCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

type ConciliacaoItem = {
  gc_os_id: string;
  gc_os_codigo: string;
  gc_cliente: string;
  gc_situacao: string;
  gc_situacao_id: string;
  gc_valor_total: string;
  data_os: string;
  auvo_task_id: string;
  conciliada: boolean;
  auvo_finalizada: boolean | null;
  auvo_pendencia: string | null;
  auvo_tecnico_nome: string | null;
  auvo_tecnico_id: string | null;
  auvo_cliente: string | null;
  gc_vendedor_id: string | null;
  gc_vendedor_nome: string | null;
  vendedor_status: string;
  tempo_trabalho_seg: number;
  tempo_pausa_seg: number;
  checkin_hora: string | null;
  checkout_hora: string | null;
  pecas_status?: string;
  pecas_aprovado?: boolean | null;
  pecas_resumo?: string | null;
  pecas_orc_qtd?: number;
  pecas_cobertas_qtd?: number;
  pecas_faltando_qtd?: number;
  pecas_parciais_qtd?: number;
  pecas_detalhes?: any;
};

type UsuarioMap = {
  id: string;
  auvo_user_id: string;
  auvo_user_nome: string;
  gc_vendedor_id: string;
  gc_vendedor_nome: string;
  ativo: boolean;
};

type ConciliacaoResponse = {
  total: number;
  conciliadas: number;
  pendentes: number;
  alteradas?: number;
  snapshot_em?: string | null;
  itens: ConciliacaoItem[];
};

const SITUACOES_OPTIONS = [
  { id: "7063579", label: "AGUARDANDO COMPRA DE PEÇAS" },
  { id: "7063580", label: "AGUARDANDO CHEGADA DE PEÇAS" },
  { id: "7659440", label: "AGUARDANDO FABRICAÇÃO" },
  { id: "7063581", label: "PEDIDO EM CONFERENCIA" },
  { id: "7063705", label: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO" },
  { id: "7213493", label: "SERVICO AGUARDANDO EXECUCAO" },
  { id: "7684665", label: "RETIRADA PELO TECNICO" },
  { id: "7748831", label: "AGUARDANDO RETIRADA" },
  { id: "8219136", label: "EM ROTA" },
  { id: "7116099", label: "EXECUTADO – AG. NEGOCIAÇÃO" },
  { id: "8889036", label: "FECHADO CHAMADO" },
];

function formatTempo(segundos: number): string {
  if (!segundos || segundos <= 0) return "—";
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHora(isoDate: string | null): string {
  if (!isoDate) return "—";
  try {
    return format(new Date(isoDate), "HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

const gcOsUrl = (gcOsId: string) => `https://gestaoclick.com/ordens_servicos/visualizar/${gcOsId}`;
const auvoTaskUrl = (taskId: string) => `https://app.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`;

const AuvoSyncPage = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // ─── Conciliação state ───
  const [dataInicio, setDataInicio] = useState<Date | undefined>(undefined);
  const [dataFim, setDataFim] = useState<Date | undefined>(undefined);
  
  const [conciliacaoData, setConciliacaoData] = useState<ConciliacaoItem[] | null>(null);
  const [snapshotEm, setSnapshotEm] = useState<string | null>(null);
  const [loadingConciliacao, setLoadingConciliacao] = useState(false);
  const [filtroConciliacao, setFiltroConciliacao] = useState<"todas" | "pendentes" | "conciliadas">("todas");
  const [selectedOsIds, setSelectedOsIds] = useState<Set<string>>(new Set());
  const [situacaoDestino, setSituacaoDestino] = useState("");
  const [changingAll, setChangingAll] = useState(false);
  const [movedOsIds, setMovedOsIds] = useState<Set<string>>(new Set());
  const [changingId, setChangingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filtroClientePos, setFiltroClientePos] = useState("");
  const [filtroSituacaoPos, setFiltroSituacaoPos] = useState("");
  const [filtroTecnicoPos, setFiltroTecnicoPos] = useState("");
  const [filtroStatusAuvo, setFiltroStatusAuvo] = useState("");
  // ─── Mapeamento state ───
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAuvoUser, setSelectedAuvoUser] = useState("");
  const [selectedAuvoUserNome, setSelectedAuvoUserNome] = useState("");
  const [selectedGcVendedor, setSelectedGcVendedor] = useState("");
  const [selectedGcVendedorNome, setSelectedGcVendedorNome] = useState("");

  // ─── Queries ───
  const { data: mapeamentos, isLoading: loadingMap } = useQuery({
    queryKey: ["auvo-gc-mapeamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("auvo_gc_usuario_map").select("*").order("auvo_user_nome");
      if (error) throw error;
      return data as UsuarioMap[];
    },
  });

  const { data: auvoUsers, isLoading: loadingAuvoUsers } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", { body: { action: "list_auvo_users" } });
      if (error) throw error;
      return (data?.users || []) as Array<{ userID: number; name: string }>;
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
        todos.push(...lista.map((f: any) => ({ id: String(f.id || ""), nome: String(f.nome || f.name || "") })));
        totalPaginas = Number(meta?.total_paginas || 1);
        pagina += 1;
      } while (pagina <= totalPaginas);
      return todos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
    enabled: dialogOpen,
  });

  const { data: conciliacaoSalva, isLoading: loadingConciliacaoSalva } = useQuery({
    queryKey: ["conciliacao-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", { body: { action: "get_last_conciliacao" } });
      if (error) throw error;
      return data as ConciliacaoResponse;
    },
    staleTime: 60000,
  });

  useEffect(() => {
    if (!conciliacaoData && conciliacaoSalva?.itens?.length) {
      setConciliacaoData(conciliacaoSalva.itens);
      setSnapshotEm(conciliacaoSalva.snapshot_em || null);
    }
  }, [conciliacaoSalva, conciliacaoData]);

  const salvarMapeamento = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("auvo_gc_usuario_map").upsert({
        auvo_user_id: selectedAuvoUser, auvo_user_nome: selectedAuvoUserNome,
        gc_vendedor_id: selectedGcVendedor, gc_vendedor_nome: selectedGcVendedorNome,
        ativo: true, atualizado_em: new Date().toISOString(),
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

  // ─── Conciliação actions ───
  const buscarConciliacao = async () => {
    setLoadingConciliacao(true);
    setSelectedOsIds(new Set());
    setMovedOsIds(new Set());
    try {
      const syncBody: any = { action: "conciliacao" };
      if (dataInicio) syncBody.data_inicio = format(dataInicio, "yyyy-MM-dd");
      if (dataFim) syncBody.data_fim = format(dataFim, "yyyy-MM-dd");
      
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", { body: syncBody });
      if (error) throw error;
      const payload = data as ConciliacaoResponse;
      setConciliacaoData(payload?.itens || []);
      setSnapshotEm(payload?.snapshot_em || null);
      toast.success(`${payload?.total || 0} OS encontradas — ${payload?.conciliadas || 0} conciliadas, ${payload?.pendentes || 0} pendentes (${payload?.alteradas || 0} alteradas)`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoadingConciliacao(false);
    }
  };

  const atualizarStatusLocal = (gcOsId: string, situacaoId: string) => {
    const label = SITUACOES_OPTIONS.find(s => s.id === situacaoId)?.label || situacaoId;
    setConciliacaoData(prev => prev?.map(i => i.gc_os_id === gcOsId ? { ...i, gc_situacao: label, gc_situacao_id: situacaoId, conciliada: true } : i) || null);
  };

  const alterarSituacaoOS = async (item: ConciliacaoItem, situacaoId: string) => {
    setChangingId(item.gc_os_id);
    try {
      const dataSaida = item.checkout_hora ? item.checkout_hora.split("T")[0] : (item.data_os || null);
      const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_os", gc_os_id: item.gc_os_id, gc_os_codigo: item.gc_os_codigo,
          situacao_id_antes: situacaoId,
          gc_vendedor_id: item.gc_vendedor_id || null, gc_vendedor_nome: item.gc_vendedor_nome || null,
          data_saida: dataSaida,
          gc_usuario_id: profile?.gc_user_id || null,
        },
      });
      if (error) throw error;
      if (data?.success) {
        atualizarStatusLocal(item.gc_os_id, situacaoId);
        setMovedOsIds(prev => new Set(prev).add(item.gc_os_id));
        toast.success(`OS ${item.gc_os_codigo} → situação alterada`);
      } else {
        toast.error(`Erro: ${JSON.stringify(data?.body || data?.error || data)}`);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setChangingId(null);
    }
  };

  const alterarSelecionadas = async () => {
    if (!situacaoDestino || selectedOsIds.size === 0) return;
    const label = SITUACOES_OPTIONS.find(s => s.id === situacaoDestino)?.label || situacaoDestino;
    if (!window.confirm(`Alterar ${selectedOsIds.size} OS para "${label}"?`)) return;
    setChangingAll(true);
    let ok = 0, fail = 0;
    const selecionadas = (conciliacaoData || []).filter(i => selectedOsIds.has(i.gc_os_id));
    for (const item of selecionadas) {
      try {
        const dataSaida = item.checkout_hora ? item.checkout_hora.split("T")[0] : (item.data_os || null);
        const { data, error } = await supabase.functions.invoke("auvo-gc-sync", {
          body: {
            action: "revert_os", gc_os_id: item.gc_os_id, gc_os_codigo: item.gc_os_codigo,
            situacao_id_antes: situacaoDestino,
            gc_vendedor_id: item.gc_vendedor_id || null, gc_vendedor_nome: item.gc_vendedor_nome || null,
            data_saida: dataSaida,
          },
        });
        if (error) throw error;
        if (data?.success) {
          ok++;
          atualizarStatusLocal(item.gc_os_id, situacaoDestino);
          setMovedOsIds(prev => new Set(prev).add(item.gc_os_id));
        } else fail++;
      } catch { fail++; }
    }
    toast.success(`${ok} OS alteradas, ${fail} erros`);
    setChangingAll(false);
    setSelectedOsIds(new Set());
  };



  const clientesUnicos = useMemo(() => {
    if (!conciliacaoData) return [];
    return [...new Set(conciliacaoData.map(i => i.gc_cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [conciliacaoData]);

  const situacoesUnicas = useMemo(() => {
    if (!conciliacaoData) return [];
    return [...new Set(conciliacaoData.map(i => i.gc_situacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [conciliacaoData]);

  const tecnicosUnicos = useMemo(() => {
    if (!conciliacaoData) return [];
    return [...new Set(conciliacaoData.map(i => i.auvo_tecnico_nome).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [conciliacaoData]);

  // ─── Filtered + searched data ───
  const itensFiltrados = useMemo(() => {
    if (!conciliacaoData) return [];
    let items = conciliacaoData;
    if (filtroConciliacao === "pendentes") items = items.filter(i => !i.conciliada);
    else if (filtroConciliacao === "conciliadas") items = items.filter(i => i.conciliada);
    if (filtroClientePos) items = items.filter(i => i.gc_cliente === filtroClientePos);
    if (filtroSituacaoPos) items = items.filter(i => i.gc_situacao === filtroSituacaoPos);
    if (filtroTecnicoPos) items = items.filter(i => i.auvo_tecnico_nome === filtroTecnicoPos);
    if (filtroStatusAuvo === "finalizada_sem_pendencia") items = items.filter(i => i.auvo_finalizada === true && (!i.auvo_pendencia || !i.auvo_pendencia.trim()));
    else if (filtroStatusAuvo === "finalizada_com_pendencia") items = items.filter(i => i.auvo_finalizada === true && i.auvo_pendencia && i.auvo_pendencia.trim());
    else if (filtroStatusAuvo === "finalizada") items = items.filter(i => i.auvo_finalizada === true);
    else if (filtroStatusAuvo === "nao_finalizada") items = items.filter(i => i.auvo_finalizada !== true);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      items = items.filter(i =>
        i.gc_os_codigo.toLowerCase().includes(q) ||
        i.gc_cliente.toLowerCase().includes(q) ||
        (i.auvo_tecnico_nome || "").toLowerCase().includes(q) ||
        (i.auvo_cliente || "").toLowerCase().includes(q) ||
        i.auvo_task_id.includes(q)
      );
    }
    return items;
  }, [conciliacaoData, filtroConciliacao, filtroClientePos, filtroSituacaoPos, filtroTecnicoPos, filtroStatusAuvo, searchText]);

  const totalConciliadas = conciliacaoData?.filter(i => i.conciliada).length || 0;
  const totalPendentes = conciliacaoData?.filter(i => !i.conciliada).length || 0;
  const totalFinalizadas = conciliacaoData?.filter(i => i.auvo_finalizada && !i.conciliada).length || 0;

  return (
    <div className="min-h-screen bg-background p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">📋 Conciliação Auvo ↔ GC</h1>
          <p className="text-muted-foreground">Visão unificada de todas as OS com tarefa Auvo e seu status no GestãoClick</p>
        </div>
      </div>

      <Tabs defaultValue="conciliacao">
        <TabsList>
          <TabsTrigger value="conciliacao">📋 Conciliação</TabsTrigger>
          <TabsTrigger value="mapeamento">🔗 Mapeamento de Técnicos</TabsTrigger>
        </TabsList>

        {/* ─── TAB: Conciliação ─── */}
        <TabsContent value="conciliacao" className="space-y-4">
          {/* Buscar + Atualizar */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Data Início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[160px] justify-start text-left font-normal">
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
                  <Button variant="outline" className="w-[160px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataFim ? format(dataFim, "dd/MM/yyyy") : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataFim} onSelect={setDataFim} locale={ptBR} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={buscarConciliacao} disabled={loadingConciliacao} className="h-10">
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingConciliacao ? "animate-spin" : ""}`} />
              {loadingConciliacao ? "Buscando..." : conciliacaoData ? "Atualizar" : "Buscar Conciliação"}
            </Button>
            {(dataInicio || dataFim) && (
              <Button variant="ghost" size="sm" className="text-xs h-10" onClick={() => { setDataInicio(undefined); setDataFim(undefined); }}>
                Limpar datas
              </Button>
            )}
            {snapshotEm && (
              <span className="text-xs text-muted-foreground self-end pb-2">
                Snapshot: {format(new Date(snapshotEm), "dd/MM/yyyy HH:mm")}
              </span>
            )}
          </div>


          {conciliacaoData && (
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFiltroConciliacao("todas")}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total</p>
                      <p className="text-3xl font-bold">{conciliacaoData.length}</p>
                    </div>
                    <FileCheck className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow border-green-200 dark:border-green-800" onClick={() => setFiltroConciliacao("conciliadas")}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-green-600">Conciliadas</p>
                      <p className="text-3xl font-bold text-green-600">{totalConciliadas}</p>
                    </div>
                    <CheckCircle2 className="h-8 w-8 text-green-500/30" />
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow border-amber-200 dark:border-amber-800" onClick={() => setFiltroConciliacao("pendentes")}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-amber-600">Pendentes</p>
                      <p className="text-3xl font-bold text-amber-600">{totalPendentes}</p>
                    </div>
                    <FileX className="h-8 w-8 text-amber-500/30" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600">Finalizadas (Auvo)</p>
                      <p className="text-3xl font-bold text-blue-600">{totalFinalizadas}</p>
                      <p className="text-xs text-muted-foreground">Prontas p/ conciliar</p>
                    </div>
                    <Timer className="h-8 w-8 text-blue-500/30" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tabela de conciliação */}
          {conciliacaoData && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">
                      {filtroConciliacao === "todas" ? "Todas as OS" : filtroConciliacao === "conciliadas" ? "OS Conciliadas" : "OS Pendentes"}
                    </CardTitle>
                    <Badge variant="secondary">{itensFiltrados.length}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input placeholder="Buscar OS, cliente, técnico..." value={searchText} onChange={e => setSearchText(e.target.value)} className="w-[220px] h-8 text-sm" />
                  </div>
                </div>

                {/* Filtros pós-busca */}
                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t">
                  <span className="text-xs font-medium text-muted-foreground">Filtros:</span>
                  <Select value={filtroConciliacao} onValueChange={(v) => setFiltroConciliacao(v as "todas" | "pendentes" | "conciliadas")}>
                    <SelectTrigger className="h-8 text-xs w-[210px]"><SelectValue placeholder="Conciliação" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas (conciliadas + não)</SelectItem>
                      <SelectItem value="conciliadas">Só conciliadas</SelectItem>
                      <SelectItem value="pendentes">Só não conciliadas</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filtroStatusAuvo || "__all__"} onValueChange={v => setFiltroStatusAuvo(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs w-[270px]"><SelectValue placeholder="Fechamento da atividade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Fechada e não fechada</SelectItem>
                      <SelectItem value="finalizada">✅ Fechada (todas)</SelectItem>
                      <SelectItem value="finalizada_sem_pendencia">✅ Fechada sem pendência</SelectItem>
                      <SelectItem value="finalizada_com_pendencia">⚠️ Fechada com pendência</SelectItem>
                      <SelectItem value="nao_finalizada">⏳ Não fechada</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filtroClientePos || "__all__"} onValueChange={v => setFiltroClientePos(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs w-[220px]"><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os clientes</SelectItem>
                      {clientesUnicos.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtroSituacaoPos || "__all__"} onValueChange={v => setFiltroSituacaoPos(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs w-[260px]"><SelectValue placeholder="Todas as situações" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas as situações</SelectItem>
                      {situacoesUnicas.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtroTecnicoPos || "__all__"} onValueChange={v => setFiltroTecnicoPos(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue placeholder="Todos os técnicos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os técnicos</SelectItem>
                      {tecnicosUnicos.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(filtroClientePos || filtroSituacaoPos || filtroTecnicoPos || filtroStatusAuvo || filtroConciliacao !== "todas") && (
                    <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => { setFiltroClientePos(""); setFiltroSituacaoPos(""); setFiltroTecnicoPos(""); setFiltroStatusAuvo(""); setFiltroConciliacao("todas"); }}>
                      Limpar filtros
                    </Button>
                  )}
                </div>

                {/* Barra de ações em lote */}
                  <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t">
                    <Button
                      variant="outline" size="sm" className="text-xs"
                      onClick={() => {
                        const selecionaveis = itensFiltrados.filter(i => !movedOsIds.has(i.gc_os_id));
                        if (selectedOsIds.size === selecionaveis.length && selecionaveis.every(i => selectedOsIds.has(i.gc_os_id))) {
                          setSelectedOsIds(new Set());
                        } else {
                          setSelectedOsIds(new Set(selecionaveis.map(i => i.gc_os_id)));
                        }
                      }}
                    >
                      {(() => {
                        const selecionaveis = itensFiltrados.filter(i => !movedOsIds.has(i.gc_os_id));
                        return selectedOsIds.size === selecionaveis.length && selecionaveis.every(i => selectedOsIds.has(i.gc_os_id))
                          ? "Desmarcar tudo" : "Selecionar tudo";
                      })()}
                    </Button>
                    {selectedOsIds.size > 0 && (
                      <>
                        <span className="text-xs text-muted-foreground">{selectedOsIds.size} selecionada(s)</span>
                        <Select value={situacaoDestino} onValueChange={setSituacaoDestino}>
                          <SelectTrigger className="h-8 text-xs w-[260px]"><SelectValue placeholder="Situação destino" /></SelectTrigger>
                          <SelectContent>
                            {SITUACOES_OPTIONS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-8 text-xs" disabled={!situacaoDestino || changingAll} onClick={alterarSelecionadas}>
                          <Settings2 className="h-3 w-3 mr-1" />
                          {changingAll ? "Alterando..." : `Alterar situação (${selectedOsIds.size})`}
                        </Button>
                      </>
                    )}
                  </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[65vh]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="text-center w-[90px]">Status</TableHead>
                        <TableHead>OS (GC)</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Tarefa (Auvo)</TableHead>
                        <TableHead>Técnico / Vendedor</TableHead>
                        <TableHead>Situação GC</TableHead>
                        <TableHead className="text-center">Auvo</TableHead>
                        <TableHead className="text-center">
                          <div className="flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> Trabalho</div>
                        </TableHead>
                        <TableHead className="text-center">
                          <div className="flex items-center justify-center gap-1"><Timer className="h-3 w-3" /> Pausa</div>
                        </TableHead>
                        <TableHead className="text-center">Check-in</TableHead>
                        <TableHead className="text-center">Check-out</TableHead>
                        <TableHead className="text-center">
                          <div className="flex items-center justify-center gap-1"><PackageCheck className="h-3 w-3" /> Peças</div>
                        </TableHead>
                        <TableHead className="w-[100px]">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itensFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={17} className="text-center text-muted-foreground py-12">
                            {loadingConciliacao ? "Buscando..." : "Nenhuma OS encontrada"}
                          </TableCell>
                        </TableRow>
                      ) : itensFiltrados.map((item) => {
                        const moved = movedOsIds.has(item.gc_os_id);
                        const selected = selectedOsIds.has(item.gc_os_id);
                        return (
                          <TableRow
                            key={item.gc_os_id}
                            className={`transition-colors text-sm ${
                              moved ? "bg-green-50 dark:bg-green-950/20 opacity-50" :
                              item.conciliada ? "bg-green-50/40 dark:bg-green-950/10" :
                              selected ? "bg-accent/30" : ""
                            }`}
                          >
                            <TableCell className="text-center">
                              {!moved && (
                                <Checkbox
                                  checked={selected}
                                  onCheckedChange={() => {
                                    const next = new Set(selectedOsIds);
                                    if (next.has(item.gc_os_id)) next.delete(item.gc_os_id);
                                    else next.add(item.gc_os_id);
                                    setSelectedOsIds(next);
                                  }}
                                />
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {moved ? (
                                <Badge variant="outline" className="text-[10px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700">✅ Movida</Badge>
                              ) : item.conciliada ? (
                                <Badge variant="outline" className="text-[10px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700">
                                  <CheckCircle2 className="h-3 w-3 mr-0.5" /> Conciliada
                                </Badge>
                              ) : item.auvo_finalizada ? (
                                <Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700">
                                  Finalizada
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700">
                                  Pendente
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <span className={`font-mono text-xs ${moved ? "line-through text-muted-foreground" : "font-medium"}`}>{item.gc_os_codigo}</span>
                                <a href={gcOsUrl(item.gc_os_id)} target="_blank" rel="noopener noreferrer" title="Abrir no GC">
                                  <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                </a>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs truncate block max-w-[180px]" title={item.gc_cliente}>{item.gc_cliente || "—"}</span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.data_os ? (() => { try { return format(new Date(item.data_os), "dd/MM/yy"); } catch { return item.data_os; } })() : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-xs font-medium">
                                {item.gc_valor_total && item.gc_valor_total !== "0"
                                  ? `R$ ${item.gc_valor_total}`
                                  : "—"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-xs">{item.auvo_task_id}</span>
                                <a href={auvoTaskUrl(item.auvo_task_id)} target="_blank" rel="noopener noreferrer" title="Abrir no Auvo">
                                  <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                </a>
                              </div>
                              {item.auvo_cliente && <span className="text-xs text-muted-foreground block truncate max-w-[150px]" title={item.auvo_cliente}>{item.auvo_cliente}</span>}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                <span className="text-xs font-medium block">{item.auvo_tecnico_nome || item.gc_vendedor_nome || "—"}</span>
                                {item.vendedor_status === "mapeado" && <Badge variant="default" className="text-[10px]">✅ Mapeado</Badge>}
                                {item.vendedor_status === "sem_mapeamento" && <Badge variant="destructive" className="text-[10px]">⚠️ Sem Mapa</Badge>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs">{item.gc_situacao}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              {item.auvo_finalizada === true ? (
                                <span className="text-green-600 text-xs font-medium">✅</span>
                              ) : item.auvo_finalizada === false ? (
                                <span className="text-amber-600 text-xs">⏳</span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                              {item.auvo_pendencia && item.auvo_pendencia.trim() && (
                                <span className="text-[10px] text-destructive block" title={item.auvo_pendencia}>Pendência</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs font-medium text-blue-600">
                              {formatTempo(item.tempo_trabalho_seg)}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-amber-600">
                              {formatTempo(item.tempo_pausa_seg)}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-muted-foreground">
                              {formatHora(item.checkin_hora)}
                            </TableCell>
                            <TableCell className="text-center font-mono text-xs text-muted-foreground">
                              {formatHora(item.checkout_hora)}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                const status = item.pecas_status;
                                if (!status || status === "nao_validado") {
                                  return <span className="text-muted-foreground text-xs">—</span>;
                                }
                                if (status === "sem_pecas") {
                                  return (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger><span className="text-muted-foreground text-xs">N/A</span></TooltipTrigger>
                                        <TooltipContent><p className="text-xs">OS sem peças no orçamento</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                }
                                if (status === "erro") {
                                  return <span className="text-destructive text-xs">Erro</span>;
                                }
                                const d = item.pecas_detalhes;
                                return (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1">
                                        {item.pecas_aprovado ? (
                                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        ) : (
                                          <AlertTriangle className="h-4 w-4 text-destructive" />
                                        )}
                                        <span className={`text-[10px] font-medium ${item.pecas_aprovado ? "text-green-600" : "text-destructive"}`}>
                                          {item.pecas_cobertas_qtd}/{item.pecas_orc_qtd}
                                        </span>
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[380px] p-3" align="end">
                                      <div className="space-y-3">
                                        <p className="text-sm font-semibold flex items-center gap-1.5">
                                          {item.pecas_aprovado ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                                          {item.pecas_resumo}
                                        </p>
                                        {d?.itens_cobertos?.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-green-600 mb-1">✅ Cobertas ({d.itens_cobertos.length})</p>
                                            {d.itens_cobertos.map((ic: any, idx: number) => (
                                              <div key={idx} className="text-[11px] text-muted-foreground ml-2">
                                                • {ic.descricao} → {ic.match} ({ic.score}%){ic.qtd_orc != null && ` | Qtd: ${ic.qtd_exec}/${ic.qtd_orc}`}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {d?.itens_parciais?.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-amber-600 mb-1">⚠️ Parciais ({d.itens_parciais.length})</p>
                                            {d.itens_parciais.map((ip: any, idx: number) => (
                                              <div key={idx} className="text-[11px] text-muted-foreground ml-2">
                                                • {ip.descricao} → {ip.melhor_match} ({ip.score}%){ip.motivo && ` — ${ip.motivo}`}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {d?.itens_faltando?.length > 0 && (
                                          <div>
                                            <p className="text-xs font-medium text-destructive mb-1">❌ Faltando ({d.itens_faltando.length})</p>
                                            {d.itens_faltando.map((f: any, idx: number) => (
                                              <div key={idx} className="text-[11px] text-muted-foreground ml-2">
                                                • {f.descricao} — {f.motivo}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {d?.materiais_execucao?.length > 0 && (
                                          <div className="border-t pt-2">
                                            <p className="text-xs font-medium text-muted-foreground mb-1">📋 Materiais da execução ({d.materiais_execucao.length})</p>
                                            {d.materiais_execucao.map((m: any, idx: number) => (
                                              <div key={idx} className="text-[11px] text-muted-foreground ml-2">
                                                • {m.quantidade}x {m.descricao}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              {!moved && (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={changingId === item.gc_os_id}>
                                      {changingId === item.gc_os_id ? "..." : "Mover"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[280px] p-2" align="end">
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-muted-foreground mb-2">Mover OS para:</p>
                                      {SITUACOES_OPTIONS.map(s => (
                                        <Button
                                          key={s.id}
                                          variant="ghost"
                                          size="sm"
                                          className="w-full justify-start text-xs h-7"
                                          onClick={() => alterarSituacaoOS(item, s.id)}
                                        >
                                          {s.label}
                                        </Button>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {!conciliacaoData && (
            <Card>
              <CardContent className="py-16 text-center">
                <FileCheck className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  {loadingConciliacaoSalva ? "Carregando última conciliação salva..." : "Selecione um período e clique em \"Buscar Conciliação\""}
                </p>
                <p className="text-sm text-muted-foreground mt-1">O sistema cruza as OS do GestãoClick com as tarefas do Auvo e mantém um snapshot salvo</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TAB: Mapeamento ─── */}
        <TabsContent value="mapeamento" className="space-y-4">
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
                      <Select value={selectedAuvoUser} onValueChange={(v) => {
                        setSelectedAuvoUser(v);
                        const user = auvoUsers?.find(u => String(u.userID) === v);
                        setSelectedAuvoUserNome(user?.name || v);
                      }}>
                        <SelectTrigger><SelectValue placeholder={loadingAuvoUsers ? "Carregando..." : "Selecione"} /></SelectTrigger>
                        <SelectContent>
                          {auvoUsers?.map(u => <SelectItem key={u.userID} value={String(u.userID)}>{u.name} (ID: {u.userID})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Vendedor GC</label>
                      <Select value={selectedGcVendedor} onValueChange={(v) => {
                        setSelectedGcVendedor(v);
                        const vend = gcVendedores?.find(f => f.id === v);
                        setSelectedGcVendedorNome(vend?.nome || v);
                      }}>
                        <SelectTrigger><SelectValue placeholder={loadingGcVendedores ? "Carregando..." : "Selecione"} /></SelectTrigger>
                        <SelectContent>
                          {gcVendedores?.map(f => <SelectItem key={f.id} value={f.id}>{f.nome} (ID: {f.id})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => salvarMapeamento.mutate()} disabled={!selectedAuvoUser || !selectedGcVendedor || salvarMapeamento.isPending}>
                      {salvarMapeamento.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingMap ? <p className="text-sm text-muted-foreground">Carregando...</p> : !mapeamentos?.length ? (
                <p className="text-sm text-muted-foreground">Nenhum mapeamento configurado.</p>
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
                          <Button variant="ghost" size="sm" onClick={() => toggleAtivo.mutate({ id: m.id, ativo: !m.ativo })}>
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
