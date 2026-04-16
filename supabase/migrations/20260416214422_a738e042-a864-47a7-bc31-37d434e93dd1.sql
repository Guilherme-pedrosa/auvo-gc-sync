
CREATE TABLE IF NOT EXISTS public.kanban_resolution_details (
  auvo_task_id text PRIMARY KEY,
  motivo text NOT NULL,
  resolvido_por_id uuid,
  resolvido_por_nome text,
  resolvido_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kanban_resolution_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_resolution_details" ON public.kanban_resolution_details
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_resolution_details" ON public.kanban_resolution_details
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "service_all_resolution_details" ON public.kanban_resolution_details
  FOR ALL TO service_role USING (true) WITH CHECK (true);
