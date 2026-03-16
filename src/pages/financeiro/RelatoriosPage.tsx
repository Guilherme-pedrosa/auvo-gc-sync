import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, Clock, Settings, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import OSAbertasTab from "@/components/relatorios/OSAbertasTab";
import HorasTrabalhadasTab from "@/components/relatorios/HorasTrabalhadasTab";
import ConfiguracoesTab from "@/components/relatorios/ConfiguracoesTab";

export default function RelatoriosPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    const toastId = toast.loading("Sincronizando tarefas do Auvo...");
    try {
      const { data, error } = await supabase.functions.invoke("central-sync", {
        body: {},
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || "Erro na sincronização");

      toast.success(
        `Sync concluído: ${data.auvo_tarefas || 0} tarefas do Auvo, ${data.upserted || 0} atualizadas`,
        { id: toastId }
      );

      // Refresh all queries
      queryClient.invalidateQueries({ queryKey: ["relatorios-tarefas-os"] });
      queryClient.invalidateQueries({ queryKey: ["relatorios-todas-tarefas"] });
    } catch (err: any) {
      // Edge function timeout returns error but sync may still complete
      if (err?.message?.includes("context canceled") || err?.message?.includes("FunctionsHttpError")) {
        toast.info("Sync iniciado em background — aguarde ~1 min e recarregue a página", { id: toastId });
      } else {
        toast.error(`Erro: ${err.message}`, { id: toastId });
      }
    } finally {
      setSyncing(false);
    }
  };

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

  // Fetch groups
  const { data: grupos, refetch: refetchGrupos } = useQuery({
    queryKey: ["grupos-clientes"],
    queryFn: async () => {
      const { data } = await supabase.from("grupos_clientes").select("*").order("nome");
      return data || [];
    },
  });

  // Fetch group members
  const { data: membros, refetch: refetchMembros } = useQuery({
    queryKey: ["grupo-membros"],
    queryFn: async () => {
      const { data } = await supabase.from("grupo_cliente_membros").select("*");
      return data || [];
    },
  });

  // Fetch valor_hora configs
  const { data: valorHoraConfigs, refetch: refetchValorHora } = useQuery({
    queryKey: ["valor-hora-config"],
    queryFn: async () => {
      const { data } = await supabase.from("valor_hora_config").select("*");
      return data || [];
    },
  });

  // Filter out executed OS (same logic as kanban)
  const osAbertas = useMemo(() => {
    if (!tarefasOS) return [];
    return tarefasOS.filter((t) => {
      const sit = (t.gc_os_situacao || "").toLowerCase();
      return !sit.startsWith("executad") && !sit.startsWith("imp cigam faturado total") && !sit.startsWith("financeiro separado / baixa cigam");
    });
  }, [tarefasOS]);

  // All unique client names from ALL tarefas (for horas/config tabs)
  const allClientes = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.cliente || t.gc_os_cliente || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  // All unique technicians
  const allTecnicos = useMemo(() => {
    if (!todasTarefas) return [] as string[];
    const set = new Set(todasTarefas.map((t) => t.tecnico || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [todasTarefas]);

  // All unique task descriptions (types)
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
