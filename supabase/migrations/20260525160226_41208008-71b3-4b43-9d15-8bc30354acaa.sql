
CREATE TABLE public.contratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  grupo_id uuid NOT NULL REFERENCES public.grupos_clientes(id) ON DELETE CASCADE,
  valor_hora numeric NOT NULL DEFAULT 0,
  taxa_comissao_servico numeric NOT NULL DEFAULT 0.15,
  vigencia_inicio date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contratos_grupo_id ON public.contratos(grupo_id);
CREATE INDEX idx_contratos_ativo ON public.contratos(ativo);

ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_contratos" ON public.contratos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_contratos" ON public.contratos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_all_contratos" ON public.contratos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_contratos_atualizado_em
  BEFORE UPDATE ON public.contratos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_os_revisao_atualizado_em();
