import { supabase } from "@/integrations/supabase/client";

/**
 * Atualiza o nome de um cliente no Auvo para corresponder ao nome no GestãoClick.
 * Utiliza a Edge Function rh-clientes-sync-gc com a ação 'update_auvo_name'.
 */
export async function updateAuvoClientName(rhClientId: string, newName: string) {
  const { data, error } = await supabase.functions.invoke("rh-clientes-sync-gc", {
    body: {
      action: "update_auvo_name",
      requestVersion: "gc-auvo-v2",
      rhClientId,
      newName
    },
  });

  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "Falha ao atualizar nome no Auvo");
  
  return data;
}

type UpdateNamesResult = {
  ok: boolean;
  requested: number;
  updated: number;
  errors: number;
  pending?: string[];
  details: Array<{ id: string; ok: boolean; error?: string }>;
};

const BATCH_SIZE = 15;

/**
 * Processa em lotes pequenos para nunca estourar o limite de 150s da Edge Function.
 */
export async function updateAuvoClientNames(
  rhClientIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<UpdateNamesResult> {
  const total = rhClientIds.length;
  const aggregate: UpdateNamesResult = { ok: true, requested: total, updated: 0, errors: 0, details: [] };

  for (let i = 0; i < total; i += BATCH_SIZE) {
    let batch = rhClientIds.slice(i, i + BATCH_SIZE);

    // Se o backend devolver pendentes (corte por tempo), reenvia até esvaziar.
    while (batch.length) {
      const { data, error } = await supabase.functions.invoke("rh-clientes-sync-gc", {
        body: { action: "update_auvo_names", requestVersion: "gc-auvo-v2", rhClientIds: batch },
      });
      if (error) throw error;
      if (!data || typeof data.updated !== "number") {
        throw new Error(data?.error || "Resposta inválida ao atualizar nomes no Auvo");
      }
      aggregate.updated += data.updated;
      aggregate.errors += data.errors ?? 0;
      aggregate.details.push(...(data.details ?? []));
      batch = Array.isArray(data.pending) ? data.pending : [];
    }

    onProgress?.(Math.min(i + BATCH_SIZE, total), total);
  }

  aggregate.ok = aggregate.errors === 0;
  return aggregate;
}
