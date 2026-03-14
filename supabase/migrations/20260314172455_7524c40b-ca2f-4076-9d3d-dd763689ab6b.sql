
CREATE TABLE public.tarefas_central (
  auvo_task_id TEXT PRIMARY KEY,
  
  -- Auvo task data
  cliente TEXT,
  tecnico TEXT,
  tecnico_id TEXT,
  data_tarefa DATE,
  status_auvo TEXT,
  orientacao TEXT,
  pendencia TEXT,
  descricao TEXT,
  duracao_decimal NUMERIC,
  hora_inicio TEXT,
  hora_fim TEXT,
  check_in BOOLEAN DEFAULT FALSE,
  check_out BOOLEAN DEFAULT FALSE,
  endereco TEXT,
  auvo_link TEXT,
  auvo_task_url TEXT,
  auvo_survey_url TEXT,
  
  -- Questionário (respostas em JSON)
  questionario_id TEXT,
  questionario_respostas JSONB DEFAULT '[]'::jsonb,
  questionario_preenchido BOOLEAN DEFAULT FALSE,
  
  -- GestãoClick Orçamento
  gc_orcamento_id TEXT,
  gc_orcamento_codigo TEXT,
  gc_orc_cliente TEXT,
  gc_orc_situacao TEXT,
  gc_orc_situacao_id TEXT,
  gc_orc_cor_situacao TEXT,
  gc_orc_valor_total NUMERIC DEFAULT 0,
  gc_orc_vendedor TEXT,
  gc_orc_data DATE,
  gc_orc_link TEXT,
  orcamento_realizado BOOLEAN DEFAULT FALSE,
  
  -- GestãoClick OS
  gc_os_id TEXT,
  gc_os_codigo TEXT,
  gc_os_cliente TEXT,
  gc_os_situacao TEXT,
  gc_os_situacao_id TEXT,
  gc_os_cor_situacao TEXT,
  gc_os_valor_total NUMERIC DEFAULT 0,
  gc_os_vendedor TEXT,
  gc_os_data DATE,
  gc_os_link TEXT,
  os_realizada BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX idx_tarefas_central_data ON public.tarefas_central(data_tarefa);
CREATE INDEX idx_tarefas_central_tecnico ON public.tarefas_central(tecnico);
CREATE INDEX idx_tarefas_central_atualizado ON public.tarefas_central(atualizado_em);

-- RLS
ALTER TABLE public.tarefas_central ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_central" ON public.tarefas_central FOR SELECT TO anon USING (true);
CREATE POLICY "auth_read_central" ON public.tarefas_central FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all_central" ON public.tarefas_central FOR ALL TO service_role USING (true) WITH CHECK (true);
