import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileText, Clock, Settings, RefreshCw, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isOpenOsSituation } from "@/lib/osOpenStatuses";
import { syncReportsInSteps, type ReportsSyncWarning } from "@/lib/reportsSync";
import LastSyncBadge from "@/components/LastSyncBadge";
import OSAbertasTab from "@/components/relatorios/OSAbertasTab";
import HorasTrabalhadasTab from "@/components/relatorios/HorasTrabalhadasTab";
import ConfiguracoesTab from "@/components/relatorios/ConfiguracoesTab";



const TAREFAS_CENTRAL_PAGE_SIZE = 1000;
const REPORTS_SYNC_CHUNK_DAYS = 1;
const TAREFAS_CENTRAL_REPORT_COLUMNS = [
  "auvo_task_id", "cliente", "tecnico", "tecnico_id", "data_tarefa", "data_conclusao", "status_auvo",
  "orientacao", "pendencia", "descricao", "endereco", "auvo_link", "auvo_task_url", "auvo_survey_url",
  "duracao_decimal", "hora_inicio", "hora_fim", "check_in", "check_out",
  "check_in_iso", "check_out_iso", "duracao_deslocamento", "equipamento_nome", "equipamento_id_serie",
  "gc_os_id", "gc_os_codigo", "gc_os_cliente", "gc_os_situacao", "gc_os_situacao_id", "gc_os_cor_situacao",
  "gc_os_valor_total", "gc_os_vendedor", "gc_os_data", "gc_os_data_saida", "gc_os_link", "gc_os_link_cobranca",
  "gc_os_tarefa_exec", "gc_os_tarefa_os", "gc_os_local_reparo", "gc_orcamento_id", "gc_orcamento_codigo", "gc_orc_cliente",
  "gc_orc_situacao", "gc_orc_situacao_id", "gc_orc_cor_situacao", "gc_orc_valor_total", "gc_orc_vendedor",
  "gc_orc_data", "gc_orc_link", "task_type_id", "atualizado_em",
].join(",");

const parseAuvoTaskIds = (value: unknown): string[] => {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw.split("/").map((id) => id.trim()).filter((id) => /^\d+$/.test(id));
};

const buildDateChunks = (from: Date, to: Date, chunkDays = REPORTS_SYNC_CHUNK_DAYS) => {
  const chunks: { start: string; end: string }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const finalDate = new Date(to);
  finalDate.setHours(0, 0, 0, 0);

  while (cursor <= finalDate) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > finalDate) chunkEnd.setTime(finalDate.getTime());
    chunks.push({ start: format(chunkStart, "yyyy-MM-dd"), end: format(chunkEnd, "yyyy-MM-dd") });
    cursor.setTime(chunkEnd.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
};

