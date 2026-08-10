import { supabase } from "@/integrations/supabase/client";
import {
  buildContractYearForecasts,
  contractVisitDurationMinutes,
} from "@/lib/contractVisits";

export type ContractPlanningContract = {
  id: string;
  nome: string;
  cliente_nome: string | null;
  grupo_id: string | null;
  horas_mes_contratadas: number | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: boolean;
};

export type ContractPlanningConfig = {
  id: string;
  contrato_id: string;
  qtd_visitas: number;
  qtd_tecnicos: number;
  duracao_minutos: number;
  hora_inicio: string;
  tecnico_ids: string[];
  dias_semana: number[];
  semanas_mes?: number[] | null;
  observacao: string | null;
  ativo: boolean;
  planejamento_pendente?: boolean;
};

export type ContractPlanningTechnician = {
  id: string;
  nome: string;
};

type ExistingForecast = {
  data: string;
  contrato_visita_numero: number | null;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function yearRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function planningYearsFromDates(dates: string[], currentYear = new Date().getFullYear()): number[] {
  return [...new Set([
    currentYear,
    ...dates.map((date) => Number(String(date).slice(0, 4))).filter((year) => Number.isInteger(year) && year >= currentYear),
  ])].sort();
}

export async function reconcileContractVisitYear(input: {
  contract: ContractPlanningContract;
  config: ContractPlanningConfig;
  technicians: ContractPlanningTechnician[];
  year: number;
  groupName?: string | null;
  createdBy?: string | null;
}): Promise<{ inserted: number; removed: number; preserved: number; year: number }> {
  const { contract, config, technicians, year } = input;
  const { start, end } = yearRange(year);
  const today = todayISO();
  if (year < Number(today.slice(0, 4))) {
    return { inserted: 0, removed: 0, preserved: 0, year };
  }
  const cutoff = year === Number(today.slice(0, 4)) ? today : start;
  const { data: existingData, error: existingError } = await supabase
    .from("agenda_agendamentos")
    .select("data,contrato_visita_numero")
    .eq("origem", "CONTRATO")
    .eq("contrato_visita_config_id", config.id)
    .gte("data", start)
    .lte("data", end);
  if (existingError) throw existingError;
  const existing = (existingData || []) as ExistingForecast[];
  const historical = existing.filter((row) => row.data < cutoff);
  const completedByMonth = new Map<string, Set<number>>();
  for (const row of historical) {
    if (!row.contrato_visita_numero) continue;
    const competence = row.data.slice(0, 7);
    const visits = completedByMonth.get(competence) || new Set<number>();
    visits.add(row.contrato_visita_numero);
    completedByMonth.set(competence, visits);
  }

  const { count: futureCount, error: countError } = await supabase
    .from("agenda_agendamentos")
    .select("id", { count: "exact", head: true })
    .eq("origem", "CONTRATO")
    .eq("contrato_visita_config_id", config.id)
    .gte("data", cutoff)
    .lte("data", end);
  if (countError) throw countError;

  const shouldGenerate = contract.ativo && config.ativo && Number(contract.horas_mes_contratadas || 0) > 0;
  const durationMinutes = shouldGenerate
    ? contractVisitDurationMinutes(
        Number(contract.horas_mes_contratadas || 0),
        config.qtd_visitas,
        config.qtd_tecnicos,
      )
    : config.duracao_minutos;
  const validTechnicianIds = config.tecnico_ids.filter((id) => technicians.some((technician) => technician.id === id));
  if (shouldGenerate && validTechnicianIds.length < config.qtd_tecnicos) {
    throw new Error(`Selecione ao menos ${config.qtd_tecnicos} técnico(s) ativos para ${contract.nome}.`);
  }

  const plan = shouldGenerate
    ? buildContractYearForecasts({
        ano: year,
        qtdVisitas: config.qtd_visitas,
        qtdTecnicos: config.qtd_tecnicos,
        horasMesContratadas: Number(contract.horas_mes_contratadas || 0),
        horaInicio: config.hora_inicio,
        tecnicoIds: validTechnicianIds,
        diasSemana: config.dias_semana,
        semanasMes: config.semanas_mes || [1, 2, 3, 4, 5],
        vigenciaInicio: contract.vigencia_inicio,
        vigenciaFim: contract.vigencia_fim,
        naoAntesDe: cutoff,
        visitasRealizadasPorMes: Object.fromEntries(
          [...completedByMonth.entries()].map(([competence, visits]) => [competence, [...visits]]),
        ),
      })
    : [];

  const technicianById = new Map(technicians.map((technician) => [technician.id, technician]));
  const target = contract.cliente_nome || input.groupName || contract.nome;
  const rows = plan.flatMap((visit) => visit.tecnicoIds.map((technicianId) => {
    const technician = technicianById.get(technicianId);
    if (!technician) return null;
    return {
      data: visit.data,
      hora_inicio: `${visit.horaInicio}:00`,
      hora_fim: `${visit.horaFim}:00`,
      colaborador_id: technician.id,
      colaborador_nome: technician.nome,
      cliente: target.toLocaleUpperCase("pt-BR"),
      descricao: `Visita contratual ${visit.visitaNumero}/${config.qtd_visitas} · ${contract.nome}`,
      status: "PREVISAO_CONTRATUAL",
      origem: "CONTRATO",
      auvo_task_id: null,
      gc_os_codigo: null,
      gc_orcamento_codigo: null,
      previsao_continuidade: true,
      previsao_tipo: "CONTRATO",
      previsao_detalhes: [
        `${Number(contract.horas_mes_contratadas).toLocaleString("pt-BR")}h/mês`,
        `${config.qtd_visitas} visita(s)`,
        `${config.qtd_tecnicos} técnico(s)`,
        config.observacao?.trim(),
      ].filter(Boolean).join(" · "),
      contrato_id: contract.id,
      contrato_visita_config_id: config.id,
      contrato_visita_competencia: `${visit.competencia}-01`,
      contrato_visita_numero: visit.visitaNumero,
      criado_por: input.createdBy || null,
    };
  })).filter(Boolean);

  const { data: insertedCount, error: reconciliationError } = await (supabase as any).rpc(
    "reconciliar_previsoes_visitas_contratuais",
    {
      p_config_id: config.id,
      p_ano: year,
      p_data_corte: cutoff,
      p_duracao_minutos: durationMinutes,
      p_linhas: rows,
    },
  );
  if (reconciliationError) throw reconciliationError;
  return { inserted: Number(insertedCount || 0), removed: futureCount || 0, preserved: historical.length, year };
}

export async function reconcileFutureContractPlans(contractId: string): Promise<void> {
  const [{ data: contract, error: contractError }, { data: config, error: configError }] = await Promise.all([
    supabase.from("contratos").select("*").eq("id", contractId).maybeSingle(),
    supabase.from("contratos_visitas_config").select("*").eq("contrato_id", contractId).maybeSingle(),
  ]);
  if (contractError) throw contractError;
  if (configError) throw configError;
  if (!contract || !config) return;

  const [{ data: collaborators, error: collaboratorsError }, { data: groups, error: groupsError }, { data: futureRows, error: futureError }] = await Promise.all([
    supabase.from("rh_colaboradores").select("id,nome").eq("ativo", true),
    supabase.from("grupos_clientes").select("id,nome"),
    supabase
      .from("agenda_agendamentos")
      .select("data")
      .eq("origem", "CONTRATO")
      .eq("contrato_visita_config_id", config.id)
      .gte("data", todayISO()),
  ]);
  if (collaboratorsError) throw collaboratorsError;
  if (groupsError) throw groupsError;
  if (futureError) throw futureError;
  const years = planningYearsFromDates((futureRows || []).map((row) => row.data));
  const groupName = (groups || []).find((group) => group.id === contract.grupo_id)?.nome || null;
  for (const year of years) {
    await reconcileContractVisitYear({
      contract: contract as ContractPlanningContract,
      config: config as ContractPlanningConfig,
      technicians: (collaborators || []) as ContractPlanningTechnician[],
      year,
      groupName,
    });
  }
}
