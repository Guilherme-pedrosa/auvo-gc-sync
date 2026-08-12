ALTER TABLE public.tarefas_central ADD COLUMN pausas JSONB;

COMMENT ON COLUMN public.tarefas_central.pausas IS 'Armazena lista de pausas detectadas no Auvo [{inicio: ISO, fim: ISO}]';