const fetchAllTarefasCentral = async ({
  onlyWithOs = false,
  signal,
}: {
  onlyWithOs?: boolean;
  signal?: AbortSignal;
} = {}) => {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("tarefas_central")
      .select(TAREFAS_CENTRAL_REPORT_COLUMNS)
      .order("data_tarefa", { ascending: false })
      .order("mirror_key", { ascending: true })
      .range(from, from + TAREFAS_CENTRAL_PAGE_SIZE - 1)
      .abortSignal(signal);

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

const fetchHorasTrabalhadasCentral = async (startDate: string, endDate: string) => {
  const { data, error } = await supabase.functions.invoke("horas-trabalhadas-fetch", {
    body: { startDate, endDate },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error || "Falha ao buscar horas trabalhadas");
  return data?.tasks || [];
};

export default function RelatoriosPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<ReportsSyncWarning[]>([]);

  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("os-abertas");
  const syncController = useRef<AbortController | null>(null);

  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));

  const refreshRelatoriosData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["relatorios-tarefas-os"] });
    queryClient.invalidateQueries({ queryKey: ["relatorios-horas-trabalhadas"] });
    queryClient.invalidateQueries({ queryKey: ["last-sync-timestamp"] });
  }, [queryClient]);

  const handleSync = async (situacaoIds?: string[]) => {
    if (syncController.current) return;
    const controller = new AbortController();
    syncController.current = controller;
    setSyncing(true);
    setSyncFailed(false);
    setSyncWarnings([]);
    setSyncStatusMessage("Iniciando sincronização em lotes...");
    try {
      const totals = await syncReportsInSteps(
        (name, options) => supabase.functions.invoke(name, options),
        {
          days: situacaoIds?.length ? [] : buildDateChunks(dateFrom, dateTo),
          situationIds: situacaoIds,
          signal: controller.signal,
          onProgress: (message, completed) => setSyncStatusMessage(`${message} · ${completed} lotes concluídos`),
          onWarnings: setSyncWarnings,
        },
      );
      if (totals.incomplete) {
        setSyncStatusMessage(`Sincronização concluída com pendências: ${totals.orders} OS atualizadas, ${totals.tasks} tarefas Auvo e ${totals.saved} tarefas gravadas. ${totals.warnings.length} OS não puderam ser conferidas; registros preservados.`);
        toast.warning(`${totals.warnings.length} OS pendentes de conferência. Os demais lotes foram processados.`, { duration: 15000 });
      } else {
        setSyncStatusMessage(`Sincronização concluída: ${totals.orders} OS conferidas, ${totals.tasks} tarefas Auvo e ${totals.saved} tarefas gravadas.`);
        toast.success("Sincronização concluída e dados gravados.");
      }
    } catch (error: any) {
      if (!controller.signal.aborted) {
        setSyncFailed(true);
        const message = error?.message || "Falha na sincronização.";
        setSyncStatusMessage(`Sincronização interrompida: ${message}`);
        toast.error(message, { duration: 15000 });
      }
    } finally {
      if (syncController.current === controller) syncController.current = null;
      if (!controller.signal.aborted) {
        setSyncing(false);
        refreshRelatoriosData();
      }
    }
  };

  useEffect(() => () => { syncController.current?.abort(); }, []);
  // Fetch OS-linked tasks (for OS em Aberto tab)
  const { data: tarefasOS, isLoading: isLoadingOS } = useQuery({
    queryKey: ["relatorios-tarefas-os"],
    queryFn: async ({ signal }) => fetchAllTarefasCentral({ onlyWithOs: true, signal }),
    staleTime: 60_000,
    enabled: activeTab === "os-abertas",
  });

  // Dedicated fetch for Horas Trabalhadas tab: reads the local mirror directly.
  // Live Auvo refresh remains explicit per OS to avoid freezing the report UI.
  const { data: horasData, isLoading: isLoadingHoras } = useQuery({
    queryKey: ["relatorios-horas-trabalhadas", format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd")],
    queryFn: async () => {
      return fetchHorasTrabalhadasCentral(format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd"));
    },
    staleTime: 60_000,
    enabled: activeTab === "horas" || activeTab === "config",
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

  const equipamentoLookupTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tarefasOS || []) {
      if (task?.auvo_task_id) ids.add(String(task.auvo_task_id));
      parseAuvoTaskIds(task?.gc_os_tarefa_exec).forEach((id) => ids.add(id));
    }
    for (const task of horasData || []) {
      if (task?.auvo_task_id) ids.add(String(task.auvo_task_id));
      parseAuvoTaskIds((task as any)?.gc_os_tarefa_exec).forEach((id) => ids.add(id));
    }
    return Array.from(ids).sort();
  }, [tarefasOS, horasData]);

  // Equipment links: auvo_task_id → { nome, id_serie } (fallback for tasks where
  // tarefas_central.equipamento_nome was not populated by the sync)
  const { data: equipamentoTaskMap } = useQuery({
    queryKey: ["equipamento-task-map", equipamentoLookupTaskIds.join(",")],
    queryFn: async () => {
      const map: Record<string, { nome: string; id_serie: string }> = {};
      const PAGE = 500;
      for (let from = 0; from < equipamentoLookupTaskIds.length; from += PAGE) {
        const taskIds = equipamentoLookupTaskIds.slice(from, from + PAGE);
        if (!taskIds.length) continue;

        const { data, error } = await supabase
          .from("equipamento_tarefas_auvo")
          .select("auvo_task_id, auvo_equipment_id")
          .in("auvo_task_id", taskIds);
        if (error) break;
        const batch = data || [];
        if (batch.length === 0) continue;

        const eqIds = Array.from(new Set(batch.map((r: any) => String(r.auvo_equipment_id || "")).filter(Boolean)));
        if (eqIds.length) {
          const { data: eqs } = await supabase
            .from("equipamentos_auvo")
            .select("auvo_equipment_id, nome, identificador")
            .in("auvo_equipment_id", eqIds);
          const eqById = new Map<string, { nome: string; id_serie: string }>();
          for (const e of eqs || []) {
            eqById.set(String(e.auvo_equipment_id), {
              nome: (e.nome as string) || "",
              id_serie: (e.identificador as string) || "",
            });
          }
          for (const r of batch) {
            const eq = eqById.get(String(r.auvo_equipment_id));
            if (!eq) continue;
            // First link wins per task; concatenate further equipment names if multiple
            const taskId = String(r.auvo_task_id);
            const existing = map[taskId];
            if (!existing) {
              map[taskId] = eq;
            } else if (existing.nome && eq.nome && !existing.nome.includes(eq.nome)) {
              map[taskId] = {
                nome: `${existing.nome} | ${eq.nome}`,
                id_serie: existing.id_serie || eq.id_serie,
              };
            }
          }
        }
      }
      return map;
    },
    enabled:
      (activeTab === "os-abertas" || activeTab === "horas") &&
      equipamentoLookupTaskIds.length > 0,
    staleTime: 5 * 60_000,
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
    return Array.from(byOsId.values()).filter(isOpenOsSituation);
  }, [tarefasOS]);

  // Map: auvo_task_id → status_auvo (to look up execution task status)
  // Uses ALL tasks so execution tasks not directly linked to an OS are still found
  const osAbertasTasks = tarefasOS || [];

  const execTaskStatusMap = useMemo(() => {
    const source = osAbertasTasks;
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
  }, [osAbertasTasks]);

  const allClientes = useMemo(() => {
    const source = horasData?.length ? horasData : osAbertasTasks;
    if (!source.length) return [] as string[];
    const normalize = (s: string) =>
      s.trim().toUpperCase()
        .replace(/\s+(LTDA|ME|SA|S\.A\.|S\/A|EIRELI|EPP|SOCIEDADE SIMPLES|SS)\s*\.?$/i, "")
        .trim();
    const map = new Map<string, string>();
    for (const t of source) {
      const raw = (t.cliente || t.gc_os_cliente || "").trim();
      if (!raw) continue;
      const key = normalize(raw);
      if (!map.has(key)) map.set(key, raw);
    }
    return Array.from(map.values()).sort() as string[];
  }, [horasData, osAbertasTasks]);

  const allTecnicos = useMemo(() => {
    const source = horasData?.length ? horasData : osAbertasTasks;
    if (!source.length) return [] as string[];
    const set = new Set(source.map((t) => t.tecnico || "").filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [horasData, osAbertasTasks]);

  const allTiposTarefa = useMemo(() => {
    if (!horasData?.length) return [] as string[];
    const set = new Set<string>(
      horasData.map((t) => {
        const tipo = (t.descricao || "").trim();
        return tipo.length > 0 ? tipo : "Sem tipo";
      })
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR")) as string[];
  }, [horasData]);

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
          {(syncing || syncStatusMessage) && (
            <div className="w-72 space-y-1.5">
              <p role="status" aria-live="polite" className={cn("text-xs text-right", syncFailed ? "text-destructive" : syncWarnings.length ? "text-amber-700" : "text-muted-foreground")}>
                {syncStatusMessage || "Iniciando..."}
              </p>
              {syncWarnings.length > 0 && (
                <details className="mt-1 max-w-2xl text-xs text-amber-700">
                  <summary className="cursor-pointer text-right">Ver OS pendentes de conferência ({syncWarnings.length})</summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-amber-200 bg-amber-50 p-2">
                    {syncWarnings.map(warning => <li key={warning.os_id}>{warning.message}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
            allTasks={osAbertasTasks}
            isLoading={isLoadingOS}
            allClientes={allClientes}
            onRefresh={refreshRelatoriosData}
            onSync={(situacaoIds) => handleSync(situacaoIds)}
            syncing={syncing}
            execTaskStatusMap={execTaskStatusMap}
            equipamentoTaskMap={equipamentoTaskMap || {}}
          />
        </TabsContent>

        <TabsContent value="horas">
          <HorasTrabalhadasTab
            data={horasData || []}
            isLoading={isLoadingHoras}
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
            equipamentoTaskMap={equipamentoTaskMap || {}}
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
