CREATE TABLE IF NOT EXISTS public.kanban_custom_cache (
  auvo_task_id TEXT NOT NULL,
  config_id TEXT NOT NULL DEFAULT 'default',
  coluna TEXT NOT NULL DEFAULT 'a_fazer',
  posicao INTEGER NOT NULL DEFAULT 0,
  dados JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (auvo_task_id, config_id)
);

ALTER TABLE public.kanban_custom_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_custom_cache" ON public.kanban_custom_cache FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_custom_cache" ON public.kanban_custom_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_custom_cache" ON public.kanban_custom_cache FOR ALL TO service_role USING (true) WITH CHECK (true);