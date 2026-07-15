
-- 1) Cliente: prazo específico da integração (dias) + canal preferido
ALTER TABLE public.rh_clientes
  ADD COLUMN IF NOT EXISTS integration_validity_days integer,
  ADD COLUMN IF NOT EXISTS integration_send_channel text CHECK (integration_send_channel IN ('email','portal','presencial','outro'));

-- 2) Integrações: novos passos do fluxo
ALTER TABLE public.rh_integrations
  ADD COLUMN IF NOT EXISTS send_channel text CHECK (send_channel IN ('email','portal','presencial','outro')),
  ADD COLUMN IF NOT EXISTS docs_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by_technician_id uuid REFERENCES public.rh_colaboradores(id),
  ADD COLUMN IF NOT EXISTS integration_valid_until date,
  ADD COLUMN IF NOT EXISTS validity_days_snapshot integer;

-- 3) Atualiza whitelist de status para refletir os 4 passos
ALTER TABLE public.rh_integrations DROP CONSTRAINT IF EXISTS rh_integrations_status_check;
-- Backfill de status legados
UPDATE public.rh_integrations SET status = 'docs_enviados' WHERE status IN ('authorized','sent');
ALTER TABLE public.rh_integrations
  ADD CONSTRAINT rh_integrations_status_check
  CHECK (status IN ('draft','docs_enviados','docs_aceitos','agendada','realizada','bloqueada','expirada'));

-- 4) Trigger: calcula validade quando completed_at é definido
CREATE OR REPLACE FUNCTION public.rh_integration_compute_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.completed_at IS NOT NULL THEN
    SELECT COALESCE(NEW.validity_days_snapshot, c.integration_validity_days)
      INTO v_days
      FROM public.rh_clientes c
     WHERE c.id = NEW.client_id;

    IF v_days IS NOT NULL AND v_days > 0 THEN
      NEW.validity_days_snapshot := v_days;
      NEW.integration_valid_until := (NEW.completed_at::date + (v_days || ' days')::interval)::date;
    END IF;

    IF NEW.status IN ('draft','docs_enviados','docs_aceitos','agendada') THEN
      NEW.status := 'realizada';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rh_int_validity ON public.rh_integrations;
CREATE TRIGGER rh_int_validity
BEFORE INSERT OR UPDATE ON public.rh_integrations
FOR EACH ROW EXECUTE FUNCTION public.rh_integration_compute_validity();
