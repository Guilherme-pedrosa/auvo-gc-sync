ALTER TABLE public.rh_clientes
  ADD COLUMN IF NOT EXISTS portal_url text,
  ADD COLUMN IF NOT EXISTS portal_login text,
  ADD COLUMN IF NOT EXISTS portal_senha text;