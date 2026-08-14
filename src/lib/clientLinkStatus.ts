import { normalizeClientName } from "@/lib/clientMatching";

export type ClientLinkRow = {
  nome?: string | null;
  nome_gc?: string | null;
  nome_auvo?: string | null;
  nome_fantasia?: string | null;
  vinculo_status?: string | null;
};

export type ClientLinkIndex = {
  /** chave: nome Auvo normalizado -> conjunto de nomes GC normalizados oficialmente vinculados */
  gcPorAuvo: Map<string, Set<string>>;
  /** nomes Auvo normalizados que pertencem a um cadastro oficialmente vinculado */
  auvoVinculados: Set<string>;
};

/**
 * tarefas_central NÃO possui gc_cliente_id. O vínculo oficial (RH > Clientes)
 * precisa ser resolvido pelo par de NOMES gravado no espelho da tarefa.
 */
export function buildClientLinkIndex(rows: ClientLinkRow[]): ClientLinkIndex {
  const gcPorAuvo = new Map<string, Set<string>>();
  const auvoVinculados = new Set<string>();

  for (const row of rows) {
    if (String(row.vinculo_status || "").toLowerCase() !== "vinculado") continue;
    const auvoNome = normalizeClientName(row.nome_auvo || row.nome);
    if (!auvoNome) continue;
    auvoVinculados.add(auvoNome);

    const gcNomes = [row.nome_gc, row.nome, row.nome_fantasia]
      .map((value) => normalizeClientName(value))
      .filter(Boolean);
    if (!gcPorAuvo.has(auvoNome)) gcPorAuvo.set(auvoNome, new Set());
    for (const gcNome of gcNomes) gcPorAuvo.get(auvoNome)!.add(gcNome);
  }

  return { gcPorAuvo, auvoVinculados };
}

/**
 * Retorna "vinculado" somente quando o par Auvo ↔ GC daquela tarefa corresponde
 * ao MESMO cadastro vinculado no RH. Nomes de unidades diferentes continuam
 * sendo tratados como divergência real.
 */
export function resolveClientLinkStatus(
  auvoNome: string | null | undefined,
  gcNome: string | null | undefined,
  index: ClientLinkIndex,
): "vinculado" | "pendente" | null {
  const auvo = normalizeClientName(auvoNome);
  const gc = normalizeClientName(gcNome);
  if (!auvo || !gc) return null;
  if (auvo === gc) return "vinculado";
  const gcNomes = index.gcPorAuvo.get(auvo);
  if (gcNomes?.has(gc)) return "vinculado";
  return index.auvoVinculados.has(auvo) ? "pendente" : null;
}
