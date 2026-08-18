import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Edit,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  contractMonthIsActive,
  contractVisitDurationMinutes,
  isFieldTechnician,
  minimumContractVisitsPerMonth,
  summarizeContractVisitMonth,
  type ContractVisitMonthSummary,
} from "@/lib/contractVisits";
import {
  planningYearsFromDates,
  reconcileContractVisitYear,
  todayISO,
  type ContractPlanningConfig,
  type ContractPlanningContract,
  type ContractPlanningTechnician,
} from "@/lib/contractVisitPlanning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RegraVisitaTextoIA, type RegraInterpretada } from "@/components/agendamento/RegraVisitaTextoIA";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Contract = Database["public"]["Tables"]["contratos"]["Row"];
type VisitConfig = Database["public"]["Tables"]["contratos_visitas_config"]["Row"];
type ContractExecution = Database["public"]["Tables"]["contratos_visitas_execucoes"]["Row"];
type ContractForecast = Database["public"]["Tables"]["agenda_agendamentos"]["Row"];
type Technician = Pick<
  Database["public"]["Tables"]["rh_colaboradores"]["Row"],
  "id" | "nome" | "cargo" | "funcao" | "ativo"
>;

type VisitConfigDraft = {
  id?: string;
  contrato_id: string;
  qtd_visitas: number;
  qtd_tecnicos: number;
  hora_inicio: string;
  tecnico_ids: string[];
  dias_semana: number[];
  semanas_mes: number[];
  meses_ativos: number[];
  visitas_consecutivas: boolean;
  regra_texto: string;
  observacao: string;
  ativo: boolean;
};

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
] as const;

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthCompetence(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

async function reconcileContractVisitsInMonthlyBatches(startDate: string, endDate: string) {
  let cursor = startDate;

  while (cursor <= endDate) {
    const [cursorYear, cursorMonth] = cursor.split("-").map(Number);
    const monthLastDay = new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
    const monthEnd = `${cursorYear}-${String(cursorMonth).padStart(2, "0")}-${String(monthLastDay).padStart(2, "0")}`;
    const batchEnd = monthEnd < endDate ? monthEnd : endDate;
    const { error } = await supabase.rpc("reconciliar_visitas_contratuais_periodo", {
      p_inicio: cursor,
      p_fim: batchEnd,
    });
    if (error) throw error;

    const nextMonth = cursorMonth === 12 ? 1 : cursorMonth + 1;
    const nextYear = cursorMonth === 12 ? cursorYear + 1 : cursorYear;
    cursor = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  }
}

function dateLabel(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function mondayWeekKey(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hoursLabel(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h`;
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}h` : ""}${rest ? `${String(rest).padStart(2, "0")}min` : ""}` || "0h";
}

function emptyDraft(contractId = ""): VisitConfigDraft {
  return {
    contrato_id: contractId,
    qtd_visitas: 1,
    qtd_tecnicos: 1,
    hora_inicio: "08:00",
    tecnico_ids: [],
    dias_semana: [1, 2, 3, 4, 5],
    semanas_mes: [1, 2, 3, 4, 5],
    meses_ativos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    visitas_consecutivas: false,
    regra_texto: "",
    observacao: "",
    ativo: true,
  };
}

function configDraft(config: VisitConfig): VisitConfigDraft {
  return {
    id: config.id,
    contrato_id: config.contrato_id,
    qtd_visitas: config.qtd_visitas,
    qtd_tecnicos: config.qtd_tecnicos,
    hora_inicio: config.hora_inicio.slice(0, 5),
    tecnico_ids: config.tecnico_ids || [],
    dias_semana: config.dias_semana || [1, 2, 3, 4, 5],
    semanas_mes: config.semanas_mes || [1, 2, 3, 4, 5],
    visitas_consecutivas: Boolean((config as { visitas_consecutivas?: boolean | null }).visitas_consecutivas),
    meses_ativos: (config as { meses_ativos?: number[] | null }).meses_ativos?.length
      ? ((config as { meses_ativos?: number[] | null }).meses_ativos as number[])
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    regra_texto: (config as { regra_texto?: string | null }).regra_texto || "",
    observacao: config.observacao || "",
    ativo: config.ativo,
  };
}

export default function VisitasContratuaisPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<VisitConfigDraft>(emptyDraft());
  const automaticPlanKey = useRef("");
  const [filtroCliente, setFiltroCliente] = useState<string>("todos");
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const contractsQuery = useQuery({
    queryKey: ["contractual-visits", "contracts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("*").eq("ativo", true).order("nome");
      if (error) throw error;
      return data as Contract[];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const configsQuery = useQuery({
    queryKey: ["contractual-visits", "configs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos_visitas_config").select("*").order("atualizado_em");
      if (error) throw error;
      return data as VisitConfig[];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const techniciansQuery = useQuery({
    queryKey: ["contractual-visits", "technicians"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .select("id, nome, cargo, funcao, ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      const rows = data as Technician[];
      const field = rows.filter(isFieldTechnician);
      return field.length ? field : rows;
    },
    staleTime: 30 * 60 * 1000,
  });

  const groupsQuery = useQuery({
    queryKey: ["contractual-visits", "groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos_clientes").select("id, nome").order("nome");
      if (error) throw error;
      return data || [];
    },
  });

  const contractTypesQuery = useQuery({
    queryKey: ["contractual-visits", "contract-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contrato_tipos").select("id, nome").order("nome");
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 60 * 1000,
  });

  const forecastsQuery = useQuery({
    queryKey: ["contractual-visits", "forecasts", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_agendamentos")
        .select("*")
        .eq("origem", "CONTRATO")
        .gte("data", `${year}-01-01`)
        .lte("data", `${year}-12-31`)
        .order("data")
        .order("hora_inicio");
      if (error) throw error;
      return data as ContractForecast[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const executionsQuery = useQuery({
    queryKey: ["contractual-visits", "executions", year],
    queryFn: async () => {
      const start = `${year}-01-01`;
      const { data, error } = await supabase
        .from("contratos_visitas_execucoes")
        .select("*")
        .gte("competencia", start)
        .lte("competencia", `${year}-12-31`)
        .order("data_realizada", { ascending: false });
      if (error) throw error;
      return data as ContractExecution[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const contracts = useMemo(() => {
    const data = contractsQuery.data || [];
    if (filtroCliente === "todos") return data;
    return data.filter(c => c.id === filtroCliente);
  }, [contractsQuery.data, filtroCliente]);

  const configs = useMemo(() => {
    const data = configsQuery.data || [];
    if (filtroCliente === "todos") return data;
    return data.filter(c => c.contrato_id === filtroCliente);
  }, [configsQuery.data, filtroCliente]);

  const technicians = techniciansQuery.data || [];

  const forecasts = useMemo(() => {
    const data = forecastsQuery.data || [];
    if (filtroCliente === "todos") return data;
    return data.filter(f => f.contrato_id === filtroCliente);
  }, [forecastsQuery.data, filtroCliente]);

  const executions = useMemo(() => {
    const data = executionsQuery.data || [];
    if (filtroCliente === "todos") return data;
    return data.filter(e => e.contrato_id === filtroCliente);
  }, [executionsQuery.data, filtroCliente]);
  const configByContract = useMemo(() => new Map(configs.map((config) => [config.contrato_id, config])), [configs]);
  const contractById = useMemo(() => new Map(contracts.map((contract) => [contract.id, contract])), [contracts]);
  const technicianById = useMemo(() => new Map(technicians.map((technician) => [technician.id, technician])), [technicians]);
  const groupById = useMemo(() => new Map((groupsQuery.data || []).map((group) => [group.id, group.nome])), [groupsQuery.data]);
  const contractTypeById = useMemo(
    () => new Map((contractTypesQuery.data || []).map((type) => [type.id, type.nome])),
    [contractTypesQuery.data],
  );
  const forecastsByConfig = useMemo(() => {
    const map = new Map<string, ContractForecast[]>();
    for (const forecast of forecasts) {
      if (!forecast.contrato_visita_config_id) continue;
      const rows = map.get(forecast.contrato_visita_config_id) || [];
      rows.push(forecast);
      map.set(forecast.contrato_visita_config_id, rows);
    }
    return map;
  }, [forecasts]);
  const executionsByConfig = useMemo(() => {
    const map = new Map<string, ContractExecution[]>();
    for (const execution of executions) {
      const rows = map.get(execution.contrato_visita_config_id) || [];
      rows.push(execution);
      map.set(execution.contrato_visita_config_id, rows);
    }
    return map;
  }, [executions]);

  const executionsByMonth = useMemo(() => {
    const map = new Map<string, ContractExecution[]>();
    for (const execution of executions) {
      const monthKey = execution.data_realizada.slice(0, 7);
      const rows = map.get(monthKey) || [];
      rows.push(execution);
      map.set(monthKey, rows);
    }
    return map;
  }, [executions]);
  const stackedConfigIds = useMemo(() => {
    const visitsByWeek = new Map<string, Set<number>>();
    for (const forecast of forecasts) {
      if (!forecast.contrato_visita_config_id || !forecast.contrato_visita_numero) continue;
      const key = `${forecast.contrato_visita_config_id}|${forecast.data.slice(0, 7)}|${mondayWeekKey(forecast.data)}`;
      const visits = visitsByWeek.get(key) || new Set<number>();
      visits.add(forecast.contrato_visita_numero);
      visitsByWeek.set(key, visits);
    }
    return new Set(
      [...visitsByWeek.entries()]
        .filter(([, visits]) => visits.size > 1)
        .map(([key]) => key.split("|")[0]),
    );
  }, [forecasts]);

  const monthlySummaries = useMemo(() => {
    if (!configs.length || !contracts.length) return new Map<string, ContractVisitMonthSummary[]>();
    const map = new Map<string, ContractVisitMonthSummary[]>();
    for (const config of configs) {
      const contract = contractById.get(config.contrato_id);
      if (!contract || !contract.horas_mes_contratadas) continue;
      const rows = forecastsByConfig.get(config.id) || [];
      const realized = executionsByConfig.get(config.id) || [];
      map.set(config.id, MONTHS.map((_, monthIndex) => {
        const competence = monthCompetence(year, monthIndex);
        const hoursContratadas = Number(contract.horas_mes_contratadas || 0);
        return summarizeContractVisitMonth({
          competencia: competence,
          visitasContratadas: config.qtd_visitas,
          horasContratadas: hoursContratadas,
          vigenciaInicio: contract.vigencia_inicio,
          vigenciaFim: contract.vigencia_fim,
          forecasts: rows.filter((row) => row.data.slice(0, 7) === competence),
          executions: realized
            .filter((row) => row.competencia.slice(0, 7) === competence)
            .map((row) => ({ visita_numero: row.visita_numero, horas_trabalhadas: row.horas_trabalhadas })),
        });
      }));
    }
    return map;
  }, [configs, contracts.length, contractById, forecastsByConfig, executionsByConfig, year]);

  const planYear = useMutation({
    mutationFn: async (configIds?: string[]) => {
      const selected = configs.filter((config) => config.ativo && (!configIds || configIds.includes(config.id)));
      if (!selected.length) throw new Error("Nenhuma configuração ativa para planejar.");
      if (year <= currentYear) {
        await reconcileContractVisitsInMonthlyBatches(
          `${year}-01-01`,
          year === currentYear ? todayISO() : `${year}-12-31`,
        );
      }
      const { data: authData } = await supabase.auth.getUser();
      let inserted = 0;
      let removed = 0;
      const errors: string[] = [];
      for (const config of selected) {
        const contract = contractById.get(config.contrato_id);
        if (!contract) continue;
        try {
          const result = await reconcileContractVisitYear({
            contract: contract as ContractPlanningContract,
            config: config as ContractPlanningConfig,
            technicians: technicians as ContractPlanningTechnician[],
            year,
            groupName: contract.grupo_id ? groupById.get(contract.grupo_id) : null,
            createdBy: authData.user?.id || null,
          });
          inserted += result.inserted;
          removed += result.removed;
        } catch (error) {
          errors.push(`${contract.nome}: ${(error as Error).message}`);
        }
      }
      return { inserted, removed, errors };
    },
    onSuccess: ({ inserted, errors }) => {
      if (inserted) toast.success(`Planejamento de ${year} atualizado: ${inserted} escala(s) de técnico.`);
      else if (!errors.length) toast.success(`Planejamento de ${year} conferido e atualizado.`);
      if (errors.length) toast.warning(errors.slice(0, 4).join(" | "));
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveConfig = useMutation({
    mutationFn: async (value: VisitConfigDraft) => {
      const contract = contractById.get(value.contrato_id);
      if (!contract) throw new Error("Selecione o contrato.");
      if (!contract.horas_mes_contratadas || Number(contract.horas_mes_contratadas) <= 0) {
        throw new Error("Cadastre as horas mensais no contrato antes de planejar as visitas.");
      }
      if (value.qtd_visitas < 1 || value.qtd_visitas > 31) throw new Error("Informe de 1 a 31 visitas por mês.");
      if (value.qtd_tecnicos < 1 || value.qtd_tecnicos > 10) throw new Error("Quantidade de técnicos inválida.");
      if (value.tecnico_ids.length < value.qtd_tecnicos) throw new Error(`Selecione pelo menos ${value.qtd_tecnicos} técnico(s).`);
      if (!value.dias_semana.length) throw new Error("Selecione pelo menos um dia da semana.");
      if (!value.semanas_mes.length) throw new Error("Selecione pelo menos uma semana do mês.");
      if (!value.meses_ativos.length) throw new Error("Selecione pelo menos um mês com visita.");
      if (!value.visitas_consecutivas && value.semanas_mes.length < value.qtd_visitas) {
        throw new Error("Selecione ao menos uma semana diferente para cada visita mensal.");
      }
      if (value.visitas_consecutivas && value.dias_semana.length < value.qtd_visitas) {
        throw new Error("Para visitas consecutivas, selecione ao menos um dia da semana para cada visita.");
      }
      const minimumVisits = minimumContractVisitsPerMonth(
        Number(contract.horas_mes_contratadas),
        value.qtd_tecnicos,
      );
      if (value.qtd_visitas < minimumVisits) {
        throw new Error(
          `Para ${hoursLabel(Number(contract.horas_mes_contratadas))}/mês com ${value.qtd_tecnicos} pessoa(s), informe ao menos ${minimumVisits} visita(s) de até 8h.`,
        );
      }
      const durationMinutes = contractVisitDurationMinutes(
        Number(contract.horas_mes_contratadas),
        value.qtd_visitas,
        value.qtd_tecnicos,
      );
      const [hour, minute] = value.hora_inicio.split(":").map(Number);
      if (hour * 60 + minute + durationMinutes > 24 * 60) {
        throw new Error("A carga calculada ultrapassa o fim do dia. Ajuste o horário, visitas ou quantidade de técnicos.");
      }
      const { data: authData } = await supabase.auth.getUser();
      const payload = {
        contrato_id: value.contrato_id,
        qtd_visitas: value.qtd_visitas,
        qtd_tecnicos: value.qtd_tecnicos,
        duracao_minutos: durationMinutes,
        hora_inicio: value.hora_inicio,
        tecnico_ids: value.tecnico_ids,
        dias_semana: value.dias_semana,
        semanas_mes: value.semanas_mes,
        meses_ativos: value.meses_ativos,
        visitas_consecutivas: value.visitas_consecutivas,
        regra_texto: value.regra_texto.trim() || null,
        observacao: value.observacao.trim() || null,
        ativo: value.ativo,
        planejamento_pendente: true,
        criado_por: authData.user?.id || null,
      };
      const response = value.id
        ? await supabase.from("contratos_visitas_config").update(payload as never).eq("id", value.id).select("*").single()
        : await supabase.from("contratos_visitas_config").insert(payload as never).select("*").single();
      if (response.error) throw response.error;
      const { data: futureRows, error: futureRowsError } = await supabase
        .from("agenda_agendamentos")
        .select("data")
        .eq("origem", "CONTRATO")
        .eq("contrato_visita_config_id", response.data.id)
        .gte("data", todayISO());
      if (futureRowsError) throw futureRowsError;
      const planningYears = planningYearsFromDates([
        ...(futureRows || []).map((row) => row.data),
        `${Math.max(year, currentYear)}-01-01`,
      ], currentYear);
      for (const planningYear of planningYears) {
        await reconcileContractVisitYear({
          contract: contract as ContractPlanningContract,
          config: response.data as ContractPlanningConfig,
          technicians: technicians as ContractPlanningTechnician[],
          year: planningYear,
          groupName: contract.grupo_id ? groupById.get(contract.grupo_id) : null,
          createdBy: authData.user?.id || null,
        });
      }
    },
    onSuccess: () => {
      toast.success("Configuração salva e próximas visitas recalculadas.");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteConfig = useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase.from("contratos_visitas_config").delete().eq("id", configId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração e previsões vinculadas removidas.");
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateContractType = useMutation({
    mutationFn: async ({ contratoId, tipoId }: { contratoId: string; tipoId: string | null }) => {
      const { error } = await supabase.from("contratos").update({ tipo_id: tipoId } as never).eq("id", contratoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tipo de contrato atualizado.");
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits", "contracts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const initialPlanIds = useMemo(() => configs.filter((config) => {
    if (!config.ativo) return false;
    const contract = contractById.get(config.contrato_id);
    if (!contract || !MONTHS.some((_, month) => contractMonthIsActive(monthCompetence(year, month), contract.vigencia_inicio, contract.vigencia_fim))) return false;
    return config.planejamento_pendente
      || stackedConfigIds.has(config.id)
      || (year >= currentYear && !(forecastsByConfig.get(config.id)?.length || executionsByConfig.get(config.id)?.length));
  }).map((config) => config.id), [configs, contractById, forecastsByConfig, executionsByConfig, stackedConfigIds, year, currentYear]);

  useEffect(() => {
    if (configsQuery.isLoading || forecastsQuery.isLoading || executionsQuery.isLoading || techniciansQuery.isLoading || planYear.isPending) return;
    if (!initialPlanIds.length || year < currentYear) return;
    const key = `${year}:${initialPlanIds.sort().join(",")}`;
    if (automaticPlanKey.current === key) return;
    
    // Pequeno atraso para não engasgar a renderização inicial se já houver dados no cache
    const timer = setTimeout(() => {
      automaticPlanKey.current = key;
      planYear.mutate(initialPlanIds);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [configsQuery.isLoading, forecastsQuery.isLoading, executionsQuery.isLoading, techniciansQuery.isLoading, initialPlanIds, planYear, year, currentYear]);

  const loading = contractsQuery.isLoading || configsQuery.isLoading || techniciansQuery.isLoading || forecastsQuery.isLoading || executionsQuery.isLoading;
  const withoutPlanning = contracts.filter((contract) => !configByContract.has(contract.id) || !Number(contract.horas_mes_contratadas || 0));
  const allSummaries = [...monthlySummaries.values()].flat();
  const missingMonths = allSummaries.filter((summary) => summary.status === "FALTANDO");
  const excessMonths = allSummaries.filter((summary) => summary.status === "EXCEDENTE");
  const launchedVisits = new Set(
    forecasts
      .filter((forecast) => forecast.contrato_visita_config_id && forecast.contrato_visita_numero)
      .map((forecast) => `${forecast.contrato_visita_config_id}|${forecast.data.slice(0, 7)}|${forecast.contrato_visita_numero}`),
  ).size;
  const realizedHours = executions.reduce((total, execution) => total + Number(execution.horas_trabalhadas || 0), 0);
  const currentCompetence = `${year}-${String(year === currentYear ? new Date().getMonth() + 1 : 12).padStart(2, "0")}`;
  const currentMonthSummaries = allSummaries.filter((summary) => summary.competencia === currentCompetence);
  const currentMonthRemainingHours = currentMonthSummaries.reduce((total, summary) => total + summary.horasRestantes, 0);
  const annualControlByConfig = useMemo(() => new Map(configs.map((config) => {
    const summaries = monthlySummaries.get(config.id) || [];
    const missing = summaries.filter((summary) => summary.status === "FALTANDO");
    const excess = summaries.filter((summary) => summary.status === "EXCEDENTE");
    return [config.id, {
      missingMonths: missing.length,
      excessMonths: excess.length,
      missingVisits: missing.reduce((total, summary) => total + Math.max(0, summary.visitasContratadas - summary.visitasPrevistas), 0),
      excessVisits: excess.reduce((total, summary) => total + Math.max(0, summary.visitasPrevistas - summary.visitasContratadas), 0),
      missingHours: missing.reduce((total, summary) => total + Math.max(0, summary.horasContratadas - summary.horasPrevistas), 0),
      excessHours: excess.reduce((total, summary) => total + Math.max(0, summary.horasPrevistas - summary.horasContratadas), 0),
    }];
  })), [configs, monthlySummaries]);
  const selectedContract = contractById.get(draft.contrato_id);
  const minimumVisits = selectedContract?.horas_mes_contratadas
    ? minimumContractVisitsPerMonth(Number(selectedContract.horas_mes_contratadas), Math.max(1, draft.qtd_tecnicos))
    : null;
  let calculatedDuration: number | null = null;
  try {
    calculatedDuration = selectedContract?.horas_mes_contratadas
      ? contractVisitDurationMinutes(Number(selectedContract.horas_mes_contratadas), draft.qtd_visitas, draft.qtd_tecnicos)
      : null;
  } catch {
    calculatedDuration = null;
  }

  return (
    <div className="h-full overflow-auto bg-background p-4 md:p-6">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Visitas Contratuais</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Cadastre as regras dos contratos para abastecer automaticamente o Agendamento Equipe durante o ano inteiro. As visitas são apenas previsões internas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              options={[
                { value: "todos", label: "Todos os Clientes" },
                ...(contractsQuery.data || []).map(c => ({ value: c.id, label: c.nome }))
              ]}
              value={filtroCliente}
              onValueChange={(val) => setFiltroCliente(val || "todos")}
              placeholder="Filtrar por Cliente"
              searchPlaceholder="Buscar cliente..."
              icon={<Filter className="h-4 w-4 opacity-50" />}
              className="w-full sm:w-64 h-10"
            />
            <Button variant="outline" onClick={() => navigate("/operacional/agendamento-equipe")}><ExternalLink className="mr-2 h-4 w-4" />Abrir Agendamento Equipe</Button>
            <Button variant="outline" size="icon" onClick={() => setYear((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex h-10 min-w-28 items-center justify-center rounded-md border bg-background px-4 text-sm font-semibold">{year}</div>
            <Button variant="outline" size="icon" onClick={() => setYear((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button onClick={() => planYear.mutate(undefined)} disabled={planYear.isPending || !configs.length || year < currentYear}>
              {planYear.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Abastecer agenda de {year}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Card><CardContent className="flex items-center gap-3 p-4"><CalendarDays className="h-5 w-5 text-primary" /><div><p className="text-xs text-muted-foreground">Contratos ativos</p><p className="text-xl font-bold">{contracts.length}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-5 w-5 text-primary" /><div><p className="text-xs text-muted-foreground">Visitas ainda planejadas</p><p className="text-xl font-bold">{launchedVisits}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><div><p className="text-xs text-muted-foreground">Visitas reconhecidas</p><p className="text-xl font-bold text-emerald-700">{executions.length}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="h-5 w-5 text-emerald-600" /><div><p className="text-xs text-muted-foreground">Horas reais em {year}</p><p className="text-xl font-bold text-emerald-700">{hoursLabel(realizedHours)}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="h-5 w-5 text-amber-600" /><div><p className="text-xs text-muted-foreground">Saldo de {MONTHS[Number(currentCompetence.slice(5, 7)) - 1]}</p><p className="text-xl font-bold text-amber-700">{hoursLabel(currentMonthRemainingHours)}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><AlertTriangle className="h-5 w-5 text-amber-600" /><div><p className="text-xs text-muted-foreground">Meses faltando</p><p className="text-xl font-bold text-amber-700">{missingMonths.length}</p></div></CardContent></Card>
        </div>

        {(withoutPlanning.length > 0 || missingMonths.length > 0 || excessMonths.length > 0) && (
          <Card className="border-amber-200 bg-amber-50/40">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-700" />Alertas do planejamento de {year}</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm lg:grid-cols-3">
              {withoutPlanning.length > 0 && <div className="rounded-md border border-amber-200 bg-white p-3"><p className="font-semibold">{withoutPlanning.length} contrato(s) sem regra ou sem horas cadastradas</p><p className="mt-1 text-xs text-muted-foreground">{withoutPlanning.slice(0, 4).map((contract) => contract.nome).join(" · ")}</p></div>}
              {missingMonths.length > 0 && <div className="rounded-md border border-amber-200 bg-white p-3"><p className="font-semibold text-amber-800">{missingMonths.length} competência(s) abaixo do contratado</p><p className="mt-1 text-xs text-muted-foreground">A quantidade prevista está menor que o cadastro.</p></div>}
              {excessMonths.length > 0 && <div className="rounded-md border border-red-200 bg-white p-3"><p className="font-semibold text-red-800">{excessMonths.length} competência(s) acima do contratado</p><p className="mt-1 text-xs text-muted-foreground">A quantidade prevista ultrapassou o cadastro.</p></div>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Execuções reconhecidas por cliente e dia</CardTitle>
            <p className="text-xs text-muted-foreground">Tarefas reais finalizadas no mesmo cliente são consolidadas em uma visita, com horas, técnicos e links do Auvo. O registro realizado não volta para o planejamento.</p>
          </CardHeader>
          <CardContent>
            {executionsQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : executions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma visita real reconhecida em {year}.</div>
            ) : (
              <div className="max-h-[500px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead>Mês / Data</TableHead>
                      <TableHead>Contrato / cliente</TableHead>
                      <TableHead>Visita</TableHead>
                      <TableHead>Técnicos</TableHead>
                      <TableHead>Horas reais</TableHead>
                      <TableHead>Tarefas Auvo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const monthKeys = Array.from(executionsByMonth.keys()).sort((a, b) => b.localeCompare(a));
                      return monthKeys.map((monthKey) => {
                        const monthExecutions = executionsByMonth.get(monthKey) || [];
                        const isExpanded = expandedMonths.has(monthKey);
                        const totalHours = monthExecutions.reduce((sum, e) => sum + Number(e.horas_trabalhadas || 0), 0);
                        const [yearPart, monthPart] = monthKey.split("-");
                        const monthLabel = `${MONTHS[Number(monthPart) - 1]} / ${yearPart}`;

                        return (
                          <React.Fragment key={monthKey}>
                            <TableRow 
                              className="cursor-pointer bg-muted/20 font-semibold hover:bg-muted/40"
                              onClick={() => toggleMonth(monthKey)}
                            >
                              <TableCell>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </TableCell>
                              <TableCell colSpan={4} className="py-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-sm uppercase tracking-wider text-muted-foreground">{monthLabel}</span>
                                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                                    {monthExecutions.length} visita(s)
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="font-bold text-emerald-700">
                                {hoursLabel(totalHours)}
                              </TableCell>
                              <TableCell></TableCell>
                            </TableRow>
                            {isExpanded && monthExecutions.map((execution) => (
                              <TableRow key={execution.id} className="bg-background">
                                <TableCell></TableCell>
                                <TableCell className="whitespace-nowrap text-xs font-medium">{dateLabel(execution.data_realizada)}</TableCell>
                                <TableCell className="min-w-[280px]">
                                  <p className="font-semibold">{contractById.get(execution.contrato_id)?.nome || "Contrato"}</p>
                                  <p className="text-[11px] text-muted-foreground">{execution.cliente}</p>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{execution.visita_numero}ª realizada</TableCell>
                                <TableCell className="min-w-[200px] text-[11px]">{execution.tecnicos.join(" · ") || "Não identificado"}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs font-bold text-emerald-700">{hoursLabel(Number(execution.horas_trabalhadas || 0))}</TableCell>
                                <TableCell className="min-w-[240px]">
                                  <div className="flex flex-wrap gap-1">
                                    {execution.tarefa_ids.map((taskId) => (
                                      <a 
                                        key={taskId} 
                                        href={`https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        #{taskId}
                                      </a>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </useMemo>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle className="text-lg">Regras de abastecimento da agenda</CardTitle><p className="mt-1 text-xs text-muted-foreground">As datas e os cards das visitas são visualizados somente no Agendamento Equipe.</p></div>
            <Button variant="outline" size="sm" onClick={() => { setDraft(emptyDraft()); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Nova configuração</Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : contracts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum contrato ativo cadastrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Contrato</TableHead><TableHead>Horas/mês</TableHead><TableHead>Visitas e pessoas</TableHead><TableHead>Técnicos vinculados</TableHead><TableHead>Regra de lançamento</TableHead><TableHead>Controle de {year}</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {contracts.map((contract) => {
                      const config = configByContract.get(contract.id);
                      const control = config ? annualControlByConfig.get(config.id) : null;
                      const monthControl = config
                        ? (monthlySummaries.get(config.id) || []).find((summary) => summary.competencia === currentCompetence)
                        : null;
                      let duration: number | null = null;
                      const requiredVisits = config && contract.horas_mes_contratadas
                        ? minimumContractVisitsPerMonth(Number(contract.horas_mes_contratadas), config.qtd_tecnicos)
                        : null;
                      if (config && contract.horas_mes_contratadas) {
                        try { duration = contractVisitDurationMinutes(Number(contract.horas_mes_contratadas), config.qtd_visitas, config.qtd_tecnicos); } catch { duration = null; }
                      }
                      return (
                        <TableRow key={contract.id} className="align-top">
                          <TableCell className="min-w-[230px]">
                            <p className="font-semibold">{contract.nome}</p>
                            <p className="mt-0.5 text-[11px]">
                              <Badge variant="outline" className={contract.tipo_id && contractTypeById.get(contract.tipo_id) ? "border-primary/40 bg-primary/10 text-primary" : "border-amber-300 bg-amber-50 text-amber-800"}>
                                {(contract.tipo_id && contractTypeById.get(contract.tipo_id)) || "Tipo não definido"}
                              </Badge>
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{contract.cliente_nome || (contract.grupo_id ? `Grupo: ${groupById.get(contract.grupo_id) || "não localizado"}` : "Sem cliente vinculado")}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">Vigência: {contract.vigencia_inicio ? dateLabel(contract.vigencia_inicio) : "sem início"} → {contract.vigencia_fim ? dateLabel(contract.vigencia_fim) : "sem fim"}</p>
                          </TableCell>
                          <TableCell className="min-w-[120px]">
                            <p className="font-semibold">{contract.horas_mes_contratadas ? hoursLabel(Number(contract.horas_mes_contratadas)) : "Não cadastrado"}</p>
                            <p className="text-[11px] text-muted-foreground">banco mensal</p>
                          </TableCell>
                          <TableCell className="min-w-[170px] text-xs">
                            {config ? <div className="space-y-1"><p className="font-semibold">{config.qtd_visitas} visita(s)/mês</p><p>{config.qtd_tecnicos} pessoa(s) por visita</p><p className="text-muted-foreground">{duration ? `${durationLabel(duration)} por visita` : requiredVisits ? `Mínimo ${requiredVisits} visita(s) para jornada de 8h` : "Revisar horas do contrato"}</p></div> : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Não configurado</Badge>}
                          </TableCell>
                          <TableCell className="min-w-[230px] text-xs">
                            {config ? <p className="font-medium">{config.tecnico_ids.map((id) => technicianById.get(id)?.nome).filter(Boolean).join(" · ") || "Equipe não localizada"}</p> : "—"}
                          </TableCell>
                          <TableCell className="min-w-[260px] text-xs">
                            {config ? <div className="space-y-1"><p>Semanas {(config.semanas_mes || [1, 2, 3, 4, 5]).join(", ")} · {WEEKDAYS.filter((day) => config.dias_semana.includes(day.value)).map((day) => day.label).join(", ")}</p><p className="text-muted-foreground">Início preferencial: {config.hora_inicio.slice(0, 5)}</p>{config.observacao && <p className="line-clamp-2 text-muted-foreground">{config.observacao}</p>}</div> : "—"}
                          </TableCell>
                          <TableCell className="min-w-[210px] text-xs">
                            {monthControl && (
                              <div className="mb-2 rounded-md border bg-muted/30 p-2">
                                <p className="font-semibold text-emerald-700">{monthControl.visitasRealizadas}/{monthControl.visitasContratadas} realizada(s) · {hoursLabel(monthControl.horasRealizadas)}</p>
                                <p className="mt-0.5 text-muted-foreground">Saldo real: {monthControl.visitasRestantes} visita(s) · {hoursLabel(monthControl.horasRestantes)}</p>
                              </div>
                            )}
                            {!config ? (
                              <Badge variant="outline" className={!Number(contract.horas_mes_contratadas || 0) ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
                                {!Number(contract.horas_mes_contratadas || 0) ? "Cadastre as horas no contrato" : "Aguardando configuração"}
                              </Badge>
                            ) : requiredVisits && config.qtd_visitas < requiredVisits ? (
                              <div><Badge variant="destructive">Configuração inválida</Badge><p className="mt-1 text-muted-foreground">Mínimo de {requiredVisits} visita(s) para limitar a jornada a 8h.</p></div>
                            ) : config.planejamento_pendente ? (
                              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">Atualização pendente</Badge>
                            ) : control?.excessMonths ? (
                              <div><Badge variant="destructive">Excedente</Badge><p className="mt-1 text-muted-foreground">{control.excessVisits > 0 ? `${control.excessVisits} visita(s) a mais` : `${hoursLabel(control.excessHours)} acima`} em {control.excessMonths} mês(es)</p></div>
                            ) : control?.missingMonths ? (
                              <div><Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Faltando</Badge><p className="mt-1 text-muted-foreground">{control.missingVisits > 0 ? `Faltam ${control.missingVisits} visita(s)` : `Faltam ${hoursLabel(control.missingHours)}`} em {control.missingMonths} mês(es)</p></div>
                            ) : (
                              <Badge className="bg-emerald-600">Agenda abastecida</Badge>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[150px] text-right">
                            <div className="flex justify-end gap-1">
                              {config ? <><Button variant="ghost" size="icon" title="Recalcular próximas visitas" onClick={() => planYear.mutate([config.id])} disabled={planYear.isPending || year < currentYear}><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Editar configuração" onClick={() => { setDraft(configDraft(config)); setDialogOpen(true); }}><Edit className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" title="Excluir configuração" onClick={() => { if (confirm("Excluir a configuração e todas as previsões contratuais vinculadas?")) deleteConfig.mutate(config.id); }}><Trash2 className="h-4 w-4" /></Button></> : <Button size="sm" onClick={() => { setDraft(emptyDraft(contract.id)); setDialogOpen(true); }}>Configurar</Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{draft.id ? "Editar planejamento contratual" : "Configurar visitas contratuais"}</DialogTitle><DialogDescription>Ao salvar, o sistema preserva o histórico e recalcula todas as próximas visitas do ano na agenda dos técnicos.</DialogDescription></DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="space-y-2"><Label>Contrato</Label><select value={draft.contrato_id} disabled={Boolean(draft.id)} onChange={(event) => setDraft((current) => ({ ...current, contrato_id: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"><option value="">Selecione o contrato</option>{contracts.filter((contract) => !configByContract.has(contract.id) || contract.id === draft.contrato_id).map((contract) => <option key={contract.id} value={contract.id}>{contract.nome}</option>)}</select></div>

            <div className="space-y-2">
              <Label>Tipo de contrato</Label>
              <select
                value={selectedContract?.tipo_id || ""}
                disabled={!selectedContract || updateContractType.isPending}
                onChange={(event) => {
                  if (!selectedContract) return;
                  updateContractType.mutate({ contratoId: selectedContract.id, tipoId: event.target.value || null });
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">Sem tipo definido</option>
                {(contractTypesQuery.data || []).map((type) => <option key={type.id} value={type.id}>{type.nome}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground">Ex.: Higienização de coifas, Manutenção preventiva. Cadastre novos tipos em Configurações › Contratos.</p>
            </div>

            {selectedContract && <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Horas contratadas</p><p className="text-lg font-bold">{selectedContract.horas_mes_contratadas ? `${hoursLabel(Number(selectedContract.horas_mes_contratadas))}/mês` : "Não cadastradas"}</p></div><div><p className="text-xs text-muted-foreground">Visitas previstas</p><p className="text-lg font-bold">{draft.qtd_visitas}/mês</p>{minimumVisits && <p className="text-[10px] text-muted-foreground">mínimo {minimumVisits} com jornada de até 8h</p>}</div><div><p className="text-xs text-muted-foreground">Carga calculada por visita</p><p className="text-lg font-bold">{calculatedDuration ? durationLabel(calculatedDuration) : minimumVisits && draft.qtd_visitas < minimumVisits ? `Mínimo ${minimumVisits} visitas` : "Revisar dados"}</p><p className="text-[10px] text-muted-foreground">horas ÷ visitas ÷ pessoas</p></div></div>}

            <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Visitas por mês</Label><Input type="number" min={1} max={31} value={draft.qtd_visitas} onChange={(event) => setDraft((current) => ({ ...current, qtd_visitas: Number(event.target.value) }))} /></div><div className="space-y-2"><Label>Pessoas por visita</Label><Input type="number" min={1} max={10} value={draft.qtd_tecnicos} onChange={(event) => setDraft((current) => ({ ...current, qtd_tecnicos: Number(event.target.value) }))} /></div><div className="space-y-2"><Label>Horário preferencial</Label><Input type="time" value={draft.hora_inicio} onChange={(event) => setDraft((current) => ({ ...current, hora_inicio: event.target.value }))} /></div></div>

            <RegraVisitaTextoIA
              value={draft.regra_texto}
              onChange={(texto) => setDraft((current) => ({ ...current, regra_texto: texto }))}
              onApply={(resultado: RegraInterpretada) => {
                setDraft((current) => ({
                  ...current,
                  qtd_visitas: resultado.qtd_visitas ?? current.qtd_visitas,
                  qtd_tecnicos: resultado.qtd_tecnicos ?? current.qtd_tecnicos,
                  hora_inicio: resultado.hora_inicio ?? current.hora_inicio,
                  semanas_mes: resultado.semanas_mes?.length ? resultado.semanas_mes : current.semanas_mes,
                  dias_semana: resultado.dias_semana?.length ? resultado.dias_semana : current.dias_semana,
                  meses_ativos: resultado.meses_ativos?.length ? resultado.meses_ativos : current.meses_ativos,
                }));
                toast.success("Campos preenchidos pela interpretação. Revise e salve.");
              }}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Meses com visita</Label>
                <Button variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, meses_ativos: current.meses_ativos.length === 12 ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }))}>{draft.meses_ativos.length === 12 ? "Limpar" : "Todos os meses"}</Button>
              </div>
              <div className="flex flex-wrap gap-2">{MONTHS.map((label, index) => { const month = index + 1; return (
                <label key={label} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox checked={draft.meses_ativos.includes(month)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, meses_ativos: checked ? [...current.meses_ativos, month].sort((a, b) => a - b) : current.meses_ativos.filter((value) => value !== month) }))} />
                  {label}
                </label>
              ); })}</div>
              <p className="text-xs text-muted-foreground">Marque apenas os meses com visita. Ex.: 1 vez a cada 2 meses = 6 meses marcados.</p>
            </div>

            <div className="space-y-2"><Label>Semanas permitidas no mês</Label><div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map((week) => <label key={week} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"><Checkbox checked={draft.semanas_mes.includes(week)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, semanas_mes: checked ? [...current.semanas_mes, week].sort() : current.semanas_mes.filter((value) => value !== week) }))} />{week}ª semana</label>)}</div></div>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <Checkbox checked={draft.visitas_consecutivas} onCheckedChange={(checked) => setDraft((current) => ({ ...current, visitas_consecutivas: checked === true }))} />
              <span>
                <span className="font-medium">Visitas consecutivas na mesma semana</span>
                <span className="block text-xs text-muted-foreground">Use para contratos com 2 ou mais visitas em dias seguidos (ex.: 2 visitas a cada 2 meses).</span>
              </span>
            </label>
            <div className="space-y-2"><Label>Dias permitidos</Label><div className="flex flex-wrap gap-2">{WEEKDAYS.map((day) => <label key={day.value} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"><Checkbox checked={draft.dias_semana.includes(day.value)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, dias_semana: checked ? [...current.dias_semana, day.value].sort() : current.dias_semana.filter((value) => value !== day.value) }))} />{day.label}</label>)}</div></div>

            <div className="space-y-2"><div className="flex items-center justify-between"><Label>Técnicos do RH que podem atender este contrato</Label><span className="text-xs text-muted-foreground">{draft.tecnico_ids.length} selecionado(s)</span></div><div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{technicians.map((technician) => <label key={technician.id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-muted"><Checkbox checked={draft.tecnico_ids.includes(technician.id)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, tecnico_ids: checked ? [...current.tecnico_ids, technician.id] : current.tecnico_ids.filter((id) => id !== technician.id) }))} /><span className="text-sm"><span className="block font-medium leading-tight">{technician.nome}</span><span className="text-[11px] text-muted-foreground">{technician.cargo || technician.funcao || "Sem cargo"}</span></span></label>)}</div><p className="text-xs text-muted-foreground">Se houver mais técnicos selecionados que pessoas por visita, o sistema faz rodízio ao longo do ano.</p></div>

            <div className="space-y-2"><Label>Regras e observações do cliente</Label><textarea value={draft.observacao} onChange={(event) => setDraft((current) => ({ ...current, observacao: event.target.value }))} placeholder="Ex.: primeira e terceira semana; quarta ou quinta; conciliar com Cargill; acesso somente pela manhã..." className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            <div className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-medium">Planejamento ativo</p><p className="text-xs text-muted-foreground">Ao pausar, as próximas previsões são retiradas; o histórico permanece.</p></div><Switch checked={draft.ativo} onCheckedChange={(checked) => setDraft((current) => ({ ...current, ativo: checked }))} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={() => saveConfig.mutate(draft)} disabled={saveConfig.isPending}>{saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar e recalcular próximas visitas</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
