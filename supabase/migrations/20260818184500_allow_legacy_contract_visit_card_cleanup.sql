-- Permite que o abastecimento remova somente a apresentação roxa legada.
-- A execução auditável permanece em contratos_visitas_execucoes e passa a
-- anotar o card na data originalmente programada.
CREATE OR REPLACE FUNCTION public.proteger_card_visita_contratual_realizada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_execucao_id uuid;
BEGIN
  IF OLD.previsao_tipo = 'CONTRATO_REALIZADO' THEN
    RETURN OLD;
  END IF;

  IF OLD.origem IS DISTINCT FROM 'CONTRATO'
     OR OLD.contrato_visita_config_id IS NULL
     OR OLD.contrato_visita_competencia IS NULL
     OR OLD.contrato_visita_numero IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT execucao.id INTO v_execucao_id
  FROM public.contratos_visitas_execucoes execucao
  WHERE execucao.contrato_visita_config_id = OLD.contrato_visita_config_id
    AND execucao.competencia = date_trunc('month', OLD.contrato_visita_competencia::date)::date
    AND execucao.visita_numero = OLD.contrato_visita_numero
  LIMIT 1;

  IF v_execucao_id IS NOT NULL THEN
    PERFORM public.materializar_card_visita_contratual(v_execucao_id);
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;
