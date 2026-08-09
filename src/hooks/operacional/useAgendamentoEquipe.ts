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
  marca?: string | null;
  status?: string | null;
  observacao?: string | null;
  tvh_vehicle_id?: string | null;
  sincronizado_em?: string | null;
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
  auvo_task_id?: string | null;
  origem?: string | null;
  gc_os_codigo?: string | null;
  gc_orcamento_codigo?: string | null;
  previsao_continuidade?: boolean;
}

export function useAgendaVeiculos() {
  return useQuery({
    queryKey: ["agenda_veiculos"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("agenda_veiculos")
        .select("*")
        .eq("ativo", true)
        .is("deletado_em", null)
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
      // O usuário solicitou remover a validação de conflito de agenda, 
      // pois o Auvo permite tarefas sobrepostas.
      
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
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
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
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===================== Escala semanal (grade estilo planilha) ===================== */

export interface AgendaVeiculoDia {
  id: string;
  veiculo_id: string;
  data: string;
  texto: string;
}

export function useAgendaSemana(dias: string[]) {
  const inicio = dias[0];
  const fim = dias[dias.length - 1];
  return useQuery({
    queryKey: ["agenda_semana", inicio, fim],
    enabled: !!inicio && !!fim,
    queryFn: async () => {
      const [ag, vd] = await Promise.all([
        sb.from("agenda_agendamentos").select("*").gte("data", inicio).lte("data", fim),
        sb.from("agenda_veiculo_dia").select("*").gte("data", inicio).lte("data", fim),
      ]);
      if (ag.error) throw ag.error;
      if (vd.error) throw vd.error;
      return {
        agendamentos: (ag.data ?? []) as AgendaAgendamento[],
        veiculoDias: (vd.data ?? []) as AgendaVeiculoDia[],
      };
    },
  });
}

export function useSalvarCelulaTecnico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id?: string | null;
      data: string;
      colaborador_id: string;
      colaborador_nome: string;
      texto: string;
    }) => {
      const texto = p.texto.trim();
      if (p.id && !texto) {
        const { error } = await sb.from("agenda_agendamentos").delete().eq("id", p.id);
        if (error) throw error;
        return;
      }
      if (!texto) return;
      if (p.id) {
        const { error } = await sb
          .from("agenda_agendamentos")
          .update({ cliente: texto })
          .eq("id", p.id);
        if (error) throw error;
        return;
      }
      const { error } = await sb.from("agenda_agendamentos").insert({
        data: p.data,
        hora_inicio: "08:00",
        hora_fim: "18:00",
        colaborador_id: p.colaborador_id,
        colaborador_nome: p.colaborador_nome,
        cliente: texto,
        status: "AGENDADO",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_semana"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSalvarCelulaVeiculo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { veiculo_id: string; data: string; texto: string }) => {
      const texto = p.texto.trim();
      if (!texto) {
        const { error } = await sb
          .from("agenda_veiculo_dia")
          .delete()
          .eq("veiculo_id", p.veiculo_id)
          .eq("data", p.data);
        if (error) throw error;
        return;
      }
      const { error } = await sb
        .from("agenda_veiculo_dia")
        .upsert({ veiculo_id: p.veiculo_id, data: p.data, texto }, { onConflict: "veiculo_id,data" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_semana"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}