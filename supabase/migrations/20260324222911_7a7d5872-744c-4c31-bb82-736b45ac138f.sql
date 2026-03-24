
-- Trigger: when a task in tarefas_central is rescheduled (data_tarefa changes)
-- and the OLD date was in the past and status was NOT "Finalizada",
-- automatically persist to atividades_nao_executadas so the atraso record is never lost.

CREATE OR REPLACE FUNCTION public.fn_capture_rescheduled_atraso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when data_tarefa actually changed
  IF OLD.data_tarefa IS NOT NULL
     AND NEW.data_tarefa IS DISTINCT FROM OLD.data_tarefa
     AND OLD.data_tarefa::date < CURRENT_DATE
     AND COALESCE(OLD.status_auvo, '') NOT IN ('Finalizada', 'Cancelada')
  THEN
    INSERT INTO public.atividades_nao_executadas (
      auvo_task_id,
      tecnico_id,
      tecnico_nome,
      cliente,
      descricao,
      data_planejada,
      status_original,
      motivo
    ) VALUES (
      OLD.auvo_task_id,
      COALESCE(OLD.tecnico_id, ''),
      COALESCE(OLD.tecnico, ''),
      OLD.cliente,
      OLD.orientacao,
      OLD.data_tarefa,
      COALESCE(OLD.status_auvo, 'Reagendada'),
      'Reagendada de ' || OLD.data_tarefa || ' para ' || NEW.data_tarefa
    )
    ON CONFLICT (auvo_task_id, data_planejada) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_rescheduled_atraso ON public.tarefas_central;

CREATE TRIGGER trg_capture_rescheduled_atraso
  BEFORE UPDATE ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capture_rescheduled_atraso();
