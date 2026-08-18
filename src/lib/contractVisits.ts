export type ContractVisitConfigInput = {
  competencia: string;
  qtdVisitas: number;
  qtdTecnicos: number;
  horasMesContratadas: number;
  horaInicio: string;
  tecnicoIds: string[];
  diasSemana: number[];
  semanasMes?: number[];
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
  naoAntesDe?: string | null;
  visitasRealizadas?: number[];
  visitasConsecutivas?: boolean;
};

export type ContractVisitForecast = {
  competencia: string;
  visitaNumero: number;
  data: string;
  horaInicio: string;
  horaFim: string;
  tecnicoIds: string[];
};

export type ContractVisitMonthStatus = "FORA_VIGENCIA" | "EM_DIA" | "FALTANDO" | "EXCEDENTE";

export type ContractVisitMonthSummary = {
  competencia: string;
  status: ContractVisitMonthStatus;
  visitasPrevistas: number;
  visitasContratadas: number;
  horasPrevistas: number;
  horasContratadas: number;
  visitasPlanejadas: number;
  horasPlanejadas: number;
  visitasRealizadas: number;
  horasRealizadas: number;
  visitasRestantes: number;
  horasRestantes: number;
};

const ISO_MONTH = /^\d{4}-\d{2}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthBounds(competencia: string): { start: Date; end: Date } {
  if (!ISO_MONTH.test(competencia)) throw new Error("COMPETENCIA_INVALIDA");
  const [year, month] = competencia.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error("COMPETENCIA_INVALIDA");
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
}

function validISODate(value: string | null | undefined): string | null {
  const day = String(value ?? "").slice(0, 10);
  return ISO_DAY.test(day) ? day : null;
}

export function contractVisitDurationMinutes(
  contractedHoursPerMonth: number,
  visitsPerMonth: number,
  techniciansPerVisit: number,
): number {
  if (!Number.isFinite(contractedHoursPerMonth) || contractedHoursPerMonth <= 0) {
    throw new Error("HORAS_CONTRATADAS_INVALIDAS");
  }
  if (!Number.isInteger(visitsPerMonth) || visitsPerMonth < 1) {
    throw new Error("QUANTIDADE_VISITAS_INVALIDA");
  }
  if (!Number.isInteger(techniciansPerVisit) || techniciansPerVisit < 1) {
    throw new Error("QUANTIDADE_TECNICOS_INVALIDA");
  }
  const minutes = Math.round((contractedHoursPerMonth * 60) / (visitsPerMonth * techniciansPerVisit));
  if (minutes < 15) throw new Error("CARGA_VISITA_INVALIDA");
  if (minutes > 8 * 60) throw new Error("CARGA_VISITA_EXCEDE_8H");
  return minutes;
}

export function minimumContractVisitsPerMonth(
  contractedHoursPerMonth: number,
  techniciansPerVisit: number,
): number {
  if (!Number.isFinite(contractedHoursPerMonth) || contractedHoursPerMonth <= 0) {
    throw new Error("HORAS_CONTRATADAS_INVALIDAS");
  }
  if (!Number.isInteger(techniciansPerVisit) || techniciansPerVisit < 1) {
    throw new Error("QUANTIDADE_TECNICOS_INVALIDA");
  }
  return Math.ceil(contractedHoursPerMonth / (8 * techniciansPerVisit));
}

