ALTER TABLE public.rh_integrations
  ADD COLUMN IF NOT EXISTS abrangencia text NOT NULL DEFAULT 'exclusiva',
  ADD COLUMN IF NOT EXISTS nome text;

CREATE TABLE IF NOT EXISTS public.rh_integration_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.rh_integrations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.rh_clientes(id) ON DELETE CASCADE,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_integration_clients TO authenticated;
GRANT ALL ON public.rh_integration_clients TO service_role;

ALTER TABLE public.rh_integration_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view shared integration clients"
ON public.rh_integration_clients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can manage shared integration clients"
ON public.rh_integration_clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_rh_integration_clients_client ON public.rh_integration_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_rh_integration_clients_integration ON public.rh_integration_clients(integration_id);

CREATE TRIGGER trg_rh_integration_clients_updated_at
BEFORE UPDATE ON public.rh_integration_clients
FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();