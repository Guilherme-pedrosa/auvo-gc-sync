CREATE TABLE public.atividades_nao_executadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_task_id text NOT NULL,
  tecnico_id text NOT NULL,
  tecnico_nome text NOT NULL,
  cliente text,
  descricao text,
  data_planejada date NOT NULL,
  status_original text NOT NULL DEFAULT 'Agendada',
  motivo text,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auvo_task_id, data_planejada)
);

ALTER TABLE public.atividades_nao_executadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_atividades" ON public.atividades_nao_executadas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_atividades" ON public.atividades_nao_executadas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_atividades" ON public.atividades_nao_executadas FOR ALL TO service_role USING (true) WITH CHECK (true);