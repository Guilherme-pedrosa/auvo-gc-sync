ALTER TABLE public.tarefas_central 
  ADD COLUMN IF NOT EXISTS data_conclusao date,
  ADD COLUMN IF NOT EXISTS deslocamento_inicio text,
  ADD COLUMN IF NOT EXISTS duracao_deslocamento numeric;