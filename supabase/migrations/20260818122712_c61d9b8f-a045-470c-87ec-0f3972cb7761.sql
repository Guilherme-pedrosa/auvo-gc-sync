ALTER TABLE public.contratos_visitas_config
  ADD COLUMN IF NOT EXISTS meses_ativos integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7,8,9,10,11,12],
  ADD COLUMN IF NOT EXISTS regra_texto text;