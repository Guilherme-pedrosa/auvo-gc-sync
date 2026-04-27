ALTER TABLE public.tarefas_central
ADD COLUMN IF NOT EXISTS mirror_key text;

UPDATE public.tarefas_central
SET mirror_key = auvo_task_id || '::os:' || COALESCE(gc_os_id, '') || '::orc:' || COALESCE(gc_orcamento_id, '')
WHERE mirror_key IS NULL OR mirror_key = '';

ALTER TABLE public.tarefas_central
ALTER COLUMN mirror_key SET NOT NULL;

ALTER TABLE public.tarefas_central
DROP CONSTRAINT IF EXISTS tarefas_central_pkey;

ALTER TABLE public.tarefas_central
ADD CONSTRAINT tarefas_central_pkey PRIMARY KEY (mirror_key);

CREATE INDEX IF NOT EXISTS idx_tarefas_central_auvo_task_id
ON public.tarefas_central (auvo_task_id);

CREATE INDEX IF NOT EXISTS idx_tarefas_central_gc_os_id
ON public.tarefas_central (gc_os_id);