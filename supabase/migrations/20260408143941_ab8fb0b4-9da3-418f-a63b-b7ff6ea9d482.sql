
-- Create relational table for native Auvo equipment-task links
CREATE TABLE public.equipamento_tarefas_auvo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auvo_equipment_id TEXT NOT NULL,
  auvo_task_id TEXT NOT NULL,
  auvo_task_type_id TEXT,
  auvo_task_type_description TEXT,
  status_auvo TEXT,
  data_tarefa DATE,
  data_conclusao DATE,
  cliente TEXT,
  tecnico TEXT,
  auvo_link TEXT,
  source TEXT NOT NULL DEFAULT 'native_equipment_relation',
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (auvo_equipment_id, auvo_task_id)
);

-- Indexes for efficient queries
CREATE INDEX idx_equip_tarefas_equipment_id ON public.equipamento_tarefas_auvo (auvo_equipment_id);
CREATE INDEX idx_equip_tarefas_task_id ON public.equipamento_tarefas_auvo (auvo_task_id);
CREATE INDEX idx_equip_tarefas_data_conclusao ON public.equipamento_tarefas_auvo (data_conclusao);
CREATE INDEX idx_equip_tarefas_task_type_id ON public.equipamento_tarefas_auvo (auvo_task_type_id);

-- Enable RLS
ALTER TABLE public.equipamento_tarefas_auvo ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can read equipamento_tarefas"
  ON public.equipamento_tarefas_auvo FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role full access equipamento_tarefas"
  ON public.equipamento_tarefas_auvo FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Anon can read equipamento_tarefas"
  ON public.equipamento_tarefas_auvo FOR SELECT
  TO anon USING (true);
