CREATE OR REPLACE FUNCTION public.upsert_budget_kanban_sync_items_v2(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item RECORD;
    v_new_coluna TEXT;
BEGIN
    FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        auvo_task_id text,
        dados jsonb,
        auto_coluna text,
        posicao int
    ) LOOP
        -- Se a coluna automática for 'resolvido_finalizado', removemos do Kanban de Orçamentos
        IF item.auto_coluna = 'resolvido_finalizado' THEN
            DELETE FROM public.kanban_orcamentos_cache WHERE auvo_task_id = item.auvo_task_id;
            CONTINUE;
        END IF;

        -- Busca o estado atual para saber se foi movido manualmente para 'resolvido_sem_orcamento' ou similar
        SELECT coluna INTO v_new_coluna FROM public.kanban_orcamentos_cache WHERE auvo_task_id = item.auvo_task_id;

        -- Regra de preservação: se não existe ou se a coluna atual é de sistema, aceita a auto_coluna.
        -- Se for uma coluna manual (como resolvido_sem_orcamento), mantém o que está.
        IF v_new_coluna IS NULL OR v_new_coluna IN ('a_fazer', 'falta_preenchimento', 'os_realizada') OR v_new_coluna LIKE 'orc_%' THEN
            v_new_coluna := item.auto_coluna;
        END IF;

        INSERT INTO public.kanban_orcamentos_cache (auvo_task_id, dados, coluna, posicao, atualizado_em)
        VALUES (item.auvo_task_id, item.dados, v_new_coluna, item.posicao, now())
        ON CONFLICT (auvo_task_id) DO UPDATE SET
            dados = EXCLUDED.dados,
            coluna = v_new_coluna,
            posicao = EXCLUDED.posicao,
            atualizado_em = now();
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_budget_kanban_sync_items_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_budget_kanban_sync_items_v2(jsonb) TO service_role;
