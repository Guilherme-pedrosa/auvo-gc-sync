import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
   Search, ArrowDownWideNarrow, ExternalLink, Filter, CalendarIcon,
   Edit2, Save, Loader2, UserCog, MapPin, Navigation, Package,
   ClipboardList, FileText, AlertTriangle, RefreshCw, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

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

interface Props {
  data: any[];
  allTasks: any[];
  isLoading: boolean;
  allClientes: string[];
  onRefresh?: () => void;
  onSync?: (situacaoIds: string[]) => void;
  syncing?: boolean;
  execTaskStatusMap?: Map<string, string>;
}

const formatCurrency = (val: number) =>
  val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const getAuvoStatusFromTask = (task: any) => {
  const ts = task?.taskStatus;
  const statusCode = typeof ts === "number"
    ? ts
    : typeof ts?.id === "number"
      ? ts.id
      : Number(ts?.id || ts?.status || 0);

  if (statusCode === 6) return "Pausada";
  if (statusCode === 4 || statusCode === 5) return "Finalizada";
  if (statusCode === 3) return "Em andamento";
  if (statusCode === 2) return "Em deslocamento";
  if (statusCode === 1) return "Aberta";

  if (task?.checkOut) return "Finalizada";
  const tcs = task?.timeControl || [];
  if (tcs.some((tc: any) => tc.pauseStart && !tc.pauseEnd) || task?.reasonForPause) return "Pausada";
  if (task?.checkIn) return "Em andamento";
  return "Agendada";
};

