
-- Kanban de Follow Up: orçamentos GC nas 5 situações configuradas, com colunas custom
-- e posição manual preservada (só remove se situação no GC mudar).

CREATE TABLE IF NOT EXISTS public.followup_kanban_colunas (
  id text PRIMARY KEY,
  titulo text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  eh_situacao boolean NOT NULL DEFAULT false,
  situacao_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.followup_kanban_cache (
  gc_orcamento_id text PRIMARY KEY,
  coluna text NOT NULL,
  posicao integer NOT NULL DEFAULT 0,
  situacao_id_origem text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_kanban_cache_coluna ON public.followup_kanban_cache(coluna, posicao);

ALTER TABLE public.followup_kanban_colunas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_kanban_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_followup_colunas ON public.followup_kanban_colunas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY service_all_followup_colunas ON public.followup_kanban_colunas FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY auth_all_followup_cache ON public.followup_kanban_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY service_all_followup_cache ON public.followup_kanban_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed das 5 colunas de situação (id da coluna = situacao_id do GC)
INSERT INTO public.followup_kanban_colunas (id, titulo, ordem, eh_situacao, situacao_id) VALUES
  ('7063588', 'Situação 7063588', 0, true, '7063588'),
  ('7063587', 'Situação 7063587', 1, true, '7063587'),
  ('7084340', 'Situação 7084340', 2, true, '7084340'),
  ('8757598', 'Situação 8757598', 3, true, '8757598'),
  ('7065899', 'Situação 7065899', 4, true, '7065899')
ON CONFLICT (id) DO NOTHING;
