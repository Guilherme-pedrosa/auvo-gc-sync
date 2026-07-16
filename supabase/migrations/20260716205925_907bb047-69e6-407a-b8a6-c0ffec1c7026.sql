
CREATE OR REPLACE FUNCTION public.rh_treinamentos_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.rh_treinamento_tipos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  validade_meses INT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_treinamento_tipos TO authenticated;
GRANT ALL ON public.rh_treinamento_tipos TO service_role;
ALTER TABLE public.rh_treinamento_tipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rh_treinamento_tipos" ON public.rh_treinamento_tipos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write rh_treinamento_tipos" ON public.rh_treinamento_tipos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rh_treinamento_tipos_updated BEFORE UPDATE ON public.rh_treinamento_tipos
  FOR EACH ROW EXECUTE FUNCTION public.rh_treinamentos_set_updated_at();

CREATE TABLE public.rh_treinamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_id UUID NOT NULL REFERENCES public.rh_treinamento_tipos(id) ON DELETE RESTRICT,
  titulo TEXT NOT NULL,
  data_realizacao DATE NOT NULL,
  data_validade DATE,
  instrutor TEXT,
  carga_horaria NUMERIC(6,2),
  local TEXT,
  observacoes TEXT,
  certificado_url TEXT,
  certificado_nome TEXT,
  lista_presenca_url TEXT,
  lista_presenca_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rh_treinamentos_tipo_idx ON public.rh_treinamentos(tipo_id);
CREATE INDEX rh_treinamentos_data_idx ON public.rh_treinamentos(data_realizacao DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_treinamentos TO authenticated;
GRANT ALL ON public.rh_treinamentos TO service_role;
ALTER TABLE public.rh_treinamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rh_treinamentos" ON public.rh_treinamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write rh_treinamentos" ON public.rh_treinamentos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rh_treinamentos_updated BEFORE UPDATE ON public.rh_treinamentos
  FOR EACH ROW EXECUTE FUNCTION public.rh_treinamentos_set_updated_at();

CREATE TABLE public.rh_treinamento_participantes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  treinamento_id UUID NOT NULL REFERENCES public.rh_treinamentos(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.rh_colaboradores(id) ON DELETE CASCADE,
  presente BOOLEAN NOT NULL DEFAULT true,
  certificado_url TEXT,
  certificado_nome TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(treinamento_id, colaborador_id)
);
CREATE INDEX rh_treinamento_participantes_colab_idx ON public.rh_treinamento_participantes(colaborador_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_treinamento_participantes TO authenticated;
GRANT ALL ON public.rh_treinamento_participantes TO service_role;
ALTER TABLE public.rh_treinamento_participantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rh_treinamento_participantes" ON public.rh_treinamento_participantes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write rh_treinamento_participantes" ON public.rh_treinamento_participantes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rh_treinamento_participantes_updated BEFORE UPDATE ON public.rh_treinamento_participantes
  FOR EACH ROW EXECUTE FUNCTION public.rh_treinamentos_set_updated_at();

INSERT INTO public.rh_treinamento_tipos (code, name, validade_meses) VALUES
  ('NR10', 'NR-10 — Segurança em Instalações Elétricas', 24),
  ('NR12', 'NR-12 — Segurança em Máquinas e Equipamentos', 24),
  ('NR35', 'NR-35 — Trabalho em Altura', 24),
  ('PRIMEIROS_SOCORROS', 'Primeiros Socorros', 12),
  ('INTEGRACAO_INTERNA', 'Integração Interna', NULL)
ON CONFLICT (code) DO NOTHING;
