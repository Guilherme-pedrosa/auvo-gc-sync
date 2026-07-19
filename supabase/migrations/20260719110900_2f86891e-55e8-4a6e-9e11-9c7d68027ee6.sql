
-- 1) Sync function: propagate med_aso dates to linked rh_colaborador_docs
CREATE OR REPLACE FUNCTION public.med_aso_sync_prontuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.documento_id IS NOT NULL THEN
    UPDATE public.rh_colaborador_docs
       SET data_emissao   = NEW.data_emissao,
           data_vencimento = NEW.data_validade
     WHERE id = NEW.documento_id
       AND (
         data_emissao IS DISTINCT FROM NEW.data_emissao
         OR data_vencimento IS DISTINCT FROM NEW.data_validade
       );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_med_aso_sync_prontuario ON public.med_aso;
CREATE TRIGGER trg_med_aso_sync_prontuario
AFTER INSERT OR UPDATE OF data_emissao, data_validade, documento_id
ON public.med_aso
FOR EACH ROW EXECUTE FUNCTION public.med_aso_sync_prontuario();

-- 2) Backfill: sync existing med_aso rows into their linked rh_colaborador_docs
UPDATE public.rh_colaborador_docs d
   SET data_emissao   = a.data_emissao,
       data_vencimento = a.data_validade
  FROM public.med_aso a
 WHERE a.documento_id = d.id
   AND (
     d.data_emissao IS DISTINCT FROM a.data_emissao
     OR d.data_vencimento IS DISTINCT FROM a.data_validade
   );
