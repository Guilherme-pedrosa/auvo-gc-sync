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
  v_total integer := 0;
  v_id uuid;
  v_cliente text;
  v_data date;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim
     OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Periodo de reconciliacao invalido';
  END IF;

  -- Criamos uma tabela temporaria para evitar cursores abertos que travam recursos
  -- e podem ser afetados por alteracoes na tarefas_central durante o loop.
  CREATE TEMP TABLE IF NOT EXISTS tmp_reconcile_days (
    cliente text,
    data_tarefa date
  ) ON COMMIT DROP;

  TRUNCATE tmp_reconcile_days;

  INSERT INTO tmp_reconcile_days (cliente, data_tarefa)
  WITH ranked AS MATERIALIZED (
    SELECT
      tc.cliente,
      tc.data_tarefa,
      tc.auvo_task_id,
      tc.duracao_decimal,
      tc.check_out,
      tc.data_conclusao,
      tc.status_auvo,
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
      AND NULLIF(
        regexp_replace(COALESCE(tc.auvo_task_id, ''), '\D', '', 'g'),
        ''
      ) IS NOT NULL
  ), eligible_days AS MATERIALIZED (
    SELECT DISTINCT task.cliente, task.data_tarefa
    FROM ranked task
    WHERE task.position = 1
      AND COALESCE(task.duracao_decimal, 0) > 0
      AND (
        task.check_out IS TRUE
        OR task.data_conclusao IS NOT NULL
        OR public.normalizar_cliente_visita(task.status_auvo) LIKE '%finaliz%'
        OR public.normalizar_cliente_visita(task.status_auvo) LIKE '%conclu%'
      )
  ), task_clients AS MATERIALIZED (
    SELECT
      source.cliente,
      public.cliente_rh_chave(source.cliente) AS cliente_chave
    FROM (SELECT DISTINCT cliente FROM eligible_days) source
  ), contract_clients AS MATERIALIZED (
    SELECT public.cliente_rh_chave(source.cliente) AS cliente_chave
    FROM (
      SELECT c.cliente_nome AS cliente
      FROM public.contratos_visitas_config cfg
      JOIN public.contratos c ON c.id = cfg.contrato_id
      WHERE cfg.ativo = true AND c.ativo = true

      UNION

      SELECT member.cliente_nome
      FROM public.contratos_visitas_config cfg
      JOIN public.contratos c ON c.id = cfg.contrato_id
      JOIN public.grupo_cliente_membros member ON member.grupo_id = c.grupo_id
      WHERE cfg.ativo = true AND c.ativo = true
    ) source
    GROUP BY public.cliente_rh_chave(source.cliente)
  )
  SELECT DISTINCT eligible.cliente, eligible.data_tarefa
  FROM eligible_days eligible
  JOIN task_clients task_client ON task_client.cliente = eligible.cliente
  JOIN contract_clients contract_client
    ON contract_client.cliente_chave = task_client.cliente_chave;

  -- Agora iteramos sobre a tabela temporaria
  FOR v_cliente, v_data IN SELECT cliente, data_tarefa FROM tmp_reconcile_days LOOP
    v_id := public.reconciliar_dia_visita_contratual(v_cliente, v_data);
    IF v_id IS NOT NULL THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;
