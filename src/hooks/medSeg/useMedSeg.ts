import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type MedTipoASO = {
  id: string;
  codigo: string;
  nome: string;
  periodicidade_meses: number | null;
  ativo: boolean;
};
export type MedClinica = {
  id: string;
  nome: string;
  contato: string | null;
  endereco: string | null;
  observacoes: string | null;
  ativo: boolean;
};
export type MedAgendamento = {
  id: string;
  colaborador_id: string;
  tipo_id: string;
  data: string;
  hora: string | null;
  clinica_id: string | null;
  observacoes: string | null;
  status: "agendado" | "confirmado" | "realizado" | "cancelado";
  aso_id: string | null;
};
export type MedASO = {
  id: string;
  colaborador_id: string;
  tipo_id: string;
  data_emissao: string;
  data_validade: string | null;
  clinica_id: string | null;
  medico_nome: string | null;
  medico_crm: string | null;
  situacao: "valido" | "vencido" | "substituido";
  documento_id: string | null;
  agendamento_id: string | null;
  vigente: boolean;
  observacoes: string | null;
};

export const useTiposASO = () =>
  useQuery({
    queryKey: ["med_tipos_aso"],
    queryFn: async () => {
      const { data, error } = await supabase.from("med_tipos_aso").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as MedTipoASO[];
    },
  });

export const useSaveTipoASO = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<MedTipoASO>) => {
      const payload = { ...t };
      const { error } = t.id
        ? await supabase.from("med_tipos_aso").update(payload).eq("id", t.id)
        : await supabase.from("med_tipos_aso").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["med_tipos_aso"] });
      toast.success("Tipo salvo");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useDeleteTipoASO = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("med_tipos_aso").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["med_tipos_aso"] }),
    onError: (e: any) => toast.error(e.message),
  });
};

export const useClinicas = () =>
  useQuery({
    queryKey: ["med_clinicas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("med_clinicas").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as MedClinica[];
    },
  });

export const useSaveClinica = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<MedClinica>) => {
      const { error } = c.id
        ? await supabase.from("med_clinicas").update(c).eq("id", c.id)
        : await supabase.from("med_clinicas").insert(c as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["med_clinicas"] });
      toast.success("Clínica salva");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useDeleteClinica = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("med_clinicas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["med_clinicas"] }),
    onError: (e: any) => toast.error(e.message),
  });
};

export const useAgendamentos = (filter?: { colaboradorId?: string }) =>
  useQuery({
    queryKey: ["med_agendamentos", filter?.colaboradorId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("med_agendamentos").select("*").order("data", { ascending: true });
      if (filter?.colaboradorId) q = q.eq("colaborador_id", filter.colaboradorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MedAgendamento[];
    },
  });

export const useSaveAgendamento = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Partial<MedAgendamento>) => {
      const { error } = a.id
        ? await supabase.from("med_agendamentos").update(a).eq("id", a.id)
        : await supabase.from("med_agendamentos").insert(a as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["med_agendamentos"] });
      qc.invalidateQueries({ queryKey: ["med_historico"] });
      toast.success("Agendamento salvo");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useDeleteAgendamento = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("med_agendamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["med_agendamentos"] }),
    onError: (e: any) => toast.error(e.message),
  });
};