export function addMinutesToClock(clock: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!match) throw new Error("HORA_INVALIDA");
  const start = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(start) || start < 0 || start >= 24 * 60 || minutes <= 0) {
    throw new Error("HORA_INVALIDA");
  }
  const end = start + minutes;
  if (end > 24 * 60) throw new Error("CARGA_ULTRAPASSA_DIA");
  return `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

export function contractMonthIsActive(
  competencia: string,
  vigenciaInicio?: string | null,
  vigenciaFim?: string | null,
): boolean {
  const { start, end } = monthBounds(competencia);
  const monthStart = localISO(start);
  const monthEnd = localISO(end);
  const validFrom = validISODate(vigenciaInicio);
  const validUntil = validISODate(vigenciaFim);
  return (!validFrom || monthEnd >= validFrom) && (!validUntil || monthStart <= validUntil);
}

export function eligibleContractVisitDates(
  competencia: string,
  diasSemana: number[],
  vigenciaInicio?: string | null,
  vigenciaFim?: string | null,
  semanasMes: number[] = [1, 2, 3, 4, 5],
  naoAntesDe?: string | null,
): string[] {
  const { start, end } = monthBounds(competencia);
  const allowedDays = new Set(diasSemana.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  const allowedWeeks = new Set(semanasMes.filter((week) => Number.isInteger(week) && week >= 1 && week <= 5));
  if (allowedDays.size === 0) throw new Error("DIAS_SEMANA_VAZIOS");
  if (allowedWeeks.size === 0) throw new Error("SEMANAS_MES_VAZIAS");
  const validFrom = validISODate(vigenciaInicio);
  const validUntil = validISODate(vigenciaFim);
  const notBefore = validISODate(naoAntesDe);
  const result: string[] = [];

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const iso = localISO(date);
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    const mondayOffset = (firstDay + 6) % 7;
    const weekOfMonth = Math.floor((date.getDate() + mondayOffset - 1) / 7) + 1;
    if (!allowedDays.has(date.getDay()) || !allowedWeeks.has(weekOfMonth)) continue;
    if (validFrom && iso < validFrom) continue;
    if (validUntil && iso > validUntil) continue;
    if (notBefore && iso < notBefore) continue;
    result.push(iso);
  }
  return result;
}

export function evenlyDistributedDates(eligibleDates: string[], quantity: number): string[] {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("QUANTIDADE_VISITAS_INVALIDA");
  if (quantity === 0) return [];
  if (eligibleDates.length < quantity) throw new Error("DIAS_ELEGIVEIS_INSUFICIENTES");
  if (quantity === 1) return [eligibleDates[Math.floor((eligibleDates.length - 1) / 2)]];

  const selected: string[] = [];
  let previousIndex = -1;
  for (let index = 0; index < quantity; index += 1) {
    const ideal = Math.round(index * (eligibleDates.length - 1) / (quantity - 1));
    const remaining = quantity - index - 1;
    const maxIndex = eligibleDates.length - remaining - 1;
    const chosen = Math.min(maxIndex, Math.max(previousIndex + 1, ideal));
    selected.push(eligibleDates[chosen]);
    previousIndex = chosen;
  }
  return selected;
}

function weekOfMonthFromISO(value: string): number {
  const date = new Date(`${value}T12:00:00`);
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  return Math.floor((date.getDate() + mondayOffset - 1) / 7) + 1;
}

export function interleavedVisitDates(
  eligibleDates: string[],
  selectedWeeks: number[],
  totalVisits: number,
  visitNumbers: number[] = Array.from({ length: totalVisits }, (_, index) => index + 1),
): string[] {
  const weeks = [...new Set(selectedWeeks)]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= 5)
    .sort((left, right) => left - right);
  if (weeks.length < totalVisits) throw new Error("SEMANAS_MES_INSUFICIENTES");

  const targetWeeks = weeks.slice(0, totalVisits);
  const datesByWeek = new Map<number, string[]>();
  for (const date of eligibleDates) {
    const week = weekOfMonthFromISO(date);
    const dates = datesByWeek.get(week) || [];
    dates.push(date);
    datesByWeek.set(week, dates);
  }
  const availableWeeks = [...datesByWeek.keys()].sort((left, right) => left - right);
  let previousWeek = 0;

  const selectedDates: string[] = [];
  for (const visitNumber of visitNumbers) {
    const targetWeek = targetWeeks[visitNumber - 1];
    const chosenWeek = availableWeeks.find((week) => week > previousWeek && week >= targetWeek)
      ?? [...availableWeeks].reverse().find((week) => week > previousWeek);
    if (!chosenWeek) break;
    previousWeek = chosenWeek;
    selectedDates.push(datesByWeek.get(chosenWeek)![0]);
  }
  return selectedDates;
}

export function rotatingVisitTeams(
  technicianIds: string[],
  techniciansPerVisit: number,
  visits: number,
): string[][] {
  const unique = [...new Set(technicianIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!Number.isInteger(techniciansPerVisit) || techniciansPerVisit < 1) {
    throw new Error("QUANTIDADE_TECNICOS_INVALIDA");
  }
  if (unique.length < techniciansPerVisit) throw new Error("TECNICOS_SELECIONADOS_INSUFICIENTES");

  return Array.from({ length: visits }, (_, visitIndex) =>
    Array.from({ length: techniciansPerVisit }, (_, teamIndex) =>
      unique[(visitIndex * techniciansPerVisit + teamIndex) % unique.length],
    ),
  );
}

export function consecutiveVisitDates(
  eligibleDates: string[],
  selectedWeeks: number[],
  totalVisits: number,
  visitNumbers: number[] = Array.from({ length: totalVisits }, (_, index) => index + 1),
): string[] {
  if (!eligibleDates.length) return [];
  const weeks = [...new Set(selectedWeeks)]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= 5)
    .sort((left, right) => left - right);
  const datesByWeek = new Map<number, string[]>();
  for (const date of eligibleDates) {
    const week = weekOfMonthFromISO(date);
    const dates = datesByWeek.get(week) || [];
    dates.push(date);
    datesByWeek.set(week, dates);
  }
  const preferred = weeks.filter((week) => (datesByWeek.get(week) || []).length >= totalVisits);
  const anyWeek = [...datesByWeek.keys()]
    .sort((left, right) => left - right)
    .filter((week) => (datesByWeek.get(week) || []).length >= totalVisits);
  const chosenWeek = preferred[0] ?? anyWeek[0] ?? null;
  const block = chosenWeek !== null
    ? datesByWeek.get(chosenWeek)!.slice(0, totalVisits)
    : eligibleDates.slice(0, totalVisits);
  return visitNumbers
    .map((visitNumber) => block[visitNumber - 1])
    .filter((date): date is string => Boolean(date));
}

export function buildContractVisitForecasts(input: ContractVisitConfigInput): ContractVisitForecast[] {
  if (!Number.isInteger(input.qtdVisitas) || input.qtdVisitas < 1 || input.qtdVisitas > 31) {
    throw new Error("QUANTIDADE_VISITAS_INVALIDA");
  }
  if (!contractMonthIsActive(input.competencia, input.vigenciaInicio, input.vigenciaFim)) return [];

  // A grade conserva o calendário contratual inteiro. Uma execução antecipada
  // cumpre o slot nominal correspondente, mas não remove nem desloca a data em
  // que a visita estava programada.
  const visitNumbers = Array.from({ length: input.qtdVisitas }, (_, index) => index + 1);

  const durationMinutes = contractVisitDurationMinutes(
    input.horasMesContratadas,
    input.qtdVisitas,
    input.qtdTecnicos,
  );
  const eligible = eligibleContractVisitDates(
    input.competencia,
    input.diasSemana,
    input.vigenciaInicio,
    input.vigenciaFim,
    [1, 2, 3, 4, 5, 6],
    input.naoAntesDe,
  );
  const dates = input.visitasConsecutivas
    ? consecutiveVisitDates(eligible, input.semanasMes || [1, 2, 3, 4, 5], input.qtdVisitas, visitNumbers)
    : interleavedVisitDates(eligible, input.semanasMes || [1, 2, 3, 4, 5], input.qtdVisitas, visitNumbers);
  const teams = rotatingVisitTeams(input.tecnicoIds, input.qtdTecnicos, input.qtdVisitas);
  const start = input.horaInicio.slice(0, 5);
  const end = addMinutesToClock(start, durationMinutes);

  return visitNumbers.slice(0, dates.length).map((visitaNumero, index) => ({
    competencia: input.competencia,
    visitaNumero,
    data: dates[index],
    horaInicio: start,
    horaFim: end,
    tecnicoIds: teams[visitaNumero - 1],
  }));
}

export function buildContractYearForecasts(
  input: Omit<ContractVisitConfigInput, "competencia" | "visitasRealizadas"> & {
    ano: number;
    visitasRealizadasPorMes?: Record<string, number[]>;
    mesesAtivos?: number[] | null;
  },
): ContractVisitForecast[] {
  const result: ContractVisitForecast[] = [];
  const activeMonths = (input.mesesAtivos && input.mesesAtivos.length)
    ? new Set(input.mesesAtivos)
    : null;
  for (let month = 1; month <= 12; month += 1) {
    if (activeMonths && !activeMonths.has(month)) continue;
    const competencia = `${input.ano}-${pad(month)}`;
    if (!contractMonthIsActive(competencia, input.vigenciaInicio, input.vigenciaFim)) continue;
    const monthEnd = localISO(monthBounds(competencia).end);
    if (input.naoAntesDe && monthEnd < input.naoAntesDe) continue;
    result.push(...buildContractVisitForecasts({
      ...input,
      competencia,
      visitasRealizadas: input.visitasRealizadasPorMes?.[competencia] || [],
    }));
  }
  return result;
}

function clockToMinutes(value: string): number {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function summarizeContractVisitMonth(input: {
  competencia: string;
  visitasContratadas: number;
  horasContratadas: number;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
  forecasts: Array<{ contrato_visita_numero: number | null; hora_inicio: string; hora_fim: string }>;
  executions?: Array<{ visita_numero: number; horas_trabalhadas: number }>;
}): ContractVisitMonthSummary {
  if (!contractMonthIsActive(input.competencia, input.vigenciaInicio, input.vigenciaFim)) {
    return {
      competencia: input.competencia,
      status: "FORA_VIGENCIA",
      visitasPrevistas: 0,
      visitasContratadas: 0,
      horasPrevistas: 0,
      horasContratadas: 0,
      visitasPlanejadas: 0,
      horasPlanejadas: 0,
      visitasRealizadas: 0,
      horasRealizadas: 0,
      visitasRestantes: 0,
      horasRestantes: 0,
    };
  }
  const plannedVisits = new Set(input.forecasts.map((row) => row.contrato_visita_numero).filter(Boolean));
  const realizedVisits = new Set((input.executions || []).map((row) => row.visita_numero).filter(Boolean));
  const coveredVisits = new Set([...plannedVisits, ...realizedVisits]);
  const plannedMinutes = input.forecasts.reduce((total, row) => {
    const start = clockToMinutes(row.hora_inicio);
    const end = clockToMinutes(row.hora_fim);
    return total + Math.max(0, end - start);
  }, 0);
  const plannedHours = plannedMinutes / 60;
  const realizedHours = (input.executions || []).reduce(
    (total, row) => total + Math.max(0, Number(row.horas_trabalhadas || 0)),
    0,
  );
  const coveredHours = plannedHours + realizedHours;
  // A carga individual é armazenada em minutos inteiros. A tolerância abaixo
  // absorve somente esse arredondamento técnico, sem esconder uma hora faltante.
  const tolerance = Math.max(1 / 60, input.forecasts.length / 120 + Number.EPSILON);
  const missing = coveredVisits.size < input.visitasContratadas || coveredHours < input.horasContratadas - tolerance;
  const excess = coveredVisits.size > input.visitasContratadas || coveredHours > input.horasContratadas + tolerance;
  return {
    competencia: input.competencia,
    status: missing ? "FALTANDO" : excess ? "EXCEDENTE" : "EM_DIA",
    visitasPrevistas: coveredVisits.size,
    visitasContratadas: input.visitasContratadas,
    horasPrevistas: coveredHours,
    horasContratadas: input.horasContratadas,
    visitasPlanejadas: plannedVisits.size,
    horasPlanejadas: plannedHours,
    visitasRealizadas: realizedVisits.size,
    horasRealizadas: realizedHours,
    visitasRestantes: Math.max(0, input.visitasContratadas - realizedVisits.size),
    horasRestantes: Math.max(0, input.horasContratadas - realizedHours),
  };
}

export function isFieldTechnician(collaborator: { cargo?: string | null; funcao?: string | null }): boolean {
  const text = `${collaborator.cargo ?? ""} ${collaborator.funcao ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return text.includes("tecnico") || text.includes("auxiliar");
}