export default function OSAbertasTab({ data, allTasks, isLoading, allClientes, onRefresh, onSync, syncing, execTaskStatusMap }: Props) {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [excludedSituacoes, setExcludedSituacoes] = useState<Set<string>>(new Set());
  const [searchSituacao, setSearchSituacao] = useState("");
  const [execStatusFilter, setExecStatusFilter] = useState<string>("all"); // all | em_andamento | pausada | finalizada | sem_exec
  const [expanded, setExpanded] = useState<string | null>(null);

  // Detail dialog
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [execTaskFallback, setExecTaskFallback] = useState<any | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCard, setEditingCard] = useState<any | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editHour, setEditHour] = useState("08");
  const [editMinute, setEditMinute] = useState("00");
  const [editTecnicoId, setEditTecnicoId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [execTaskId, setExecTaskId] = useState<string | null>(null);
  const [execTaskLoading, setExecTaskLoading] = useState(false);

  // Live exec task resolution for OS items missing gc_os_tarefa_exec
  const [liveExecMap, setLiveExecMap] = useState<Map<string, { execTaskId: string; tecnico: string; dataTarefa: string; status: string }>>(new Map());

  // Conciliação
  const [changingId, setChangingId] = useState<string | null>(null);
  const [movedOsIds, setMovedOsIds] = useState<Set<string>>(new Set());
  // Conciliação dialog
  const [conciliacaoCard, setConciliacaoCard] = useState<any | null>(null);
  const [conciliacaoSituacao, setConciliacaoSituacao] = useState("");

  // Fetch Auvo users
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

  // Fetch vendedor mapping
  const { data: vendedorMap } = useQuery({
    queryKey: ["auvo-gc-usuario-map"],
    queryFn: async () => {
      const { data } = await supabase.from("auvo_gc_usuario_map").select("*").eq("ativo", true);
      return (data || []) as { auvo_user_id: string; gc_vendedor_id: string; gc_vendedor_nome: string }[];
    },
    staleTime: 1000 * 60 * 30,
  });

  // Conciliação handler
  const alterarSituacaoOS = useCallback(async (item: any, situacaoId: string) => {
    setChangingId(item.gc_os_id);
    try {
      // Use the EXECUTION task's technician (gc_os_tarefa_exec) as the vendor, not the OS task's
      const execTaskId = item.gc_os_tarefa_exec;
      const execTask = execTaskId ? allTasks.find((t: any) => t.auvo_task_id === execTaskId) : null;
      const execTecnicoId = execTask?.tecnico_id || item.tecnico_id; // fallback to OS task tech
      const mapping = vendedorMap?.find(m => m.auvo_user_id === execTecnicoId);
      const gcVendedorId = mapping?.gc_vendedor_id || null;
      const gcVendedorNome = mapping?.gc_vendedor_nome || null;

      const { data: resp, error } = await supabase.functions.invoke("auvo-gc-sync", {
        body: {
          action: "revert_os",
          gc_os_id: item.gc_os_id,
          gc_os_codigo: item.gc_os_codigo,
          situacao_id_antes: situacaoId,
          gc_vendedor_id: gcVendedorId,
          gc_vendedor_nome: gcVendedorNome,
          data_saida: item.data_tarefa || null,
          gc_usuario_id: profile?.gc_user_id || null,
        },
      });
      if (error) throw error;
      if (resp?.success) {
        const label = SITUACOES_OPTIONS.find(s => s.id === situacaoId)?.label || situacaoId;
        setMovedOsIds(prev => new Set(prev).add(item.gc_os_id));
        toast.success(`OS ${item.gc_os_codigo} → ${label}`);
        onRefresh?.();
      } else {
        toast.error(`Erro: ${JSON.stringify(resp?.body || resp?.error || resp)}`);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setChangingId(null);
      setConciliacaoCard(null);
      setConciliacaoSituacao("");
    }
  }, [profile?.gc_user_id, onRefresh, vendedorMap, allTasks]);

  const allSituacoes = useMemo(() => {
    const set = new Set(data.map((t) => t.gc_os_situacao || "").filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  const filteredSituacoes = useMemo(() => {
    if (!searchSituacao) return allSituacoes;
    return allSituacoes.filter((s) => s.toLowerCase().includes(searchSituacao.toLowerCase()));
  }, [allSituacoes, searchSituacao]);

  const osTaskByGcOsId = useMemo(() => {
    const grouped = new Map<string, any[]>();

    for (const task of allTasks) {
      if (!task?.gc_os_id) continue;
      const gcOsId = String(task.gc_os_id);
      const bucket = grouped.get(gcOsId) || [];
      bucket.push(task);
      grouped.set(gcOsId, bucket);
    }

    const resolved = new Map<string, any>();

    for (const [gcOsId, tasks] of grouped.entries()) {
      const execIds = new Set(
        tasks
          .map((task) => task?.gc_os_tarefa_exec)
          .filter(Boolean)
          .map((id) => String(id))
      );

      const osTask =
        tasks.find((task) => !execIds.has(String(task.auvo_task_id))) ||
        tasks.find((task) => String(task.auvo_task_id) !== String(task.gc_os_tarefa_exec || "")) ||
        tasks[0];

      resolved.set(gcOsId, osTask);
    }

    return resolved;
  }, [allTasks]);

  // Helper to resolve exec status for an item
  const getItemExecStatus = useCallback((item: any): string => {
    const execId = item.gc_os_tarefa_exec;
    const live = liveExecMap.get(String(item.gc_os_id));
    if (live?.status) return live.status;
    if (execId && execTaskStatusMap?.get(execId)) return execTaskStatusMap.get(execId)!;
    if (execId) {
      const execRow = allTasks.find((t: any) => t.auvo_task_id === execId);
      return execRow?.status_auvo || "";
    }
    return "";
  }, [liveExecMap, execTaskStatusMap, allTasks]);

  // Group by client, sum values
  const clienteSummary = useMemo(() => {
    let items = excludedSituacoes.size > 0
      ? data.filter((t) => !excludedSituacoes.has(t.gc_os_situacao || ""))
      : data;

    // Apply exec status filter
    if (execStatusFilter !== "all") {
      items = items.filter((item) => {
        const status = getItemExecStatus(item).toLowerCase();
        if (execStatusFilter === "em_andamento") return status.includes("andamento") || status.includes("deslocamento");
        if (execStatusFilter === "pausada") return status.includes("pausa");
        if (execStatusFilter === "finalizada") return status.includes("finalizada");
        if (execStatusFilter === "sem_exec") return !status || status === "agendada" || status === "aberta";
        return true;
      });
    }

    const map = new Map<string, { cliente: string; count: number; total: number; items: any[] }>();
    for (const item of items) {
      const cliente = item.cliente || item.gc_os_cliente || "Sem cliente";
      const entry = map.get(cliente) || { cliente, count: 0, total: 0, items: [] };
      entry.count++;
      entry.total += Number(item.gc_os_valor_total) || 0;
      entry.items.push(item);
      map.set(cliente, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [data, excludedSituacoes, execStatusFilter, getItemExecStatus]);

  const filtered = useMemo(() => {
    if (!search) return clienteSummary;
    const s = search.toLowerCase();
    return clienteSummary.filter((c) => {
      // Search in client name
      if (c.cliente.toLowerCase().includes(s)) return true;
      // Search in OS codes, auvo task IDs
      return c.items.some((item: any) =>
        (item.gc_os_codigo || "").toLowerCase().includes(s) ||
        (item.auvo_task_id || "").toLowerCase().includes(s) ||
        (item.gc_orcamento_codigo || "").toLowerCase().includes(s)
      );
    });
  }, [clienteSummary, search]);

  const grandTotal = useMemo(() => filtered.reduce((sum, c) => sum + c.total, 0), [filtered]);
  const grandCount = useMemo(() => filtered.reduce((sum, c) => sum + c.count, 0), [filtered]);

  // Fetch live exec task info when client row is expanded
  useEffect(() => {
    if (!expanded) return;
    const row = filtered.find((r) => r.cliente === expanded);
    if (!row) return;

    const itemsToResolve = row.items.filter(
      (item: any) => item.gc_os_id && !liveExecMap.has(String(item.gc_os_id))
    );
    if (itemsToResolve.length === 0) return;

    let cancelled = false;

    (async () => {
      const updates = new Map(liveExecMap);

      for (const item of itemsToResolve) {
        if (cancelled) break;

        try {
          let execId = String(item.gc_os_tarefa_exec || "").trim();

          if (!execId && item.gc_os_id) {
            const { data: gcData, error } = await supabase.functions.invoke("gc-proxy", {
              body: { endpoint: `/api/ordens_servicos/${item.gc_os_id}`, method: "GET" },
            });
            if (error || cancelled) continue;

            const osObj = gcData?.data?.data ?? gcData?.data ?? null;
            const atributos: any[] = osObj?.atributos || [];
            const execAttr = atributos.find((a: any) => {
              const nested = a?.atributo || a;
              return String(nested?.atributo_id || nested?.id || "") === "73344";
            });
            const nested = execAttr?.atributo || execAttr;
            execId = String(nested?.conteudo || nested?.valor || "").trim();
          }

          if (!execId || !/^\d+$/.test(execId)) {
            updates.set(String(item.gc_os_id), { execTaskId: "", tecnico: "", dataTarefa: "", status: "" });
            continue;
          }

          const { data: taskData, error: taskError } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "get", taskId: Number(execId) },
          });
          if (taskError || cancelled) continue;

          const taskObj = taskData?.data?.result ?? taskData?.data ?? null;

          // If Auvo returns empty/404 (task expired), fallback to GC OS vendedor
          if (!taskObj || (taskData?.status === 404)) {
            // Try to get vendedor info from GC OS detail
            if (item.gc_os_id) {
              try {
                const { data: gcFallback } = await supabase.functions.invoke("gc-proxy", {
                  body: { endpoint: `/api/ordens_servicos/${item.gc_os_id}`, method: "GET" },
                });
                const osObj = gcFallback?.data?.data ?? gcFallback?.data ?? null;
                const vendedor = osObj?.vendedor?.nome || osObj?.vendedor_nome || item.gc_os_vendedor || "";
                updates.set(String(item.gc_os_id), {
                  execTaskId: execId,
                  tecnico: vendedor,
                  dataTarefa: item.gc_os_data_saida || item.gc_os_data || "",
                  status: "",
                });
                continue;
              } catch { /* ignore */ }
            }
            updates.set(String(item.gc_os_id), { execTaskId: execId, tecnico: item.gc_os_vendedor || "", dataTarefa: "", status: "" });
            continue;
          }

          const userTo = taskObj?.userTo || taskObj?.user_to || {};
          const tecName = userTo?.name || userTo?.login || taskObj?.technician || "";
          const taskDate = taskObj?.taskDate || taskObj?.task_date || taskObj?.date || "";
          const dateOnly = taskDate ? String(taskDate).substring(0, 10) : "";

          updates.set(String(item.gc_os_id), {
            execTaskId: execId,
            tecnico: tecName,
            dataTarefa: dateOnly,
            status: taskObj ? getAuvoStatusFromTask(taskObj) : "",
          });
        } catch {
          // ignore individual failures
        }
      }

      if (!cancelled) setLiveExecMap(updates);
    })();

    return () => {
      cancelled = true;
    };
  }, [expanded, filtered, liveExecMap]);

  // Fetch OS detail when card is selected
  useEffect(() => {
    if (!selectedCard?.gc_os_id) {
      setOsDetail(null);
      setExecTaskFallback(null);
      return;
    }
    let cancelled = false;
    setOsDetailLoading(true);
    setOsDetail(null);
    setExecTaskFallback(null);

    supabase.functions
      .invoke("gc-proxy", {
        body: { endpoint: `/api/ordens_servicos/${selectedCard.gc_os_id}`, method: "GET" },
      })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setOsDetailLoading(false);
          return;
        }
        const osObj = data?.data?.data ?? data?.data ?? null;

        // Enrich products/services with codigo_interno from GC product detail
        if (osObj) {
          const produtosRaw: any[] = osObj?.produtos || [];
          const servicosRaw: any[] = osObj?.servicos || [];
          const allItems = [
            ...produtosRaw.map((p: any) => ({ item: p?.produto || p, type: "produto" })),
            ...servicosRaw.map((s: any) => ({ item: s?.servico || s, type: "servico" })),
          ];
          const uniqueIds = [...new Set(allItems.map(i => String(i.item?.produto_id || i.item?.servico_id || "")).filter(Boolean))];
          
          if (uniqueIds.length > 0) {
            const codeMap = new Map<string, string>();
            await Promise.all(
              uniqueIds.map(async (pid) => {
                // Try /api/produtos first, then /api/servicos as fallback
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
                  } catch { /* ignore 404s and network errors */ }
                }
              })
            );

            // Inject codigo_interno into products
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

        setOsDetail(osObj);

        const atributos: any[] = osObj?.atributos || [];
        const execAttr = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested?.atributo_id || nested?.id || "") === "73344";
        });
        const nested = execAttr?.atributo || execAttr;
        const execTaskId = String(nested?.conteudo || nested?.valor || "").trim();

        if (execTaskId) {
          const { data: taskData, error: taskError } = await supabase.functions.invoke("auvo-task-update", {
            body: { action: "get", taskId: Number(execTaskId) },
          });

          if (!cancelled && !taskError) {
            const taskObj = taskData?.data?.result ?? taskData?.data ?? null;
            setExecTaskFallback(taskObj);
          }
        }

        if (!cancelled) setOsDetailLoading(false);
      })
      .catch(() => {
        if (!cancelled) setOsDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCard?.gc_os_id, allTasks]);

  // Fetch exec task ID from GC OS attributes
  const fetchExecTaskId = useCallback(async (gcOsId: string): Promise<{ execTaskId: string | null; osTaskId: string | null }> => {
    try {
      const { data, error } = await supabase.functions.invoke("gc-proxy", {
        body: { endpoint: `/api/ordens_servicos/${gcOsId}`, method: "GET" },
      });
      if (error) return { execTaskId: null, osTaskId: null };
      const osObj = data?.data?.data ?? data?.data ?? null;
      if (!osObj) return { execTaskId: null, osTaskId: null };
      const atributos: any[] = osObj.atributos || [];
      const findAttrValue = (attrId: string) => {
        const attr = atributos.find((a: any) => {
          const nested = a?.atributo || a;
          return String(nested.atributo_id || nested.id || "") === attrId;
        });
        if (!attr) return null;
        const nested = attr?.atributo || attr;
        const valor = String(nested?.conteudo || nested?.valor || "").trim();
        return valor && /^\d+$/.test(valor) ? valor : null;
      };
      return { osTaskId: findAttrValue("73343"), execTaskId: findAttrValue("73344") };
    } catch { return { execTaskId: null, osTaskId: null }; }
  }, []);

  const openEditModal = useCallback(async (card: any) => {
    setEditingCard(card);
    setExecTaskId(null);
    setExecTaskLoading(true);
    setEditDate(undefined);
    setEditHour("08");
    setEditMinute("00");
    const currentTecnico = auvoUsers?.find((u) => u.name === card.tecnico || u.login === card.tecnico);
    setEditTecnicoId(currentTecnico ? String(currentTecnico.userID) : card.tecnico_id || "");
    setShowEditModal(true);

    if (card.gc_os_id) {
      const { execTaskId: fetchedExecTaskId, osTaskId } = await fetchExecTaskId(card.gc_os_id);
      if (!fetchedExecTaskId) {
        toast.warning("Tarefa de execução (73344) não encontrada nesta OS");
        setExecTaskLoading(false);
        return;
      }
      if (osTaskId && fetchedExecTaskId === osTaskId) {
        toast.error("A tarefa de execução (73344) está igual à tarefa OS (73343). Verifique os campos no GC.");
      }
      setExecTaskId(fetchedExecTaskId);

      const { data: taskData, error: taskError } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "get", taskId: Number(fetchedExecTaskId) },
      });
      if (!taskError) {
        const taskObj = taskData?.data?.result ?? taskData?.data ?? null;
        const rawTaskDate = taskObj?.taskDate || taskObj?.task_date || taskObj?.date || null;
        if (rawTaskDate) {
          const parsedDate = new Date(rawTaskDate);
          if (!isNaN(parsedDate.getTime())) {
            setEditDate(parsedDate);
            setEditHour(String(parsedDate.getHours()).padStart(2, "0"));
            setEditMinute(String(parsedDate.getMinutes()).padStart(2, "0"));
          }
        }
        const rawUserTo = taskObj?.idUserTo ?? taskObj?.id_user_to ?? null;
        if (rawUserTo) setEditTecnicoId(String(rawUserTo));
      }
    }
    setExecTaskLoading(false);
  }, [auvoUsers, fetchExecTaskId]);

  const handleEditSave = useCallback(async () => {
    if (!editingCard || !execTaskId) {
      toast.error("ID da tarefa de execução não disponível");
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
        toast.warning("Nenhuma alteração para salvar");
        setEditSaving(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("auvo-task-update", {
        body: { action: "edit", taskId: Number(execTaskId), patches },
      });
      if (error) throw error;
      if (data?.status && data.status >= 400) {
        throw new Error(JSON.stringify(data?.data || "Erro ao atualizar tarefa"));
      }

      const tecnicoSelecionado = auvoUsers?.find((user) => String(user.userID) === editTecnicoId);
      const { error: persistError } = await supabase.functions.invoke("auvo-task-update", {
        body: {
          action: "persist-central",
          row: {
            auvo_task_id: editingCard.auvo_task_id,
            data_tarefa: editDate ? format(editDate, "yyyy-MM-dd") : editingCard.data_tarefa,
            tecnico_id: editTecnicoId || editingCard.tecnico_id,
            tecnico: tecnicoSelecionado?.name || tecnicoSelecionado?.login || editingCard.tecnico,
          },
        },
      });

      if (persistError) {
        console.warn("Falha ao persistir espelho local após edição:", persistError);
      }

      toast.success(`Tarefa de execução #${execTaskId} atualizada no Auvo!`);
      onRefresh?.();
      setShowEditModal(false);
      setEditingCard(null);
    } catch (err: any) {
      toast.error(`Erro: ${err.message || "Falha ao atualizar"}`);
    } finally {
      setEditSaving(false);
    }
  }, [auvoUsers, editDate, editHour, editMinute, editTecnicoId, editingCard, execTaskId, onRefresh]);

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
            <p className="text-2xl font-bold text-foreground">{formatCurrency(grandTotal)}</p>
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, OS, tarefa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Situação
              {excludedSituacoes.size > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{excludedSituacoes.size} ocultas</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <div className="space-y-2">
              <Input
                placeholder="Buscar situação..."
                value={searchSituacao}
                onChange={(e) => setSearchSituacao(e.target.value)}
                className="h-8 text-xs"
              />
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

        {/* Exec status filter */}
        <div className="flex items-center gap-1.5">
          {[
            { value: "all", label: "Todas", icon: null },
            { value: "em_andamento", label: "🔄 Em andamento", icon: null },
            { value: "pausada", label: "⏸ Pausada", icon: null },
            { value: "finalizada", label: "✅ Finalizada", icon: null },
            { value: "sem_exec", label: "Sem execução", icon: null },
          ].map((opt) => (
            <Button
              key={opt.value}
              variant={execStatusFilter === opt.value ? "default" : "outline"}
              size="sm"
              className="text-xs h-7 px-2.5"
              onClick={() => setExecStatusFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Sync with selected situações */}
        {onSync && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              // Get the visible (non-excluded) situação IDs from SITUACOES_OPTIONS
              const visibleIds = SITUACOES_OPTIONS
                .filter((s) => !excludedSituacoes.has(s.label))
                .map((s) => s.id);
              onSync(visibleIds);
            }}
            disabled={syncing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar OS"}
          </Button>
        )}
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
                        {formatCurrency(row.total)}
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
                                  <TableHead className="text-xs">Téc. OS</TableHead>
                                  <TableHead className="text-xs">Téc. Execução</TableHead>
                                  <TableHead className="text-xs">Data OS</TableHead>
                                  <TableHead className="text-xs">Data Execução</TableHead>
                                  <TableHead className="text-xs text-right">Valor</TableHead>
                                  <TableHead className="text-xs w-56">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {row.items
                                  .sort((a: any, b: any) => (Number(b.gc_os_valor_total) || 0) - (Number(a.gc_os_valor_total) || 0))
                                  .map((item: any) => (
                                    <TableRow key={item.auvo_task_id} className="text-xs">
                                      <TableCell>
                                        <button
                                          className="text-primary hover:underline font-medium"
                                          onClick={() => setSelectedCard(item)}
                                        >
                                          {item.gc_os_codigo || `T#${item.auvo_task_id}`}
                                        </button>
                                      </TableCell>
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
                                      <TableCell>{osTaskByGcOsId.get(String(item.gc_os_id))?.tecnico || item.tecnico || "—"}</TableCell>
                                      <TableCell>
                                        {(() => {
                                          const execId = item.gc_os_tarefa_exec;
                                          const execRow = execId ? allTasks.find((t: any) => t.auvo_task_id === execId) : null;
                                          const live = liveExecMap.get(String(item.gc_os_id));
                                          return execRow?.tecnico || live?.tecnico || item.gc_os_vendedor || "—";
                                        })()}
                                      </TableCell>
                                      <TableCell>
                                        <span>{item.gc_os_data || item.data_tarefa || "—"}</span>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex items-center gap-1.5">
                                          {(() => {
                                            const execId = item.gc_os_tarefa_exec;
                                            const execRow = execId ? allTasks.find((t: any) => t.auvo_task_id === execId) : null;
                                            const live = liveExecMap.get(String(item.gc_os_id));
                                            const execDate = live?.dataTarefa || execRow?.data_tarefa;
                                            const execStatus = live?.status || (execId && execTaskStatusMap?.get(execId));
                                            return (
                                              <>
                                                <span>{execDate || "—"}</span>
                                                {execStatus === "Finalizada" && (
                                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700 whitespace-nowrap">
                                                    ✅ Exec. Finalizada
                                                  </Badge>
                                                )}
                                                {execStatus === "Pausada" && (
                                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/50 dark:text-yellow-300 dark:border-yellow-700 whitespace-nowrap">
                                                    ⏸ Pausada
                                                  </Badge>
                                                )}
                                                {execStatus === "Em andamento" && (
                                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700 whitespace-nowrap">
                                                    🔄 Em andamento
                                                  </Badge>
                                                )}
                                              </>
                                            );
                                          })()}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-medium">
                                        {formatCurrency(Number(item.gc_os_valor_total) || 0)}
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6"
                                            title="Editar agendamento"
                                            onClick={(e) => { e.stopPropagation(); openEditModal(item); }}
                                          >
                                            <Edit2 className="h-3 w-3" />
                                          </Button>
                                          {item.gc_os_id && (
                                            <a href={`https://gestaoclick.com/ordens_servicos/visualizar/${item.gc_os_id}`} target="_blank" rel="noopener noreferrer" title="OS no GestãoClick">
                                              <Button size="icon" variant="ghost" className="h-6 w-6">
                                                <FileText className="h-3 w-3" />
                                              </Button>
                                            </a>
                                          )}
                                          {(item.auvo_task_url || item.auvo_link) && (
                                            <a href={item.auvo_task_url || item.auvo_link} target="_blank" rel="noopener noreferrer" title="Tarefa no Auvo">
                                              <Button size="icon" variant="ghost" className="h-6 w-6">
                                                <ExternalLink className="h-3 w-3" />
                                              </Button>
                                            </a>
                                          )}
                                          {item.gc_os_id && !movedOsIds.has(item.gc_os_id) && (
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-6 w-6"
                                              title="Conciliar OS"
                                              disabled={changingId === item.gc_os_id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setConciliacaoCard(item);
                                                setConciliacaoSituacao("");
                                              }}
                                            >
                                              {changingId === item.gc_os_id ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                              ) : (
                                                <RefreshCw className="h-3 w-3" />
                                              )}
                                            </Button>
                                          )}
                                          {movedOsIds.has(item.gc_os_id) && (
                                            <Badge variant="outline" className="text-[9px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700">
                                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> Alterada
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

      {/* Detail Dialog */}
      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>OS {selectedCard?.gc_os_codigo}</span>
              <Badge
                className="text-xs"
                style={{ backgroundColor: selectedCard?.gc_os_cor_situacao || undefined }}
              >
                {selectedCard?.gc_os_situacao}
              </Badge>
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {(() => {
                const atributos: any[] = osDetail?.atributos || [];
                const liveResolvedExec = liveExecMap.get(String(selectedCard?.gc_os_id));
                const findAttrValue = (attrId: string) => {
                  const attr = atributos.find((a: any) => {
                    const nested = a?.atributo || a;
                    return String(nested?.atributo_id || nested?.id || "") === attrId;
                  });
                  if (!attr) return null;
                  const nested = attr?.atributo || attr;
                  const valor = String(nested?.conteudo || nested?.valor || "").trim();
                  return valor && /^\d+$/.test(valor) ? valor : null;
                };

                const osTaskId = findAttrValue("73343");
                const execTaskId = findAttrValue("73344") || selectedCard?.gc_os_tarefa_exec || liveResolvedExec?.execTaskId || null;

                if (osTaskId || execTaskId) {
                  return `Tarefa OS #${osTaskId || "—"} • Execução #${execTaskId || "—"}`;
                }

                return `Tarefa Auvo #${selectedCard?.auvo_task_id}`;
              })()}
            </p>
          </DialogHeader>
          {selectedCard && (() => {
            const atributos: any[] = osDetail?.atributos || [];
            const liveResolvedExec = liveExecMap.get(String(selectedCard.gc_os_id));
            const findAttrValue = (attrId: string) => {
              const attr = atributos.find((a: any) => {
                const nested = a?.atributo || a;
                return String(nested?.atributo_id || nested?.id || "") === attrId;
              });
              if (!attr) return null;
              const nested = attr?.atributo || attr;
              const valor = String(nested?.conteudo || nested?.valor || "").trim();
              return valor && /^\d+$/.test(valor) ? valor : null;
            };

            const osTaskId = findAttrValue("73343");
            const execTaskId = findAttrValue("73344") || selectedCard.gc_os_tarefa_exec || liveResolvedExec?.execTaskId || null;

            const osRow = (() => {
              if (osTaskId) {
                return allTasks.find((t: any) => String(t.auvo_task_id) === String(osTaskId))
                  || (String(selectedCard.auvo_task_id) === String(osTaskId) ? selectedCard : null);
              }
              if (!execTaskId || String(selectedCard.auvo_task_id) !== String(execTaskId)) return selectedCard;
              return null;
            })();

            const execRow = (() => {
              if (!execTaskId) return null;

              const mirrorExecRow = allTasks.find((t: any) => String(t.auvo_task_id) === String(execTaskId))
                || (String(selectedCard.auvo_task_id) === String(execTaskId) ? selectedCard : null)
                || (liveResolvedExec ? {
                  auvo_task_id: String(execTaskId),
                  tecnico: liveResolvedExec.tecnico || null,
                  data_tarefa: liveResolvedExec.dataTarefa || null,
                  status_auvo: liveResolvedExec.status || null,
                } : null);

              if (execTaskFallback) {
                return {
                  ...mirrorExecRow,
                  auvo_task_id: String(execTaskId),
                  tecnico: execTaskFallback?.idUserTo && auvoUsers?.find((u) => String(u.userID) === String(execTaskFallback.idUserTo))?.name,
                  data_tarefa: String(execTaskFallback?.taskDate || "").slice(0, 10) || mirrorExecRow?.data_tarefa || null,
                  status_auvo: getAuvoStatusFromTask(execTaskFallback),
                  hora_inicio: execTaskFallback?.checkInDate ? String(execTaskFallback.checkInDate).slice(11, 19) : (mirrorExecRow?.hora_inicio || String(execTaskFallback?.taskDate || "").slice(11, 19) || null),
                  hora_fim: execTaskFallback?.checkOutDate ? String(execTaskFallback.checkOutDate).slice(11, 19) : (mirrorExecRow?.hora_fim || null),
                  check_in: !!execTaskFallback?.checkIn,
                  check_out: !!execTaskFallback?.checkOut,
                  duracao_decimal: execTaskFallback?.durationDecimal ? Number(execTaskFallback.durationDecimal) : (mirrorExecRow?.duracao_decimal ?? null),
                  report: execTaskFallback?.report || null,
                  reasonForPause: execTaskFallback?.reasonForPause || null,
                };
              }

              return mirrorExecRow;
            })();

            return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Cliente (Auvo)</span>
                  <p className="font-medium">{selectedCard.cliente || "—"}</p>
                  {selectedCard.gc_os_cliente && (
                    <p className="text-xs text-muted-foreground">GC: {selectedCard.gc_os_cliente}</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Vendedor GC</span>
                  <p className="font-medium">{selectedCard.gc_os_vendedor || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Valor Total OS</span>
                  <p className="font-semibold text-foreground">{formatCurrency(Number(selectedCard.gc_os_valor_total) || 0)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Data Abertura OS</span>
                  <p className="font-medium">{selectedCard.gc_os_data || "—"}</p>
                </div>
              </div>

              {/* Tarefa OS (73343) */}
              {osRow ? (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border-b">
                    <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <a
                      href={`https://app.auvo.com.br/relatorioTarefas/DetalheTarefa/${osRow.auvo_task_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-blue-700 dark:text-blue-300 underline hover:text-blue-900 dark:hover:text-blue-100"
                    >
                      Tarefa OS #{osRow.auvo_task_id}
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Técnico</span>
                      <p className="font-medium">{osRow.tecnico || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Data Agendamento</span>
                      <p className="font-medium">{osRow.data_tarefa || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Status Auvo</span>
                      <p className="font-medium">{osRow.status_auvo || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Horário (Check-in / Check-out)</span>
                      <p className="font-medium">
                        {osRow.check_in ? "✅" : "❌"} In{osRow.hora_inicio ? ` ${osRow.hora_inicio}` : ""}
                        {" → "}
                        {osRow.check_out ? "✅" : "❌"} Out{osRow.hora_fim ? ` ${osRow.hora_fim}` : ""}
                      </p>
                      {osRow.duracao_decimal != null && Number(osRow.duracao_decimal) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Duração: {Number(osRow.duracao_decimal).toFixed(1)}h
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border rounded-md p-3 text-sm text-muted-foreground text-center border-dashed">
                  Tarefa OS não encontrada no banco
                </div>
              )}

              {/* Tarefa Execução (73344) */}
              {execRow ? (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 border-b">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <a
                      href={`https://app.auvo.com.br/relatorioTarefas/DetalheTarefa/${execRow.auvo_task_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 underline hover:text-emerald-900 dark:hover:text-emerald-100"
                    >
                      Tarefa Execução #{execRow.auvo_task_id}
                    </a>
                    {execRow.status_auvo === "Finalizada" && (
                      <Badge className="ml-auto text-[10px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300">
                        ✅ Finalizada
                      </Badge>
                    )}
                    {(execRow.status_auvo || "").toLowerCase().includes("pausa") && (
                      <Badge className="ml-auto text-[10px] bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/50 dark:text-yellow-300">
                        ⏸ Pausada
                      </Badge>
                    )}
                    {(execRow.status_auvo || "").toLowerCase().includes("andamento") && (
                      <Badge className="ml-auto text-[10px] bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300">
                        🔄 Em andamento
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Técnico</span>
                      <p className="font-medium">{execRow.tecnico || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Data Agendamento</span>
                      <p className="font-medium">{execRow.data_tarefa || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Status Auvo</span>
                      <p className="font-medium">{execRow.status_auvo || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Horário (Check-in / Check-out)</span>
                      <p className="font-medium">
                        {execRow.check_in ? "✅" : "❌"} In{execRow.hora_inicio ? ` ${execRow.hora_inicio}` : ""}
                        {" → "}
                        {execRow.check_out ? "✅" : "❌"} Out{execRow.hora_fim ? ` ${execRow.hora_fim}` : ""}
                      </p>
                      {execRow.duracao_decimal != null && Number(execRow.duracao_decimal) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Duração: {Number(execRow.duracao_decimal).toFixed(1)}h
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Motivo da pausa */}
                  {execRow.reasonForPause && (
                    <div className="mx-3 mb-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-2">
                      <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">⏸ Motivo da pausa:</span>
                      <p className="text-sm mt-0.5">{execRow.reasonForPause}</p>
                    </div>
                  )}
                  {/* Relato da tarefa */}
                  {execRow.report && (
                    <div className="mx-3 mb-3 bg-muted/50 border rounded-md p-2">
                      <span className="text-xs font-medium text-muted-foreground">📝 Relato do técnico:</span>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{execRow.report}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="border rounded-md p-3 text-sm text-muted-foreground text-center border-dashed">
                  Nenhuma tarefa de execução vinculada
                </div>
              )}

              {/* Endereço */}
              {selectedCard.endereco && (
                <div className="flex items-start gap-2 bg-muted/50 rounded-md p-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm flex-1">{selectedCard.endereco}</p>
                  <Button size="sm" variant="outline" className="flex-shrink-0 gap-1 h-7 text-xs" asChild>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedCard.endereco)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Navigation className="h-3 w-3" /> Maps
                    </a>
                  </Button>
                </div>
              )}

              {/* Orientação */}
              {selectedCard.orientacao && (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Orientação / Peças da OS</span>
                  </div>
                  <div className="p-3">
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                      {selectedCard.orientacao}
                    </pre>
                  </div>
                </div>
              )}

              {/* GC OS Detail: produtos/serviços */}
              {osDetailLoading && (
                <div className="border rounded-md p-4 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
              {!osDetailLoading && osDetail && (() => {
                const produtos: any[] = (osDetail?.produtos || []).map((p: any) => p?.produto || p);
                const servicos: any[] = (osDetail?.servicos || []).map((s: any) => s?.servico || s);
                const hasItems = produtos.length > 0 || servicos.length > 0;
                const valorProdutos = Number(osDetail?.valor_produtos || osDetail?.total_produtos || 0);
                const valorServicos = Number(osDetail?.valor_servicos || osDetail?.total_servicos || 0);
                const valorDesconto = Number(osDetail?.desconto || osDetail?.valor_desconto || 0);
                const valorTotal = Number(osDetail?.valor_total || selectedCard.gc_os_valor_total || 0);

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
                          <span className="text-sm font-semibold">Produtos ({produtos.length})</span>
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
                                  <TableCell className="text-xs py-1.5 max-w-[200px] truncate">{String(p.nome_produto || p.descricao || p.nome || "—")}</TableCell>
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
                                  <TableCell className="text-xs py-1.5 max-w-[200px] truncate">{String(s.nome_servico || s.descricao || s.nome || "—")}</TableCell>
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
                        Nenhum produto ou serviço cadastrado nesta OS
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Orçamento vinculado */}
              {selectedCard.orcamento_realizado && selectedCard.gc_orcamento_codigo && (
                <div className="border rounded-md border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-300">
                    <FileText className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Orçamento #{selectedCard.gc_orcamento_codigo}
                    </span>
                    <Badge className="ml-auto text-[10px]" style={{ backgroundColor: selectedCard.gc_orc_cor_situacao || undefined }}>
                      {selectedCard.gc_orc_situacao || "—"}
                    </Badge>
                  </div>
                  <div className="p-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Valor</span>
                      <p className="font-medium">{formatCurrency(Number(selectedCard.gc_orc_valor_total) || 0)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Vendedor</span>
                      <p className="font-medium">{selectedCard.gc_orc_vendedor || "—"}</p>
                    </div>
                  </div>
                  {selectedCard.gc_orc_link && (
                    <div className="px-3 pb-3">
                      <Button size="sm" variant="outline" asChild>
                        <a href={selectedCard.gc_orc_link} target="_blank" rel="noopener noreferrer" className="gap-1">
                          <ExternalLink className="h-3.5 w-3.5" /> Ver Orçamento no GC
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Questionário */}
              {selectedCard.questionario_preenchido && selectedCard.questionario_respostas && (
                <div className="border rounded-md">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Questionário Preenchido</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {(Array.isArray(selectedCard.questionario_respostas) ? selectedCard.questionario_respostas : [])
                      .filter((r: any) => r.reply && !r.reply.startsWith("http"))
                      .map((r: any, i: number) => (
                        <div key={i} className="text-sm">
                          <span className="text-muted-foreground text-xs">{r.question}</span>
                          <p className="font-medium">{r.reply}</p>
                        </div>
                      ))}
                    {(() => {
                      const photos = (Array.isArray(selectedCard.questionario_respostas) ? selectedCard.questionario_respostas : [])
                        .filter((r: any) => r.reply && r.reply.startsWith("http"));
                      if (photos.length === 0) return null;
                      return (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">Fotos</span>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {photos.map((r: any, i: number) => (
                              <a key={i} href={r.reply} target="_blank" rel="noopener noreferrer">
                                <img src={r.reply} alt={r.question} className="h-16 w-16 object-cover rounded border hover:ring-2 ring-primary" />
                              </a>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Pendência */}
              {selectedCard.pendencia && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3">
                  <span className="text-sm font-medium text-destructive">⚠️ Pendência:</span>
                  <p className="text-sm mt-1">{selectedCard.pendencia}</p>
                </div>
              )}

              {/* Links + Edit */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button size="sm" variant="default" className="gap-1" onClick={() => { setSelectedCard(null); openEditModal(selectedCard); }}>
                  <Edit2 className="h-3.5 w-3.5" /> Editar Agendamento
                </Button>
                {selectedCard.gc_os_id && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={`https://gestaoclick.com/ordens_servicos/visualizar/${selectedCard.gc_os_id}`} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> OS no GestãoClick
                    </a>
                  </Button>
                )}
                {(selectedCard.auvo_task_url || selectedCard.auvo_link) && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.auvo_task_url || selectedCard.auvo_link || "#"} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> Tarefa Auvo
                    </a>
                  </Button>
                )}
                {selectedCard.auvo_survey_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={selectedCard.auvo_survey_url} target="_blank" rel="noopener noreferrer" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" /> Formulário
                    </a>
                  </Button>
                )}
              </div>
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Task Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Editar Tarefa Auvo
            </DialogTitle>
          </DialogHeader>
          {editingCard && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-md p-3 text-sm">
                <p className="font-medium">{editingCard.cliente || editingCard.gc_os_cliente || "—"}</p>
                <p className="text-muted-foreground text-xs mt-0.5">OS {editingCard.gc_os_codigo}</p>
                <p className="text-xs mt-1">
                  {execTaskLoading ? (
                    <span className="text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando tarefa de execução...</span>
                  ) : execTaskId ? (
                    <a href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${execTaskId}`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
                      ✓ Tarefa Execução #{execTaskId} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-destructive">⚠ Tarefa de execução não encontrada</span>
                  )}
                </p>
              </div>

              {/* Warning: exec task already scheduled */}
              {(() => {
                const execId = editingCard.gc_os_tarefa_exec;
                const execRow = execId ? allTasks.find((t: any) => t.auvo_task_id === execId) : null;
                const execDate = execRow?.data_tarefa;
                const execTecnico = execRow?.tecnico;
                const osDate = editingCard.gc_os_data || editingCard.data_tarefa;
                return (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-sm space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Informações da OS
                    </div>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      <span className="font-medium">Abertura da OS:</span> {osDate || "—"}
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      <span className="font-medium">Agendamento Execução:</span> {execDate && execTecnico ? `${execDate} — ${execTecnico}` : execDate ? execDate : ""}
                    </p>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <Label>Data da Tarefa de Execução</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !editDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editDate ? format(editDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editDate}
                      onSelect={setEditDate}
                      locale={ptBR}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Horário</Label>
                <div className="flex items-center gap-2">
                  <Select value={editHour} onValueChange={setEditHour}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder="HH" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-lg font-bold text-muted-foreground">:</span>
                  <Select value={editMinute} onValueChange={setEditMinute}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder="MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {["00", "15", "30", "45"].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Técnico</Label>
                <Select value={editTecnicoId} onValueChange={setEditTecnicoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar técnico" />
                  </SelectTrigger>
                  <SelectContent>
                    {auvoUsers?.map((user) => (
                      <SelectItem key={user.userID} value={String(user.userID)}>
                        {user.name || user.login}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancelar</Button>
                <Button onClick={handleEditSave} disabled={editSaving || execTaskLoading || !execTaskId}>
                  {editSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Conciliação Dialog */}
      <Dialog open={!!conciliacaoCard} onOpenChange={(open) => { if (!open) { setConciliacaoCard(null); setConciliacaoSituacao(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Conciliar OS {conciliacaoCard?.gc_os_codigo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              Cliente: <span className="font-medium text-foreground">{conciliacaoCard?.cliente || conciliacaoCard?.gc_os_cliente || "—"}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Situação atual: <Badge variant="outline" className="text-xs ml-1" style={{ borderColor: conciliacaoCard?.gc_os_cor_situacao || undefined, color: conciliacaoCard?.gc_os_cor_situacao || undefined }}>{conciliacaoCard?.gc_os_situacao || "—"}</Badge>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Nova situação</Label>
              <Select value={conciliacaoSituacao} onValueChange={setConciliacaoSituacao}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a situação destino..." />
                </SelectTrigger>
                <SelectContent>
                  {SITUACOES_OPTIONS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConciliacaoCard(null); setConciliacaoSituacao(""); }}>
              Cancelar
            </Button>
            <Button
              disabled={!conciliacaoSituacao || !!changingId}
              onClick={() => conciliacaoCard && alterarSituacaoOS(conciliacaoCard, conciliacaoSituacao)}
            >
              {changingId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
