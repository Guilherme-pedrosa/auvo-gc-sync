import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAgendaTagColor } from "@/lib/agendaTags";

export interface AgendaTag {
  id: string;
  name: string;
  color: string;
  criado_em: string;
  atualizado_em: string;
}

export interface AgendaTagLink {
  agendamento_id: string;
  tag_id: string;
}

export function isAgendaTagsSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code ?? "").toUpperCase();
  const message = String(candidate.message ?? "").toLowerCase();
  return code === "PGRST205"
    || (message.includes("schema cache") && message.includes("tags"))
    || (message.includes("relation") && message.includes("tags") && message.includes("does not exist"));
}

const missingSchemaMessage = "A estrutura de tags ainda não foi aplicada no banco. Publique novamente para executar a migration de reparo.";

export function useAgendaTags(enabled = true) {
  return useQuery({
    queryKey: ["agenda_tags"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("id,name,color,criado_em,atualizado_em")
        .order("name", { ascending: true });
      if (isAgendaTagsSchemaMissing(error)) {
        console.warn("[agenda-tags] tabela tags ainda não disponível no schema cache");
        return [];
      }
      if (error) throw error;
      return (data ?? []) as AgendaTag[];
    },
    retry: (failureCount, error) => !isAgendaTagsSchemaMissing(error) && failureCount < 2,
  });
}

export function useAgendaTagLinks(agendamentoIds: string[], enabled = true) {
  const ids = [...new Set(agendamentoIds.filter(Boolean))].sort();

  return useQuery({
    queryKey: ["agenda_tag_links", ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const links: AgendaTagLink[] = [];
      for (let index = 0; index < ids.length; index += 500) {
        const { data, error } = await supabase
          .from("agenda_agendamento_tags")
          .select("agendamento_id,tag_id")
          .in("agendamento_id", ids.slice(index, index + 500));
        if (isAgendaTagsSchemaMissing(error)) {
          console.warn("[agenda-tags] tabela de vínculos ainda não disponível no schema cache");
          return [];
        }
        if (error) throw error;
        links.push(...((data ?? []) as AgendaTagLink[]));
      }
      return links;
    },
    retry: (failureCount, error) => !isAgendaTagsSchemaMissing(error) && failureCount < 2,
  });
}

export function useAgendaIdByTask(taskId: string | null) {
  return useQuery({
    queryKey: ["agenda_id_by_task", taskId],
    enabled: !!taskId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_agendamentos")
        .select("id")
        .eq("auvo_task_id", taskId as string)
        .order("atualizado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });
}

export function useCreateAgendaTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Informe o nome da tag.");
      const { data, error } = await supabase
        .from("tags")
        .insert({ name: normalizedName, color: normalizeAgendaTagColor(color) })
        .select("id,name,color,criado_em,atualizado_em")
        .single();
      if (isAgendaTagsSchemaMissing(error)) throw new Error(missingSchemaMessage);
      if (error) throw error;
      return data as AgendaTag;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agenda_tags"] }),
  });
}

export function useSetAgendaTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ agendamentoId, tagIds }: { agendamentoId: string; tagIds: string[] }) => {
      const desired = [...new Set(tagIds.filter(Boolean))];
      const { data: currentRows, error: currentError } = await supabase
        .from("agenda_agendamento_tags")
        .select("tag_id")
        .eq("agendamento_id", agendamentoId);
      if (isAgendaTagsSchemaMissing(currentError)) throw new Error(missingSchemaMessage);
      if (currentError) throw currentError;

      const current = new Set((currentRows ?? []).map((row) => row.tag_id));
      const desiredSet = new Set(desired);
      const removed = [...current].filter((tagId) => !desiredSet.has(tagId));
      const added = desired.filter((tagId) => !current.has(tagId));

      if (removed.length > 0) {
        const { error } = await supabase
          .from("agenda_agendamento_tags")
          .delete()
          .eq("agendamento_id", agendamentoId)
          .in("tag_id", removed);
        if (error) throw error;
      }

      if (added.length > 0) {
        const { error } = await supabase
          .from("agenda_agendamento_tags")
          .insert(added.map((tagId) => ({ agendamento_id: agendamentoId, tag_id: tagId })));
        if (error) throw error;
      }

      return desired;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agenda_tag_links"] }),
  });
}
