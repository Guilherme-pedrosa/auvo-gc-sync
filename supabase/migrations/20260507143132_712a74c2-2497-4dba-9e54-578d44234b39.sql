CREATE TABLE IF NOT EXISTS public.kanban_os_cache (
  gc_os_id text PRIMARY KEY,
  auvo_task_id text,
  coluna text NOT NULL DEFAULT 'col_agendado',
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.kanban_os_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kanban_os_cache'
      AND policyname = 'anon_all_os_cache'
  ) THEN
    CREATE POLICY "anon_all_os_cache"
    ON public.kanban_os_cache
    FOR ALL
    TO anon
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kanban_os_cache'
      AND policyname = 'auth_all_os_cache'
  ) THEN
    CREATE POLICY "auth_all_os_cache"
    ON public.kanban_os_cache
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kanban_os_cache'
      AND policyname = 'service_all_os_cache'
  ) THEN
    CREATE POLICY "service_all_os_cache"
    ON public.kanban_os_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kanban_os_cache_coluna_posicao
ON public.kanban_os_cache (coluna, posicao);

CREATE INDEX IF NOT EXISTS idx_kanban_os_cache_auvo_task_id
ON public.kanban_os_cache (auvo_task_id);
