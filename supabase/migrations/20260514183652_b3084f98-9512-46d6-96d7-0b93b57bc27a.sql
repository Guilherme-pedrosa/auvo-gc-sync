ALTER TABLE public.tarefas_central
  ADD COLUMN IF NOT EXISTS task_type_id text;

CREATE INDEX IF NOT EXISTS idx_tarefas_central_task_type_id
  ON public.tarefas_central (task_type_id);