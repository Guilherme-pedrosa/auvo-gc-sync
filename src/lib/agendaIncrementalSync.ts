export type AgendaTaskSnapshot = Record<string, unknown> & {
  id?: string | null;
  auvo_task_id?: string | null;
};

export const AGENDA_TASK_SYNC_FIELDS = [
  "data",
  "hora_inicio",
  "hora_fim",
  "colaborador_id",
  "colaborador_nome",
  "cliente",
  "descricao",
  "status",
  "origem",
  "gc_os_codigo",
  "gc_orcamento_codigo",
] as const;

const PRESERVE_WHEN_MISSING = [
  "hora_inicio",
  "hora_fim",
  "colaborador_id",
  "colaborador_nome",
  "cliente",
  "descricao",
  "status",
  "origem",
  "gc_os_codigo",
  "gc_orcamento_codigo",
] as const;

function isMissingSnapshotValue(field: string, value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return true;
  if (field === "cliente" && normalized === "SEM CLIENTE") return true;
  return false;
}

/**
 * A tarefa Auvo é a identidade estável do card. Uma nova leitura pode mudar
 * data, técnico, horário ou documento, mas nunca deve recriar o card nem apagar
 * informação conhecida quando a API omitir um campo naquela rodada.
 */
export function mergeAgendaTaskSnapshot(
  existing: AgendaTaskSnapshot | null | undefined,
  incoming: AgendaTaskSnapshot,
): AgendaTaskSnapshot {
  const merged: AgendaTaskSnapshot = {
    ...incoming,
    id: existing?.id || incoming.id,
  };

  if (existing) {
    for (const field of PRESERVE_WHEN_MISSING) {
      if (
        isMissingSnapshotValue(field, incoming[field])
        && !isMissingSnapshotValue(field, existing[field])
      ) {
        merged[field] = existing[field];
      }
    }
  }

  if (isMissingSnapshotValue("hora_inicio", merged.hora_inicio)) merged.hora_inicio = "08:00";
  if (isMissingSnapshotValue("hora_fim", merged.hora_fim)) merged.hora_fim = "18:00";
  if (isMissingSnapshotValue("cliente", merged.cliente)) merged.cliente = "SEM CLIENTE";
  if (isMissingSnapshotValue("status", merged.status)) merged.status = "AGENDADO";
  if (isMissingSnapshotValue("origem", merged.origem)) merged.origem = "AUVO";

  return merged;
}

export function agendaTaskSnapshotChanged(
  existing: AgendaTaskSnapshot | null | undefined,
  merged: AgendaTaskSnapshot,
): boolean {
  if (!existing) return true;
  const comparable = (value: unknown) => value == null ? "" : String(value);
  return AGENDA_TASK_SYNC_FIELDS.some((field) =>
    comparable(existing[field]) !== comparable(merged[field])
  );
}
