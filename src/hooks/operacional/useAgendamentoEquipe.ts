import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as sb } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AgendaVeiculo {
  id: string;
  nome: string;
  placa: string | null;
  modelo: string | null;
  ordem: number;
  ativo: boolean;
}

export interface AgendaAgendamento {
  id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  colaborador_id: string | null;
  colaborador_nome: string;
  veiculo_id: string | null;
  cliente: string;
  descricao: string | null;
  status: string;
}

export function useAgendaVeiculos() {
  return useQuery({
    queryKey: ["agenda_veiculos"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("agenda_veiculos")
        .select("*")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as AgendaVeiculo[];
    },
  });
}

export function useAgendamentos(dataISO: string) {
  return useQuery({
    queryKey: ["agenda_agendamentos", dataISO],
    queryFn: async () => {
      const { data, error } = await sb
        .from("agenda_agendamentos")
        .select("*")
        .eq("data", dataISO)
        .order("hora_inicio");
      if (error) throw error;
      return (data ?? []) as AgendaAgendamento[];
    },
  });
}

export function useSaveAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<AgendaAgendamento> & { id?: string }) => {
      // Validação de disponibilidade (técnico e veículo no mesmo intervalo)
      const { data: existentes, error: errList } = await sb
        .from("agenda_agendamentos")
        .select("*")
        .eq("data", payload.data!);
      if (errList) throw errList;

      const overlap = (existentes ?? []).filter((e: AgendaAgendamento) => {
        if (payload.id && e.id === payload.id) return false;
        const conflitaHorario =
          payload.hora_inicio! < e.hora_fim && payload.hora_fim! > e.hora_inicio;
        if (!conflitaHorario) return false;
        return (
          (payload.colaborador_id && e.colaborador_id === payload.colaborador_id) ||
          (payload.veiculo_id && e.veiculo_id === payload.veiculo_id)
        );
      });

      if (overlap.length > 0) {
        const o = overlap[0];
        throw new Error(
          `Conflito de agenda: ${o.colaborador_nome} / ${o.cliente} (${o.hora_inicio.slice(0, 5)} - ${o.hora_fim.slice(0, 5)})`,
        );
      }

      if (payload.id) {
        const { error } = await sb.from("agenda_agendamentos").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("agenda_agendamentos").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Agendamento salvo");
      qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("agenda_agendamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento excluído");
      qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}