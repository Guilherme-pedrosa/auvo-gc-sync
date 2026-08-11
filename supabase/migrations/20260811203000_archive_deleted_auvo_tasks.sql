-- Arquiva tarefas comprovadamente excluidas no Auvo e retira somente os
-- espelhos derivados da tarefa. A operacao inteira e transacional: se o log
-- falhar, nenhum dado ativo e removido.

CREATE TABLE IF NOT EXISTS public.tarefas_auvo_excluidas (
  auvo_task_id text PRIMARY KEY,
  detectada_primeiro_em timestamptz NOT NULL DEFAULT now(),
  detectada_ultimo_em timestamptz NOT NULL DEFAULT now(),
  ocorrencias integer NOT NULL DEFAULT 1,
  motivo text NOT NULL DEFAULT 'nao_encontrada_no_auvo',
  origem_sync text NOT NULL,
  periodo_inicio date,
  periodo_fim date,
  tarefas_central_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipamentos_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  agenda_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  agenda_tags_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  atividades_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  removido_das_tabelas_ativas_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefas_auvo_excluidas_detectada
  ON public.tarefas_auvo_excluidas (detectada_ultimo_em DESC);

ALTER TABLE public.tarefas_auvo_excluidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read deleted auvo tasks" ON public.tarefas_auvo_excluidas;
CREATE POLICY "authenticated read deleted auvo tasks"
  ON public.tarefas_auvo_excluidas
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "service role manages deleted auvo tasks" ON public.tarefas_auvo_excluidas;
CREATE POLICY "service role manages deleted auvo tasks"
  ON public.tarefas_auvo_excluidas
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.tarefas_auvo_excluidas TO authenticated;
GRANT ALL ON public.tarefas_auvo_excluidas TO service_role;

CREATE OR REPLACE FUNCTION public.arquivar_tarefas_auvo_excluidas(
  p_task_ids text[],
  p_origem_sync text,
  p_periodo_inicio date,
  p_periodo_fim date
)
RETURNS TABLE (
  arquivadas integer,
  central_removidas integer,
  equipamentos_removidos integer,
  agenda_removida integer,
  atividades_removidas integer,
  vinculos_kanban_os_limpados integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
  v_central integer := 0;
  v_equipamentos integer := 0;
  v_agenda integer := 0;
  v_atividades integer := 0;
  v_kanban integer := 0;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT btrim(ids.task_id)), ARRAY[]::text[])
    INTO v_ids
  FROM unnest(COALESCE(p_task_ids, ARRAY[]::text[])) AS ids(task_id)
  WHERE btrim(ids.task_id) ~ '^[1-9][0-9]*$';

  IF cardinality(v_ids) = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  INSERT INTO public.tarefas_auvo_excluidas (
    auvo_task_id,
    motivo,
    origem_sync,
    periodo_inicio,
    periodo_fim,
    tarefas_central_snapshot,
    equipamentos_snapshot,
    agenda_snapshot,
    agenda_tags_snapshot,
    atividades_snapshot,
    removido_das_tabelas_ativas_em
  )
  SELECT
    ids.task_id,
    'confirmada_ausente_em_duas_consultas_individuais_auvo',
    COALESCE(NULLIF(btrim(p_origem_sync), ''), 'sync'),
    p_periodo_inicio,
    p_periodo_fim,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.mirror_key)
      FROM public.tarefas_central t
      WHERE t.auvo_task_id = ids.task_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)
      FROM public.equipamento_tarefas_auvo e
      WHERE e.auvo_task_id = ids.task_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM public.agenda_agendamentos a
      WHERE a.auvo_task_id = ids.task_id
        AND upper(COALESCE(a.origem, '')) = 'AUVO'
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(at) ORDER BY at.agendamento_id, at.tag_id)
      FROM public.agenda_agendamento_tags at
      JOIN public.agenda_agendamentos a ON a.id = at.agendamento_id
      WHERE a.auvo_task_id = ids.task_id
        AND upper(COALESCE(a.origem, '')) = 'AUVO'
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.data_planejada, n.id)
      FROM public.atividades_nao_executadas n
      WHERE n.auvo_task_id = ids.task_id
    ), '[]'::jsonb),
    now()
  FROM unnest(v_ids) AS ids(task_id)
  ON CONFLICT (auvo_task_id) DO UPDATE SET
    detectada_ultimo_em = now(),
    ocorrencias = public.tarefas_auvo_excluidas.ocorrencias + 1,
    motivo = EXCLUDED.motivo,
    origem_sync = EXCLUDED.origem_sync,
    periodo_inicio = EXCLUDED.periodo_inicio,
    periodo_fim = EXCLUDED.periodo_fim,
    tarefas_central_snapshot = EXCLUDED.tarefas_central_snapshot,
    equipamentos_snapshot = EXCLUDED.equipamentos_snapshot,
    agenda_snapshot = EXCLUDED.agenda_snapshot,
    agenda_tags_snapshot = EXCLUDED.agenda_tags_snapshot,
    atividades_snapshot = EXCLUDED.atividades_snapshot,
    removido_das_tabelas_ativas_em = now();

  -- O cache do Kanban OS pertence a OS do GC, nao a tarefa Auvo. Mantemos o
  -- card e retiramos apenas a referencia morta da tarefa.
  UPDATE public.kanban_os_cache
  SET auvo_task_id = NULL,
      atualizado_em = now()
  WHERE auvo_task_id = ANY(v_ids);
  GET DIAGNOSTICS v_kanban = ROW_COUNT;

  DELETE FROM public.atividades_nao_executadas
  WHERE auvo_task_id = ANY(v_ids);
  GET DIAGNOSTICS v_atividades = ROW_COUNT;

  DELETE FROM public.equipamento_tarefas_auvo
  WHERE auvo_task_id = ANY(v_ids);
  GET DIAGNOSTICS v_equipamentos = ROW_COUNT;

  -- Apenas espelhos criados a partir do Auvo. Previsoes MANUAL/CONTRATO nunca
  -- entram nesta exclusao, mesmo que tenham algum dado legado semelhante.
  DELETE FROM public.agenda_agendamentos
  WHERE auvo_task_id = ANY(v_ids)
    AND upper(COALESCE(origem, '')) = 'AUVO';
  GET DIAGNOSTICS v_agenda = ROW_COUNT;

  DELETE FROM public.tarefas_central
  WHERE auvo_task_id = ANY(v_ids);
  GET DIAGNOSTICS v_central = ROW_COUNT;

  RETURN QUERY SELECT
    cardinality(v_ids),
    v_central,
    v_equipamentos,
    v_agenda,
    v_atividades,
    v_kanban;
END;
$$;

REVOKE ALL ON FUNCTION public.arquivar_tarefas_auvo_excluidas(text[], text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arquivar_tarefas_auvo_excluidas(text[], text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.arquivar_tarefas_auvo_excluidas(text[], text, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.arquivar_tarefas_auvo_excluidas(text[], text, date, date) TO service_role;
