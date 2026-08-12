DELETE FROM public.kanban_orcamentos_cache k
WHERE EXISTS (
  SELECT 1 FROM public.tarefas_central t
  WHERE t.auvo_task_id::text = k.auvo_task_id
    AND t.questionario_id IS NOT NULL
    AND t.questionario_id::text <> '216040'
)
AND NOT EXISTS (
  SELECT 1 FROM public.tarefas_central t2
  WHERE t2.auvo_task_id::text = k.auvo_task_id
    AND t2.questionario_id::text = '216040'
);