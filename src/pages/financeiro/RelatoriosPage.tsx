import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileText, Clock, Settings, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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

export default function RelatoriosPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        // Hold at last step
        if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      }
    }, 8000); // ~8s per step for a ~1min sync
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

  const handleSync = async () => {
    setSyncing(true);
    startProgressSimulation();
    try {
      const { data, error } = await supabase.functions.invoke("central-sync", {
        body: {},
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || "Erro na sincronização");

      toast.success(
        `Sync concluído: ${data.auvo_tarefas || 0} tarefas do Auvo, ${data.upserted || 0} atualizadas`
      );
      stopProgressSimulation(true);

      queryClient.invalidateQueries({ queryKey: ["relatorios-tarefas-os"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios-todas-tarefas"] });
    } catch (err: any) {
      if (err?.message?.includes("context canceled") || err?.message?.includes("FunctionsHttpError")) {
        toast.info("Sync iniciado em background — aguarde ~1 min e recarregue a página");
        stopProgressSimulation(true);
      } else {
        toast.error(`Erro: ${err.message}`);
        stopProgressSimulation(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, []);

  // Fetch OS-linked tasks (for OS em Aberto tab)
  const { data: tarefasOS, isLoading: isLoadingOS } = useQuery({
    queryKey: ["relatorios-tarefas-os"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .not("gc_os_id", "is", null)
        .order("data_tarefa", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  // Fetch ALL tasks (for Horas Trabalhadas tab - includes tasks without OS)
  const { data: todasTarefas, isLoading: isLoadingAll } = useQuery({
    queryKey: ["relatorios-todas-tarefas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .order("data_tarefa", { ascending: false });
      if (error) throw error;
      return data || [];
    },
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
    return tarefasOS.filter((t) => {
      const sit = (t.gc_os_situacao || "").toLowerCase();
      return !sit.startsWith("executad") && !sit.startsWith("imp cigam faturado total") && !sit.startsWith("financeiro separado / baixa cigam");
    });
  }, [tarefasOS]);

  const allClientes = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.cliente || t.gc_os_cliente || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  const allTecnicos = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.tecnico || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  const allTiposTarefa = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.descricao || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Visão consolidada de OS abertas e horas trabalhadas</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Atualizar do Auvo"}
          </Button>
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
          <OSAbertasTab data={osAbertas} isLoading={isLoadingOS} allClientes={allClientes} />
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
