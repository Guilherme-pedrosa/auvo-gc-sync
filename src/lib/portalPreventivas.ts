export type PortalClientGroup = {
  id: string;
  nome: string;
};

export type PortalClientMembership = {
  grupo_id: string;
  cliente_nome: string;
};

export type PortalClientAliases = {
  nome: string;
  nome_fantasia: string | null;
};

export function normalizePortalClientName(value: string | null | undefined): string {
  return (value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*(LTDA|ME|SA|EPP|EIRELI|S\/A|S\.A\.|LTDA\.?|MEI)\s*/g, "")
    .replace(/[./-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve os grupos que um cliente do portal pode enxergar.
 * O nome do grupo pode ficar antigo após uma renomeação no Auvo; a associação
 * persistida em grupo_cliente_membros é a chave confiável.
 */
export function resolvePortalPreventiveGroupIds(input: {
  principalGroupId: string;
  principalMemberNames: string[];
  groups: PortalClientGroup[];
  memberships: PortalClientMembership[];
}): Set<string> {
  const allowed = new Set<string>([input.principalGroupId]);
  const principalNames = new Set(
    input.principalMemberNames.map(normalizePortalClientName).filter(Boolean),
  );

  if (principalNames.size === 0) return allowed;

  const autoGroupIds = new Set(
    input.groups
      .filter((group) => /^\s*\[Auto\]/i.test(group.nome))
      .map((group) => group.id),
  );

  for (const membership of input.memberships) {
    if (!autoGroupIds.has(membership.grupo_id)) continue;
    if (principalNames.has(normalizePortalClientName(membership.cliente_nome))) {
      allowed.add(membership.grupo_id);
    }
  }

  return allowed;
}

/**
 * Expande os nomes de um membro do portal para os aliases registrados no
 * cadastro central RH > Clientes. Assim GC e Auvo podem manter nomes distintos
 * sem quebrar a visibilidade do mesmo cliente.
 */
export function expandPortalClientAliases(
  principalMemberNames: string[],
  clients: PortalClientAliases[],
): string[] {
  const aliases = new Set(principalMemberNames.map(normalizePortalClientName).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const client of clients) {
      const names = [client.nome, client.nome_fantasia]
        .map(normalizePortalClientName)
        .filter(Boolean);
      if (!names.some((name) => aliases.has(name))) continue;
      for (const name of names) {
        if (!aliases.has(name)) {
          aliases.add(name);
          changed = true;
        }
      }
    }
  }
  return Array.from(aliases);
}
