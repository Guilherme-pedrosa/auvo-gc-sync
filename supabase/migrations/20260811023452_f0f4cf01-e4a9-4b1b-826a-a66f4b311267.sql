ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS duracao_planejada_minutos integer;

ALTER TABLE public.agenda_agendamentos
  DROP CONSTRAINT IF EXISTS agenda_duracao_planejada_minutos_chk;

ALTER TABLE public.agenda_agendamentos
  ADD CONSTRAINT agenda_duracao_planejada_minutos_chk
  CHECK (
    duracao_planejada_minutos IS NULL
    OR duracao_planejada_minutos BETWEEN 1 AND 10080
  );

CREATE INDEX IF NOT EXISTS idx_agenda_os_planejamento_diario
  ON public.agenda_agendamentos (data, colaborador_id)
  WHERE gc_os_codigo IS NOT NULL
    AND duracao_planejada_minutos IS NOT NULL;