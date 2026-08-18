-- O card verde continua sendo uma previsão interna da agenda. Mesmo quando o
-- slot já foi cumprido no mês, o usuário pode reposicionar ou remover somente
-- essa apresentação; contratos_visitas_execucoes permanece como auditoria.

CREATE OR REPLACE FUNCTION public.mover_previsao_visita_contratual(
  p_agendamento_id uuid,
  p_data date,
  p_colaborador_id uuid,
  p_colaborador_nome text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agenda public.agenda_agendamentos%ROWTYPE;
  v_afetadas integer := 0;
BEGIN
  SELECT * INTO v_agenda
  FROM public.agenda_agendamentos
  WHERE id = p_agendamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previsão contratual não encontrada';
  END IF;
  IF v_agenda.origem <> 'CONTRATO'
     OR v_agenda.previsao_tipo <> 'CONTRATO'
     OR v_agenda.contrato_visita_config_id IS NULL
     OR v_agenda.contrato_visita_competencia IS NULL
     OR v_agenda.contrato_visita_numero IS NULL THEN
    RAISE EXCEPTION 'O registro informado não é uma previsão contratual';
  END IF;
  IF p_data IS NULL OR p_colaborador_id IS NULL OR NULLIF(trim(p_colaborador_nome), '') IS NULL THEN
    RAISE EXCEPTION 'Data e técnico são obrigatórios';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_agendamentos destino
    WHERE destino.id <> v_agenda.id
      AND destino.origem = 'CONTRATO'
      AND destino.previsao_tipo = 'CONTRATO'
      AND destino.contrato_visita_config_id = v_agenda.contrato_visita_config_id
      AND destino.contrato_visita_competencia = v_agenda.contrato_visita_competencia
      AND destino.contrato_visita_numero = v_agenda.contrato_visita_numero
      AND destino.colaborador_id = p_colaborador_id
  ) THEN
    RAISE EXCEPTION 'Este técnico já possui o card desta visita contratual';
  END IF;

  DELETE FROM public.agenda_contrato_visita_exclusoes
  WHERE contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND contrato_visita_competencia
        = date_trunc('month', v_agenda.contrato_visita_competencia::date)::date
    AND contrato_visita_numero = v_agenda.contrato_visita_numero;

  UPDATE public.agenda_agendamentos agenda
  SET contrato_visita_ajuste_manual = true
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND agenda.contrato_visita_competencia = v_agenda.contrato_visita_competencia
    AND agenda.contrato_visita_numero = v_agenda.contrato_visita_numero;

  UPDATE public.agenda_agendamentos
  SET data = p_data,
      colaborador_id = p_colaborador_id,
      colaborador_nome = trim(p_colaborador_nome),
      contrato_visita_ajuste_manual = true
  WHERE id = p_agendamento_id;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.mover_previsao_visita_contratual(uuid, date, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mover_previsao_visita_contratual(uuid, date, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.excluir_previsao_visita_contratual(
  p_agendamento_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agenda public.agenda_agendamentos%ROWTYPE;
  v_afetadas integer := 0;
BEGIN
  SELECT * INTO v_agenda
  FROM public.agenda_agendamentos
  WHERE id = p_agendamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previsão contratual não encontrada';
  END IF;
  IF v_agenda.origem <> 'CONTRATO'
     OR v_agenda.previsao_tipo <> 'CONTRATO'
     OR v_agenda.contrato_visita_config_id IS NULL
     OR v_agenda.contrato_visita_competencia IS NULL
     OR v_agenda.contrato_visita_numero IS NULL THEN
    RAISE EXCEPTION 'O registro informado não é uma previsão contratual';
  END IF;

  INSERT INTO public.agenda_contrato_visita_exclusoes (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero,
    excluido_por,
    excluido_em
  ) VALUES (
    v_agenda.contrato_visita_config_id,
    date_trunc('month', v_agenda.contrato_visita_competencia::date)::date,
    v_agenda.contrato_visita_numero,
    auth.uid(),
    now()
  )
  ON CONFLICT (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero
  ) DO UPDATE
  SET excluido_por = EXCLUDED.excluido_por,
      excluido_em = EXCLUDED.excluido_em;

  PERFORM set_config('app.excluir_previsao_contratual', 'on', true);

  -- Remove somente o card e suas cópias por técnico. A execução real fica em
  -- contratos_visitas_execucoes e continua alimentando horas/visitas do mês.
  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND agenda.contrato_visita_competencia = v_agenda.contrato_visita_competencia
    AND agenda.contrato_visita_numero = v_agenda.contrato_visita_numero;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_previsao_visita_contratual(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_previsao_visita_contratual(uuid)
  TO authenticated, service_role;

