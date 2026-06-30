DROP TRIGGER IF EXISTS trg_ppi_updated ON public.plano_preventivo_item;
CREATE OR REPLACE FUNCTION public.set_plano_preventivo_item_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ppi_updated
BEFORE UPDATE ON public.plano_preventivo_item
FOR EACH ROW
EXECUTE FUNCTION public.set_plano_preventivo_item_updated_at();