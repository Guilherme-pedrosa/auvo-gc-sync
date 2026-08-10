// Regras puras do módulo "Agendamento" (duas faixas: compras de peças + OS prontas).

export const ORC_PECA_SITUACOES = [
  { id: "8743484", label: "APROVADO · aguardando compra", short: "Ag. compra" },
  { id: "8743485", label: "COMPRADO · aguardando chegada", short: "Ag. chegada" },
  { id: "8894381", label: "Aguardando chegada · peça em garantia", short: "Garantia" },
] as const;

export const ORC_PECA_SITUACAO_IDS = ORC_PECA_SITUACOES.map((s) => s.id);

export type AgendaBucket = "nao_agendada" | "atrasada" | "hoje" | "futura";

export const AGENDA_BUCKETS: { id: AgendaBucket; label: string; hint: string }[] = [
  { id: "nao_agendada", label: "Sem agendamento", hint: "OS gerada, ainda sem data/técnico" },
  { id: "atrasada", label: "Atrasadas", hint: "Data de execução já passou" },
  { id: "hoje", label: "Hoje", hint: "Execução prevista para hoje" },
  { id: "futura", label: "Agendadas", hint: "Execução prevista à frente" },
];

// A consulta chama diretamente a API do GestãoClick e é pesada. Depois da primeira
// carga da sessão, somente o botão "Atualizar" deve consultá-la novamente.
export const CHEGADAS_QUERY_POLICY = {
  staleTime: 5 * 60 * 1000,
  gcTime: Infinity,
  retry: false,
  refetchOnMount: true,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
} as const;

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getAgendaBucket(data: string | null | undefined, tecnico: string | null | undefined): AgendaBucket {
  const dia = String(data ?? "").slice(0, 10);
  const temTecnico = !!String(tecnico ?? "").trim();
  if (!dia || !temTecnico) return "nao_agendada";
  const hoje = todayISO();
  if (dia < hoje) return "atrasada";
  if (dia === hoje) return "hoje";
  return "futura";
}

export function diasDesde(data: string | null | undefined): number | null {
  const dia = String(data ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const ms = Date.now() - new Date(`${dia}T00:00:00`).getTime();
  return Math.floor(ms / 86_400_000);
}

export function parseValor(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number(raw) || 0;
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Primeiro id de tarefa Auvo de execução (o GC pode gravar "123/456"). */
export function parseExecTaskId(raw: unknown): string | null {
  const txt = String(raw ?? "").trim();
  if (!txt) return null;
  const first = txt.split(/[\/,;\s]+/).map((s) => s.replace(/\D/g, "")).find((s) => s.length >= 4);
  return first || null;
}

/** Chegada de peças vinda do módulo de compras do GestãoClick. */
export type PrevisaoAgendamento = {
  id: string;
  data: string;
  colaborador_nome: string;
  colaborador_id: string | null;
  gc_orcamento_codigo: string | null;
  gc_os_codigo: string | null;
  previsao_detalhes: string | null;
  hora_inicio: string;
  hora_fim: string;
  atualizado_em: string;
};

export type PedidoDetalheProduto = {
  codigo: string;
  id: string;
  situacao_id: string;
  situacao: string;
  data_chegada: string | null;
  data_chegada_texto: string;
  estado: "pendente" | "chegou" | "cancelado" | "desconhecido";
  gc_link: string;
  quantidade?: number;
};

export type PecaEmFalta = {
  produto_id: string;
  nome: string;
  quantidade: number;
  estoque_atual: number;
  deficit: number;
  demanda_total_aberta?: number;
  conflito_estoque?: boolean;
  pedidos_compra: PedidoDetalheProduto[];
};

export type ChegadaItem = {
  doc_tipo?: "orcamento" | "compra";
  orcamento_id?: string;
  compra_id: string;
  compra_codigo: string;
  pedidos_compra?: string[];
  pedidos_detalhes?: {
    codigo: string;
    id: string;
    situacao_id: string;
    situacao: string;
    data_chegada: string | null;
    data_chegada_texto: string;
    estado: "pendente" | "chegou" | "cancelado" | "desconhecido";
    gc_link: string;
  }[];
  pedidos_todos_chegaram?: boolean;
  estoque_verificado?: boolean;
  todos_em_estoque?: boolean;
  pode_agendar?: boolean;
  motivo_bloqueio?: string | null;
  proxima_reposicao?: string | null;
  pecas_em_falta?: PecaEmFalta[];
  data_chegada_orcamento?: string | null;
  fornecedor: string;
  situacao_id: string;
  situacao: string;
  grupo: string;
  data_emissao: string | null;
  data_chegada: string | null;
  data_chegada_texto: string;
  vinculo_tipo: "os" | "orcamento" | "texto";
  vinculo_codigo: string;
  vinculo_texto: string;
  auvo_task_id: string;
  observacao_extra: string;
  valor_total: number;
  produtos: {
    produto_id: string;
    variacao_id: string | null;
    nome: string;
    quantidade: number;
    valor_total: number;
    estoque_atual: number;
    estoque_verificado: boolean;
    deficit: number;
    demanda_total_aberta?: number;
    conflito_estoque?: boolean;
    critico: boolean;
    pedidos_compra: PedidoDetalheProduto[];
  }[];
  gc_link: string;
  cliente: string;
  equipamento: string;
  os_codigo: string;
  orcamento_codigo: string;
  documento_valor: number;
  documento_situacao: string;
  documento_link: string;
  auvo_link: string;
  previsao_data?: string | null;
  previsao_id?: string | null;
  previsao_atualizado_em?: string | null;
  previsao_tecnico?: string | null;
  previsao_colab_id?: string | null;
  previsao_detalhes?: string | null;
  previsao_hora?: string | null;
  previsao_hora_fim?: string | null;
};

/** Seleciona sempre a previsão mais recentemente atualizada para o documento. */
export function latestForecastForDocument(
  item: Pick<ChegadaItem, "orcamento_codigo" | "vinculo_codigo" | "vinculo_tipo" | "os_codigo">,
  forecasts: PrevisaoAgendamento[],
): PrevisaoAgendamento | null {
  const orcamento = String(
    item.orcamento_codigo || (item.vinculo_tipo === "orcamento" ? item.vinculo_codigo : "") || "",
  );
  const os = String(item.os_codigo || (item.vinculo_tipo === "os" ? item.vinculo_codigo : "") || "");

  return forecasts
    .filter((forecast) =>
      (orcamento && String(forecast.gc_orcamento_codigo || "") === orcamento)
      || (os && String(forecast.gc_os_codigo || "") === os),
    )
    .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))[0] ?? null;
}

