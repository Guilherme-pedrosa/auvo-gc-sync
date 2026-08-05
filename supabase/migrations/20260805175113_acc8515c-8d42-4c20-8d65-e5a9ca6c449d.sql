ALTER TABLE public.rh_integrations
  ADD COLUMN IF NOT EXISTS ressalva boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ressalva_motivo text;