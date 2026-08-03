CREATE OR REPLACE FUNCTION public.resolve_budget_kanban_item(p_task_id text, p_motivo text, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(auvo_task_id text, coluna text, posicao integer, resolvido_em timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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

  INSERT INTO public.kanban_resolution_details AS d (
    auvo_task_id, motivo, resolvido_por_id, resolvido_por_nome,
    resolvido_em, atualizado_em, ativo, reaberto_em, reaberto_por_id, reaberto_por_nome
  ) VALUES (
    p_task_id, btrim(p_motivo), p_user_id, p_user_name,
    v_now, v_now, true, NULL, NULL, NULL
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

  RETURN QUERY SELECT p_task_id, 'resolvido_sem_orcamento'::text, v_position, v_now;
END;
$function$;