export const useASOs = (filter?: { colaboradorId?: string; onlyVigente?: boolean }) =>
  useQuery({
    queryKey: ["med_aso", filter?.colaboradorId ?? "all", !!filter?.onlyVigente],
    queryFn: async () => {
      let q = supabase.from("med_aso").select("*").order("data_emissao", { ascending: false });
      if (filter?.colaboradorId) q = q.eq("colaborador_id", filter.colaboradorId);
      if (filter?.onlyVigente) q = q.eq("vigente", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MedASO[];
    },
  });

/**
 * Cria um ASO no módulo de Medicina/Segurança **e** grava/atualiza o PDF em
 * rh_colaborador_docs (tipo ASO) para que apareça no Prontuário → Saúde Ocupacional.
 */
export const useSaveASO = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      colaborador_id: string;
      tipo_id: string;
      data_emissao: string;
      data_validade?: string | null;
      clinica_id?: string | null;
      medico_nome?: string | null;
      medico_crm?: string | null;
      observacoes?: string | null;
      agendamento_id?: string | null;
      file?: File | null;
    }) => {
      let documento_id: string | null = null;

      // 1. Upload PDF + upsert rh_colaborador_docs (tipo ASO) — mantém prontuário.
      if (input.file) {
        const { data: asoType, error: tErr } = await supabase
          .from("rh_document_types")
          .select("id")
          .eq("code", "ASO")
          .maybeSingle();
        if (tErr) throw tErr;
        if (!asoType) throw new Error("Tipo de documento ASO não encontrado no cadastro do RH.");

        const ext = input.file.name.includes(".")
          ? input.file.name.slice(input.file.name.lastIndexOf(".")).toLowerCase()
          : "";
        const path = `colaboradores/${input.colaborador_id}/aso/${Date.now()}${ext}`;
        const { error: upErr } = await supabase.storage
          .from("rh-documentos")
          .upload(path, input.file, { upsert: false });
        if (upErr) throw upErr;

        const { data: docRow, error: dErr } = await supabase
          .from("rh_colaborador_docs")
          .upsert(
            {
              colaborador_id: input.colaborador_id,
              document_type_id: asoType.id,
              data_emissao: input.data_emissao,
              data_vencimento: input.data_validade ?? null,
              arquivo_url: path,
              arquivo_nome: input.file.name,
            },
            { onConflict: "colaborador_id,document_type_id" }
          )
          .select("id")
          .single();
        if (dErr) throw dErr;
        documento_id = docRow.id;
      }

      // 2. Insere/atualiza registro operacional em med_aso.
      const payload: any = {
        colaborador_id: input.colaborador_id,
        tipo_id: input.tipo_id,
        data_emissao: input.data_emissao,
        data_validade: input.data_validade ?? null,
        clinica_id: input.clinica_id ?? null,
        medico_nome: input.medico_nome ?? null,
        medico_crm: input.medico_crm ?? null,
        observacoes: input.observacoes ?? null,
        agendamento_id: input.agendamento_id ?? null,
        vigente: true,
        situacao: "valido",
      };
      if (documento_id) payload.documento_id = documento_id;

      let asoId = input.id;
      if (input.id) {
        const { error } = await supabase.from("med_aso").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("med_aso").insert(payload).select("id").single();
        if (error) throw error;
        asoId = data.id;
      }

      // 3. Se veio de agendamento, marca como realizado e vincula.
      if (input.agendamento_id) {
        await supabase
          .from("med_agendamentos")
          .update({ status: "realizado", aso_id: asoId })
          .eq("id", input.agendamento_id);
      }

      // 4. Histórico
      await supabase.from("med_historico").insert({
        colaborador_id: input.colaborador_id,
        evento: "aso_novo",
        payload: { aso_id: asoId, tipo_id: input.tipo_id, data_emissao: input.data_emissao },
      } as any);

      return asoId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["med_aso"] });
      qc.invalidateQueries({ queryKey: ["med_agendamentos"] });
      qc.invalidateQueries({ queryKey: ["med_historico"] });
      qc.invalidateQueries({ queryKey: ["rh_colaborador_docs"] });
      toast.success("ASO registrado");
    },
    onError: (e: any) => toast.error(e.message),
  });
};

export const useHistorico = (colaboradorId?: string) =>
  useQuery({
    queryKey: ["med_historico", colaboradorId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("med_historico")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(200);
      if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        colaborador_id: string;
        evento: string;
        payload: any;
        criado_em: string;
      }>;
    },
  });

export const useSignedUrl = () => {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage
        .from("rh-documentos")
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
};

export type ColaboradorLite = {
  id: string;
  nome: string;
  cargo: string | null;
  funcao: string | null;
  ativo: boolean;
  tipo_pessoa: string;
};

export const useColaboradores = () =>
  useQuery({
    queryKey: ["rh_colaboradores_lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .select("id,nome,cargo,funcao,ativo,tipo_pessoa")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ColaboradorLite[];
    },
  });