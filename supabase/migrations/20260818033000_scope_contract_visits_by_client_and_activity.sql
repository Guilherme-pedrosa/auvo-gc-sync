-- Visitas contratuais respeitam duas fontes de verdade:
-- 1. o vinculo Auvo <-> GC cadastrado em RH > Clientes;
-- 2. o escopo da atividade contratada (coifa x demais contratos).

CREATE OR REPLACE FUNCTION public.cliente_rh_chave(p_cliente text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT 'rh:' || cliente.id::text
      FROM public.rh_clientes cliente
      WHERE cliente.ativo = true
        AND lower(COALESCE(cliente.vinculo_status, '')) = 'vinculado'
        AND public.normalizar_cliente_visita(p_cliente) = ANY (ARRAY[
          public.normalizar_cliente_visita(cliente.nome),
          public.normalizar_cliente_visita(cliente.nome_gc),
          public.normalizar_cliente_visita(cliente.nome_auvo),
          public.normalizar_cliente_visita(cliente.nome_fantasia)
        ])
      ORDER BY cliente.atualizado_em DESC NULLS LAST, cliente.id
      LIMIT 1
    ),
    public.normalizar_cliente_visita(p_cliente)
  );
$$;

CREATE OR REPLACE FUNCTION public.clientes_rh_relacionados(p_cliente_a text, p_cliente_b text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.cliente_rh_chave(p_cliente_a) = public.cliente_rh_chave(p_cliente_b);
$$;

CREATE OR REPLACE FUNCTION public.atividade_e_limpeza_coifa(
  p_task_type_id text,
  p_descricao text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    regexp_replace(COALESCE(p_task_type_id, ''), '\D', '', 'g') = '180795'
    OR public.normalizar_cliente_visita(p_descricao) LIKE '%higienizacao-de-coifa%'
    OR public.normalizar_cliente_visita(p_descricao) LIKE '%limpeza-de-coifa%';
$$;

CREATE OR REPLACE FUNCTION public.contrato_e_limpeza_coifa(p_contrato_nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT public.normalizar_cliente_visita(p_contrato_nome) LIKE '%coifa%';
$$;

REVOKE ALL ON FUNCTION public.cliente_rh_chave(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clientes_rh_relacionados(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atividade_e_limpeza_coifa(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contrato_e_limpeza_coifa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_rh_chave(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clientes_rh_relacionados(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atividade_e_limpeza_coifa(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contrato_e_limpeza_coifa(text) TO authenticated, service_role;

-- Um mesmo cliente/dia pode cumprir dois contratos diferentes quando houver,
-- por exemplo, manutencao comum e higienizacao de coifa no mesmo atendimento.
ALTER TABLE public.contratos_visitas_execucoes
  DROP CONSTRAINT IF EXISTS contratos_visitas_execucao_cliente_dia_unique;

CREATE UNIQUE INDEX IF NOT EXISTS contratos_visitas_execucao_config_cliente_dia_unique
  ON public.contratos_visitas_execucoes (
    contrato_visita_config_id,
    cliente_chave,
    data_realizada
  );

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
          WHERE public.atividade_e_limpeza_coifa(tarefa.task_type_id, tarefa.descricao)
            = public.contrato_e_limpeza_coifa(c.nome)
        )
    )
    SELECT DISTINCT ON (contrato_coifa) *
    FROM candidates
    ORDER BY contrato_coifa,
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
        AND public.atividade_e_limpeza_coifa(task_type_id, descricao) = v_candidate.contrato_coifa
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

REVOKE ALL ON FUNCTION public.reconciliar_dia_visita_contratual(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_dia_visita_contratual(text, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconciliar_config_visita_contratual_agendada(
  p_cliente text,
  p_data date,
  p_config_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND public.atividade_e_limpeza_coifa(task_type_id, descricao) = v_contrato_coifa
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
  FROM tecnicos_para_card tecnico;
  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  RETURN v_inseridas;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_config_visita_contratual_agendada(text, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_config_visita_contratual_agendada(text, date, uuid)
  TO service_role;

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
          WHERE public.atividade_e_limpeza_coifa(tarefa.task_type_id, tarefa.descricao)
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

REVOKE ALL ON FUNCTION public.reconciliar_dia_visita_contratual_agendada(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_dia_visita_contratual_agendada(text, date)
  TO service_role;

-- Reconstroi somente a competencia atual: a tabela e derivada das tarefas
-- Auvo, portanto a operacao corrige numeros, horas e cards sem perder a fonte.
DELETE FROM public.contratos_visitas_execucoes
WHERE competencia = date_trunc('month', current_date)::date;

DELETE FROM public.agenda_agendamentos
WHERE previsao_tipo = 'CONTRATO_REALIZADO'
  AND date_trunc('month', contrato_visita_realizada_em)::date = date_trunc('month', current_date)::date;

DO $$
DECLARE
  dia record;
BEGIN
  FOR dia IN
    WITH origem AS (
      SELECT cliente, data_tarefa AS data
      FROM public.tarefas_central
      WHERE data_tarefa BETWEEN date_trunc('month', current_date)::date
        AND (date_trunc('month', current_date) + interval '1 month - 1 day')::date
        AND NULLIF(trim(cliente), '') IS NOT NULL
      UNION
      SELECT cliente, data_realizada
      FROM public.contratos_visitas_execucoes
      WHERE competencia = date_trunc('month', current_date)::date
    )
    SELECT cliente, data
    FROM origem
    GROUP BY cliente, data
    ORDER BY data, cliente
  LOOP
    PERFORM public.reconciliar_dia_visita_contratual(dia.cliente, dia.data);
  END LOOP;

  FOR dia IN
    SELECT cliente, data_tarefa AS data
    FROM public.tarefas_central
    WHERE data_tarefa BETWEEN current_date AND current_date + 90
      AND NULLIF(trim(cliente), '') IS NOT NULL
    GROUP BY cliente, data_tarefa
    ORDER BY data_tarefa, cliente
  LOOP
    PERFORM public.reconciliar_dia_visita_contratual_agendada(dia.cliente, dia.data);
  END LOOP;
END;
$$;
