-- A execução cumpre o slot mensal correspondente, mas não desloca o card da
-- data em que a visita contratual estava programada.

CREATE OR REPLACE FUNCTION public.anotar_execucao_no_card_programado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exec public.contratos_visitas_execucoes%ROWTYPE;
  v_horas_contratadas numeric := 0;
  v_horas_consumidas numeric := 0;
  v_horas_disponiveis numeric := 0;
BEGIN
  IF NEW.origem <> 'CONTRATO'
     OR NEW.previsao_tipo <> 'CONTRATO'
     OR NEW.contrato_visita_config_id IS NULL
     OR NEW.contrato_visita_competencia IS NULL
     OR NEW.contrato_visita_numero IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT execucao.*
  INTO v_exec
  FROM public.contratos_visitas_execucoes execucao
  WHERE execucao.contrato_visita_config_id = NEW.contrato_visita_config_id
    AND execucao.competencia = date_trunc('month', NEW.contrato_visita_competencia::date)::date
    AND execucao.visita_numero = NEW.contrato_visita_numero
  ORDER BY execucao.atualizado_em DESC NULLS LAST, execucao.criado_em DESC NULLS LAST
  LIMIT 1;

  IF v_exec.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(contrato.horas_mes_contratadas, 0),
    COALESCE(sum(execucao.horas_trabalhadas), 0)
  INTO v_horas_contratadas, v_horas_consumidas
  FROM public.contratos_visitas_config config
  JOIN public.contratos contrato ON contrato.id = config.contrato_id
  LEFT JOIN public.contratos_visitas_execucoes execucao
    ON execucao.contrato_visita_config_id = config.id
   AND execucao.competencia = v_exec.competencia
  WHERE config.id = NEW.contrato_visita_config_id
  GROUP BY contrato.horas_mes_contratadas;

  v_horas_disponiveis := GREATEST(v_horas_contratadas - v_horas_consumidas, 0);

  -- Data, horário, colaborador e duração original do calendário são mantidos.
  NEW.status := 'CUMPRIDA_NO_MES';
  NEW.previsao_continuidade := false;
  NEW.duracao_planejada_minutos := NULL;
  NEW.previsao_detalhes := format(
    'Visita já realizada neste mês em %s · %s horas disponíveis',
    to_char(v_exec.data_realizada, 'DD/MM/YYYY'),
    trim(to_char(v_horas_disponiveis, 'FM999990D00'))
  );
  NEW.contrato_visita_execucao_id := v_exec.id;
  NEW.contrato_visita_realizada_em := v_exec.data_realizada;
  NEW.contrato_visita_horas_realizadas := v_exec.horas_trabalhadas;
  NEW.contrato_visita_tarefa_ids := CASE
    WHEN cardinality(COALESCE(NEW.contrato_visita_tarefa_ids, '{}')) > 0
      THEN NEW.contrato_visita_tarefa_ids
    ELSE v_exec.tarefa_ids
  END;
  NEW.contrato_visita_tecnicos := CASE
    WHEN cardinality(COALESCE(NEW.contrato_visita_tecnicos, '{}')) > 0
      THEN NEW.contrato_visita_tecnicos
    ELSE v_exec.tecnicos
  END;
  NEW.contrato_visita_tarefas_detalhes := v_exec.tarefas_detalhes;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agenda_anotar_execucao_no_card_programado
  ON public.agenda_agendamentos;
CREATE TRIGGER trg_agenda_anotar_execucao_no_card_programado
  BEFORE INSERT OR UPDATE
  ON public.agenda_agendamentos
  FOR EACH ROW
  WHEN (NEW.origem = 'CONTRATO' AND NEW.previsao_tipo = 'CONTRATO')
  EXECUTE FUNCTION public.anotar_execucao_no_card_programado();

