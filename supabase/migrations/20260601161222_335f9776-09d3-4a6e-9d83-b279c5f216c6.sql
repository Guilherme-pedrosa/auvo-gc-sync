-- Add 'cliente' value to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cliente';

-- Add grupo_id to profiles to link a client-portal user to one client group
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES public.grupos_clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_grupo_id ON public.profiles(grupo_id);