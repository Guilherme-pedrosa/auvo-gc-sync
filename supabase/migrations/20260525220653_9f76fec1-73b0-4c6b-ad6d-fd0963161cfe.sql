
CREATE TABLE public.metas_tecnicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_tecnico text NOT NULL UNIQUE,
  meta_faturamento numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metas_tecnicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_metas_tec ON public.metas_tecnicos FOR SELECT TO anon USING (true);
CREATE POLICY auth_all_metas_tec ON public.metas_tecnicos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY service_all_metas_tec ON public.metas_tecnicos FOR ALL TO service_role USING (true) WITH CHECK (true);
