ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS previsao_tipo text;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS conversao_status text;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS conversao_erro text;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS conversao_tentada_em timestamp with time zone;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS convertida_em timestamp with time zone;
