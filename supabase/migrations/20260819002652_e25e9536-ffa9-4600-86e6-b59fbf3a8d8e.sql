-- 0) Remove linhas "orfas" (sem OS) quando a mesma tarefa ja possui linha com OS
DELETE FROM public.tarefas_central t
WHERE t.auvo_task_id NOT LIKE 'gc-only%'
  AND COALESCE(NULLIF(TRIM(t.gc_os_id), ''), '') = ''
  AND EXISTS (
    SELECT 1 FROM public.tarefas_central o
    WHERE o.auvo_task_id = t.auvo_task_id
      AND COALESCE(NULLIF(TRIM(o.gc_os_id), ''), '') <> ''
  );

-- 1) Remove duplicadas da mesma tarefa + mesma OS, mantendo a mais completa
WITH ranked AS (
  SELECT mirror_key,
         ROW_NUMBER() OVER (
           PARTITION BY TRIM(auvo_task_id), COALESCE(NULLIF(TRIM(gc_os_id), ''), '')
           ORDER BY (CASE WHEN COALESCE(gc_orcamento_id,'') <> '' THEN 4 ELSE 0 END
                   + CASE WHEN gc_os_valor_total IS NOT NULL THEN 2 ELSE 0 END
                   + CASE WHEN COALESCE(gc_os_tarefa_exec,'') <> '' THEN 1 ELSE 0 END) DESC,
                    atualizado_em DESC NULLS LAST
         ) AS rn
  FROM public.tarefas_central
  WHERE auvo_task_id NOT LIKE 'gc-only%'
)
DELETE FROM public.tarefas_central t
USING ranked r
WHERE t.mirror_key = r.mirror_key AND r.rn > 1;

-- 2) Normaliza a chave espelho para tarefa + OS (sem o orcamento)
UPDATE public.tarefas_central
SET mirror_key = TRIM(auvo_task_id) || '::os:' || COALESCE(NULLIF(TRIM(gc_os_id), ''), '') || '::orc:'
WHERE auvo_task_id NOT LIKE 'gc-only%'
  AND mirror_key <> TRIM(auvo_task_id) || '::os:' || COALESCE(NULLIF(TRIM(gc_os_id), ''), '') || '::orc:';