-- Estado explícito e operações atômicas do Kanban de Orçamentos.
-- A migration é apenas aditiva: o código anterior continua funcionando se houver rollback.

ALTER TABLE public.kanban_resolution_details
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz,
  ADD COLUMN IF NOT EXISTS reaberto_por_id uuid,
  ADD COLUMN IF NOT EXISTS reaberto_por_nome text;

-- Antes desta migration, "Reabrir" não apagava o motivo. Portanto a existência
-- de um detalhe não prova que a resolução ainda está ativa; a coluna atual é a
-- fonte mais segura para o backfill sem ressuscitar cards já reabertos.
UPDATE public.kanban_resolution_details d
SET ativo = EXISTS (
  SELECT 1
  FROM public.kanban_orcamentos_cache k
  WHERE k.auvo_task_id = d.auvo_task_id
    AND k.coluna = 'resolvido_sem_orcamento'
);

CREATE INDEX IF NOT EXISTS idx_kanban_resolution_details_ativos
  ON public.kanban_resolution_details (auvo_task_id)
  WHERE ativo = true;

CREATE OR REPLACE FUNCTION public.resolve_budget_kanban_item(
  p_task_id text,
  p_motivo text,
  p_user_id uuid DEFAULT NULL,
  p_user_name text DEFAULT NULL
)
RETURNS TABLE (
  auvo_task_id text,
  coluna text,
  posicao integer,
  resolvido_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_position integer;
BEGIN
  IF NULLIF(btrim(p_task_id), '') IS NULL THEN
    RAISE EXCEPTION 'auvo_task_id obrigatório';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'motivo deve ter ao menos 3 caracteres';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kanban_orcamentos_cache k WHERE k.auvo_task_id = p_task_id
  ) THEN
    RAISE EXCEPTION 'card % não encontrado no cache', p_task_id;
  END IF;

  -- Ao apenas editar o motivo, mantém a posição atual. Em uma resolução nova,
  -- insere o card no topo da coluna.
  SELECT k.posicao
    INTO v_position
  FROM public.kanban_orcamentos_cache k
  WHERE k.auvo_task_id = p_task_id
    AND k.coluna = 'resolvido_sem_orcamento';

  IF NOT FOUND THEN
    SELECT COALESCE(MIN(k.posicao), 0) - 1
      INTO v_position
    FROM public.kanban_orcamentos_cache k
    WHERE k.coluna = 'resolvido_sem_orcamento';
  END IF;

  INSERT INTO public.kanban_resolution_details (
    auvo_task_id,
    motivo,
    resolvido_por_id,
    resolvido_por_nome,
    resolvido_em,
    atualizado_em,
    ativo,
    reaberto_em,
    reaberto_por_id,
    reaberto_por_nome
  ) VALUES (
    p_task_id,
    btrim(p_motivo),
    p_user_id,
    p_user_name,
    v_now,
    v_now,
    true,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (auvo_task_id) DO UPDATE SET
    motivo = EXCLUDED.motivo,
    resolvido_por_id = EXCLUDED.resolvido_por_id,
    resolvido_por_nome = EXCLUDED.resolvido_por_nome,
    resolvido_em = EXCLUDED.resolvido_em,
    atualizado_em = EXCLUDED.atualizado_em,
    ativo = true,
    reaberto_em = NULL,
    reaberto_por_id = NULL,
    reaberto_por_nome = NULL;

  UPDATE public.kanban_orcamentos_cache k
  SET coluna = 'resolvido_sem_orcamento',
      posicao = v_position,
      atualizado_em = v_now
  WHERE k.auvo_task_id = p_task_id;

  RETURN QUERY
  SELECT p_task_id, 'resolvido_sem_orcamento'::text, v_position, v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_budget_kanban_item(
  p_task_id text,
  p_target_column text,
  p_user_id uuid DEFAULT NULL,
  p_user_name text DEFAULT NULL
)
RETURNS TABLE (
  auvo_task_id text,
  coluna text,
  posicao integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_position integer;
  v_target text := btrim(COALESCE(p_target_column, ''));
BEGIN
  IF NULLIF(btrim(p_task_id), '') IS NULL THEN
    RAISE EXCEPTION 'auvo_task_id obrigatório';
  END IF;
  IF v_target NOT IN ('a_fazer', 'falta_preenchimento', 'os_realizada')
     AND v_target NOT LIKE 'orc_%' THEN
    RAISE EXCEPTION 'coluna automática inválida: %', v_target;
  END IF;

  SELECT COALESCE(MIN(k.posicao), 0) - 1
    INTO v_position
  FROM public.kanban_orcamentos_cache k
  WHERE k.coluna = v_target;

  UPDATE public.kanban_resolution_details d
  SET ativo = false,
      atualizado_em = v_now,
      reaberto_em = v_now,
      reaberto_por_id = p_user_id,
      reaberto_por_nome = p_user_name
  WHERE d.auvo_task_id = p_task_id;

  UPDATE public.kanban_orcamentos_cache k
  SET coluna = v_target,
      posicao = v_position,
      atualizado_em = v_now
  WHERE k.auvo_task_id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'card % não encontrado no cache', p_task_id;
  END IF;

  RETURN QUERY SELECT p_task_id, v_target, v_position;
END;
$$;

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

    UPDATE public.kanban_orcamentos_cache k
    SET coluna = CASE
          WHEN k.coluna = 'resolvido_sem_orcamento' OR EXISTS (
            SELECT 1
            FROM public.kanban_resolution_details d
            WHERE d.auvo_task_id = k.auvo_task_id AND d.ativo = true
          ) THEN 'resolvido_sem_orcamento'
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

CREATE OR REPLACE FUNCTION public.upsert_budget_kanban_sync_items(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_saved integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'items deve ser um array';
  END IF;

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
      AS x(auvo_task_id text, dados jsonb, auto_coluna text, posicao integer)
  LOOP
    IF NULLIF(btrim(v_row.auvo_task_id), '') IS NULL OR v_row.dados IS NULL THEN
      RAISE EXCEPTION 'item de sincronização inválido';
    END IF;

    INSERT INTO public.kanban_orcamentos_cache AS cache (
      auvo_task_id,
      dados,
      coluna,
      posicao,
      atualizado_em
    ) VALUES (
      v_row.auvo_task_id,
      v_row.dados,
      v_row.auto_coluna,
      v_row.posicao,
      now()
    )
    ON CONFLICT (auvo_task_id) DO UPDATE SET
      dados = EXCLUDED.dados,
      coluna = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.kanban_resolution_details d
          WHERE d.auvo_task_id = cache.auvo_task_id AND d.ativo = true
        ) THEN 'resolvido_sem_orcamento'
        WHEN cache.coluna NOT IN ('a_fazer', 'falta_preenchimento', 'os_realizada')
             AND cache.coluna NOT LIKE 'orc_%' THEN cache.coluna
        ELSE EXCLUDED.coluna
      END,
      posicao = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.kanban_resolution_details d
          WHERE d.auvo_task_id = cache.auvo_task_id AND d.ativo = true
        ) THEN cache.posicao
        WHEN cache.coluna NOT IN ('a_fazer', 'falta_preenchimento', 'os_realizada')
             AND cache.coluna NOT LIKE 'orc_%' THEN cache.posicao
        WHEN cache.coluna = EXCLUDED.coluna THEN cache.posicao
        ELSE EXCLUDED.posicao
      END,
      atualizado_em = EXCLUDED.atualizado_em;

    v_saved := v_saved + 1;
  END LOOP;

  RETURN v_saved;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_budget_kanban_item(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_budget_kanban_item(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_budget_kanban_positions(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_budget_kanban_sync_items(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_budget_kanban_item(text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_budget_kanban_item(text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_budget_kanban_positions(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_budget_kanban_sync_items(jsonb) TO service_role;
