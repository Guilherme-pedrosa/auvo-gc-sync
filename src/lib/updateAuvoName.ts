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

export async function updateAuvoClientNames(rhClientIds: string[]) {
  const { data, error } = await supabase.functions.invoke("rh-clientes-sync-gc", {
    body: {
      action: "update_auvo_names",
      requestVersion: "gc-auvo-v2",
      rhClientIds,
    },
  });

  if (error) throw error;
  if (!data || typeof data.updated !== "number") {
    throw new Error(data?.error || "Resposta inválida ao atualizar nomes no Auvo");
  }
  return data as { ok: boolean; requested: number; updated: number; errors: number; details: Array<{ id: string; ok: boolean; error?: string }> };
}
