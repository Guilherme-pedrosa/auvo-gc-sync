-- Garante a coluna e recupera durações planejadas que ficaram nulas quando a
-- migration simplificada foi aplicada sem o backfill original.

ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS duracao_planejada_minutos integer;

WITH managed_duration AS (
  SELECT DISTINCT ON (auvo_task_id)
    auvo_task_id,
    substring(descricao from '^\[WEDO:[0-9]+:([0-9]+)\]')::integer AS minutos
  FROM public.tarefas_central
  WHERE NULLIF(btrim(auvo_task_id), '') IS NOT NULL
    AND descricao ~ '^\[WEDO:[0-9]+:[0-9]+\]'
  ORDER BY auvo_task_id, atualizado_em DESC
)
UPDATE public.agenda_agendamentos AS agenda
SET duracao_planejada_minutos = managed_duration.minutos
FROM managed_duration
WHERE agenda.auvo_task_id = managed_duration.auvo_task_id
  AND agenda.duracao_planejada_minutos IS NULL
  AND managed_duration.minutos BETWEEN 1 AND 10080;

-- Em OS ainda não executadas, hora_inicio/hora_fim representam a janela que
-- foi planejada. Histórico comum não é inferido porque pode conter o tempo real.
UPDATE public.agenda_agendamentos AS agenda
SET duracao_planejada_minutos = (
  (
    EXTRACT(EPOCH FROM agenda.hora_fim)::integer
    - EXTRACT(EPOCH FROM agenda.hora_inicio)::integer
    + 86400
  ) % 86400
) / 60
WHERE agenda.duracao_planejada_minutos IS NULL
  AND NULLIF(btrim(agenda.gc_os_codigo), '') IS NOT NULL
  AND agenda.hora_fim IS DISTINCT FROM agenda.hora_inicio
  AND (
    agenda.data > CURRENT_DATE
    OR agenda.auvo_task_id IS NULL
    OR (
      agenda.data = CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM public.tarefas_central AS tarefa
        WHERE tarefa.auvo_task_id = agenda.auvo_task_id
          AND NULLIF(btrim(tarefa.check_in_iso::text), '') IS NOT NULL
      )
    )
  );

NOTIFY pgrst, 'reload schema';
