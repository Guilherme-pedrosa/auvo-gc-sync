CREATE OR REPLACE FUNCTION public.reconciliar_config_visita_contratual_agendada(p_cliente text, p_data date, p_config_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_config public.contratos_visitas_config%ROWTYPE;
  v_contrato public.contratos%ROWTYPE;
  v_competencia date := date_trunc('month', p_data)::date;
  v_contrato_coifa boolean;
  v_tarefa_ids text[] := '{}';
  v_tecnicos text[] := '{}';
  v_hora_inicio time;
  v_hora_fim time;
  v_visita_numero integer;
  v_numero_nominal_livre integer;
  v_inseridas integer := 0;
  v_extra boolean := false;
  v_detalhes text;
BEGIN
  SELECT * INTO v_config
  FROM public.contratos_visitas_config
  WHERE id = p_config_id AND ativo = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_contrato
  FROM public.contratos
  WHERE id = v_config.contrato_id AND ativo = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_contrato_coifa := public.contrato_e_limpeza_coifa(v_contrato.nome);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_config.id::text || ':' || p_data::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = v_config.id
      AND execucao.data_realizada = p_data
      AND public.clientes_rh_relacionados(execucao.cliente, p_cliente)
  ) THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    SELECT
      tarefa.*,
      row_number() OVER (
        PARTITION BY tarefa.auvo_task_id
        ORDER BY tarefa.atualizado_em DESC NULLS LAST, tarefa.criado_em DESC NULLS LAST
      ) AS position
    FROM public.tarefas_central tarefa
    WHERE tarefa.data_tarefa = p_data
      AND public.clientes_rh_relacionados(tarefa.cliente, p_cliente)
      AND NULLIF(regexp_replace(COALESCE(tarefa.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
  ), validas AS (
    SELECT *
    FROM ranked
    WHERE position = 1
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%cancel%'
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%exclu%'
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%pendente-vinculo%'
      AND NULLIF(trim(tecnico), '') IS NOT NULL
      AND public.atividade_e_limpeza_coifa(
        task_type_id, descricao, questionario_id, questionario_respostas
      ) = v_contrato_coifa
  )
  SELECT
    COALESCE(array_agg(auvo_task_id ORDER BY hora_inicio NULLS LAST, auvo_task_id), '{}'),
    COALESCE(array_agg(DISTINCT tecnico), '{}'),
    min(NULLIF(hora_inicio, '')::time),
    max(NULLIF(hora_fim, '')::time)
  INTO v_tarefa_ids, v_tecnicos, v_hora_inicio, v_hora_fim
  FROM validas;

  IF cardinality(v_tarefa_ids) = 0 THEN
    DELETE FROM public.agenda_agendamentos agenda
    WHERE agenda.origem = 'CONTRATO'
      AND agenda.previsao_tipo = 'CONTRATO'
      AND agenda.contrato_visita_config_id = v_config.id
      AND agenda.data = p_data
      AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) > 0;
    RETURN 0;
  END IF;

  SELECT min(agenda.contrato_visita_numero)
  INTO v_visita_numero
  FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_config.id
    AND agenda.data = p_data;

  SELECT numero
  INTO v_numero_nominal_livre
  FROM generate_series(1, v_config.qtd_visitas) numero
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = v_config.id
      AND execucao.competencia = v_competencia
      AND execucao.visita_numero = numero
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.agenda_agendamentos agenda
      WHERE agenda.contrato_visita_config_id = v_config.id
        AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
        AND agenda.contrato_visita_numero = numero
        AND agenda.data <> p_data
    )
  ORDER BY numero
  LIMIT 1;

  IF v_visita_numero > v_config.qtd_visitas AND v_numero_nominal_livre IS NOT NULL THEN
    v_visita_numero := v_numero_nominal_livre;
  END IF;

  IF v_visita_numero IS NULL THEN
    SELECT agenda.contrato_visita_numero
    INTO v_visita_numero
    FROM public.agenda_agendamentos agenda
    WHERE agenda.origem = 'CONTRATO'
      AND agenda.previsao_tipo = 'CONTRATO'
      AND agenda.contrato_visita_config_id = v_config.id
      AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
      AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.contratos_visitas_execucoes execucao
        WHERE execucao.contrato_visita_config_id = v_config.id
          AND execucao.competencia = v_competencia
          AND execucao.visita_numero = agenda.contrato_visita_numero
      )
    ORDER BY abs(agenda.data - p_data), agenda.contrato_visita_numero
    LIMIT 1;
  END IF;

  v_visita_numero := COALESCE(v_visita_numero, v_numero_nominal_livre);
  IF v_visita_numero IS NULL THEN
    SELECT COALESCE(max(numero), 0) + 1
    INTO v_visita_numero
    FROM (
      SELECT execucao.visita_numero AS numero
      FROM public.contratos_visitas_execucoes execucao
      WHERE execucao.contrato_visita_config_id = v_config.id
        AND execucao.competencia = v_competencia
      UNION ALL
      SELECT agenda.contrato_visita_numero
      FROM public.agenda_agendamentos agenda
      WHERE agenda.contrato_visita_config_id = v_config.id
        AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
        AND agenda.contrato_visita_numero IS NOT NULL
    ) numeros;
  END IF;

  v_extra := v_visita_numero > v_config.qtd_visitas;
  v_detalhes := format(
    '%s previstas · %s tarefa(s) agendada(s)%s',
    CASE
      WHEN v_config.duracao_minutos >= 60 THEN
        (v_config.duracao_minutos / 60)::text || 'h' ||
        CASE WHEN mod(v_config.duracao_minutos, 60) > 0
          THEN lpad(mod(v_config.duracao_minutos, 60)::text, 2, '0') ELSE '' END
      ELSE v_config.duracao_minutos::text || 'min'
    END,
    cardinality(v_tarefa_ids),
    CASE WHEN v_extra
      THEN CASE WHEN v_config.qtd_visitas = 1
        THEN ' · visita extra alem da 1 contratada'
        ELSE format(' · visita extra alem das %s contratadas', v_config.qtd_visitas)
      END
      ELSE '' END
  );

  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_config.id
    AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
    AND (
      agenda.contrato_visita_numero = v_visita_numero
      OR (
        agenda.data = p_data
        AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) > 0
      )
    );

  -- Um card contratual do mesmo cliente/dia/tecnico pode ter sobrado de outra
  -- competencia/numero e o indice unico parcial rejeitaria o INSERT, abortando
  -- toda a sincronizacao. Nesse caso o card existente e atualizado.
  WITH tecnicos_agendados AS (
    SELECT DISTINCT agenda.colaborador_id, agenda.colaborador_nome
    FROM public.agenda_agendamentos agenda
    WHERE agenda.auvo_task_id = ANY(v_tarefa_ids)
      AND agenda.colaborador_id IS NOT NULL
    UNION
    SELECT DISTINCT rh.id, rh.nome
    FROM unnest(v_tecnicos) tecnico(nome)
    JOIN public.rh_colaboradores rh
      ON public.normalizar_cliente_visita(rh.nome) = public.normalizar_cliente_visita(tecnico.nome)
      OR public.normalizar_cliente_visita(rh.nome) LIKE public.normalizar_cliente_visita(tecnico.nome) || '-%'
      OR public.normalizar_cliente_visita(tecnico.nome) LIKE public.normalizar_cliente_visita(rh.nome) || '-%'
    WHERE rh.ativo = true
  ), tecnicos_configurados AS (
    SELECT DISTINCT rh.id AS colaborador_id, rh.nome AS colaborador_nome
    FROM unnest(COALESCE(v_config.tecnico_ids, '{}'::uuid[])) tecnico_id
    JOIN public.rh_colaboradores rh ON rh.id = tecnico_id
    WHERE rh.ativo = true
  ), tecnicos_para_card AS (
    SELECT * FROM tecnicos_agendados
    UNION ALL
    SELECT * FROM tecnicos_configurados
    WHERE NOT EXISTS (SELECT 1 FROM tecnicos_agendados)
  ), tecnicos_unicos AS (
    SELECT DISTINCT ON (colaborador_id) colaborador_id, colaborador_nome
    FROM tecnicos_para_card
    ORDER BY colaborador_id, colaborador_nome
  )
  INSERT INTO public.agenda_agendamentos (
    data, hora_inicio, hora_fim, colaborador_id, colaborador_nome,
    cliente, descricao, status, origem, auvo_task_id,
    previsao_continuidade, previsao_tipo, previsao_detalhes,
    contrato_id, contrato_visita_config_id, contrato_visita_competencia,
    contrato_visita_numero, duracao_planejada_minutos,
    contrato_visita_tarefa_ids, contrato_visita_tecnicos
  )
  SELECT
    p_data,
    COALESCE(v_hora_inicio, v_config.hora_inicio),
    COALESCE(
      v_hora_fim,
      COALESCE(v_hora_inicio, v_config.hora_inicio)
        + make_interval(mins => GREATEST(v_config.duracao_minutos, 1))
    ),
    tecnico.colaborador_id,
    tecnico.colaborador_nome,
    p_cliente,
    'Visita contratual planejada a partir das tarefas Auvo',
    'PREVISAO_CONTRATUAL',
    'CONTRATO',
    NULL,
    true,
    'CONTRATO',
    v_detalhes,
    v_config.contrato_id,
    v_config.id,
    v_competencia,
    v_visita_numero,
    v_config.duracao_minutos,
    v_tarefa_ids,
    v_tecnicos
  FROM tecnicos_unicos tecnico
  ON CONFLICT (
    cliente, data,
    COALESCE(colaborador_id::text,''),
    COALESCE(contrato_visita_config_id::text,''),
    COALESCE(contrato_visita_execucao_id::text,'')
  ) WHERE origem = 'CONTRATO'
  DO UPDATE SET
    hora_inicio = EXCLUDED.hora_inicio,
    hora_fim = EXCLUDED.hora_fim,
    colaborador_nome = EXCLUDED.colaborador_nome,
    descricao = EXCLUDED.descricao,
    status = EXCLUDED.status,
    previsao_continuidade = EXCLUDED.previsao_continuidade,
    previsao_tipo = EXCLUDED.previsao_tipo,
    previsao_detalhes = EXCLUDED.previsao_detalhes,
    contrato_id = EXCLUDED.contrato_id,
    contrato_visita_competencia = EXCLUDED.contrato_visita_competencia,
    contrato_visita_numero = EXCLUDED.contrato_visita_numero,
    duracao_planejada_minutos = EXCLUDED.duracao_planejada_minutos,
    contrato_visita_tarefa_ids = EXCLUDED.contrato_visita_tarefa_ids,
    contrato_visita_tecnicos = EXCLUDED.contrato_visita_tecnicos;
  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  RETURN v_inseridas;
END;
$function$;