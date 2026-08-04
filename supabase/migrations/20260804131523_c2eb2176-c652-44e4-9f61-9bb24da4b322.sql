CREATE OR REPLACE FUNCTION public.save_budget_kanban_positions(
  p_positions jsonb,
  p_custom_columns jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_saved integer := 0;
  v_is_resolved_target boolean;
  v_has_resolution boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_positions, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'positions deve ser um array';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_positions, '[]'::jsonb))
      AS x(auvo_task_id text, coluna text, posicao integer)
  LOOP
    IF NULLIF(btrim(v_row.auvo_task_id), '') IS NULL
       OR NULLIF(btrim(v_row.coluna), '') IS NULL THEN
      RAISE EXCEPTION 'posição inválida';
    END IF;

    v_is_resolved_target := v_row.coluna = 'resolvido_sem_orcamento'
      OR EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(COALESCE(p_custom_columns, '[]'::jsonb))
          AS c(id text, title text, "order" integer)
        WHERE c.id = v_row.coluna
          AND lower(translate(COALESCE(c.title, ''),
            'áàâãäéèêëíìîïóòôõöúùûüç',
            'aaaaaeeeeiiiiooooouuuuc')) LIKE '%resolvid%'
      );

    SELECT EXISTS (
      SELECT 1
      FROM public.kanban_resolution_details d
      WHERE d.auvo_task_id = v_row.auvo_task_id
        AND d.ativo = true
        AND length(btrim(d.motivo)) >= 3
        AND d.resolvido_em IS NOT NULL
        AND NULLIF(btrim(d.resolvido_por_nome), '') IS NOT NULL
    ) INTO v_has_resolution;

    IF v_is_resolved_target AND NOT v_has_resolution THEN
      RAISE EXCEPTION 'card % não pode ir para Resolvido sem justificativa, usuário e data no histórico', v_row.auvo_task_id;
    END IF;

    IF v_has_resolution AND NOT v_is_resolved_target THEN
      RAISE EXCEPTION 'card % está resolvido; use a ação Reabrir antes de movê-lo', v_row.auvo_task_id;
    END IF;

    UPDATE public.kanban_orcamentos_cache k
    SET coluna = CASE
          WHEN v_has_resolution THEN 'resolvido_sem_orcamento'
          ELSE v_row.coluna
        END,
        posicao = v_row.posicao,
        atualizado_em = now()
    WHERE k.auvo_task_id = v_row.auvo_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'card % não encontrado no cache', v_row.auvo_task_id;
    END IF;
    v_saved := v_saved + 1;
  END LOOP;

  IF p_custom_columns IS NOT NULL AND jsonb_typeof(p_custom_columns) = 'array' THEN
    INSERT INTO public.kanban_sync_meta (id, periodo_inicio)
    VALUES ('custom_columns', p_custom_columns::text)
    ON CONFLICT (id) DO UPDATE SET periodo_inicio = EXCLUDED.periodo_inicio;
  END IF;

  RETURN v_saved;
END;
$$;

REVOKE ALL ON FUNCTION public.save_budget_kanban_positions(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_budget_kanban_positions(jsonb, jsonb) TO service_role;