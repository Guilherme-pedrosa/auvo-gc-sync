import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, ArrowLeftRight, ExternalLink, Search, Users, ArrowRightLeft, Scale, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ResolvedExecTask {
  tecnico_id: string;
  tecnico: string;
  data_conclusao: string | null;
}

const PAGE_SIZE = 1000;

const formatCurrency = (val: number) =>
  val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parseExecIds = (raw: unknown): string[] => {
  const str = String(raw ?? "").trim();
  if (!str) return [];
  return str.split("/").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
};

interface CrossedOS {
  gc_os_id: string;
  gc_os_codigo: string | null;
  gc_os_situacao: string | null;
  gc_os_valor_total: number;
  cliente: string;
  data_tarefa: string | null;
  data_conclusao: string | null;
  abridor_id: string;
  abridor_nome: string;
  executor_id: string;
  executor_nome: string;
  os_task_id: string | null;
  exec_task_id: string | null;
  auvo_link: string | null;
}

export default function OSCruzadasPage() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));
  const [search, setSearch] = useState("");
  const [selectedTecnico, setSelectedTecnico] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"executor" | "abridor" | "saldo">("saldo");

  // Step 1: identify EXECUTION tasks in the period (data_tarefa = data execução).
  // Step 2: fetch every OS row whose execution task ID is in that set,
  // regardless of when the OPENING task happened.
  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["os-cruzadas-tarefas-by-exec", format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd")],
    queryFn: async () => {
      const from = format(dateFrom, "yyyy-MM-dd");
      const to = format(dateTo, "yyyy-MM-dd");

      // 1) Pull all tasks executed in the period (any task, not just OS rows).
      const execTasks: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("tarefas_central")
          .select("auvo_task_id, tecnico, tecnico_id, data_tarefa, data_conclusao")
          .gte("data_tarefa", from)
          .lte("data_tarefa", to)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const batch = data || [];
        execTasks.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      const execIds = new Set(execTasks.map((t) => String(t.auvo_task_id)));

      // 2) Pull OS rows whose gc_os_tarefa_exec matches any of those exec IDs.
      // We fetch in chunks because PostgREST `in.()` filter has URL length limits.
      const allOsRows: any[] = [];
      const seen = new Set<string>();
      const idArr = Array.from(execIds);
      const CHUNK = 200;
      for (let i = 0; i < idArr.length; i += CHUNK) {
        const slice = idArr.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("tarefas_central")
          .select("auvo_task_id, tecnico, tecnico_id, cliente, data_tarefa, data_conclusao, gc_os_id, gc_os_codigo, gc_os_cliente, gc_os_situacao, gc_os_valor_total, gc_os_tarefa_exec, gc_os_link, auvo_link")
          .not("gc_os_id", "is", null)
          .in("gc_os_tarefa_exec", slice);
        if (error) throw error;
        for (const r of data || []) {
          const k = String(r.auvo_task_id);
          if (!seen.has(k)) {
            seen.add(k);
            allOsRows.push(r);
          }
        }
      }

      // 3) Also include the exec task rows themselves so the in-memory join
      //    (taskById in crossedList) can resolve executor name/id locally.
      const referencedExecIds = new Set<string>();
      for (const r of allOsRows) {
        for (const eid of String(r.gc_os_tarefa_exec || "").split("/").map((s) => s.trim()).filter((s) => /^\d+$/.test(s))) {
          referencedExecIds.add(eid);
        }
      }
      for (const t of execTasks) {
        if (referencedExecIds.has(String(t.auvo_task_id)) && !seen.has(String(t.auvo_task_id))) {
          seen.add(String(t.auvo_task_id));
          allOsRows.push({
            auvo_task_id: t.auvo_task_id,
            tecnico: t.tecnico,
            tecnico_id: t.tecnico_id,
            cliente: null,
            data_tarefa: t.data_tarefa,
            data_conclusao: t.data_conclusao,
            gc_os_id: null,
            gc_os_codigo: null,
            gc_os_cliente: null,
            gc_os_situacao: null,
            gc_os_valor_total: 0,
            gc_os_tarefa_exec: null,
            gc_os_link: null,
            auvo_link: null,
          });
        }
      }

      return allOsRows;
    },
    staleTime: 30_000,
  });

  // Cache of exec tasks resolved via Auvo API (for tasks not in tarefas_central)
  const [resolvedExec, setResolvedExec] = useState<Record<string, ResolvedExecTask | null>>({});
  const [resolvingCount, setResolvingCount] = useState(0);

  // Identify exec task IDs referenced but missing from local data
  const missingExecIds = useMemo(() => {
    const local = new Set<string>();
    for (const t of tarefas) local.add(String(t.auvo_task_id));
    const missing = new Set<string>();
    for (const t of tarefas) {
      const ids = String(t.gc_os_tarefa_exec || "").split("/").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      for (const eid of ids) {
        if (!local.has(eid) && !(eid in resolvedExec)) missing.add(eid);
      }
    }
    return Array.from(missing);
  }, [tarefas, resolvedExec]);

  // Resolve missing exec tasks via Auvo API in batches
  useEffect(() => {
    if (missingExecIds.length === 0) return;
    let cancelled = false;
    (async () => {
      setResolvingCount(missingExecIds.length);
      const BATCH = 5;
      for (let i = 0; i < missingExecIds.length; i += BATCH) {
        if (cancelled) return;
        const slice = missingExecIds.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map(async (taskId) => {
            try {
              const { data, error } = await supabase.functions.invoke("auvo-task-update", {
                body: { action: "get", taskId: Number(taskId) },
              });
              if (error || !data?.ok) return [taskId, null] as const;
              const task = data?.task ?? data?.data ?? data;
              const userId = String(task?.userId ?? task?.idUser ?? task?.user?.userId ?? "").trim();
              const userName = String(task?.userName ?? task?.user?.name ?? task?.userToTask?.name ?? "").trim();
              const dataConclusao = task?.checkOutDate || task?.taskFinishDate || null;
              if (!userId && !userName) return [taskId, null] as const;
              return [taskId, { tecnico_id: userId, tecnico: userName, data_conclusao: dataConclusao }] as const;
            } catch {
              return [taskId, null] as const;
            }
          })
        );
        if (cancelled) return;
        setResolvedExec((prev) => {
          const next = { ...prev };
          for (const [id, val] of results) next[id] = val;
          return next;
        });
      }
      if (!cancelled) setResolvingCount(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [missingExecIds]);


  // Compute crossed OS
  const crossedList = useMemo<CrossedOS[]>(() => {
    // Group tasks by gc_os_id
    const byOsId = new Map<string, any[]>();
    for (const t of tarefas) {
      if (!t.gc_os_id) continue;
      const key = String(t.gc_os_id);
      const bucket = byOsId.get(key) || [];
      bucket.push(t);
      byOsId.set(key, bucket);
    }

    const taskById = new Map<string, any>();
    for (const t of tarefas) taskById.set(String(t.auvo_task_id), t);

    const result: CrossedOS[] = [];

    for (const [gcOsId, tasks] of byOsId.entries()) {
      // Determine OS task (the one whose auvo_task_id is NOT in any exec list)
      const allExecIds = new Set<string>();
      for (const t of tasks) {
        for (const eid of parseExecIds(t.gc_os_tarefa_exec)) allExecIds.add(eid);
      }
      const osTask =
        tasks.find((t) => !allExecIds.has(String(t.auvo_task_id))) ||
        tasks.find((t) => String(t.auvo_task_id) !== String(t.gc_os_tarefa_exec || "")) ||
        tasks[0];

      const execIds = parseExecIds(osTask?.gc_os_tarefa_exec);
      if (execIds.length === 0) continue; // no exec task → can't determine cross

      // Resolve exec task: first try local DB, then resolved Auvo cache
      let execTask: { tecnico_id: string; tecnico: string; data_conclusao: string | null; auvo_task_id: string } | null = null;
      for (const eid of execIds) {
        const found = taskById.get(eid);
        if (found?.tecnico_id && found?.tecnico) {
          execTask = {
            tecnico_id: String(found.tecnico_id),
            tecnico: String(found.tecnico),
            data_conclusao: found.data_conclusao,
            auvo_task_id: String(found.auvo_task_id),
          };
          break;
        }
        const resolved = resolvedExec[eid];
        if (resolved?.tecnico_id && resolved?.tecnico) {
          execTask = {
            tecnico_id: resolved.tecnico_id,
            tecnico: resolved.tecnico,
            data_conclusao: resolved.data_conclusao,
            auvo_task_id: eid,
          };
          break;
        }
      }
      if (!execTask) continue; // exec task still not resolvable

      const abridorId = String(osTask?.tecnico_id || "").trim();
      const abridorNome = String(osTask?.tecnico || "").trim();
      const executorId = execTask.tecnico_id;
      const executorNome = execTask.tecnico;

      if (!abridorId || !executorId || !abridorNome || !executorNome) continue;
      if (abridorId === executorId) continue; // same tech opened and executed → skip

      result.push({
        gc_os_id: gcOsId,
        gc_os_codigo: osTask.gc_os_codigo,
        gc_os_situacao: osTask.gc_os_situacao,
        gc_os_valor_total: Number(osTask.gc_os_valor_total) || 0,
        cliente: osTask.cliente || osTask.gc_os_cliente || "—",
        data_tarefa: osTask.data_tarefa,
        data_conclusao: execTask.data_conclusao || osTask.data_conclusao,
        abridor_id: abridorId,
        abridor_nome: abridorNome,
        executor_id: executorId,
        executor_nome: executorNome,
        os_task_id: osTask.auvo_task_id,
        exec_task_id: execTask.auvo_task_id,
        auvo_link: osTask.gc_os_link || osTask.auvo_link,
      });
    }

    return result;
  }, [tarefas, resolvedExec]);


  // Aggregate per technician (executor view: what each tech executed for others)
  const totaisPorExecutor = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; count: number; total: number }>();
    for (const c of crossedList) {
      const e = map.get(c.executor_id) || { id: c.executor_id, nome: c.executor_nome, count: 0, total: 0 };
      e.count++;
      e.total += c.gc_os_valor_total;
      map.set(c.executor_id, e);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [crossedList]);

  // Aggregate per technician (abridor view: what each tech opened that someone else executed)
  const totaisPorAbridor = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; count: number; total: number }>();
    for (const c of crossedList) {
      const e = map.get(c.abridor_id) || { id: c.abridor_id, nome: c.abridor_nome, count: 0, total: 0 };
      e.count++;
      e.total += c.gc_os_valor_total;
      map.set(c.abridor_id, e);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [crossedList]);

  // Saldo (lucro/prejuízo) per technician = executou para outros - abriu pra outros executarem
  const saldoPorTecnico = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; credito: number; debito: number; qtd_executou: number; qtd_abriu: number }>();
    for (const t of totaisPorExecutor) {
      const e = map.get(t.id) || { id: t.id, nome: t.nome, credito: 0, debito: 0, qtd_executou: 0, qtd_abriu: 0 };
      e.credito = t.total;
      e.qtd_executou = t.count;
      map.set(t.id, e);
    }
    for (const t of totaisPorAbridor) {
      const e = map.get(t.id) || { id: t.id, nome: t.nome, credito: 0, debito: 0, qtd_executou: 0, qtd_abriu: 0 };
      e.debito = t.total;
      e.qtd_abriu = t.count;
      map.set(t.id, e);
    }
    return Array.from(map.values())
      .map((e) => ({ ...e, saldo: e.credito - e.debito }))
      .sort((a, b) => b.saldo - a.saldo);
  }, [totaisPorExecutor, totaisPorAbridor]);

  const totais = viewMode === "executor" ? totaisPorExecutor : viewMode === "abridor" ? totaisPorAbridor : [];

  // Filtered detail: by selected tech and search
  const detalhe = useMemo(() => {
    let items = crossedList;
    if (selectedTecnico) {
      items = items.filter((c) =>
        viewMode === "executor"
          ? c.executor_id === selectedTecnico
          : viewMode === "abridor"
            ? c.abridor_id === selectedTecnico
            : c.executor_id === selectedTecnico || c.abridor_id === selectedTecnico
      );
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      items = items.filter(
        (c) =>
          (c.gc_os_codigo || "").toLowerCase().includes(s) ||
          c.cliente.toLowerCase().includes(s) ||
          c.abridor_nome.toLowerCase().includes(s) ||
          c.executor_nome.toLowerCase().includes(s)
      );
    }
    return items.sort((a, b) => b.gc_os_valor_total - a.gc_os_valor_total);
  }, [crossedList, selectedTecnico, search, viewMode]);

  const totalGeral = useMemo(() => crossedList.reduce((s, c) => s + c.gc_os_valor_total, 0), [crossedList]);

  const setMonth = useCallback((monthsBack: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    setDateFrom(startOfMonth(d));
    setDateTo(endOfMonth(d));
    setSelectedTecnico(null);
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            OS Cruzadas — Abridor ≠ Executor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mapeamento de OS abertas por um técnico e executadas por outro. OS em que o mesmo técnico abriu e fechou são excluídas.
          </p>
          {resolvingCount > 0 && (
            <p className="text-xs text-muted-foreground mt-2 inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Resolvendo {resolvingCount} tarefa(s) de execução via Auvo (fora da janela local)…
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setMonth(0)}>Mês atual</Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(1)}>Mês anterior</Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {format(dateFrom, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus className="pointer-events-auto" />
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground text-sm">até</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                {format(dateTo, "dd/MM/yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total OS Cruzadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{crossedList.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Valor Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{formatCurrency(totalGeral)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Técnicos Envolvidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{new Set([...totaisPorExecutor.map((t) => t.id), ...totaisPorAbridor.map((t) => t.id)]).size}</div>
          </CardContent>
        </Card>
      </div>

      {/* Mode tabs */}
      <Tabs value={viewMode} onValueChange={(v) => { setViewMode(v as "executor" | "abridor" | "saldo"); setSelectedTecnico(null); }}>
        <TabsList>
          <TabsTrigger value="saldo" className="gap-2">
            <Scale className="h-4 w-4" />
            Saldo (Lucro/Prejuízo)
          </TabsTrigger>
          <TabsTrigger value="executor" className="gap-2">
            <Users className="h-4 w-4" />
            Por Executor (executou OS de outros)
          </TabsTrigger>
          <TabsTrigger value="abridor" className="gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Por Abridor (abriu OS executada por outros)
          </TabsTrigger>
        </TabsList>

        {/* SALDO TAB */}
        <TabsContent value="saldo" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saldo por técnico no período</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-emerald-600 font-medium">Crédito</span> = valor de OS executadas para outros técnicos.{" "}
                <span className="text-rose-600 font-medium">Débito</span> = valor de OS que ele abriu mas foi outro quem executou.{" "}
                <span className="font-medium">Saldo</span> = crédito − débito.
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : saldoPorTecnico.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma OS cruzada encontrada no período.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Técnico</TableHead>
                      <TableHead className="text-right">Qtd. Executou</TableHead>
                      <TableHead className="text-right text-emerald-700">Crédito</TableHead>
                      <TableHead className="text-right">Qtd. Abriu</TableHead>
                      <TableHead className="text-right text-rose-700">Débito</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saldoPorTecnico.map((t) => {
                      const isSelected = selectedTecnico === t.id;
                      const positivo = t.saldo >= 0;
                      return (
                        <TableRow
                          key={t.id}
                          className={cn("cursor-pointer hover:bg-muted/50", isSelected && "bg-primary/5")}
                          onClick={() => setSelectedTecnico(isSelected ? null : t.id)}
                        >
                          <TableCell className="font-medium">{t.nome}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{t.qtd_executou}</TableCell>
                          <TableCell className="text-right font-mono text-emerald-700">{formatCurrency(t.credito)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{t.qtd_abriu}</TableCell>
                          <TableCell className="text-right font-mono text-rose-700">{formatCurrency(t.debito)}</TableCell>
                          <TableCell className="text-right">
                            <div className={cn("inline-flex items-center gap-1.5 font-mono font-bold", positivo ? "text-emerald-600" : "text-rose-600")}>
                              {positivo ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                              {formatCurrency(t.saldo)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={isSelected ? "default" : "outline"} className="text-xs">
                              {isSelected ? "Ocultar" : "Ver detalhes"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Detail for saldo: show both directions */}
          {selectedTecnico && (() => {
            const tech = saldoPorTecnico.find((t) => t.id === selectedTecnico);
            const executou = detalhe.filter((c) => c.executor_id === selectedTecnico);
            const abriu = detalhe.filter((c) => c.abridor_id === selectedTecnico);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-emerald-700">
                      <TrendingUp className="h-4 w-4" />
                      Executou para outros — {executou.length} OS · {formatCurrency(tech?.credito || 0)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {executou.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">Nenhuma OS.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">OS</TableHead>
                            <TableHead className="text-xs">Cliente</TableHead>
                            <TableHead className="text-xs">Aberta por</TableHead>
                            <TableHead className="text-xs text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {executou.map((c) => (
                            <TableRow key={c.gc_os_id}>
                              <TableCell className="font-mono text-xs">{c.gc_os_codigo || c.gc_os_id}</TableCell>
                              <TableCell className="text-xs max-w-[160px] truncate" title={c.cliente}>{c.cliente}</TableCell>
                              <TableCell className="text-xs">{c.abridor_nome}</TableCell>
                              <TableCell className="text-right text-xs font-mono font-semibold text-emerald-700">{formatCurrency(c.gc_os_valor_total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-rose-700">
                      <TrendingDown className="h-4 w-4" />
                      Abriu e outro executou — {abriu.length} OS · {formatCurrency(tech?.debito || 0)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {abriu.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">Nenhuma OS.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">OS</TableHead>
                            <TableHead className="text-xs">Cliente</TableHead>
                            <TableHead className="text-xs">Executada por</TableHead>
                            <TableHead className="text-xs text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {abriu.map((c) => (
                            <TableRow key={c.gc_os_id}>
                              <TableCell className="font-mono text-xs">{c.gc_os_codigo || c.gc_os_id}</TableCell>
                              <TableCell className="text-xs max-w-[160px] truncate" title={c.cliente}>{c.cliente}</TableCell>
                              <TableCell className="text-xs">{c.executor_nome}</TableCell>
                              <TableCell className="text-right text-xs font-mono font-semibold text-rose-700">{formatCurrency(c.gc_os_valor_total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value={viewMode} className="space-y-4 mt-4">
          {/* Technician summary table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {viewMode === "executor"
                  ? "Total executado para OS abertas por outros técnicos"
                  : "Total aberto por técnico, executado por outros"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : totais.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma OS cruzada encontrada no período.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Técnico</TableHead>
                      <TableHead className="text-right">Qtd. OS</TableHead>
                      <TableHead className="text-right">Valor Total</TableHead>
                      <TableHead className="text-right">% do Total</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {totais.map((t) => {
                      const pct = totalGeral > 0 ? (t.total / totalGeral) * 100 : 0;
                      const isSelected = selectedTecnico === t.id;
                      return (
                        <TableRow
                          key={t.id}
                          className={cn("cursor-pointer hover:bg-muted/50", isSelected && "bg-primary/5")}
                          onClick={() => setSelectedTecnico(isSelected ? null : t.id)}
                        >
                          <TableCell className="font-medium">{t.nome}</TableCell>
                          <TableCell className="text-right">{t.count}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatCurrency(t.total)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={isSelected ? "default" : "outline"} className="text-xs">
                              {isSelected ? "Ocultar" : "Ver detalhes"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Detail table */}
          {(selectedTecnico || search) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="text-base">
                  {selectedTecnico
                    ? `Detalhe — ${totais.find((t) => t.id === selectedTecnico)?.nome || "Técnico"}`
                    : "Detalhe (busca)"}
                </CardTitle>
                <div className="relative w-72">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar OS, cliente, técnico..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {detalhe.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma OS encontrada.</div>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>OS</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Situação</TableHead>
                          <TableHead>Abridor</TableHead>
                          <TableHead>Executor</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalhe.map((c) => (
                          <TableRow key={c.gc_os_id}>
                            <TableCell className="font-mono text-sm">{c.gc_os_codigo || c.gc_os_id}</TableCell>
                            <TableCell className="max-w-[220px] truncate" title={c.cliente}>{c.cliente}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{c.gc_os_situacao || "—"}</Badge>
                            </TableCell>
                            <TableCell>
                              <span className={cn(viewMode === "abridor" && c.abridor_id === selectedTecnico && "font-semibold")}>
                                {c.abridor_nome}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className={cn(viewMode === "executor" && c.executor_id === selectedTecnico && "font-semibold")}>
                                {c.executor_nome}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {c.data_tarefa ? format(new Date(c.data_tarefa + "T00:00:00"), "dd/MM/yyyy") : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">{formatCurrency(c.gc_os_valor_total)}</TableCell>
                            <TableCell>
                              {c.auvo_link && (
                                <a href={c.auvo_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
