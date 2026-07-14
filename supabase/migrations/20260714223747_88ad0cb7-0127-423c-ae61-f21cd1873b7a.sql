
CREATE TABLE public.rh_document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('COMPANY','TECHNICIAN','CLIENT')),
  requires_expiry boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_document_types TO authenticated;
GRANT ALL ON public.rh_document_types TO service_role;
ALTER TABLE public.rh_document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_doc_types_read" ON public.rh_document_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_doc_types_admin_write" ON public.rh_document_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.rh_document_types (code, name, scope, requires_expiry) VALUES
  ('ASO','ASO - Atestado de Saúde Ocupacional','TECHNICIAN', true),
  ('NR10','NR-10 - Segurança em Instalações Elétricas','TECHNICIAN', true),
  ('NR35','NR-35 - Trabalho em Altura','TECHNICIAN', true),
  ('NR33','NR-33 - Espaço Confinado','TECHNICIAN', true),
  ('CNH','CNH','TECHNICIAN', true),
  ('FICHA_REGISTRO','Ficha de Registro','TECHNICIAN', false),
  ('CONTRATO_SOCIAL','Contrato Social','COMPANY', false),
  ('CERTIFICADO_NR','Certificado NR','COMPANY', true),
  ('ALVARA','Alvará','COMPANY', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.rh_company_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_id uuid NOT NULL REFERENCES public.rh_document_types(id) ON DELETE RESTRICT,
  numero text,
  data_emissao date,
  data_vencimento date,
  arquivo_url text,
  arquivo_nome text,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_company_documents TO authenticated;
GRANT ALL ON public.rh_company_documents TO service_role;
ALTER TABLE public.rh_company_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_company_docs_read" ON public.rh_company_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_company_docs_admin_write" ON public.rh_company_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rh_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_cliente_id text UNIQUE,
  nome text NOT NULL,
  nome_normalizado text NOT NULL UNIQUE,
  nome_fantasia text,
  cpf_cnpj text,
  email text,
  telefone text,
  endereco text,
  cidade text,
  uf text,
  cep text,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'cache' CHECK (origem IN ('cache','gc','manual')),
  sync_em timestamptz,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_clientes TO authenticated;
GRANT ALL ON public.rh_clientes TO service_role;
ALTER TABLE public.rh_clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_clientes_read" ON public.rh_clientes FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_clientes_admin_write" ON public.rh_clientes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.rh_clientes (nome, nome_normalizado, origem)
SELECT DISTINCT
  btrim(dados->>'cliente'),
  lower(regexp_replace(btrim(dados->>'cliente'), '\s+', ' ', 'g')),
  'cache'
FROM public.followup_kanban_cache
WHERE dados->>'cliente' IS NOT NULL AND btrim(dados->>'cliente') <> ''
ON CONFLICT (nome_normalizado) DO NOTHING;

CREATE TABLE public.rh_colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_pessoa text NOT NULL DEFAULT 'PF' CHECK (tipo_pessoa IN ('PF','PJ')),
  nome text NOT NULL,
  nome_fantasia text,
  cpf_cnpj text,
  email text,
  telefone text,
  cargo text,
  funcao text,
  departamento text,
  ativo boolean NOT NULL DEFAULT true,
  auvo_user_id text,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_colaboradores TO authenticated;
GRANT ALL ON public.rh_colaboradores TO service_role;
ALTER TABLE public.rh_colaboradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_colab_read" ON public.rh_colaboradores FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_colab_admin_write" ON public.rh_colaboradores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rh_colaborador_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.rh_colaboradores(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.rh_document_types(id) ON DELETE RESTRICT,
  tipo_customizado text,
  data_emissao date,
  data_vencimento date,
  arquivo_url text,
  arquivo_nome text,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(colaborador_id, document_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_colaborador_docs TO authenticated;
GRANT ALL ON public.rh_colaborador_docs TO service_role;
ALTER TABLE public.rh_colaborador_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_colab_docs_read" ON public.rh_colaborador_docs FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_colab_docs_admin_write" ON public.rh_colaborador_docs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rh_client_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.rh_clientes(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.rh_document_types(id) ON DELETE RESTRICT,
  required_for text NOT NULL CHECK (required_for IN ('COMPANY','TECHNICIAN')),
  is_required boolean NOT NULL DEFAULT true,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, document_type_id, required_for)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_client_requirements TO authenticated;
GRANT ALL ON public.rh_client_requirements TO service_role;
ALTER TABLE public.rh_client_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_req_read" ON public.rh_client_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_req_admin_write" ON public.rh_client_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rh_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.rh_clientes(id) ON DELETE CASCADE,
  technician_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','authorized','sent','blocked','expired')),
  validated_at timestamptz,
  sent_at timestamptz,
  earliest_expiry_date date,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  zip_file_name text,
  zip_url text,
  observacoes text,
  criado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_integrations TO authenticated;
GRANT ALL ON public.rh_integrations TO service_role;
ALTER TABLE public.rh_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_int_read" ON public.rh_integrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_int_admin_write" ON public.rh_integrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rh_integration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES public.rh_integrations(id) ON DELETE CASCADE,
  action text NOT NULL,
  detalhes jsonb,
  user_id uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rh_integration_audit TO authenticated;
GRANT ALL ON public.rh_integration_audit TO service_role;
ALTER TABLE public.rh_integration_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_audit_read" ON public.rh_integration_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "rh_audit_insert" ON public.rh_integration_audit FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rh_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

CREATE TRIGGER rh_doc_types_upd BEFORE UPDATE ON public.rh_document_types
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_company_docs_upd BEFORE UPDATE ON public.rh_company_documents
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_clientes_upd BEFORE UPDATE ON public.rh_clientes
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_colab_upd BEFORE UPDATE ON public.rh_colaboradores
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_colab_docs_upd BEFORE UPDATE ON public.rh_colaborador_docs
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_req_upd BEFORE UPDATE ON public.rh_client_requirements
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();
CREATE TRIGGER rh_int_upd BEFORE UPDATE ON public.rh_integrations
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

CREATE POLICY "rh_docs_bucket_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rh-documentos');
CREATE POLICY "rh_docs_bucket_admin_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rh-documentos' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh_docs_bucket_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'rh-documentos' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh_docs_bucket_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rh-documentos' AND public.has_role(auth.uid(),'admin'));
