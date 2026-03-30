import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileText, Clock, Settings, RefreshCw, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import LastSyncBadge from "@/components/LastSyncBadge";
import OSAbertasTab from "@/components/relatorios/OSAbertasTab";
import HorasTrabalhadasTab from "@/components/relatorios/HorasTrabalhadasTab";
import ConfiguracoesTab from "@/components/relatorios/ConfiguracoesTab";



const SYNC_STEPS = [
  { label: "Autenticando no Auvo...", progress: 5 },
  { label: "Buscando tarefas do Auvo...", progress: 15 },
  { label: "Buscando orçamentos do GestãoClick...", progress: 35 },
  { label: "Buscando OS do GestãoClick...", progress: 50 },
  { label: "Cruzando dados Auvo × GC...", progress: 65 },
  { label: "Buscando endereços detalhados...", progress: 75 },
  { label: "Salvando no banco de dados...", progress: 88 },
  { label: "Finalizando...", progress: 95 },
];

const TAREFAS_CENTRAL_PAGE_SIZE = 1000;

const fetchAllTarefasCentral = async ({
  onlyWithOs = false,
}: {
  onlyWithOs?: boolean;
} = {}) => {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("tarefas_central")
      .select("*")
      .order("data_tarefa", { ascending: false })
      .range(from, from + TAREFAS_CENTRAL_PAGE_SIZE - 1);

    if (onlyWithOs) {
      query = query.not("gc_os_id", "is", null);
    }

    const { data, error } = await query;
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch);

    if (batch.length < TAREFAS_CENTRAL_PAGE_SIZE) {
      break;
    }

    from += TAREFAS_CENTRAL_PAGE_SIZE;
  }

  return rows;
};

