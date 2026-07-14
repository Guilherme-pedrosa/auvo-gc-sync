import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Search, Filter, RefreshCw, CalendarIcon, ExternalLink, Edit2,
  FileText, Loader2, CheckCircle2, Package, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import LastSyncBadge from "@/components/LastSyncBadge";
import { useAuth } from "@/hooks/useAuth";

const PAGE_SIZE = 1000;
const formatCurrency = (val: number) =>
  (val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Apenas orçamentos aguardando aprovação devem aparecer aqui */
const SITUACAO_ABERTA_REGEX = /aguardando\s*aprova/i;

const fetchOrcamentosNoPeriodo = async (fromDate: Date, toDate: Date) => {
  const fromStr = format(fromDate, "yyyy-MM-dd");
  const toStr = format(toDate, "yyyy-MM-dd");
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("tarefas_central")
      .select("*")
      .not("gc_orcamento_id", "is", null)
      .gte("gc_orc_data", fromStr)
      .lte("gc_orc_data", toStr)
      .order("gc_orc_data", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Merge com followup_kanban_cache (fonte de verdade "Aguardando Aprovação")
  // para incluir orçamentos que ainda NÃO têm tarefa Auvo vinculada.
  const seen = new Set(rows.map((r: any) => String(r.gc_orcamento_id || "")));
  const { data: cache } = await supabase
    .from("followup_kanban_cache")
    .select("gc_orcamento_id, atualizado_em, dados")
    .eq("coluna", "7063588");
  for (const c of cache || []) {
    const id = String((c as any).gc_orcamento_id || "");
    if (!id || seen.has(id)) continue;
    const d: any = (c as any).dados || {};
    const dataOrc = String(d.data || "").slice(0, 10);
    if (!dataOrc || dataOrc < fromStr || dataOrc > toStr) continue;
    rows.push({
      gc_orcamento_id: id,
      gc_orcamento_codigo: d.gc_orcamento_codigo || "",
      gc_orc_situacao: d.situacao || "",
      gc_orc_situacao_id: d.situacao_id || "",
      gc_orc_cor_situacao: d.cor_situacao || "",
      gc_orc_data: dataOrc,
      gc_orc_valor_total: Number(d.valor_total || 0),
      gc_orc_cliente: d.cliente || "",
      cliente: d.cliente || "",
      gc_orc_vendedor: d.vendedor || "",
      gc_orc_link: d.link || null,
      auvo_task_id: null,
      atualizado_em: (c as any).atualizado_em || null,
      _origem_cache_followup: true,
    });
    seen.add(id);
  }
  return rows;
};

export default function OrcamentosControlePage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const today = new Date();
  // Default: últimos 12 meses até fim do mês atual (pega antigos + novos)
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(subMonths(today, 12)));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [excludedSituacoes, setExcludedSituacoes] = useState<Set<string>>(new Set());
  const [searchSituacao, setSearchSituacao] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<any | null>(null);

  // Conciliação
  const [conciliacaoCard, setConciliacaoCard] = useState<any | null>(null);
  const [conciliacaoSituacao, setConciliacaoSituacao] = useState("");
  const [changingId, setChangingId] = useState<string | null>(null);
  const [movedIds, setMovedIds] = useState<Set<string>>(new Set());

  // Edit Auvo task
  const [editingCard, setEditingCard] = useState<any | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editHour, setEditHour] = useState("08");
  const [editMinute, setEditMinute] = useState("00");
  const [editTecnicoId, setEditTecnicoId] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const refreshTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["orcamentos-controle"] });
    queryClient.invalidateQueries({ queryKey: ["last-sync-timestamp"] });
  }, [queryClient]);

  useEffect(() => () => {
    refreshTimeoutsRef.current.forEach(clearTimeout);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const syncFrom = format(dateFrom, "yyyy-MM-dd");
      const syncTo = format(dateTo, "yyyy-MM-dd");
      const { data, error } = await supabase.functions.invoke("central-sync", {
        body: { start_date: syncFrom, end_date: syncTo, situacao_ids: [], fast: false },
      });
      if (error) throw error;
      if (data?.background) {
        toast.info("Sync rodando em background — atualizando automaticamente");
        const delays = [15000, 30000, 60000];
        refreshTimeoutsRef.current = delays.map((d) => setTimeout(refreshData, d));
        setTimeout(() => setSyncing(false), 2500);
        return;
      }
      toast.success(`Sync ${syncFrom} → ${syncTo}: ${data?.upserted || 0} atualizadas`);
      refreshData();
      setSyncing(false);
    } catch (err: any) {
      toast.error(`Erro: ${err.message || err}`);
      setSyncing(false);
    }
  };

  const { data: rows, isLoading } = useQuery({
    queryKey: ["orcamentos-controle", format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd")],
    queryFn: () => fetchOrcamentosNoPeriodo(dateFrom, dateTo),
    staleTime: 60_000,
  });

  // Auvo users for edit modal
  const { data: auvoUsers } = useQuery({
    queryKey: ["auvo-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "list-users" },
      });
      if (error) throw error;
      return (data?.data || []) as { userID: number; login: string; name: string }[];
    },
    staleTime: 1000 * 60 * 30,
  });

  // Detalhe do orçamento (peças/serviços) — busca quando abre o modal
  const selectedOrcId = selectedCard?.gc_orcamento_id || null;
  const { data: orcDetail, isLoading: orcDetailLoading } = useQuery({
    queryKey: ["orcamento-detail", selectedOrcId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body: { endpoint: `/api/orcamentos/${selectedOrcId}`, method: "GET" },
      });
      if (error) return null;
      const orcObj = data?.data?.data ?? data?.data ?? null;
      if (orcObj) {
        const produtosRaw: any[] = orcObj?.produtos || [];
        const servicosRaw: any[] = orcObj?.servicos || [];
        const allItems = [
          ...produtosRaw.map((p: any) => ({ item: p?.produto || p })),
          ...servicosRaw.map((s: any) => ({ item: s?.servico || s })),
        ];
        const uniqueIds = [
          ...new Set(
            allItems
              .map((i) => String(i.item?.produto_id || i.item?.servico_id || ""))
              .filter(Boolean)
          ),
        ];
        if (uniqueIds.length > 0) {
          const codeMap = new Map<string, string>();
          await Promise.all(
            uniqueIds.map(async (pid) => {
              for (const endpoint of [`/api/produtos/${pid}`, `/api/servicos/${pid}`]) {
                try {
                  const { data: prodData, error: prodError } = await supabase.functions.invoke("gc-proxy", {
                    body: { endpoint, method: "GET" },
                  });
                  if (prodError) continue;
                  const prodObj = prodData?.data?.data ?? prodData?.data ?? null;
                  if (!prodObj || prodData?.status === 404 || prodData?.code === 404) continue;
                  const code = prodObj?.codigo_interno || prodObj?.codigo_barra || prodObj?.codigo || "";
                  if (code) { codeMap.set(pid, code); break; }
                } catch { /* ignore */ }
              }
            })
          );
          for (const p of produtosRaw) {
            const inner = p?.produto || p;
            const pid = String(inner?.produto_id || "");
            if (pid && codeMap.has(pid)) inner.codigo_interno = codeMap.get(pid);
          }
          for (const s of servicosRaw) {
            const inner = s?.servico || s;
            const sid = String(inner?.servico_id || inner?.produto_id || "");
            if (sid && codeMap.has(sid)) inner.codigo_interno = codeMap.get(sid);
          }
        }
      }
      return orcObj;
    },
    enabled: !!selectedOrcId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // Dedup orçamentos por gc_orcamento_id
  const orcamentos = useMemo(() => {
    if (!rows) return [];
    const byId = new Map<string, any>();
    for (const r of rows) {
      const id = r.gc_orcamento_id;
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing || (r.atualizado_em || "") > (existing.atualizado_em || "")) {
        byId.set(id, r);
      }
    }
    // Filtra "fechados"
    return Array.from(byId.values()).filter((t) => {
      const sit = t.gc_orc_situacao || "";
      return SITUACAO_ABERTA_REGEX.test(sit);
    });
  }, [rows]);

  const allSituacoes = useMemo(() => {
    const set = new Set(orcamentos.map((t) => t.gc_orc_situacao || "").filter(Boolean));
    return Array.from(set).sort();
  }, [orcamentos]);

  const filteredSituacoes = useMemo(() => {
    if (!searchSituacao) return allSituacoes;
    return allSituacoes.filter((s) => s.toLowerCase().includes(searchSituacao.toLowerCase()));
  }, [allSituacoes, searchSituacao]);

  const filteredItems = useMemo(() => {
    let items = orcamentos.filter((t) => !movedIds.has(t.gc_orcamento_id));
    if (excludedSituacoes.size > 0) {
      items = items.filter((t) => !excludedSituacoes.has(t.gc_orc_situacao || ""));
    }
    // Filtro por data do orçamento (gc_orc_data) dentro do range selecionado
    const fromStr = format(dateFrom, "yyyy-MM-dd");
    const toStr = format(dateTo, "yyyy-MM-dd");
    items = items.filter((t) => {
      const d = (t.gc_orc_data || "").slice(0, 10);
      if (!d) return false;
      return d >= fromStr && d <= toStr;
    });
    return items;
  }, [orcamentos, excludedSituacoes, movedIds, dateFrom, dateTo]);

  const clienteSummary = useMemo(() => {
    const map = new Map<string, { cliente: string; count: number; total: number; items: any[] }>();
    for (const item of filteredItems) {
      const cliente = item.gc_orc_cliente || item.cliente || "Sem cliente";
      const entry = map.get(cliente) || { cliente, count: 0, total: 0, items: [] };
      entry.count++;
      entry.total += Number(item.gc_orc_valor_total) || 0;
      entry.items.push(item);
      map.set(cliente, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredItems]);

  const filtered = useMemo(() => {
    if (!search) return clienteSummary;
    const s = search.toLowerCase();
    const result: typeof clienteSummary = [];
    for (const c of clienteSummary) {
      if (c.cliente.toLowerCase().includes(s)) {
        result.push(c);
      } else {
        const matching = c.items.filter((it: any) =>
          (it.gc_orc_situacao || "").toLowerCase().includes(s) ||
          (it.gc_orcamento_codigo || "").toLowerCase().includes(s) ||
          (String(it.gc_orcamento_id || "")).includes(s) ||
          (it.auvo_task_id || "").toLowerCase().includes(s)
        );
        if (matching.length > 0) {
          result.push({
            ...c,
            count: matching.length,
            total: matching.reduce((sum, it: any) => sum + (Number(it.gc_orc_valor_total) || 0), 0),
            items: matching,
          });
        }
      }
    }
    return result;
  }, [clienteSummary, search]);

  const grandTotal = filtered.reduce((s, c) => s + c.total, 0);
  const grandCount = filtered.reduce((s, c) => s + c.count, 0);

  // ─── Conciliação ───
  const handleAlterarSituacao = async () => {
    if (!conciliacaoCard || !conciliacaoSituacao) return;
    setChangingId(conciliacaoCard.gc_orcamento_id);
    try {
      const { data: resp, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_orcamento",
          gc_orcamento_id: conciliacaoCard.gc_orcamento_id,
          gc_orcamento_codigo: conciliacaoCard.gc_orcamento_codigo,
          situacao_id: conciliacaoSituacao,
          gc_usuario_id: profile?.gc_user_id || null,
        },
      });
      if (error) throw error;
      if (resp?.success) {
        setMovedIds((prev) => new Set(prev).add(conciliacaoCard.gc_orcamento_id));
        toast.success(`Orçamento ${conciliacaoCard.gc_orcamento_codigo || conciliacaoCard.gc_orcamento_id} alterado`);
        refreshData();
      } else {
        toast.error(`Erro: ${JSON.stringify(resp?.body || resp?.error || resp)}`);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message || err}`);
    } finally {
      setChangingId(null);
      setConciliacaoCard(null);
      setConciliacaoSituacao("");
    }
  };

  // ─── Edit Auvo task ───
  const openEditModal = useCallback((card: any) => {
    setEditingCard(card);
    if (card.data_tarefa) {
      const d = new Date(card.data_tarefa + "T00:00:00");
      setEditDate(d);
    } else {
      setEditDate(undefined);
    }
    if (card.hora_inicio && /^\d{1,2}:\d{2}/.test(card.hora_inicio)) {
      const [h, m] = card.hora_inicio.split(":");
      setEditHour(h.padStart(2, "0"));
      setEditMinute(m.padStart(2, "0"));
    } else {
      setEditHour("08"); setEditMinute("00");
    }
    setEditTecnicoId(card.tecnico_id || "");
  }, []);

  const handleEditSave = async () => {
    if (!editingCard?.auvo_task_id) {
      toast.error("Tarefa Auvo não vinculada");
      return;
    }
    setEditSaving(true);
    try {
      const patches: { op: string; path: string; value: any }[] = [];
      if (editDate) {
        const h = editHour.padStart(2, "0");
        const m = editMinute.padStart(2, "0");
        patches.push({ op: "replace", path: "taskDate", value: format(editDate, `yyyy-MM-dd'T'${h}:${m}:00`) });
      }
      if (editTecnicoId) {
        patches.push({ op: "replace", path: "idUserTo", value: Number(editTecnicoId) });
      }
      if (patches.length === 0) {
        toast.warning("Nenhuma alteração");
        setEditSaving(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(editingCard.auvo_task_id), patches },
      });
      if (error) throw error;
      if (data?.status && data.status >= 400) {
        throw new Error(JSON.stringify(data?.data || "Erro Auvo"));
      }
      const tec = auvoUsers?.find((u) => String(u.userID) === editTecnicoId);
      await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "persist-central",
          row: {
            auvo_task_id: editingCard.auvo_task_id,
            data_tarefa: editDate ? format(editDate, "yyyy-MM-dd") : editingCard.data_tarefa,
            tecnico_id: editTecnicoId || editingCard.tecnico_id,
            tecnico: tec?.name || tec?.login || editingCard.tecnico,
          },
        },
      }).catch(() => null);
      toast.success(`Tarefa #${editingCard.auvo_task_id} atualizada`);
      refreshData();
      setEditingCard(null);
    } catch (err: any) {
      toast.error(`Erro: ${err.message || err}`);
    } finally {
      setEditSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-1/3" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Controle de Orçamentos</h1>
          <p className="text-sm text-muted-foreground">Orçamentos aguardando aprovação agrupados por cliente</p>
          <LastSyncBadge className="mt-0.5" />
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("gap-1.5 w-[130px] justify-start text-left font-normal")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(dateFrom, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus locale={ptBR} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-sm text-muted-foreground">até</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("gap-1.5 w-[130px] justify-start text-left font-normal")}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(dateTo, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus locale={ptBR} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium text-muted-foreground">Aguardando Aprovação</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{grandCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{formatCurrency(grandTotal)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium text-muted-foreground">Clientes</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3"><p className="text-2xl font-bold">{filtered.length}</p></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente, código, tarefa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Situação
              {excludedSituacoes.size > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{excludedSituacoes.size} ocultas</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <div className="space-y-2">
              <Input placeholder="Buscar situação..." value={searchSituacao} onChange={(e) => setSearchSituacao(e.target.value)} className="h-8 text-xs" />
              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  checked={excludedSituacoes.size === 0}
                  onCheckedChange={(checked) => {
                    if (checked) setExcludedSituacoes(new Set());
                    else setExcludedSituacoes(new Set(allSituacoes));
                  }}
                />
                <span className="text-xs font-medium">Todas</span>
              </div>
              <ScrollArea className="h-48">
                <div className="space-y-1">
                  {filteredSituacoes.map((sit) => (
                    <div key={sit} className="flex items-center gap-2">
                      <Checkbox
                        checked={!excludedSituacoes.has(sit)}
                        onCheckedChange={() => {
                          setExcludedSituacoes((prev) => {
                            const next = new Set(prev);
                            if (next.has(sit)) next.delete(sit);
                            else next.add(sit);
                            return next;
                          });
                        }}
                      />
                      <span className="text-xs truncate">{sit}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">Aguardando Aprovação</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    Nenhum orçamento aguardando aprovação
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
                      <TableCell className="text-center"><Badge variant="secondary">{row.count}</Badge></TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                    {expanded === row.cliente && (
                      <TableRow key={`${row.cliente}-detail`}>
                        <TableCell colSpan={3} className="p-0">
                          <div className="bg-muted/30 px-6 py-3 overflow-x-auto">
                            <Table className="min-w-[1100px]">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Código</TableHead>
                                  <TableHead className="text-xs">Situação</TableHead>
                                  <TableHead className="text-xs">Vendedor</TableHead>
                                  <TableHead className="text-xs">Téc. Auvo</TableHead>
                                  <TableHead className="text-xs">Equipamento</TableHead>
                                  <TableHead className="text-xs">Data Orç.</TableHead>
                                  <TableHead className="text-xs">Data Tarefa</TableHead>
                                  <TableHead className="text-xs text-right">Valor</TableHead>
                                  <TableHead className="text-xs w-44">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {row.items
                                  .sort((a: any, b: any) => (Number(b.gc_orc_valor_total) || 0) - (Number(a.gc_orc_valor_total) || 0))
                                  .map((item: any) => (
                                  <TableRow key={item.gc_orcamento_id} className="text-xs">
                                    <TableCell>
                                      <button className="text-primary hover:underline font-medium" onClick={() => setSelectedCard(item)}>
                                        {item.gc_orcamento_codigo || item.gc_orcamento_id}
                                      </button>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: item.gc_orc_cor_situacao || undefined, color: item.gc_orc_cor_situacao || undefined }}>
                                        {item.gc_orc_situacao || "—"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>{item.gc_orc_vendedor || "—"}</TableCell>
                                    <TableCell>{item.tecnico || "—"}</TableCell>
                                    <TableCell>{item.equipamento_nome || "—"}</TableCell>
                                    <TableCell>{item.gc_orc_data || "—"}</TableCell>
                                    <TableCell>{item.data_tarefa || "—"}</TableCell>
                                    <TableCell className="text-right font-medium">{formatCurrency(Number(item.gc_orc_valor_total) || 0)}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        {item.auvo_task_id && !String(item.auvo_task_id).startsWith("gc-only::") && (
                                          <Button size="icon" variant="ghost" className="h-6 w-6" title="Editar agendamento" onClick={(e) => { e.stopPropagation(); openEditModal(item); }}>
                                            <Edit2 className="h-3 w-3" />
                                          </Button>
                                        )}
                                        {item.gc_orc_link && (
                                          <a href={item.gc_orc_link} target="_blank" rel="noopener noreferrer" title="Orçamento no GestãoClick">
                                            <Button size="icon" variant="ghost" className="h-6 w-6"><FileText className="h-3 w-3" /></Button>
                                          </a>
                                        )}
                                        {item.auvo_task_url && (
                                          <a href={item.auvo_task_url} target="_blank" rel="noopener noreferrer" title="Tarefa Auvo">
                                            <Button size="icon" variant="ghost" className="h-6 w-6"><ExternalLink className="h-3 w-3" /></Button>
                                          </a>
                                        )}
                                        {item.gc_orcamento_id && !movedIds.has(item.gc_orcamento_id) && (
                                          <Button
                                            size="icon" variant="ghost" className="h-6 w-6"
                                            title="Alterar situação no GC"
                                            disabled={changingId === item.gc_orcamento_id}
                                            onClick={(e) => { e.stopPropagation(); setConciliacaoCard(item); setConciliacaoSituacao(""); }}
                                          >
                                            {changingId === item.gc_orcamento_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                          </Button>
                                        )}
                                        {movedIds.has(item.gc_orcamento_id) && (
                                          <Badge variant="outline" className="text-[9px] bg-green-100 text-green-700 border-green-300">
                                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> Alterado
                                          </Badge>
                                        )}
                                      </div>
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

      {/* Detail dialog */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Orçamento {selectedCard?.gc_orcamento_codigo || selectedCard?.gc_orcamento_id}</span>
              <Badge className="text-xs" style={{ backgroundColor: selectedCard?.gc_orc_cor_situacao || undefined }}>
                {selectedCard?.gc_orc_situacao}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {selectedCard && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-[11px] text-muted-foreground">Cliente</Label><p>{selectedCard.gc_orc_cliente || selectedCard.cliente || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Vendedor</Label><p>{selectedCard.gc_orc_vendedor || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Data Orçamento</Label><p>{selectedCard.gc_orc_data || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Valor Total</Label><p className="font-semibold">{formatCurrency(Number(selectedCard.gc_orc_valor_total) || 0)}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Tarefa Auvo</Label><p className="font-mono">{selectedCard.auvo_task_id || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Técnico</Label><p>{selectedCard.tecnico || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Data Tarefa</Label><p>{selectedCard.data_tarefa || "—"}</p></div>
                <div><Label className="text-[11px] text-muted-foreground">Status Auvo</Label><p>{selectedCard.status_auvo || "—"}</p></div>
              </div>
              {selectedCard.orientacao && (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Orientação</Label>
                  <p className="whitespace-pre-wrap text-xs bg-muted/30 p-2 rounded">{selectedCard.orientacao}</p>
                </div>
              )}

              {/* Peças e Serviços do orçamento */}
              {orcDetailLoading && (
                <div className="border rounded-md p-3 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
              {!orcDetailLoading && orcDetail && (() => {
                const produtos: any[] = (orcDetail?.produtos || []).map((p: any) => p?.produto || p);
                const servicos: any[] = (orcDetail?.servicos || []).map((s: any) => s?.servico || s);
                const hasItems = produtos.length > 0 || servicos.length > 0;
                const valorProdutos = Number(orcDetail?.valor_produtos || orcDetail?.total_produtos || 0);
                const valorServicos = Number(orcDetail?.valor_servicos || orcDetail?.total_servicos || 0);
                const valorDesconto = Number(orcDetail?.desconto || orcDetail?.valor_desconto || 0);
                const valorTotal = Number(orcDetail?.valor_total || selectedCard.gc_orc_valor_total || 0);

                return (
                  <>
                    <div className="border rounded-md">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                        <span className="text-sm font-semibold">💰 Resumo Financeiro</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 p-3 text-sm">
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Produtos</span>
                          <p className="font-semibold">{formatCurrency(valorProdutos)}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Serviços</span>
                          <p className="font-semibold">{formatCurrency(valorServicos)}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Desconto</span>
                          <p className="font-semibold text-destructive">
                            {valorDesconto > 0 ? `-${formatCurrency(valorDesconto)}` : "—"}
                          </p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs block">Total</span>
                          <p className="font-bold text-foreground">{formatCurrency(valorTotal)}</p>
                        </div>
                      </div>
                    </div>

                    {produtos.length > 0 && (
                      <div className="border rounded-md">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Peças ({produtos.length})</span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Código</TableHead>
                              <TableHead className="text-xs">Descrição</TableHead>
                              <TableHead className="text-xs text-right">Qtd</TableHead>
                              <TableHead className="text-xs text-right">Unit.</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {produtos.map((p: any, i: number) => {
                              const qtd = Number(p.quantidade || p.qtd || 1);
                              const unitario = Number(p.valor_venda || p.valor_unitario || p.preco || p.valor || 0);
                              const total = Number(p.valor_total || p.subtotal || qtd * unitario);
                              return (
                                <TableRow key={i}>
                                  <TableCell className="text-xs font-mono py-1.5">{String(p.codigo_interno || p.codigo || p.produto_id || "—")}</TableCell>
                                  <TableCell className="text-xs py-1.5 max-w-[220px] truncate">{String(p.nome_produto || p.descricao || p.nome || "—")}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {servicos.length > 0 && (
                      <div className="border rounded-md">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                          <ClipboardList className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">Serviços ({servicos.length})</span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Código</TableHead>
                              <TableHead className="text-xs">Descrição</TableHead>
                              <TableHead className="text-xs text-right">Qtd</TableHead>
                              <TableHead className="text-xs text-right">Unit.</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {servicos.map((s: any, i: number) => {
                              const qtd = Number(s.quantidade || s.qtd || 1);
                              const unitario = Number(s.valor_venda || s.valor_unitario || s.preco || s.valor || 0);
                              const total = Number(s.valor_total || s.subtotal || qtd * unitario);
                              return (
                                <TableRow key={i}>
                                  <TableCell className="text-xs font-mono py-1.5">{String(s.codigo_interno || s.codigo || s.servico_id || "—")}</TableCell>
                                  <TableCell className="text-xs py-1.5 max-w-[220px] truncate">{String(s.nome_servico || s.descricao || s.nome || "—")}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{qtd}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right">{formatCurrency(unitario)}</TableCell>
                                  <TableCell className="text-xs py-1.5 text-right font-medium">{formatCurrency(total)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {!hasItems && (
                      <div className="border rounded-md p-3 text-sm text-muted-foreground text-center">
                        Nenhuma peça ou serviço cadastrado neste orçamento
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="flex gap-2 pt-2">
                {selectedCard.gc_orc_link && (
                  <a href={selectedCard.gc_orc_link} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="gap-1"><FileText className="h-3 w-3" /> Abrir no GC</Button>
                  </a>
                )}
                {selectedCard.auvo_task_url && (
                  <a href={selectedCard.auvo_task_url} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="gap-1"><ExternalLink className="h-3 w-3" /> Abrir no Auvo</Button>
                  </a>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Conciliação dialog */}
      <Dialog open={!!conciliacaoCard} onOpenChange={(open) => !open && setConciliacaoCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar situação do orçamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <p><span className="text-muted-foreground">Orçamento:</span> <strong>{conciliacaoCard?.gc_orcamento_codigo || conciliacaoCard?.gc_orcamento_id}</strong></p>
              <p><span className="text-muted-foreground">Situação atual:</span> {conciliacaoCard?.gc_orc_situacao}</p>
            </div>
            <div>
              <Label className="text-xs">Nova situação</Label>
              <Select value={conciliacaoSituacao} onValueChange={setConciliacaoSituacao}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Map(
                      (rows || [])
                        .filter((r) => r.gc_orc_situacao_id && r.gc_orc_situacao && r.gc_orc_situacao_id !== conciliacaoCard?.gc_orc_situacao_id)
                        .map((r) => [r.gc_orc_situacao_id, { id: r.gc_orc_situacao_id, label: r.gc_orc_situacao }])
                    ).values()
                  ).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConciliacaoCard(null)}>Cancelar</Button>
            <Button onClick={handleAlterarSituacao} disabled={!conciliacaoSituacao || !!changingId}>
              {changingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Alterar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Auvo task dialog */}
      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar tarefa Auvo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Tarefa #{editingCard?.auvo_task_id} — {editingCard?.cliente}
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {editDate ? format(editDate, "dd/MM/yyyy") : "Selecione..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={editDate} onSelect={setEditDate} initialFocus locale={ptBR} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Hora</Label>
                <Input value={editHour} onChange={(e) => setEditHour(e.target.value.replace(/\D/g, "").slice(0, 2))} className="h-9" />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Min</Label>
                <Input value={editMinute} onChange={(e) => setEditMinute(e.target.value.replace(/\D/g, "").slice(0, 2))} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Técnico</Label>
              <Select value={editTecnicoId} onValueChange={setEditTecnicoId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {(auvoUsers || []).map((u) => (
                    <SelectItem key={u.userID} value={String(u.userID)}>{u.name || u.login}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)}>Cancelar</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}