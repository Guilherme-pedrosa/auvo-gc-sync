import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Clock, Settings } from "lucide-react";
import OSAbertasTab from "@/components/relatorios/OSAbertasTab";
import HorasTrabalhadasTab from "@/components/relatorios/HorasTrabalhadasTab";
import ConfiguracoesTab from "@/components/relatorios/ConfiguracoesTab";

export default function RelatoriosPage() {
  // Fetch all OS from tarefas_central (same logic as kanban)
  const { data: tarefas, isLoading } = useQuery({
    queryKey: ["relatorios-tarefas"],
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
    if (!tarefas) return [];
    return tarefas.filter((t) => {
      const sit = (t.gc_os_situacao || "").toLowerCase();
      return !sit.startsWith("executad") && !sit.startsWith("imp cigam faturado total") && !sit.startsWith("financeiro separado / baixa cigam");
    });
  }, [tarefas]);

  // All unique client names from all tarefas
  const allClientes = useMemo(() => {
    if (!tarefas) return [];
    const set = new Set(tarefas.map((t) => t.cliente || t.gc_os_cliente || "").filter(Boolean));
    return Array.from(set).sort();
  }, [tarefas]);

  // All unique technicians
  const allTecnicos = useMemo(() => {
    if (!tarefas) return [];
    const set = new Set(tarefas.map((t) => t.tecnico || "").filter(Boolean));
    return Array.from(set).sort();
  }, [tarefas]);

  // All unique task descriptions (types)
  const allTiposTarefa = useMemo(() => {
    if (!tarefas) return [];
    const set = new Set(tarefas.map((t) => t.descricao || "").filter(Boolean));
    return Array.from(set).sort();
  }, [tarefas]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada de OS abertas e horas trabalhadas</p>
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
          <OSAbertasTab data={osAbertas} isLoading={isLoading} allClientes={allClientes} />
        </TabsContent>

        <TabsContent value="horas">
          <HorasTrabalhadasTab
            data={tarefas || []}
            isLoading={isLoading}
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