function isoDay(value: string | null | undefined): string | null {
  const day = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function forecastInitialDate(
  existing: string | null | undefined,
  suggested: string | null | undefined,
  minimum: string | null | undefined,
  today = todayISO(),
): string {
  const existingDay = isoDay(existing);
  if (existingDay) return existingDay;

  const todayDay = isoDay(today) ?? todayISO();
  const minimumDay = isoDay(minimum);
  let result = isoDay(suggested) ?? todayDay;
  if (result < todayDay) result = todayDay;
  if (minimumDay && result < minimumDay) result = minimumDay;
  return result;
}

export function forecastDateMeetsMinimum(
  date: string | null | undefined,
  minimum: string | null | undefined,
): boolean {
  const day = isoDay(date);
  const minimumDay = isoDay(minimum);
  return Boolean(day) && (!minimumDay || day! >= minimumDay);
}

export function missingPartArrivalDates(part: PecaEmFalta): string[] {
  return [...new Set(
    part.pedidos_compra
      .filter((order) => order.estado !== "cancelado" && order.estado !== "chegou" && order.data_chegada)
      .map((order) => String(order.data_chegada).slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  )].sort();
}

export function latestMissingPartsArrival(parts: PecaEmFalta[] | null | undefined): string | null {
  const dates = [...new Set((parts ?? []).flatMap(missingPartArrivalDates))].sort();
  return dates.at(-1) ?? null;
}

export type ChegadaStatus = "atrasada" | "hoje" | "futura" | "sem_data";

export function getChegadaStatus(dataChegada: string | null | undefined): ChegadaStatus {
  const dia = String(dataChegada ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "sem_data";
  const hoje = todayISO();
  if (dia < hoje) return "atrasada";
  if (dia === hoje) return "hoje";
  return "futura";
}

export function formatDiaBR(iso: string | null | undefined): string {
  const dia = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "—";
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

export function monthLabel(ano: number, mes: number): string {
  return new Date(ano, mes, 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());
}

/** Semanas (domingo a sábado) que cobrem o mês informado. */
export function buildMonthGrid(ano: number, mes: number): string[][] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(ano, mes, 1 - primeiro.getDay());
  const semanas: string[][] = [];
  const cursor = new Date(inicio);
  for (let s = 0; s < 6; s++) {
    const semana: string[] = [];
    for (let d = 0; d < 7; d++) {
      semana.push(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
    if (cursor.getMonth() !== mes && cursor.getDate() > 7) break;
  }
  return semanas;
}
