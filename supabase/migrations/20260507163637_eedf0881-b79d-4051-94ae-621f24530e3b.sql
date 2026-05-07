ALTER TABLE public.tarefas_central
ADD COLUMN IF NOT EXISTS gc_os_tarefa_os text;

CREATE INDEX IF NOT EXISTS idx_tarefas_central_gc_os_tarefa_os
ON public.tarefas_central (gc_os_tarefa_os)
WHERE gc_os_tarefa_os IS NOT NULL;