export const OPEN_OS_SITUATIONS = [
  { id: "7063579", label: "AGUARDANDO COMPRA DE PEÇAS" },
  { id: "7063580", label: "AGUARDANDO CHEGADA DE PEÇAS" },
  { id: "7659440", label: "AGUARDANDO FABRICAÇÃO" },
  { id: "7063581", label: "PEDIDO EM CONFERENCIA" },
  { id: "7063705", label: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO" },
  { id: "7213493", label: "SERVICO AGUARDANDO EXECUCAO" },
  { id: "7684665", label: "RETIRADA PELO TECNICO" },
  { id: "7748831", label: "AGUARDANDO RETIRADA" },
  { id: "8219136", label: "EM ROTA" },
  { id: "7116099", label: "EXECUTADO – AG. NEGOCIAÇÃO" },
] as const;

export const RECONCILIATION_OS_SITUATIONS = [
  ...OPEN_OS_SITUATIONS,
  { id: "8889036", label: "FECHADO CHAMADO" },
] as const;

const OPEN_OS_SITUATION_IDS = new Set<string>(OPEN_OS_SITUATIONS.map((s) => s.id));

const normalizeSituationLabel = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const OPEN_OS_SITUATION_LABELS = new Set<string>([
  ...OPEN_OS_SITUATIONS.map((s) => normalizeSituationLabel(s.label)),
  normalizeSituationLabel("EXECUTADO - AGUARDANDO NEGOCIAÇÃO"),
  normalizeSituationLabel("EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA"),
]);

export function isOpenOsSituation(item: {
  gc_os_situacao_id?: unknown;
  gc_os_situacao?: unknown;
}): boolean {
  const situationId = String(item.gc_os_situacao_id ?? "").trim();
  if (situationId) return OPEN_OS_SITUATION_IDS.has(situationId);

  const label = normalizeSituationLabel(item.gc_os_situacao);
  return !!label && OPEN_OS_SITUATION_LABELS.has(label);
}