export default function RelatoriosPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));

  const refreshRelatoriosData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["relatorios-tarefas-os"] });
    queryClient.invalidateQueries({ queryKey: ["relatorios-todas-tarefas"] });
    queryClient.invalidateQueries({ queryKey: ["last-sync-timestamp"] });
  }, [queryClient]);

  const clearScheduledRefreshes = useCallback(() => {
    refreshTimeoutsRef.current.forEach(clearTimeout);
    refreshTimeoutsRef.current = [];
  }, []);

  const scheduleBackgroundRefresh = useCallback(() => {
    clearScheduledRefreshes();
    const delays = [15000, 30000, 60000];
    refreshTimeoutsRef.current = delays.map((delay) =>
      setTimeout(() => {
        refreshRelatoriosData();
      }, delay)
    );
  }, [clearScheduledRefreshes, refreshRelatoriosData]);

  const startProgressSimulation = () => {
    setSyncStep(0);
    setSyncProgress(0);
    let currentStep = 0;

    stepTimerRef.current = setInterval(() => {
      currentStep++;
      if (currentStep < SYNC_STEPS.length) {
        setSyncStep(currentStep);
        setSyncProgress(SYNC_STEPS[currentStep].progress);
      } else {
        if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      }
    }, 8000);
  };

  const stopProgressSimulation = (success: boolean) => {
    if (stepTimerRef.current) {
      clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    if (success) {
      setSyncProgress(100);
      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(0);
        setSyncStep(0);
      }, 1500);
    } else {
      setSyncing(false);
      setSyncProgress(0);
      setSyncStep(0);
    }
  };

  const handleSync = async (situacaoIds?: string[]) => {
    setSyncing(true);
    clearScheduledRefreshes();
    startProgressSimulation();
    const syncFrom = format(dateFrom, "yyyy-MM-dd");
    const syncTo = format(dateTo, "yyyy-MM-dd");

    try {
      const { data, error } = await supabase.functions.invoke("central-sync", {
        body: { start_date: syncFrom, end_date: syncTo, situacao_ids: situacaoIds || [] },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || "Erro na sincronização");

      toast.success(
        `Sync ${syncFrom} → ${syncTo}: ${data.auvo_tarefas || 0} tarefas, ${data.upserted || 0} atualizadas`
      );
      stopProgressSimulation(true);
      refreshRelatoriosData();
    } catch (err: any) {
      const message = String(err?.message || "");
      const isBackgroundSync =
        message.includes("context canceled") ||
        message.includes("FunctionsHttpError") ||
        message.includes("FunctionsFetchError") ||
        message.includes("Failed to send a request to the Edge Function") ||
        message.toLowerCase().includes("fetch");

      if (isBackgroundSync) {
        toast.info("Sync iniciado em background — atualizando a tela automaticamente");
        stopProgressSimulation(true);
        scheduleBackgroundRefresh();
      } else {
        toast.error(`Erro: ${message}`);
        stopProgressSimulation(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      clearScheduledRefreshes();
    };
  }, [clearScheduledRefreshes]);

  // Fetch OS-linked tasks (for OS em Aberto tab)
  const { data: tarefasOS, isLoading: isLoadingOS } = useQuery({
    queryKey: ["relatorios-tarefas-os"],
    queryFn: async () => fetchAllTarefasCentral({ onlyWithOs: true }),
    staleTime: 60_000,
  });

  // Fetch ALL tasks (for Horas Trabalhadas tab - includes tasks without OS)
  const { data: todasTarefas, isLoading: isLoadingAll } = useQuery({
    queryKey: ["relatorios-todas-tarefas"],
    queryFn: async () => fetchAllTarefasCentral(),
    staleTime: 60_000,
  });

  const { data: grupos, refetch: refetchGrupos } = useQuery({
    queryKey: ["grupos-clientes"],
    queryFn: async () => {
      const { data } = await supabase.from("grupos_clientes").select("*").order("nome");
      return data || [];
    },
  });

  const { data: membros, refetch: refetchMembros } = useQuery({
    queryKey: ["grupo-membros"],
    queryFn: async () => {
      const { data } = await supabase.from("grupo_cliente_membros").select("*");
      return data || [];
    },
  });

  const { data: valorHoraConfigs, refetch: refetchValorHora } = useQuery({
    queryKey: ["valor-hora-config"],
    queryFn: async () => {
      const { data } = await supabase.from("valor_hora_config").select("*");
      return data || [];
    },
  });

  const osAbertas = useMemo(() => {
    if (!tarefasOS) return [];
    // Deduplicate by gc_os_id — keep the most recently updated row per OS
    const byOsId = new Map<string, any>();
    for (const t of tarefasOS) {
      const osId = t.gc_os_id;
      if (!osId) continue;
      const existing = byOsId.get(osId);
      if (!existing || (t.atualizado_em || "") > (existing.atualizado_em || "")) {
        byOsId.set(osId, t);
      }
    }
    return Array.from(byOsId.values()).filter((t) => {
      const sit = (t.gc_os_situacao || "").toLowerCase();
      return !sit.startsWith("executad") && !sit.startsWith("imp cigam faturado total") && !sit.startsWith("financeiro separado / baixa cigam");
    });
  }, [tarefasOS]);

  // Map: auvo_task_id → status_auvo (to look up execution task status)
  // Uses ALL tasks so execution tasks not directly linked to an OS are still found
  const execTaskStatusMap = useMemo(() => {
    const source = todasTarefas || tarefasOS;
    if (!source) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const t of source) {
      // Derive a reliable status: only mark as "Finalizada" if check_out is true
      let status = t.status_auvo || "";
      if (status === "Finalizada" && !t.check_out) {
        // Task was incorrectly marked — treat as in-progress or paused
        status = t.check_in ? "Em andamento" : "Agendada";
      }
      map.set(t.auvo_task_id, status);
    }
    return map;
  }, [todasTarefas, tarefasOS]);

  const allClientes = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const normalize = (s: string) =>
      s.trim().toUpperCase()
        .replace(/\s+(LTDA|ME|SA|S\.A\.|S\/A|EIRELI|EPP|SOCIEDADE SIMPLES|SS)\s*\.?$/i, "")
        .trim();
    const map = new Map<string, string>();
    for (const t of todasTarefas) {
      const raw = (t.cliente || t.gc_os_cliente || "").trim();
      if (!raw) continue;
      const key = normalize(raw);
      if (!map.has(key)) map.set(key, raw);
    }
    return Array.from(map.values()).sort() as string[];
  }, [todasTarefas]);

  const allTecnicos = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.tecnico || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  const allTiposTarefa = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(
      todasTarefas.map((t) => {
        const tipo = (t.descricao || "").trim();
        return tipo.length > 0 ? tipo : "Sem tipo";
      })
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR")) as string[];
  }, [todasTarefas]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Visão consolidada de OS abertas e horas trabalhadas</p>
          <LastSyncBadge className="mt-0.5" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-1.5 w-[130px] justify-start text-left font-normal")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(dateFrom, "dd/MM/yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={(d) => d && setDateFrom(d)}
                  initialFocus
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
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
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={(d) => d && setDateTo(d)}
                  initialFocus
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handleSync()}
              disabled={syncing}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
          </div>
          {syncing && (
            <div className="w-64 space-y-1.5">
              <Progress value={syncProgress} className="h-2" />
              <p className="text-[11px] text-muted-foreground text-right">
                {SYNC_STEPS[syncStep]?.label}
              </p>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="os-abertas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="os-abertas" className="gap-1.5">
            <FileText className="h-4 w-4" />
            OS em Aberto
          </TabsTrigger>
          <TabsTrigger value="horas" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Horas Trabalhadas
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-4 w-4" />
            Configurações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="os-abertas">
          <OSAbertasTab
            data={osAbertas}
            allTasks={todasTarefas || []}
            isLoading={isLoadingOS}
            allClientes={allClientes}
            onRefresh={refreshRelatoriosData}
            onSync={(situacaoIds) => handleSync(situacaoIds)}
            syncing={syncing}
            execTaskStatusMap={execTaskStatusMap}
          />
        </TabsContent>

        <TabsContent value="horas">
          <HorasTrabalhadasTab
            data={todasTarefas || []}
            isLoading={isLoadingAll}
            allClientes={allClientes}
            allTecnicos={allTecnicos}
            allTiposTarefa={allTiposTarefa}
            grupos={grupos || []}
            membros={membros || []}
            valorHoraConfigs={valorHoraConfigs || []}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        </TabsContent>

        <TabsContent value="config">
          <ConfiguracoesTab
            grupos={grupos || []}
            membros={membros || []}
            allClientes={allClientes}
            allTecnicos={allTecnicos}
            valorHoraConfigs={valorHoraConfigs || []}
            onRefresh={() => { refetchGrupos(); refetchMembros(); refetchValorHora(); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
