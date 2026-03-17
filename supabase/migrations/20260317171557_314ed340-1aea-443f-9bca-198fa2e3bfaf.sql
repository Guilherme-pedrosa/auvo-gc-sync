
ALTER TABLE public.tarefas_central
ADD COLUMN IF NOT EXISTS equipamento_nome text,
ADD COLUMN IF NOT EXISTS equipamento_id_serie text;
