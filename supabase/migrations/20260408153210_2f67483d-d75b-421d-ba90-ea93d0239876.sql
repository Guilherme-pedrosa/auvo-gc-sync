ALTER TABLE public.equipamentos_auvo 
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS marca_source TEXT,
  ADD COLUMN IF NOT EXISTS marca_manual_override BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_equipamentos_marca ON public.equipamentos_auvo (marca);