CREATE TABLE public.orcamento_detalhe_cache (
  gc_orcamento_id text PRIMARY KEY,
  fingerprint text,
  orcamento jsonb NOT NULL DEFAULT '{}'::jsonb,
  tarefas jsonb NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.orcamento_detalhe_cache TO authenticated;
GRANT ALL ON public.orcamento_detalhe_cache TO service_role;

ALTER TABLE public.orcamento_detalhe_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_orcamento_detalhe_cache"
  ON public.orcamento_detalhe_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_all_orcamento_detalhe_cache"
  ON public.orcamento_detalhe_cache
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);