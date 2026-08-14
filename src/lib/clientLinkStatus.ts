import { normalizeClientName } from "@/lib/clientMatching";

export type ClientLinkRow = {
  nome?: string | null;
  nome_gc?: string | null;
  nome_auvo?: string | null;
  nome_fantasia?: string | null;
  vinculo_status?: string | null;
  auvo_cliente_id?: number | string | null;
};

export type AuvoClientCacheRow = {
  auvo_id?: number | string | null;
  nome?: string | null;
  nome_legal?: string | null;
};

export type ClientLinkIndex = {
  /** chave: nome Auvo normalizado -> conjunto de nomes GC normalizados oficialmente vinculados */
  gcPorAuvo: Map<string, Set<string>>;
  /** nomes Auvo normalizados que pertencem a um cadastro oficialmente vinculado */
  auvoVinculados: Set<string>;
  /** IDs Auvo que pertencem a um cadastro oficialmente vinculado */
  idsAuvoVinculados: Set<string>;
  /** ID Auvo atual resolvido pelo nome vigente no cache da API */
  idAuvoPorNomeAtual: Map<string, string>;
};

/**
 * tarefas_central NÃO possui gc_cliente_id. O vínculo oficial (RH > Clientes)
 * precisa ser resolvido pelo par de NOMES gravado no espelho da tarefa.
 */
export function buildClientLinkIndex(
  rows: ClientLinkRow[],
  auvoClients: AuvoClientCacheRow[] = [],
): ClientLinkIndex {
  const gcPorAuvo = new Map<string, Set<string>>();
  const auvoVinculados = new Set<string>();
  const idsAuvoVinculados = new Set<string>();
  const idAuvoPorNomeAtual = new Map<string, string>();

  for (const client of auvoClients) {
    if (!client.auvo_id) continue;
    const id = String(client.auvo_id);
    for (const rawName of [client.nome, client.nome_legal]) {
      const name = normalizeClientName(rawName);
      if (name) idAuvoPorNomeAtual.set(name, id);
    }
  }

  for (const row of rows) {
    if (String(row.vinculo_status || "").toLowerCase() !== "vinculado") continue;
    
    // Vínculo por ID (mais confiável)
    if (row.auvo_cliente_id) {
      idsAuvoVinculados.add(String(row.auvo_cliente_id));
    }

    const auvoNome = normalizeClientName(row.nome_auvo || row.nome);
    if (!auvoNome) continue;
    auvoVinculados.add(auvoNome);

    const gcNomes = [row.nome_gc, row.nome, row.nome_fantasia]
      .map((value) => normalizeClientName(value))
      .filter(Boolean);
    if (!gcPorAuvo.has(auvoNome)) gcPorAuvo.set(auvoNome, new Set());
    const linkedGcNames = gcPorAuvo.get(auvoNome);
    if (linkedGcNames) {
      for (const gcNome of gcNomes) linkedGcNames.add(gcNome);
    }
  }

  return { gcPorAuvo, auvoVinculados, idsAuvoVinculados, idAuvoPorNomeAtual };
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
  auvoClientId?: string | number | null
): "vinculado" | "pendente" | null {
  // 1. Prioridade máxima: ID Auvo oficialmente vinculado
  const auvoNameKey = normalizeClientName(auvoNome);
  const resolvedAuvoId = auvoClientId
    ? String(auvoClientId)
    : index.idAuvoPorNomeAtual.get(auvoNameKey);
  if (resolvedAuvoId && index.idsAuvoVinculados.has(resolvedAuvoId)) {
    return "vinculado";
  }

  const auvo = normalizeClientName(auvoNome);
  const gc = normalizeClientName(gcNome);
  if (!auvo || !gc) return null;
  
  // 2. Nomes idênticos após normalização ou similaridade alta (70%)
  if (auvo === gc) return "vinculado";
  
  // Se não for idêntico, testar similaridade de 70% antes de considerar pendente
  const normAuvo = normalizeClientName(auvoNome);
  const normGc = normalizeClientName(gcNome);
  const tokensAuvo = normAuvo.split(" ").filter(t => t.length > 2);
  const tokensGc = normGc.split(" ").filter(t => t.length > 2);
  
  if (tokensAuvo.length > 0 && tokensGc.length > 0) {
    const intersection = tokensAuvo.filter(t => tokensGc.includes(t));
    const overlap = intersection.length / Math.max(tokensAuvo.length, tokensGc.length);
    if (overlap >= 0.7) return "vinculado";
  }
  
  // 3. Par Auvo <-> GC registrado no vínculo
  const gcNomes = index.gcPorAuvo.get(auvo);
  if (gcNomes?.has(gc)) return "vinculado";
  
  // 4. Cadastro Auvo vinculado a OUTRO GC
  return index.auvoVinculados.has(auvo) ? "pendente" : null;
}
