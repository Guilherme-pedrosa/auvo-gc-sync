import { normalizeClientName } from "@/lib/clientMatching";

export type AgendaClientFilter = {
  kind: "cliente" | "contrato";
  id: string;
  names: string[];
};

type ClientNames = {
  nome: string;
  nome_gc?: string | null;
  nome_auvo?: string | null;
  nome_fantasia?: string | null;
};

export function agendaClientNames(client: ClientNames): string[] {
  return [...new Set([client.nome, client.nome_gc, client.nome_auvo, client.nome_fantasia]
    .map(normalizeClientName).filter(Boolean))];
}

export function agendaMatchesClientFilter(
  item: { cliente: string; gc_os_cliente?: string | null; contrato_id?: string | null },
  filter: AgendaClientFilter | null,
): boolean {
  if (!filter) return true;
  // UUID de contrato e UUID de RH > Clientes pertencem a entidades diferentes.
  if (filter.kind === "contrato" && item.contrato_id) return item.contrato_id === filter.id;
  const names = new Set(filter.names.map(normalizeClientName).filter(Boolean));
  return [item.cliente, item.gc_os_cliente].some((name) => names.has(normalizeClientName(name)));
}

export function agendaVisibleCollaborators<T extends {
  id: string; nome: string; ativo: boolean; cargo?: string | null; funcao?: string | null;
}>(collaborators: T[], items: Array<{ colaborador_id: string | null }>): T[] {
  const active = collaborators.filter((person) => person.ativo);
  const isTechnician = (person: T) => /tecnico|auxiliar/.test(
    normalizeClientName(`${person.cargo || ""} ${person.funcao || ""}`),
  );
  const assignedIds = new Set(items.map((item) => item.colaborador_id).filter(Boolean));
  const hasTechnicians = active.some(isTechnician);
  return active.filter((person) => !hasTechnicians || isTechnician(person) || assignedIds.has(person.id))
    .sort((left, right) => left.nome.localeCompare(right.nome));
}
