ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS previsao_continuidade BOOLEAN DEFAULT FALSE;
GRANT ALL ON public.agenda_agendamentos TO authenticated;
GRANT ALL ON public.agenda_agendamentos TO service_role;
GRANT ALL ON public.agenda_agendamentos TO anon;