export type ContractVisitConfigInput = {
  competencia: string;
  qtdVisitas: number;
  qtdTecnicos: number;
  duracaoMinutos: number;
  horaInicio: string;
  tecnicoIds: string[];
  diasSemana: number[];
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
};

export type ContractVisitForecast = {
  visitaNumero: number;
  data: string;
  horaInicio: string;
  horaFim: string;
  tecnicoIds: string[];
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

export function addMinutesToClock(clock: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!match) throw new Error("HORA_INVALIDA");
  const start = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(start) || start < 0 || start >= 24 * 60 || minutes <= 0) {
    throw new Error("HORA_INVALIDA");
  }
  const end = start + minutes;
  if (end > 24 * 60) throw new Error("DURACAO_ULTRAPASSA_DIA");
  return `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

export function eligibleContractVisitDates(
  competencia: string,
  diasSemana: number[],
  vigenciaInicio?: string | null,
  vigenciaFim?: string | null,
): string[] {
  const { start, end } = monthBounds(competencia);
  const allowed = new Set(diasSemana.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (allowed.size === 0) throw new Error("DIAS_SEMANA_VAZIOS");
  const validFrom = validISODate(vigenciaInicio);
  const validUntil = validISODate(vigenciaFim);
  const result: string[] = [];

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const iso = localISO(date);
    if (!allowed.has(date.getDay())) continue;
    if (validFrom && iso < validFrom) continue;
    if (validUntil && iso > validUntil) continue;
    result.push(iso);
  }
  return result;
}

export function evenlyDistributedDates(eligibleDates: string[], quantity: number): string[] {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("QUANTIDADE_VISITAS_INVALIDA");
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

export function buildContractVisitForecasts(input: ContractVisitConfigInput): ContractVisitForecast[] {
  if (!Number.isInteger(input.qtdVisitas) || input.qtdVisitas < 1 || input.qtdVisitas > 31) {
    throw new Error("QUANTIDADE_VISITAS_INVALIDA");
  }
  if (!Number.isInteger(input.duracaoMinutos) || input.duracaoMinutos < 15) {
    throw new Error("DURACAO_INVALIDA");
  }

  const dates = evenlyDistributedDates(
    eligibleContractVisitDates(
      input.competencia,
      input.diasSemana,
      input.vigenciaInicio,
      input.vigenciaFim,
    ),
    input.qtdVisitas,
  );
  const teams = rotatingVisitTeams(input.tecnicoIds, input.qtdTecnicos, input.qtdVisitas);
  const start = input.horaInicio.slice(0, 5);
  const end = addMinutesToClock(start, input.duracaoMinutos);

  return dates.map((data, index) => ({
    visitaNumero: index + 1,
    data,
    horaInicio: start,
    horaFim: end,
    tecnicoIds: teams[index],
  }));
}

export function isFieldTechnician(collaborator: { cargo?: string | null; funcao?: string | null }): boolean {
  const text = `${collaborator.cargo ?? ""} ${collaborator.funcao ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return text.includes("tecnico") || text.includes("auxiliar");
}
