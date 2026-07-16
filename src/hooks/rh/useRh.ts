import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type DocumentType = {
  id: string; code: string; name: string;
  scope: "COMPANY" | "TECHNICIAN" | "CLIENT";
  requires_expiry: boolean; ativo: boolean;
  pacote_padrao?: ("COMPANY" | "MEI" | "CLT")[];
};
export type RhCliente = {
  id: string; gc_cliente_id: string | null;
  nome: string; nome_normalizado: string; nome_fantasia: string | null;
  cpf_cnpj: string | null; email: string | null; telefone: string | null;
  endereco: string | null; cidade: string | null; uf: string | null; cep: string | null;
  ativo: boolean; origem: "cache" | "gc" | "manual"; sync_em: string | null;
  observacoes: string | null;
  integration_validity_days: number | null;
  integration_send_channel: "email" | "portal" | "presencial" | "outro" | null;
  portal_url: string | null;
  portal_login: string | null;
  portal_senha: string | null;
};
export type RhColaborador = {
  id: string; tipo_pessoa: "PF" | "PJ"; nome: string;
  nome_fantasia: string | null; cpf_cnpj: string | null;
  email: string | null; telefone: string | null;
  cargo: string | null; funcao: string | null; departamento: string | null;
  ativo: boolean; auvo_user_id: string | null; observacoes: string | null;
};
export type ColabDoc = {
  id: string; colaborador_id: string; document_type_id: string;
  data_emissao: string | null; data_vencimento: string | null;
  arquivo_url: string | null; arquivo_nome: string | null;
  observacoes: string | null;
};
export type CompanyDoc = {
  id: string; document_type_id: string; numero: string | null;
  data_emissao: string | null; data_vencimento: string | null;
  arquivo_url: string | null; arquivo_nome: string | null;
  observacoes: string | null;
};
export type ClientRequirement = {
  id: string; client_id: string; document_type_id: string;
  required_for: "COMPANY" | "TECHNICIAN"; is_required: boolean;
};
export type Integration = {
  id: string; client_id: string; technician_ids: string[];
  status: "draft" | "docs_enviados" | "docs_aceitos" | "agendada" | "realizada" | "bloqueada" | "expirada";
  validated_at: string | null; sent_at: string | null;
  earliest_expiry_date: string | null; blocked_reasons: unknown[];
  zip_file_name: string | null; zip_url: string | null;
  observacoes: string | null; criado_em: string;
  send_channel: "email" | "portal" | "presencial" | "outro" | null;
  docs_sent_at: string | null;
  docs_accepted_at: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  completed_by_technician_id: string | null;
  integration_valid_until: string | null;
  validity_days_snapshot: number | null;
};

