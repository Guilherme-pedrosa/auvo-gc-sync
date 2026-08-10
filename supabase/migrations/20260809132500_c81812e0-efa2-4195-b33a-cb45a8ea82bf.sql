ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS gc_os_codigo TEXT;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS gc_orcamento_codigo TEXT;

GRANT ALL ON public.agenda_agendamentos TO authenticated;
GRANT ALL ON public.agenda_agendamentos TO service_role;
GRANT ALL ON public.agenda_agendamentos TO anon;