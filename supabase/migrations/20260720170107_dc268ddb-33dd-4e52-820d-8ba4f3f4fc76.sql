
-- Add months-based validity fields
ALTER TABLE public.rh_clientes 
  ADD COLUMN IF NOT EXISTS integration_validity_months integer;

ALTER TABLE public.rh_integrations 
  ADD COLUMN IF NOT EXISTS validity_months_snapshot integer;

-- Backfill months from existing days (round to nearest month)
UPDATE public.rh_clientes 
  SET integration_validity_months = GREATEST(1, ROUND(integration_validity_days::numeric / 30)::int)
  WHERE integration_validity_months IS NULL AND integration_validity_days IS NOT NULL;

UPDATE public.rh_integrations 
  SET validity_months_snapshot = GREATEST(1, ROUND(validity_days_snapshot::numeric / 30)::int)
  WHERE validity_months_snapshot IS NULL AND validity_days_snapshot IS NOT NULL;

-- Update compute function to use months (anniversary-based expiration)
CREATE OR REPLACE FUNCTION public.rh_integration_compute_validity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_months integer;
BEGIN
  IF NEW.completed_at IS NOT NULL THEN
    SELECT COALESCE(NEW.validity_months_snapshot, c.integration_validity_months)
      INTO v_months
      FROM public.rh_clientes c
     WHERE c.id = NEW.client_id;

    IF v_months IS NOT NULL AND v_months > 0 THEN
      NEW.validity_months_snapshot := v_months;
      NEW.integration_valid_until := (NEW.completed_at::date + make_interval(months => v_months))::date;
    END IF;

    IF NEW.status IN ('draft','docs_enviados','docs_aceitos','agendada') THEN
      NEW.status := 'realizada';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
