-- Tabela de itens/peças amarrados ao card do kanban oficina
CREATE TABLE public.workshop_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_task_id text NOT NULL,
  tipo text NOT NULL DEFAULT 'peca',
  descricao text NOT NULL DEFAULT '',
  quantidade numeric NOT NULL DEFAULT 1,
  preco_unitario numeric NOT NULL DEFAULT 0,
  origem text DEFAULT 'estoque',
  status_item text DEFAULT 'pendente',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Tabela de eventos/histórico (auditoria)
CREATE TABLE public.workshop_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_task_id text NOT NULL,
  from_status text,
  to_status text,
  user_id uuid,
  user_name text,
  note text,
  event_type text NOT NULL DEFAULT 'status_change',
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_workshop_items_task ON public.workshop_job_items(auvo_task_id);
CREATE INDEX idx_workshop_events_task ON public.workshop_job_events(auvo_task_id);
CREATE INDEX idx_workshop_events_created ON public.workshop_job_events(criado_em DESC);

-- RLS
ALTER TABLE public.workshop_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_workshop_items" ON public.workshop_job_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_workshop_items" ON public.workshop_job_items FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_workshop_events" ON public.workshop_job_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_workshop_events" ON public.workshop_job_events FOR ALL TO service_role USING (true) WITH CHECK (true);