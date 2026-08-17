ALTER TABLE tarefas_central ADD COLUMN IF NOT EXISTS outros_questionarios jsonb;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefas_central TO authenticated;
GRANT ALL ON public.tarefas_central TO service_role;