-- Reconcilia visitas contratuais com o trabalho realmente executado no Auvo.
-- Uma visita real e uma ida ao cliente em um dia, ainda que o trabalho esteja
-- dividido em varias tarefas. As horas sao somadas sem contar espelhos/linhas
-- tecnicas duplicadas do mesmo auvo_task_id.

CREATE OR REPLACE FUNCTION public.normalizar_cliente_visita(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    lower(translate(
      COALESCE(p_nome, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
    )),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

CREATE TABLE IF NOT EXISTS public.contratos_visitas_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_visita_config_id uuid NOT NULL
    REFERENCES public.contratos_visitas_config(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  visita_numero integer NOT NULL CHECK (visita_numero BETWEEN 1 AND 31),
  data_realizada date NOT NULL,
  cliente text NOT NULL,
  cliente_chave text NOT NULL,
  horas_trabalhadas numeric(12,4) NOT NULL DEFAULT 0 CHECK (horas_trabalhadas >= 0),
  tarefa_ids text[] NOT NULL DEFAULT '{}',
  tecnicos text[] NOT NULL DEFAULT '{}',
  tarefas_detalhes jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratos_visitas_execucao_visita_unique
    UNIQUE (contrato_visita_config_id, competencia, visita_numero),
  CONSTRAINT contratos_visitas_execucao_cliente_dia_unique
    UNIQUE (cliente_chave, data_realizada)
);

CREATE INDEX IF NOT EXISTS idx_contratos_visitas_execucoes_competencia
  ON public.contratos_visitas_execucoes (contrato_visita_config_id, competencia);

CREATE INDEX IF NOT EXISTS idx_contratos_visitas_execucoes_tarefas
  ON public.contratos_visitas_execucoes USING gin (tarefa_ids);

ALTER TABLE public.contratos_visitas_execucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read contract visit executions"
  ON public.contratos_visitas_execucoes;
CREATE POLICY "auth read contract visit executions"
  ON public.contratos_visitas_execucoes
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.contratos_visitas_execucoes TO authenticated;
GRANT ALL ON public.contratos_visitas_execucoes TO service_role;

-- Recalcula um cliente/dia inteiro. Isso permite que a segunda ou terceira
-- tarefa do mesmo atendimento apenas acrescente suas horas a mesma visita.
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
  v_cliente_chave text := public.normalizar_cliente_visita(p_cliente);
  v_cliente text;
  v_horas numeric(12,4);
  v_tarefa_ids text[];
  v_tecnicos text[];
  v_detalhes jsonb;
  v_execucao_id uuid;
  v_config_id uuid;
  v_contrato_id uuid;
  v_competencia date := date_trunc('month', p_data)::date;
  v_visita_numero integer;
BEGIN
  IF p_data IS NULL OR length(v_cliente_chave) < 3 THEN
    RETURN NULL;
  END IF;

  WITH ranked AS (
    SELECT
      tc.*,
      row_number() OVER (
        PARTITION BY tc.auvo_task_id
        ORDER BY
          (tc.check_out IS TRUE) DESC,
          (tc.data_conclusao IS NOT NULL) DESC,
          (COALESCE(tc.duracao_decimal, 0) > 0) DESC,
          tc.atualizado_em DESC NULLS LAST,
          tc.criado_em DESC NULLS LAST
      ) AS position
    FROM public.tarefas_central tc
    WHERE tc.data_tarefa = p_data
      AND public.normalizar_cliente_visita(tc.cliente) = v_cliente_chave
      AND NULLIF(regexp_replace(COALESCE(tc.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
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
        'link', COALESCE(NULLIF(auvo_link, ''), NULLIF(auvo_task_url, ''),
          'https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/' || auvo_task_id)
      )
      ORDER BY check_in_iso NULLS LAST, auvo_task_id
    )
  INTO v_cliente, v_horas, v_tarefa_ids, v_tecnicos, v_detalhes
  FROM realizadas;

  IF COALESCE(cardinality(v_tarefa_ids), 0) = 0 THEN
    -- Uma resposta parcial da API nunca desfaz uma visita ja reconhecida.
    RETURN NULL;
  END IF;

  SELECT id INTO v_execucao_id
  FROM public.contratos_visitas_execucoes
  WHERE cliente_chave = v_cliente_chave
    AND data_realizada = p_data
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.contratos_visitas_execucoes
    SET cliente = COALESCE(v_cliente, cliente),
        horas_trabalhadas = v_horas,
        tarefa_ids = v_tarefa_ids,
        tecnicos = COALESCE(v_tecnicos, '{}'),
        tarefas_detalhes = COALESCE(v_detalhes, '[]'::jsonb),
        atualizado_em = now()
    WHERE id = v_execucao_id;
    RETURN v_execucao_id;
  END IF;

  -- Se o mesmo cliente possui mais de um contrato, a ida e apropriada uma
  -- unica vez, ao planejamento cuja data estiver mais proxima da execucao.
  SELECT candidate.config_id, candidate.contrato_id, candidate.visita_numero
  INTO v_config_id, v_contrato_id, v_visita_numero
  FROM (
    SELECT
      cfg.id AS config_id,
      c.id AS contrato_id,
      COALESCE(planned.visita_numero, missing.visita_numero) AS visita_numero,
      (planned.visita_numero IS NOT NULL) AS possui_previsao,
      COALESCE(planned.distancia_dias, 9999) AS distancia_dias,
      GREATEST(COALESCE(c.horas_mes_contratadas, 0) - COALESCE(performed.horas, 0), 0) AS horas_restantes,
      COALESCE(performed.visitas, 0) AS visitas_realizadas,
      cfg.atualizado_em
    FROM public.contratos_visitas_config cfg
    JOIN public.contratos c ON c.id = cfg.contrato_id
    LEFT JOIN LATERAL (
      SELECT
        aa.contrato_visita_numero AS visita_numero,
        min(abs(aa.data - p_data)) AS distancia_dias
      FROM public.agenda_agendamentos aa
      WHERE aa.origem = 'CONTRATO'
        AND aa.contrato_visita_config_id = cfg.id
        AND aa.contrato_visita_competencia::text LIKE to_char(v_competencia, 'YYYY-MM') || '%'
        AND aa.contrato_visita_numero IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.contratos_visitas_execucoes done
          WHERE done.contrato_visita_config_id = cfg.id
            AND done.competencia = v_competencia
            AND done.visita_numero = aa.contrato_visita_numero
        )
      GROUP BY aa.contrato_visita_numero
      ORDER BY min(abs(aa.data - p_data)), aa.contrato_visita_numero
      LIMIT 1
    ) planned ON true
    LEFT JOIN LATERAL (
      SELECT number AS visita_numero
      -- Depois da quantidade nominal, continuamos numerando visitas extras.
      -- Elas precisam entrar nas horas reais e no alerta de excedente.
      FROM generate_series(1, 31) AS number
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.contratos_visitas_execucoes done
        WHERE done.contrato_visita_config_id = cfg.id
          AND done.competencia = v_competencia
          AND done.visita_numero = number
      )
      ORDER BY number
      LIMIT 1
    ) missing ON true
    LEFT JOIN LATERAL (
      SELECT
        sum(done.horas_trabalhadas) AS horas,
        count(*) AS visitas
      FROM public.contratos_visitas_execucoes done
      WHERE done.contrato_visita_config_id = cfg.id
        AND done.competencia = v_competencia
    ) performed ON true
    WHERE cfg.ativo = true
      AND c.ativo = true
      AND COALESCE(c.horas_mes_contratadas, 0) > 0
      AND (c.vigencia_inicio IS NULL OR p_data >= c.vigencia_inicio)
      AND (c.vigencia_fim IS NULL OR p_data <= c.vigencia_fim)
      AND COALESCE(planned.visita_numero, missing.visita_numero) IS NOT NULL
      AND (
        public.normalizar_cliente_visita(c.cliente_nome) = v_cliente_chave
        OR EXISTS (
          SELECT 1
          FROM public.grupo_cliente_membros member
          WHERE member.grupo_id = c.grupo_id
            AND public.normalizar_cliente_visita(member.cliente_nome) = v_cliente_chave
        )
      )
  ) candidate
  ORDER BY candidate.possui_previsao DESC,
           candidate.distancia_dias,
           candidate.horas_restantes DESC,
           candidate.visitas_realizadas,
           candidate.atualizado_em,
           candidate.config_id
  LIMIT 1;

  IF v_config_id IS NULL OR v_visita_numero IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.contratos_visitas_execucoes (
    contrato_visita_config_id, contrato_id, competencia, visita_numero,
    data_realizada, cliente, cliente_chave, horas_trabalhadas,
    tarefa_ids, tecnicos, tarefas_detalhes
  ) VALUES (
    v_config_id, v_contrato_id, v_competencia, v_visita_numero,
    p_data, COALESCE(v_cliente, p_cliente), v_cliente_chave, v_horas,
    v_tarefa_ids, COALESCE(v_tecnicos, '{}'), COALESCE(v_detalhes, '[]'::jsonb)
  )
  ON CONFLICT (cliente_chave, data_realizada) DO UPDATE
  SET horas_trabalhadas = EXCLUDED.horas_trabalhadas,
      tarefa_ids = EXCLUDED.tarefa_ids,
      tecnicos = EXCLUDED.tecnicos,
      tarefas_detalhes = EXCLUDED.tarefas_detalhes,
      atualizado_em = now()
  RETURNING id INTO v_execucao_id;

  -- A tarefa real ja aparece na Agenda de Tecnicos; o card de previsao deixa
  -- de existir para nao duplicar a mesma ida ao cliente.
  DELETE FROM public.agenda_agendamentos
  WHERE origem = 'CONTRATO'
    AND contrato_visita_config_id = v_config_id
    AND contrato_visita_competencia::text LIKE to_char(v_competencia, 'YYYY-MM') || '%'
    AND contrato_visita_numero = v_visita_numero;

  RETURN v_execucao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_dia_visita_contratual(text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_dia_visita_contratual(text, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconciliar_visitas_contratuais_periodo(
  p_inicio date,
  p_fim date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  day_row record;
  v_total integer := 0;
  v_id uuid;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim
     OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Periodo de reconciliacao invalido';
  END IF;

  FOR day_row IN
    WITH ranked AS (
      SELECT
        tc.*,
        row_number() OVER (
          PARTITION BY tc.auvo_task_id
          ORDER BY
            (tc.check_out IS TRUE) DESC,
            (tc.data_conclusao IS NOT NULL) DESC,
            (COALESCE(tc.duracao_decimal, 0) > 0) DESC,
            tc.atualizado_em DESC NULLS LAST
        ) AS position
      FROM public.tarefas_central tc
      WHERE tc.data_tarefa BETWEEN p_inicio AND p_fim
        AND NULLIF(trim(tc.cliente), '') IS NOT NULL
        AND NULLIF(regexp_replace(COALESCE(tc.auvo_task_id, ''), '\D', '', 'g'), '') IS NOT NULL
    )
    SELECT DISTINCT cliente, data_tarefa
    FROM ranked task
    WHERE position = 1
      AND COALESCE(duracao_decimal, 0) > 0
      AND (
        check_out IS TRUE
        OR data_conclusao IS NOT NULL
        OR public.normalizar_cliente_visita(status_auvo) LIKE '%finaliz%'
        OR public.normalizar_cliente_visita(status_auvo) LIKE '%conclu%'
      )
      AND EXISTS (
        SELECT 1
        FROM public.contratos_visitas_config cfg
        JOIN public.contratos c ON c.id = cfg.contrato_id
        WHERE cfg.ativo = true
          AND c.ativo = true
          AND (
            public.normalizar_cliente_visita(c.cliente_nome) = public.normalizar_cliente_visita(task.cliente)
            OR EXISTS (
              SELECT 1 FROM public.grupo_cliente_membros member
              WHERE member.grupo_id = c.grupo_id
                AND public.normalizar_cliente_visita(member.cliente_nome) = public.normalizar_cliente_visita(task.cliente)
            )
          )
      )
    ORDER BY data_tarefa, cliente
  LOOP
    v_id := public.reconciliar_dia_visita_contratual(day_row.cliente, day_row.data_tarefa);
    IF v_id IS NOT NULL THEN v_total := v_total + 1; END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_visitas_contratuais_periodo(date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconciliar_visitas_contratuais_periodo(date, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.data_tarefa IS NULL
     OR NULLIF(trim(NEW.cliente), '') IS NULL
     OR COALESCE(NEW.duracao_decimal, 0) <= 0
     OR NOT (
       NEW.check_out IS TRUE
       OR NEW.data_conclusao IS NOT NULL
       OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%finaliz%'
       OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%conclu%'
     ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
     AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa
     AND OLD.duracao_decimal IS NOT DISTINCT FROM NEW.duracao_decimal
     AND OLD.check_out IS NOT DISTINCT FROM NEW.check_out
     AND OLD.data_conclusao IS NOT DISTINCT FROM NEW.data_conclusao
     AND OLD.status_auvo IS NOT DISTINCT FROM NEW.status_auvo
     AND OLD.tecnico IS NOT DISTINCT FROM NEW.tecnico
     AND OLD.check_in_iso IS NOT DISTINCT FROM NEW.check_in_iso
     AND OLD.check_out_iso IS NOT DISTINCT FROM NEW.check_out_iso THEN
    RETURN NEW;
  END IF;

  PERFORM public.reconciliar_dia_visita_contratual(NEW.cliente, NEW.data_tarefa);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_reconciliar_visita_contratual
  ON public.tarefas_central;
CREATE TRIGGER trg_tarefa_reconciliar_visita_contratual
  AFTER INSERT OR UPDATE OF cliente, data_tarefa, duracao_decimal, check_out,
    data_conclusao, status_auvo, tecnico, check_in_iso, check_out_iso
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_por_tarefa();

-- O replanejamento passa a substituir tambem previsoes vencidas da competencia
-- atual e nunca reinsere uma visita ja comprovada pelas tarefas reais.
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
    AND agenda.contrato_visita_config_id = p_config_id
    AND agenda.data BETWEEN v_inicio_competencia AND v_fim
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

-- Corrige o ano corrente imediatamente ao aplicar a migration.
SELECT public.reconciliar_visitas_contratuais_periodo(
  date_trunc('year', current_date)::date,
  current_date
);
