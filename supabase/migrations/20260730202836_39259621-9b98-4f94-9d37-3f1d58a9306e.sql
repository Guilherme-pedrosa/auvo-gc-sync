CREATE TABLE public.analises_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_task_id text NOT NULL UNIQUE,
  auvo_equipment_id text,
  equipamento_nome text,
  identificador text,
  cliente text,
  grupo_nome text,
  marca text,
  categoria text,
  tecnico text,
  data_preventiva date,
  status_tarefa text,
  status_analise text NOT NULL DEFAULT 'nova',
  prioridade text NOT NULL DEFAULT 'baixa',
  diagnostico_ia text,
  pendencia text,
  acao_sugerida text,
  satisfacao integer,
  auvo_link text,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacoes_gerenciais text,
  data_analise timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analises_operacionais TO authenticated;
GRANT ALL ON public.analises_operacionais TO service_role;
ALTER TABLE public.analises_operacionais ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analises_select" ON public.analises_operacionais FOR SELECT TO authenticated USING (true);
CREATE POLICY "analises_insert" ON public.analises_operacionais FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "analises_update" ON public.analises_operacionais FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_analises_data_preventiva ON public.analises_operacionais(data_preventiva);
CREATE INDEX idx_analises_status ON public.analises_operacionais(status_analise);

CREATE TRIGGER trg_analises_updated_at
BEFORE UPDATE ON public.analises_operacionais
FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

CREATE TABLE public.analises_operacionais_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analise_id uuid NOT NULL REFERENCES public.analises_operacionais(id) ON DELETE CASCADE,
  status_anterior text,
  status_novo text NOT NULL,
  observacao text,
  user_id uuid,
  user_nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.analises_operacionais_log TO authenticated;
GRANT ALL ON public.analises_operacionais_log TO service_role;
ALTER TABLE public.analises_operacionais_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analises_log_select" ON public.analises_operacionais_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "analises_log_insert" ON public.analises_operacionais_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_analises_log_analise ON public.analises_operacionais_log(analise_id);