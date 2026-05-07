DELETE FROM kanban_orcamentos_cache k
USING tarefas_central t
WHERE k.auvo_task_id=t.auvo_task_id
  AND k.coluna='os_realizada'
  AND (t.gc_os_id IS NULL OR t.os_realizada IS NOT TRUE);

DELETE FROM kanban_orcamentos_cache k
WHERE k.coluna='os_realizada'
  AND NOT EXISTS (SELECT 1 FROM tarefas_central t WHERE t.auvo_task_id=k.auvo_task_id);