CREATE TABLE IF NOT EXISTS public.premiacao_os_detalhe_cache (
  gc_os_id text PRIMARY KEY,
  detalhe jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.premiacao_os_detalhe_cache TO authenticated;
GRANT ALL ON public.premiacao_os_detalhe_cache TO service_role;
ALTER TABLE public.premiacao_os_detalhe_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read premiacao os cache"
ON public.premiacao_os_detalhe_cache FOR SELECT TO authenticated USING (true);