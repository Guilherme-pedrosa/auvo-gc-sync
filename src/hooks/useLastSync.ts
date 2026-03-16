import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useLastSync() {
  return useQuery({
    queryKey: ["last-sync-timestamp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("atualizado_em")
        .order("atualizado_em", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.atualizado_em || null;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
