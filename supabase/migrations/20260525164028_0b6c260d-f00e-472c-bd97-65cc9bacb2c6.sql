ALTER TABLE public.contratos ALTER COLUMN grupo_id DROP NOT NULL;
ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS cliente_nome TEXT;
ALTER TABLE public.contratos DROP CONSTRAINT IF EXISTS contratos_grupo_ou_cliente_chk;
ALTER TABLE public.contratos ADD CONSTRAINT contratos_grupo_ou_cliente_chk CHECK (grupo_id IS NOT NULL OR (cliente_nome IS NOT NULL AND length(trim(cliente_nome)) > 0));