ALTER TABLE public.tarefas_central
  ADD COLUMN IF NOT EXISTS check_in_iso TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_iso TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tarefas_central_check_in_iso
  ON public.tarefas_central (check_in_iso);

CREATE INDEX IF NOT EXISTS idx_tarefas_central_check_out_iso
  ON public.tarefas_central (check_out_iso);