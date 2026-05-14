ALTER TABLE public.valor_hora_config
  ADD COLUMN IF NOT EXISTS valor_hora_fds NUMERIC,
  ADD COLUMN IF NOT EXISTS taxa_fixa_emergencial NUMERIC,
  ADD COLUMN IF NOT EXISTS aplica_taxa_emergencial BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS task_types_emergenciais TEXT;