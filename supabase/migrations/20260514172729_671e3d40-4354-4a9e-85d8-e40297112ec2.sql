ALTER TABLE public.alertas_horas_config
  ADD COLUMN IF NOT EXISTS sem_janela_requer_revisao BOOLEAN DEFAULT TRUE;

UPDATE public.alertas_horas_config
SET sem_janela_requer_revisao = COALESCE(sem_janela_requer_revisao, TRUE);