// ---------- Document Types ----------
export function useDocumentTypes() {
  return useQuery({
    queryKey: ["rh_document_types"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_document_types").select("*").order("scope").order("name");
      if (error) throw error;
      return (data ?? []) as DocumentType[];
    },
  });
}
export function useSaveDocumentType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<DocumentType> & { id?: string }) => {
      if (payload.id) {
        const { error } = await sb.from("rh_document_types").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_document_types").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Tipo salvo"); qc.invalidateQueries({ queryKey: ["rh_document_types"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteDocumentType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_document_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tipo excluído"); qc.invalidateQueries({ queryKey: ["rh_document_types"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Clientes ----------
export function useRhClientes(search = "") {
  return useQuery({
    queryKey: ["rh_clientes", search],
    queryFn: async () => {
      let q = sb.from("rh_clientes").select("*").order("nome");
      if (search) q = q.ilike("nome", `%${search}%`);
      const { data, error } = await q.limit(2000);
      if (error) throw error;
      return (data ?? []) as RhCliente[];
    },
  });
}
export function useSaveRhCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<RhCliente> & { id?: string }) => {
      const body = { ...payload };
      if (body.nome && !body.nome_normalizado) {
        body.nome_normalizado = body.nome.trim().toLowerCase().replace(/\s+/g, " ");
      }
      if (payload.id) {
        const { error } = await sb.from("rh_clientes").update(body).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_clientes").insert({ ...body, origem: "manual" });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Cliente salvo"); qc.invalidateQueries({ queryKey: ["rh_clientes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteRhCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cliente excluído"); qc.invalidateQueries({ queryKey: ["rh_clientes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Colaboradores ----------
export function useColaboradores() {
  return useQuery({
    queryKey: ["rh_colaboradores"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_colaboradores").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as RhColaborador[];
    },
  });
}
export function useColaborador(id: string | undefined) {
  return useQuery({
    queryKey: ["rh_colaborador", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await sb.from("rh_colaboradores").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as RhColaborador | null;
    },
  });
}
export function useSaveColaborador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<RhColaborador> & { id?: string }) => {
      if (payload.id) {
        const { error } = await sb.from("rh_colaboradores").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_colaboradores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Colaborador salvo"); qc.invalidateQueries({ queryKey: ["rh_colaboradores"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteColaborador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_colaboradores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Colaborador excluído"); qc.invalidateQueries({ queryKey: ["rh_colaboradores"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Colaborador Docs ----------
export function useColaboradorDocs(colaboradorId: string | undefined) {
  return useQuery({
    queryKey: ["rh_colaborador_docs", colaboradorId],
    enabled: !!colaboradorId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_colaborador_docs")
        .select("*")
        .eq("colaborador_id", colaboradorId);
      if (error) throw error;
      return (data ?? []) as ColabDoc[];
    },
  });
}
export function useSaveColabDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<ColabDoc> & { id?: string }) => {
      if (payload.id) {
        const { error } = await sb.from("rh_colaborador_docs").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_colaborador_docs").upsert(payload, {
          onConflict: "colaborador_id,document_type_id",
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      toast.success("Documento salvo");
      qc.invalidateQueries({ queryKey: ["rh_colaborador_docs", vars.colaborador_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteColabDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, colaborador_id }: { id: string; colaborador_id: string }) => {
      const { error } = await sb.from("rh_colaborador_docs").delete().eq("id", id);
      if (error) throw error;
      return { colaborador_id };
    },
    onSuccess: (res) => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["rh_colaborador_docs", res.colaborador_id] });
    },
  });
}

// ---------- Company Docs ----------
export function useCompanyDocs() {
  return useQuery({
    queryKey: ["rh_company_documents"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_company_documents").select("*").order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompanyDoc[];
    },
  });
}
export function useSaveCompanyDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<CompanyDoc> & { id?: string }) => {
      if (payload.id) {
        const { error } = await sb.from("rh_company_documents").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_company_documents").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Documento salvo"); qc.invalidateQueries({ queryKey: ["rh_company_documents"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteCompanyDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_company_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Documento excluído"); qc.invalidateQueries({ queryKey: ["rh_company_documents"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Client Requirements ----------
export function useClientRequirements(clientId: string | undefined) {
  return useQuery({
    queryKey: ["rh_client_requirements", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_client_requirements")
        .select("*")
        .eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as ClientRequirement[];
    },
  });
}
export function useToggleRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      client_id: string; document_type_id: string;
      required_for: "COMPANY" | "TECHNICIAN"; is_required: boolean;
    }) => {
      const { error } = await sb.from("rh_client_requirements").upsert(payload, {
        onConflict: "client_id,document_type_id,required_for",
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["rh_client_requirements", vars.client_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      client_id: string; document_type_id: string;
      required_for: "COMPANY" | "TECHNICIAN"; is_required?: boolean;
    }) => {
      const { error } = await sb.from("rh_client_requirements").upsert(
        { is_required: true, ...payload },
        { onConflict: "client_id,document_type_id,required_for" },
      );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["rh_client_requirements", vars.client_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; client_id: string }) => {
      const { error } = await sb.from("rh_client_requirements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["rh_client_requirements", vars.client_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetRequirementRequired() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_required }: { id: string; is_required: boolean; client_id: string }) => {
      const { error } = await sb.from("rh_client_requirements").update({ is_required }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["rh_client_requirements", vars.client_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export async function applyRequirementsTemplate(clientId: string, docTypes: DocumentType[], existing: ClientRequirement[]) {
  const has = (t: DocumentType, s: "COMPANY" | "TECHNICIAN") =>
    existing.some((r) => r.document_type_id === t.id && r.required_for === s);
  const inPack = (t: DocumentType, k: "COMPANY" | "MEI" | "CLT") =>
    (t.pacote_padrao ?? []).includes(k);
  const rows = [
    // Empresa
    ...docTypes
      .filter((t) => t.ativo && t.scope === "COMPANY" && inPack(t, "COMPANY") && !has(t, "COMPANY"))
      .map((t) => ({ client_id: clientId, document_type_id: t.id, required_for: "COMPANY" as const, is_required: true })),
    // Técnico (MEI ∪ CLT)
    ...docTypes
      .filter(
        (t) =>
          t.ativo &&
          t.scope === "TECHNICIAN" &&
          (inPack(t, "MEI") || inPack(t, "CLT")) &&
          !has(t, "TECHNICIAN")
      )
      .map((t) => ({ client_id: clientId, document_type_id: t.id, required_for: "TECHNICIAN" as const, is_required: true })),
  ];
  if (rows.length === 0) return 0;
  const { error } = await sb.from("rh_client_requirements").insert(rows);
  if (error) throw error;
  return rows.length;
}

// ---------- Integrations ----------
export function useIntegrations() {
  return useQuery({
    queryKey: ["rh_integrations"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_integrations").select("*").order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Integration[];
    },
  });
}
export function useSaveIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Integration> & { id?: string }) => {
      if (payload.id) {
        const { error } = await sb.from("rh_integrations").update(payload).eq("id", payload.id);
        if (error) throw error;
        return payload.id;
      } else {
        const { data, error } = await sb.from("rh_integrations").insert(payload).select("id").maybeSingle();
        if (error) throw error;
        return data?.id as string | undefined;
      }
    },
    onSuccess: () => { toast.success("Integração salva"); qc.invalidateQueries({ queryKey: ["rh_integrations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_integrations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Integração excluída"); qc.invalidateQueries({ queryKey: ["rh_integrations"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Sync GC ----------
export function useSyncClientesGc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.functions.invoke("rh-clientes-sync-gc", { body: {} });
      if (error) throw error;
      return data as { updated: number; errors: number };
    },
    onSuccess: (res) => {
      toast.success(`Sync concluído: ${res.updated} atualizado(s), ${res.errors} falha(s)`);
      qc.invalidateQueries({ queryKey: ["rh_clientes"] });
    },
    onError: (e: Error) => toast.error(`Falha no sync: ${e.message}`),
  });
}

// ---------- Helpers ----------
export function computeDocStatus(doc: { data_vencimento: string | null } | undefined): "ok" | "expiring" | "expired" | "missing" {
  if (!doc) return "missing";
  if (!doc.data_vencimento) return "ok";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const venc = new Date(doc.data_vencimento);
  const diff = Math.floor((venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring";
  return "ok";
}

// ==================== TREINAMENTOS ====================
export type TreinamentoTipo = {
  id: string; code: string; name: string;
  validade_meses: number | null; ativo: boolean;
};
export type Treinamento = {
  id: string; tipo_id: string; titulo: string;
  data_realizacao: string; data_validade: string | null;
  instrutor: string | null; carga_horaria: number | null;
  local: string | null; observacoes: string | null;
  certificado_url: string | null; certificado_nome: string | null;
  lista_presenca_url: string | null; lista_presenca_nome: string | null;
};
export type TreinamentoParticipante = {
  id: string; treinamento_id: string; colaborador_id: string;
  presente: boolean; certificado_url: string | null; certificado_nome: string | null;
  observacoes: string | null;
};

export function useTreinamentoTipos() {
  return useQuery({
    queryKey: ["rh_treinamento_tipos"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_treinamento_tipos").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as TreinamentoTipo[];
    },
  });
}
export function useSaveTreinamentoTipo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<TreinamentoTipo> & { id?: string }) => {
      const body = { ...payload };
      if (body.id) {
        const { error } = await sb.from("rh_treinamento_tipos").update(body).eq("id", body.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("rh_treinamento_tipos").insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Tipo salvo"); qc.invalidateQueries({ queryKey: ["rh_treinamento_tipos"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteTreinamentoTipo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_treinamento_tipos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tipo excluído"); qc.invalidateQueries({ queryKey: ["rh_treinamento_tipos"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTreinamentos() {
  return useQuery({
    queryKey: ["rh_treinamentos"],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_treinamentos").select("*").order("data_realizacao", { ascending: false }).limit(2000);
      if (error) throw error;
      return (data ?? []) as Treinamento[];
    },
  });
}
export function useTreinamento(id?: string) {
  return useQuery({
    queryKey: ["rh_treinamento", id],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_treinamentos").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Treinamento | null;
    },
    enabled: !!id,
  });
}
export function useSaveTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Treinamento> & { id?: string }) => {
      const body = { ...payload };
      if (body.id) {
        const { error } = await sb.from("rh_treinamentos").update(body).eq("id", body.id);
        if (error) throw error;
        return body.id;
      } else {
        const { data, error } = await sb.from("rh_treinamentos").insert(body).select("id").single();
        if (error) throw error;
        return (data as { id: string }).id;
      }
    },
    onSuccess: (id) => {
      toast.success("Treinamento salvo");
      qc.invalidateQueries({ queryKey: ["rh_treinamentos"] });
      if (id) qc.invalidateQueries({ queryKey: ["rh_treinamento", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useDeleteTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("rh_treinamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Treinamento excluído"); qc.invalidateQueries({ queryKey: ["rh_treinamentos"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTreinamentoParticipantes(treinamentoId?: string) {
  return useQuery({
    queryKey: ["rh_treinamento_participantes", treinamentoId],
    queryFn: async () => {
      const { data, error } = await sb.from("rh_treinamento_participantes").select("*").eq("treinamento_id", treinamentoId);
      if (error) throw error;
      return (data ?? []) as TreinamentoParticipante[];
    },
    enabled: !!treinamentoId,
  });
}
export function useColaboradorTreinamentos(colaboradorId?: string) {
  return useQuery({
    queryKey: ["rh_colaborador_treinamentos", colaboradorId],
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_treinamento_participantes")
        .select("*, treinamento:rh_treinamentos(*)")
        .eq("colaborador_id", colaboradorId);
      if (error) throw error;
      return (data ?? []) as (TreinamentoParticipante & { treinamento: Treinamento })[];
    },
    enabled: !!colaboradorId,
  });
}
export function useAddParticipantes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ treinamento_id, colaborador_ids }: { treinamento_id: string; colaborador_ids: string[] }) => {
      if (colaborador_ids.length === 0) return;
      const rows = colaborador_ids.map((cid) => ({ treinamento_id, colaborador_id: cid, presente: true }));
      const { error } = await sb.from("rh_treinamento_participantes").upsert(rows, { onConflict: "treinamento_id,colaborador_id" });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success("Participantes vinculados");
      qc.invalidateQueries({ queryKey: ["rh_treinamento_participantes", v.treinamento_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useRemoveParticipante() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; treinamento_id: string }) => {
      const { error } = await sb.from("rh_treinamento_participantes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success("Participante removido");
      qc.invalidateQueries({ queryKey: ["rh_treinamento_participantes", v.treinamento_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function computeTrainingStatus(t: { data_validade: string | null } | undefined): "ok" | "expiring" | "expired" | "missing" {
  if (!t) return "missing";
  if (!t.data_validade) return "ok";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const venc = new Date(t.data_validade);
  const diff = Math.floor((venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring";
  return "ok";
}