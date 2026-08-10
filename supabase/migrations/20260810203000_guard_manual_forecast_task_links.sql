-- Previsoes internas nao sao tarefas Auvo. O vinculo so passa a existir quando
-- a previsao de orcamento e promovida pela funcao promover_previsao_orcamento,
-- que tambem troca previsao_continuidade para false.

UPDATE public.agenda_agendamentos
SET
  auvo_task_id = NULL,
  status = 'PREVISAO',
  previsao_tipo = CASE
    WHEN NULLIF(regexp_replace(COALESCE(gc_orcamento_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
      THEN 'ORCAMENTO_EXECUCAO'
    WHEN NULLIF(regexp_replace(COALESCE(gc_os_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
      THEN 'OS_EXECUCAO'
    ELSE 'CONTINUACAO'
  END,
  conversao_status = CASE
    WHEN NULLIF(regexp_replace(COALESCE(gc_orcamento_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
      THEN CASE
        WHEN NULLIF(regexp_replace(COALESCE(gc_os_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
          THEN 'AGUARDANDO_TAREFA'
        ELSE 'AGUARDANDO_OS'
      END
    ELSE NULL
  END,
  conversao_erro = NULL,
  conversao_tentada_em = NULL,
  convertida_em = NULL,
  atualizado_em = now()
WHERE previsao_continuidade IS TRUE
  AND origem = 'MANUAL'
  AND NULLIF(btrim(auvo_task_id), '') IS NOT NULL
  AND conversao_status IS DISTINCT FROM 'CONVERTIDA';

CREATE OR REPLACE FUNCTION public.normalizar_previsao_manual_sem_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.previsao_continuidade IS TRUE
     AND NEW.origem = 'MANUAL'
     AND NEW.conversao_status IS DISTINCT FROM 'CONVERTIDA' THEN
    NEW.auvo_task_id := NULL;
    NEW.status := 'PREVISAO';

    IF NEW.previsao_tipo IS NULL THEN
      NEW.previsao_tipo := CASE
        WHEN NULLIF(regexp_replace(COALESCE(NEW.gc_orcamento_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
          THEN 'ORCAMENTO_EXECUCAO'
        WHEN NULLIF(regexp_replace(COALESCE(NEW.gc_os_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
          THEN 'OS_EXECUCAO'
        ELSE 'CONTINUACAO'
      END;
    END IF;

    IF NEW.previsao_tipo = 'ORCAMENTO_EXECUCAO' AND NEW.conversao_status IS NULL THEN
      NEW.conversao_status := CASE
        WHEN NULLIF(regexp_replace(COALESCE(NEW.gc_os_codigo, ''), '\D', '', 'g'), '') IS NOT NULL
          THEN 'AGUARDANDO_TAREFA'
        ELSE 'AGUARDANDO_OS'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalizar_previsao_manual_sem_tarefa
  ON public.agenda_agendamentos;

CREATE TRIGGER trg_normalizar_previsao_manual_sem_tarefa
BEFORE INSERT OR UPDATE ON public.agenda_agendamentos
FOR EACH ROW
EXECUTE FUNCTION public.normalizar_previsao_manual_sem_tarefa();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agenda_previsao_manual_sem_tarefa_chk'
      AND conrelid = 'public.agenda_agendamentos'::regclass
  ) THEN
    ALTER TABLE public.agenda_agendamentos
      ADD CONSTRAINT agenda_previsao_manual_sem_tarefa_chk
      CHECK (
        NOT (
          previsao_continuidade IS TRUE
          AND origem = 'MANUAL'
          AND conversao_status IS DISTINCT FROM 'CONVERTIDA'
          AND NULLIF(btrim(auvo_task_id), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.agenda_agendamentos
  VALIDATE CONSTRAINT agenda_previsao_manual_sem_tarefa_chk;
