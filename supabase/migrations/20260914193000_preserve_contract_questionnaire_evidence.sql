-- A linha operacional escolhida para uma tarefa pode ser um espelho GC sem
-- questionario. Combine a evidencia Auvo antes de eliminar os espelhos, mas
-- contabilize somente uma duracao por tarefa. Cliente/dia continuam isolados.
-- A regra continua sendo questionario 215148 = coifa, 224444 = excluido.
-- Nome e tipo da tarefa nao substituem a evidencia do questionario.

CREATE OR REPLACE FUNCTION public.escopo_questionarios_visita(
  p_questionario_id text,
  p_questionario_respostas jsonb,
  p_outros_questionarios jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT public.atividade_e_limpeza_coifa(
    NULL, NULL, p_questionario_id,
    (CASE WHEN jsonb_typeof(p_questionario_respostas) = 'array'
      THEN p_questionario_respostas ELSE '[]'::jsonb END)
    || (CASE
      WHEN jsonb_typeof(p_outros_questionarios) = 'array' THEN p_outros_questionarios
      WHEN jsonb_typeof(p_outros_questionarios) = 'object' THEN jsonb_build_array(p_outros_questionarios)
      ELSE '[]'::jsonb END)
  );
$$;

CREATE OR REPLACE FUNCTION public.consolidar_escopos_visita(p_escopos boolean[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN array_position(p_escopos, NULL::boolean) IS NOT NULL THEN NULL::boolean
    ELSE COALESCE(true = ANY(p_escopos), false)
  END;
$$;

COMMENT ON FUNCTION public.escopo_questionarios_visita(text, jsonb, jsonb) IS
  'Usa questionario principal, respostas e outros_questionarios; 224444 sempre exclui.';
COMMENT ON FUNCTION public.consolidar_escopos_visita(boolean[]) IS
  'Combina evidencia dos espelhos da mesma tarefa: exclusao prevalece, depois coifa.';

REVOKE ALL ON FUNCTION public.escopo_questionarios_visita(text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidar_escopos_visita(boolean[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.escopo_questionarios_visita(text, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consolidar_escopos_visita(boolean[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconciliar_dia_visita_contratual(
  p_cliente text,
  p_data date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_chave text := public.cliente_rh_chave(p_cliente);
  v_competencia date := date_trunc('month', p_data)::date;
  v_candidate record;
  v_obsoleta record;
  v_cliente text;
  v_horas numeric(12,4);
  v_tarefa_ids text[];
  v_tecnicos text[];
  v_detalhes jsonb;
  v_execucao_id uuid;
  v_ultima_execucao_id uuid;
  v_execucoes_selecionadas uuid[] := '{}';
  v_visita_numero integer;
BEGIN
  IF p_data IS NULL OR length(v_cliente_chave) < 3 THEN
    RETURN NULL;
  END IF;

  -- Escolhe no maximo um contrato de cada escopo para o cliente/dia. Quando
  -- ha mais de um, a previsao mais proxima continua sendo o desempate.
  FOR v_candidate IN
    WITH ranked AS (
      SELECT
        tarefa.*,
        public.consolidar_escopos_visita(
          array_agg(public.escopo_questionarios_visita(
            tarefa.questionario_id, tarefa.questionario_respostas, tarefa.outros_questionarios
          )) OVER (PARTITION BY tarefa.auvo_task_id)
        ) AS escopo_coifa,
        row_number() OVER (
          PARTITION BY tarefa.auvo_task_id
          ORDER BY
            (tarefa.check_out IS TRUE) DESC,
            (tarefa.data_conclusao IS NOT NULL) DESC,
            (COALESCE(tarefa.duracao_decimal, 0) > 0) DESC,
            tarefa.atualizado_em DESC NULLS LAST,
            tarefa.criado_em DESC NULLS LAST
        ) AS position
      FROM public.tarefas_central tarefa
      WHERE tarefa.data_tarefa = p_data
        AND public.clientes_rh_relacionados(tarefa.cliente, p_cliente)
        AND NULLIF(regexp_replace(COALESCE(tarefa.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
    ), realizadas AS (
      SELECT *
      FROM ranked
      WHERE position = 1
        AND COALESCE(duracao_decimal, 0) > 0
        AND (
          check_out IS TRUE
          OR data_conclusao IS NOT NULL
          OR public.normalizar_cliente_visita(status_auvo) LIKE '%finaliz%'
          OR public.normalizar_cliente_visita(status_auvo) LIKE '%conclu%'
        )
        AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%pendente-vinculo%'
    ), candidates AS (
      SELECT
        cfg.id AS config_id,
        c.id AS contrato_id,
        EXISTS (
          SELECT 1 FROM public.contratos_visitas_execucoes existente
          WHERE existente.contrato_visita_config_id = cfg.id
            AND existente.data_realizada = p_data
            AND public.clientes_rh_relacionados(existente.cliente, p_cliente)
        ) AS possui_execucao,
        public.contrato_e_limpeza_coifa(c.nome) AS contrato_coifa,
        planned.visita_numero AS visita_planejada,
        COALESCE(planned.distancia_dias, 9999) AS distancia_dias,
        GREATEST(COALESCE(c.horas_mes_contratadas, 0) - COALESCE(performed.horas, 0), 0) AS horas_restantes,
        cfg.atualizado_em
      FROM public.contratos_visitas_config cfg
      JOIN public.contratos c ON c.id = cfg.contrato_id
      LEFT JOIN LATERAL (
        SELECT
          agenda.contrato_visita_numero AS visita_numero,
          min(abs(agenda.data - p_data)) AS distancia_dias
        FROM public.agenda_agendamentos agenda
        WHERE agenda.origem = 'CONTRATO'
          AND agenda.previsao_tipo = 'CONTRATO'
          AND agenda.contrato_visita_config_id = cfg.id
          AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
          AND agenda.contrato_visita_numero IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.contratos_visitas_execucoes done
            WHERE done.contrato_visita_config_id = cfg.id
              AND done.competencia = v_competencia
              AND done.visita_numero = agenda.contrato_visita_numero
          )
        GROUP BY agenda.contrato_visita_numero
        ORDER BY min(abs(agenda.data - p_data)), agenda.contrato_visita_numero
        LIMIT 1
      ) planned ON true
      LEFT JOIN LATERAL (
        SELECT sum(done.horas_trabalhadas) AS horas
        FROM public.contratos_visitas_execucoes done
        WHERE done.contrato_visita_config_id = cfg.id
          AND done.competencia = v_competencia
      ) performed ON true
      WHERE cfg.ativo = true
        AND c.ativo = true
        AND COALESCE(c.horas_mes_contratadas, 0) > 0
        AND (c.vigencia_inicio IS NULL OR p_data >= c.vigencia_inicio)
        AND (c.vigencia_fim IS NULL OR p_data <= c.vigencia_fim)
        AND (
          public.clientes_rh_relacionados(c.cliente_nome, p_cliente)
          OR EXISTS (
            SELECT 1
            FROM public.grupo_cliente_membros membro
            WHERE membro.grupo_id = c.grupo_id
              AND public.clientes_rh_relacionados(membro.cliente_nome, p_cliente)
          )
        )
        AND EXISTS (
          SELECT 1
          FROM realizadas tarefa
          WHERE tarefa.escopo_coifa
            = public.contrato_e_limpeza_coifa(c.nome)
        )
    )
    SELECT DISTINCT ON (contrato_coifa) *
    FROM candidates
    -- Uma execucao ja apropriada a um contrato ainda valido tem prioridade.
    -- Sem isso, a previsao cumprida sai de "planned" e outra configuracao do
    -- mesmo escopo rouba a tarefa a cada nova sincronizacao.
    ORDER BY contrato_coifa,
             possui_execucao DESC,
             (visita_planejada IS NOT NULL) DESC,
             distancia_dias,
             horas_restantes DESC,
             atualizado_em DESC,
             config_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_candidate.config_id::text || ':' || p_data::text, 0)
    );

    WITH ranked AS (
      SELECT
        tarefa.*,
        public.consolidar_escopos_visita(
          array_agg(public.escopo_questionarios_visita(
            tarefa.questionario_id, tarefa.questionario_respostas, tarefa.outros_questionarios
          )) OVER (PARTITION BY tarefa.auvo_task_id)
        ) AS escopo_coifa,
        row_number() OVER (
          PARTITION BY tarefa.auvo_task_id
          ORDER BY
            (tarefa.check_out IS TRUE) DESC,
            (tarefa.data_conclusao IS NOT NULL) DESC,
            (COALESCE(tarefa.duracao_decimal, 0) > 0) DESC,
            tarefa.atualizado_em DESC NULLS LAST,
            tarefa.criado_em DESC NULLS LAST
        ) AS position
      FROM public.tarefas_central tarefa
      WHERE tarefa.data_tarefa = p_data
        AND public.clientes_rh_relacionados(tarefa.cliente, p_cliente)
        AND NULLIF(regexp_replace(COALESCE(tarefa.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
    ), realizadas AS (
      SELECT *
      FROM ranked
      WHERE position = 1
        AND COALESCE(duracao_decimal, 0) > 0
        AND (
          check_out IS TRUE
          OR data_conclusao IS NOT NULL
          OR public.normalizar_cliente_visita(status_auvo) LIKE '%finaliz%'
          OR public.normalizar_cliente_visita(status_auvo) LIKE '%conclu%'
        )
        AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%pendente-vinculo%'
        AND escopo_coifa = v_candidate.contrato_coifa
    )
    SELECT
      max(cliente),
      round(sum(COALESCE(duracao_decimal, 0))::numeric, 4),
      array_agg(auvo_task_id ORDER BY check_in_iso NULLS LAST, auvo_task_id),
      array_agg(DISTINCT tecnico) FILTER (WHERE NULLIF(trim(tecnico), '') IS NOT NULL),
      jsonb_agg(
        jsonb_build_object(
          'tarefa_id', auvo_task_id,
          'tecnico', tecnico,
          'horas', round(COALESCE(duracao_decimal, 0)::numeric, 4),
          'descricao', descricao,
          'os', gc_os_codigo,
          'check_in', check_in_iso,
          'check_out', check_out_iso,
          'link', COALESCE(
            NULLIF(auvo_link, ''),
            NULLIF(auvo_task_url, ''),
            'https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/' || auvo_task_id
          )
        )
        ORDER BY check_in_iso NULLS LAST, auvo_task_id
      )
    INTO v_cliente, v_horas, v_tarefa_ids, v_tecnicos, v_detalhes
    FROM realizadas;

    IF COALESCE(cardinality(v_tarefa_ids), 0) = 0 THEN
      CONTINUE;
    END IF;

    SELECT execucao.id, execucao.visita_numero
    INTO v_execucao_id, v_visita_numero
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = v_candidate.config_id
      AND execucao.data_realizada = p_data
      AND public.clientes_rh_relacionados(execucao.cliente, p_cliente)
    ORDER BY execucao.atualizado_em DESC
    LIMIT 1
    FOR UPDATE;

    IF v_execucao_id IS NOT NULL THEN
      UPDATE public.contratos_visitas_execucoes
      SET cliente = COALESCE(v_cliente, p_cliente),
          cliente_chave = v_cliente_chave,
          horas_trabalhadas = v_horas,
          tarefa_ids = v_tarefa_ids,
          tecnicos = COALESCE(v_tecnicos, '{}'),
          tarefas_detalhes = COALESCE(v_detalhes, '[]'::jsonb),
          atualizado_em = now()
      WHERE id = v_execucao_id;
    ELSE
      v_visita_numero := v_candidate.visita_planejada;
      IF v_visita_numero IS NULL THEN
        SELECT numero
        INTO v_visita_numero
        FROM generate_series(1, 31) numero
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.contratos_visitas_execucoes done
          WHERE done.contrato_visita_config_id = v_candidate.config_id
            AND done.competencia = v_competencia
            AND done.visita_numero = numero
        )
        ORDER BY numero
        LIMIT 1;
      END IF;

      INSERT INTO public.contratos_visitas_execucoes (
        contrato_visita_config_id, contrato_id, competencia, visita_numero,
        data_realizada, cliente, cliente_chave, horas_trabalhadas,
        tarefa_ids, tecnicos, tarefas_detalhes
      ) VALUES (
        v_candidate.config_id, v_candidate.contrato_id, v_competencia, v_visita_numero,
        p_data, COALESCE(v_cliente, p_cliente), v_cliente_chave, v_horas,
        v_tarefa_ids, COALESCE(v_tecnicos, '{}'), COALESCE(v_detalhes, '[]'::jsonb)
      )
      ON CONFLICT (contrato_visita_config_id, cliente_chave, data_realizada) DO UPDATE
      SET horas_trabalhadas = EXCLUDED.horas_trabalhadas,
          tarefa_ids = EXCLUDED.tarefa_ids,
          tecnicos = EXCLUDED.tecnicos,
          tarefas_detalhes = EXCLUDED.tarefas_detalhes,
          atualizado_em = now()
      RETURNING id INTO v_execucao_id;
    END IF;

    v_execucoes_selecionadas := array_append(v_execucoes_selecionadas, v_execucao_id);
    v_ultima_execucao_id := v_execucao_id;
  END LOOP;

  -- Remove apropriacoes antigas que pertenciam ao cliente/dia, mas nao ao
  -- escopo correto de atividade depois da classificacao acima.
  FOR v_obsoleta IN
    SELECT execucao.*
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.data_realizada = p_data
      AND public.clientes_rh_relacionados(execucao.cliente, p_cliente)
      AND NOT (execucao.id = ANY(v_execucoes_selecionadas))
  LOOP
    DELETE FROM public.contratos_visitas_execucoes
    WHERE id = v_obsoleta.id;

    DELETE FROM public.agenda_agendamentos agenda
    WHERE agenda.previsao_tipo = 'CONTRATO_REALIZADO'
      AND agenda.contrato_visita_config_id = v_obsoleta.contrato_visita_config_id
      AND agenda.contrato_visita_realizada_em = p_data;
  END LOOP;

  RETURN v_ultima_execucao_id;
END;
$$;

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
      public.consolidar_escopos_visita(
        array_agg(public.escopo_questionarios_visita(
          tarefa.questionario_id, tarefa.questionario_respostas, tarefa.outros_questionarios
        )) OVER (PARTITION BY tarefa.auvo_task_id)
      ) AS escopo_coifa,
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
      AND escopo_coifa = v_contrato_coifa
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

CREATE OR REPLACE FUNCTION public.reconciliar_dia_visita_contratual_agendada(
  p_cliente text,
  p_data date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate record;
  v_selecionadas uuid[] := '{}';
  v_total integer := 0;
BEGIN
  IF p_data IS NULL OR p_data < current_date OR length(public.normalizar_cliente_visita(p_cliente)) < 3 THEN
    RETURN 0;
  END IF;

  FOR v_candidate IN
    WITH ranked AS (
      SELECT
        tarefa.*,
        public.consolidar_escopos_visita(
          array_agg(public.escopo_questionarios_visita(
            tarefa.questionario_id, tarefa.questionario_respostas, tarefa.outros_questionarios
          )) OVER (PARTITION BY tarefa.auvo_task_id)
        ) AS escopo_coifa,
        row_number() OVER (
          PARTITION BY tarefa.auvo_task_id
          ORDER BY tarefa.atualizado_em DESC NULLS LAST, tarefa.criado_em DESC NULLS LAST
        ) AS position
      FROM public.tarefas_central tarefa
      WHERE tarefa.data_tarefa = p_data
        AND public.clientes_rh_relacionados(tarefa.cliente, p_cliente)
    ), validas AS (
      SELECT *
      FROM ranked
      WHERE position = 1
        AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%cancel%'
        AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%exclu%'
        AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%pendente-vinculo%'
        AND NULLIF(trim(tecnico), '') IS NOT NULL
    ), candidates AS (
      SELECT
        cfg.id AS config_id,
        public.contrato_e_limpeza_coifa(c.nome) AS contrato_coifa,
        cfg.atualizado_em
      FROM public.contratos_visitas_config cfg
      JOIN public.contratos c ON c.id = cfg.contrato_id
      WHERE cfg.ativo = true
        AND c.ativo = true
        AND (c.vigencia_inicio IS NULL OR p_data >= c.vigencia_inicio)
        AND (c.vigencia_fim IS NULL OR p_data <= c.vigencia_fim)
        AND (
          public.clientes_rh_relacionados(c.cliente_nome, p_cliente)
          OR EXISTS (
            SELECT 1
            FROM public.grupo_cliente_membros membro
            WHERE membro.grupo_id = c.grupo_id
              AND public.clientes_rh_relacionados(membro.cliente_nome, p_cliente)
          )
        )
        AND EXISTS (
          SELECT 1
          FROM validas tarefa
          WHERE tarefa.escopo_coifa
            = public.contrato_e_limpeza_coifa(c.nome)
        )
    )
    SELECT DISTINCT ON (contrato_coifa) *
    FROM candidates
    ORDER BY contrato_coifa, atualizado_em DESC, config_id
  LOOP
    v_selecionadas := array_append(v_selecionadas, v_candidate.config_id);
    v_total := v_total + public.reconciliar_config_visita_contratual_agendada(
      p_cliente, p_data, v_candidate.config_id
    );
  END LOOP;

  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.data = p_data
    AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) > 0
    AND public.clientes_rh_relacionados(agenda.cliente, p_cliente)
    AND NOT (agenda.contrato_visita_config_id = ANY(v_selecionadas));

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
     AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa
     AND OLD.auvo_task_id IS NOT DISTINCT FROM NEW.auvo_task_id
     AND OLD.tecnico IS NOT DISTINCT FROM NEW.tecnico
     AND OLD.hora_inicio IS NOT DISTINCT FROM NEW.hora_inicio
     AND OLD.hora_fim IS NOT DISTINCT FROM NEW.hora_fim
     AND OLD.status_auvo IS NOT DISTINCT FROM NEW.status_auvo
     AND OLD.questionario_id IS NOT DISTINCT FROM NEW.questionario_id
     AND OLD.questionario_respostas IS NOT DISTINCT FROM NEW.questionario_respostas
     AND OLD.outros_questionarios IS NOT DISTINCT FROM NEW.outros_questionarios THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.data_tarefa IS NOT NULL
     AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR OLD.cliente IS DISTINCT FROM NEW.cliente
       OR OLD.data_tarefa IS DISTINCT FROM NEW.data_tarefa
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.data_tarefa IS NOT NULL
     AND NULLIF(trim(NEW.cliente), '') IS NOT NULL THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(
      NEW.cliente, NEW.data_tarefa
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
     AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa
     AND OLD.auvo_task_id IS NOT DISTINCT FROM NEW.auvo_task_id
     AND OLD.duracao_decimal IS NOT DISTINCT FROM NEW.duracao_decimal
     AND OLD.check_out IS NOT DISTINCT FROM NEW.check_out
     AND OLD.data_conclusao IS NOT DISTINCT FROM NEW.data_conclusao
     AND OLD.status_auvo IS NOT DISTINCT FROM NEW.status_auvo
     AND OLD.tecnico IS NOT DISTINCT FROM NEW.tecnico
     AND OLD.check_in_iso IS NOT DISTINCT FROM NEW.check_in_iso
     AND OLD.check_out_iso IS NOT DISTINCT FROM NEW.check_out_iso
     AND OLD.questionario_id IS NOT DISTINCT FROM NEW.questionario_id
     AND OLD.questionario_respostas IS NOT DISTINCT FROM NEW.questionario_respostas
     AND OLD.outros_questionarios IS NOT DISTINCT FROM NEW.outros_questionarios THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.data_tarefa IS NOT NULL
     AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR OLD.cliente IS DISTINCT FROM NEW.cliente
       OR OLD.data_tarefa IS DISTINCT FROM NEW.data_tarefa
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.data_tarefa IS NOT NULL
     AND NULLIF(trim(NEW.cliente), '') IS NOT NULL
     AND (
       (
         COALESCE(NEW.duracao_decimal, 0) > 0
         AND (
           NEW.check_out IS TRUE
           OR NEW.data_conclusao IS NOT NULL
           OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%finaliz%'
           OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%conclu%'
         )
       )
       OR (
         -- O questionario pode chegar em um espelho ainda pausado depois do
         -- espelho finalizado, inclusive por correcao de cliente/data. Isso
         -- nao transforma tarefas incompletas em realizadas: a reconciliacao
         -- continua escolhendo a linha finalizada.
         TG_OP IN ('INSERT', 'UPDATE')
         AND EXISTS (
           SELECT 1 FROM public.tarefas_central espelho
           WHERE espelho.auvo_task_id = NEW.auvo_task_id
             AND espelho.data_tarefa = NEW.data_tarefa
             AND public.clientes_rh_relacionados(espelho.cliente, NEW.cliente)
             AND COALESCE(espelho.duracao_decimal, 0) > 0
             AND (
               espelho.check_out IS TRUE
               OR espelho.data_conclusao IS NOT NULL
               OR public.normalizar_cliente_visita(espelho.status_auvo) LIKE '%finaliz%'
               OR public.normalizar_cliente_visita(espelho.status_auvo) LIKE '%conclu%'
             )
         )
       )
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual(
      NEW.cliente, NEW.data_tarefa
    );
  ELSIF TG_OP = 'UPDATE'
        AND OLD.data_tarefa IS NOT NULL
        AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
        AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
        AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa THEN
    -- Se uma tarefa deixou de ser valida, limpa/recalcula a apropriacao antiga.
    PERFORM public.reconciliar_dia_visita_contratual(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_reconciliar_visita_contratual_agendada
  ON public.tarefas_central;
CREATE TRIGGER trg_tarefa_reconciliar_visita_contratual_agendada
  AFTER INSERT OR DELETE OR UPDATE OF cliente, data_tarefa, auvo_task_id,
    tecnico, hora_inicio, hora_fim, status_auvo,
    questionario_id, questionario_respostas, outros_questionarios
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa();

DROP TRIGGER IF EXISTS trg_tarefa_reconciliar_visita_contratual
  ON public.tarefas_central;
CREATE TRIGGER trg_tarefa_reconciliar_visita_contratual
  AFTER INSERT OR DELETE OR UPDATE OF cliente, data_tarefa, auvo_task_id,
    duracao_decimal, check_out, data_conclusao, status_auvo,
    tecnico, check_in_iso, check_out_iso,
    questionario_id, questionario_respostas, outros_questionarios
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_por_tarefa();

-- Nao reconstroi todo o historico nem altera vinculos de clientes. O reparo
-- dos dias afetados deve executar as mesmas RPCs, em lotes auditaveis.
