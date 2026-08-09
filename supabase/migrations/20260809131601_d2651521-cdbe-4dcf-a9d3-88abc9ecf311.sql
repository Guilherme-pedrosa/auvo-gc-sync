ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS auvo_task_id text,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'MANUAL';
CREATE INDEX IF NOT EXISTS idx_agenda_agendamentos_task ON public.agenda_agendamentos (auvo_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_agendamentos_task_dia ON public.agenda_agendamentos (auvo_task_id, data, colaborador_id) WHERE auvo_task_id IS NOT NULL;