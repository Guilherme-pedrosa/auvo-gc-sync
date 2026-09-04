CREATE TABLE public.compras_chegadas_snapshot (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  gerado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  atualizando_desde TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.compras_chegadas_snapshot TO authenticated;
GRANT ALL ON public.compras_chegadas_snapshot TO service_role;

ALTER TABLE public.compras_chegadas_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read chegadas snapshot"
ON public.compras_chegadas_snapshot
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at_compras_chegadas()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_compras_chegadas_snapshot_updated_at
BEFORE UPDATE ON public.compras_chegadas_snapshot
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_compras_chegadas();