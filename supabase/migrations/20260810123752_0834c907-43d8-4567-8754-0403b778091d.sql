ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS previsao_detalhes text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_agendamentos TO authenticated;
GRANT ALL ON public.agenda_agendamentos TO service_role;
