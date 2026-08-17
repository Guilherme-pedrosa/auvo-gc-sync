-- Tarefas futuras no Auvo tambem materializam o card da visita contratual.
-- O card anual disponivel e alinhado a data real da agenda; quando a franquia
-- mensal ja foi consumida, a proxima ida e numerada como visita extra.

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
  v_cliente_chave text := public.normalizar_cliente_visita(p_cliente);
  v_config public.contratos_visitas_config%ROWTYPE;
  v_competencia date := date_trunc('month', p_data)::date;
  v_tarefa_ids text[] := '{}';
  v_tecnicos text[] := '{}';
  v_hora_inicio time;
  v_hora_fim time;
  v_visita_numero integer;
  v_inseridas integer := 0;
  v_extra boolean := false;
  v_detalhes text;
BEGIN
  IF p_data IS NULL OR p_data < current_date OR length(v_cliente_chave) < 3 THEN
    RETURN 0;
  END IF;

  SELECT cfg.*
  INTO v_config
  FROM public.contratos_visitas_config cfg
  JOIN public.contratos c ON c.id = cfg.contrato_id
  WHERE cfg.ativo = true
    AND c.ativo = true
    AND (c.vigencia_inicio IS NULL OR p_data >= c.vigencia_inicio)
    AND (c.vigencia_fim IS NULL OR p_data <= c.vigencia_fim)
    AND (
      public.normalizar_cliente_visita(c.cliente_nome) = v_cliente_chave
      OR EXISTS (
        SELECT 1
        FROM public.grupo_cliente_membros membro
        WHERE membro.grupo_id = c.grupo_id
          AND public.normalizar_cliente_visita(membro.cliente_nome) = v_cliente_chave
      )
    )
  ORDER BY cfg.atualizado_em DESC, cfg.id
  LIMIT 1;

  IF v_config.id IS NULL THEN RETURN 0; END IF;

  -- Serializa cliente/dia para duas tarefas do mesmo sync nao escolherem o
  -- mesmo numero e tentarem recriar o card simultaneamente.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_config.id::text || ':' || p_data::text, 0));

  -- Uma visita ja executada e tratada pelo card realizado, nunca por previsao.
  IF EXISTS (
    SELECT 1
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.cliente_chave = v_cliente_chave
      AND execucao.data_realizada = p_data
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
      AND public.normalizar_cliente_visita(tarefa.cliente) = v_cliente_chave
      AND NULLIF(regexp_replace(COALESCE(tarefa.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
  ), validas AS (
    SELECT *
    FROM ranked
    WHERE position = 1
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%cancel%'
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%exclu%'
  )
  SELECT
    COALESCE(array_agg(auvo_task_id ORDER BY hora_inicio NULLS LAST, auvo_task_id), '{}'),
    COALESCE(array_agg(DISTINCT tecnico) FILTER (WHERE NULLIF(trim(tecnico), '') IS NOT NULL), '{}'),
    min(NULLIF(hora_inicio, '')::time),
    max(NULLIF(hora_fim, '')::time)
  INTO v_tarefa_ids, v_tecnicos, v_hora_inicio, v_hora_fim
  FROM validas;

  -- Se a ultima tarefa foi cancelada, remove somente o card derivado das tarefas.
  IF cardinality(v_tarefa_ids) = 0 THEN
    DELETE FROM public.agenda_agendamentos agenda
    WHERE agenda.origem = 'CONTRATO'
      AND agenda.previsao_tipo = 'CONTRATO'
      AND agenda.contrato_visita_config_id = v_config.id
      AND agenda.data = p_data
      AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) > 0;
    RETURN 0;
  END IF;

  -- Mantem o numero ja atribuido a este cliente/dia em sincronizacoes repetidas.
  SELECT min(agenda.contrato_visita_numero)
  INTO v_visita_numero
  FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_config.id
    AND agenda.data = p_data;

  -- Senao, consome o card anual ainda livre mais proximo da data agendada.
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
        SELECT 1 FROM public.contratos_visitas_execucoes execucao
        WHERE execucao.contrato_visita_config_id = v_config.id
          AND execucao.competencia = v_competencia
          AND execucao.visita_numero = agenda.contrato_visita_numero
      )
    ORDER BY abs(agenda.data - p_data), agenda.contrato_visita_numero
    LIMIT 1;
  END IF;

  -- Sem card nominal livre, a ida passa a ser a proxima visita extra do mes.
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
      THEN format(' · visita extra alem das %s contratadas', v_config.qtd_visitas)
      ELSE '' END
  );

  -- Substitui o card anual ou a versao anterior deste mesmo dia pelas linhas
  -- dos tecnicos que realmente constam nas tarefas agendadas.
  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_config.id
    AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_competencia
    AND agenda.contrato_visita_numero = v_visita_numero;

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
    v_competencia::text,
    v_visita_numero,
    v_config.duracao_minutos,
    v_tarefa_ids,
    v_tecnicos
  FROM tecnicos_para_card tecnico;
  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  RETURN v_inseridas;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_dia_visita_contratual_agendada(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_dia_visita_contratual_agendada(text, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.data_tarefa IS NOT NULL
     AND NULLIF(trim(OLD.cliente), '') IS NOT NULL THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(OLD.cliente, OLD.data_tarefa);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.data_tarefa IS NOT NULL
     AND NULLIF(trim(NEW.cliente), '') IS NOT NULL THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(NEW.cliente, NEW.data_tarefa);
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
  AFTER INSERT OR DELETE OR UPDATE OF cliente, data_tarefa, tecnico,
    hora_inicio, hora_fim, status_auvo, atualizado_em
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa();

-- O recalculo anual nao pode apagar nem recriar um slot que ja foi alinhado
-- as tarefas concretamente agendadas no Auvo.
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

  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = p_config_id
    AND agenda.data BETWEEN v_inicio_competencia AND v_fim
    AND cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.contratos_visitas_execucoes done
      WHERE done.contrato_visita_config_id = p_config_id
        AND done.competencia = date_trunc('month', agenda.data)::date
        AND done.visita_numero = agenda.contrato_visita_numero
    );

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
        FROM public.contratos_visitas_execucoes done
        WHERE done.contrato_visita_config_id = p_config_id
          AND done.competencia = linha.contrato_visita_competencia
          AND done.visita_numero = linha.contrato_visita_numero
      )
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

-- Materializa todos os cliente/dia futuros ja presentes no espelho Auvo.
DO $$
DECLARE
  dia record;
BEGIN
  FOR dia IN
    WITH ranked AS (
      SELECT
        tarefa.*,
        row_number() OVER (
          PARTITION BY tarefa.auvo_task_id
          ORDER BY tarefa.atualizado_em DESC NULLS LAST, tarefa.criado_em DESC NULLS LAST
        ) AS position
      FROM public.tarefas_central tarefa
      WHERE tarefa.data_tarefa BETWEEN current_date AND current_date + 90
        AND NULLIF(trim(tarefa.cliente), '') IS NOT NULL
    )
    SELECT DISTINCT cliente, data_tarefa
    FROM ranked
    WHERE position = 1
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%cancel%'
      AND public.normalizar_cliente_visita(status_auvo) NOT LIKE '%exclu%'
    ORDER BY data_tarefa, cliente
  LOOP
    PERFORM public.reconciliar_dia_visita_contratual_agendada(dia.cliente, dia.data_tarefa);
  END LOOP;
END;
$$;