CREATE OR REPLACE FUNCTION public.materializar_card_visita_contratual(
  p_execucao_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exec public.contratos_visitas_execucoes%ROWTYPE;
  v_afetadas integer := 0;
BEGIN
  SELECT * INTO v_exec
  FROM public.contratos_visitas_execucoes
  WHERE id = p_execucao_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- O BEFORE trigger anota a execução. Este UPDATE deliberadamente não altera
  -- data, horário, colaborador nem o tipo programado do card.
  UPDATE public.agenda_agendamentos agenda
  SET atualizado_em = now()
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_exec.contrato_visita_config_id
    AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_exec.competencia
    AND agenda.contrato_visita_numero = v_exec.visita_numero;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.materializar_card_visita_contratual(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materializar_card_visita_contratual(uuid)
  TO service_role;

-- O abastecimento anual volta a gerar todos os slots nominais. Execuções já
-- reconhecidas são anexadas pelo trigger acima, em vez de suprimir o slot.
CREATE OR REPLACE FUNCTION public.reconciliar_previsoes_visitas_contratuais(
  p_config_id uuid,
  p_ano integer,
  p_data_corte date,
  p_duracao_minutos integer,
  p_linhas jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrato_id uuid;
  v_inseridas integer := 0;
  v_inicio date := make_date(p_ano, 1, 1);
  v_fim date := make_date(p_ano, 12, 31);
  v_inicio_competencia date := date_trunc('month', p_data_corte)::date;
  v_execucao_id uuid;
BEGIN
  IF p_ano < 2000 OR p_ano > 2200 OR p_data_corte < v_inicio OR p_data_corte > v_fim THEN
    RAISE EXCEPTION 'Ano ou data de corte invalidos';
  END IF;
  IF p_duracao_minutos < 1 OR p_duracao_minutos > 1440 THEN
    RAISE EXCEPTION 'Carga da visita invalida';
  END IF;
  IF jsonb_typeof(COALESCE(p_linhas, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Linhas do planejamento devem ser um array';
  END IF;

  SELECT contrato_id INTO v_contrato_id
  FROM public.contratos_visitas_config
  WHERE id = p_config_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuracao contratual nao encontrada'; END IF;

  -- Remove a apresentação antiga que havia sido deslocada para o dia real.
  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO_REALIZADO'
    AND agenda.contrato_visita_config_id = p_config_id
    AND agenda.data BETWEEN v_inicio_competencia AND v_fim;

  -- Preserva somente cards já alinhados a tarefas futuras/concretas. Os slots
  -- anuais livres são refeitos nas datas originais, mesmo quando já cumpridos.
  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = p_config_id
    AND agenda.data BETWEEN v_inicio_competencia AND v_fim
    AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) = 0;

  IF jsonb_array_length(COALESCE(p_linhas, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.agenda_agendamentos (
      data, hora_inicio, hora_fim, colaborador_id, colaborador_nome,
      cliente, descricao, status, origem, auvo_task_id, gc_os_codigo,
      gc_orcamento_codigo, previsao_continuidade, previsao_tipo,
      previsao_detalhes, contrato_id, contrato_visita_config_id,
      contrato_visita_competencia, contrato_visita_numero, criado_por,
      duracao_planejada_minutos
    )
    SELECT
      linha.data, linha.hora_inicio, linha.hora_fim, linha.colaborador_id,
      linha.colaborador_nome, linha.cliente, linha.descricao,
      'PREVISAO_CONTRATUAL', 'CONTRATO', NULL, NULL, NULL, true, 'CONTRATO',
      linha.previsao_detalhes, v_contrato_id, p_config_id,
      linha.contrato_visita_competencia::text, linha.contrato_visita_numero,
      linha.criado_por, p_duracao_minutos
    FROM jsonb_to_recordset(p_linhas) AS linha(
      data date,
      hora_inicio time,
      hora_fim time,
      colaborador_id uuid,
      colaborador_nome text,
      cliente text,
      descricao text,
      previsao_detalhes text,
      contrato_visita_competencia date,
      contrato_visita_numero integer,
      criado_por uuid
    )
    WHERE linha.data BETWEEN p_data_corte AND v_fim
      AND NOT EXISTS (
        SELECT 1
        FROM public.agenda_agendamentos alinhado
        WHERE alinhado.contrato_visita_config_id = p_config_id
          AND alinhado.contrato_visita_competencia::date = linha.contrato_visita_competencia
          AND alinhado.contrato_visita_numero = linha.contrato_visita_numero
          AND cardinality(COALESCE(alinhado.contrato_visita_tarefa_ids, '{}')) > 0
      );
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
  END IF;

  -- Também atualiza cards preservados que já existiam antes desta versão.
  FOR v_execucao_id IN
    SELECT execucao.id
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = p_config_id
      AND execucao.competencia BETWEEN v_inicio_competencia AND v_fim
  LOOP
    PERFORM public.materializar_card_visita_contratual(v_execucao_id);
  END LOOP;

  UPDATE public.contratos_visitas_config
  SET duracao_minutos = p_duracao_minutos,
      planejamento_pendente = false,
      planejamento_atualizado_em = now(),
      atualizado_em = now()
  WHERE id = p_config_id;

  RETURN v_inseridas;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_previsoes_visitas_contratuais(uuid, integer, date, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconciliar_previsoes_visitas_contratuais(uuid, integer, date, integer, jsonb)
  TO authenticated, service_role;

-- Anota imediatamente planejamentos já preservados; os antigos cards roxos
-- serão substituídos pelo próximo abastecimento mensal/anual.
UPDATE public.agenda_agendamentos agenda
SET atualizado_em = now()
WHERE agenda.origem = 'CONTRATO'
  AND agenda.previsao_tipo = 'CONTRATO'
  AND EXISTS (
    SELECT 1
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = agenda.contrato_visita_config_id
      AND execucao.competencia = date_trunc('month', agenda.contrato_visita_competencia::date)::date
      AND execucao.visita_numero = agenda.contrato_visita_numero
  );
