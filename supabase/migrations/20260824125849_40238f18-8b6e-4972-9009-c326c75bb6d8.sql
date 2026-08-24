CREATE TABLE public.premiacao_regras_config (
  id text PRIMARY KEY DEFAULT 'default',
  pct_pecas numeric NOT NULL DEFAULT 0.01,
  pct_servicos numeric NOT NULL DEFAULT 0.15,
  reducoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  bonus_telemetria jsonb NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.premiacao_regras_config TO authenticated;
GRANT ALL ON public.premiacao_regras_config TO service_role;

ALTER TABLE public.premiacao_regras_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "premiacao_regras_select" ON public.premiacao_regras_config
FOR SELECT TO authenticated USING (true);

CREATE POLICY "premiacao_regras_write" ON public.premiacao_regras_config
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.premiacao_regras_config (id, pct_pecas, pct_servicos, reducoes, bonus_telemetria)
VALUES (
  'default',
  0.01,
  0.15,
  '[{"km_min":0,"km_max":40,"pct":0.30},{"km_min":40,"km_max":65,"pct":0.25}]'::jsonb,
  '[{"km_total_min":800,"km_tel_min":150,"pct":0.03},{"km_total_min":2000,"km_tel_min":200,"pct":0.05}]'::jsonb
);