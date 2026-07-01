
-- ═══════════════════════════════════════════════════════════════════
-- ITEM 4: Tipos de tarefa preventiva configuráveis (criado ANTES do 2
--          porque a consolidação vai ler daqui)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tipos_tarefa_preventiva (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_task_type_id TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  aplica_a_categoria TEXT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_tarefa_preventiva TO authenticated;
GRANT ALL ON public.tipos_tarefa_preventiva TO service_role;

ALTER TABLE public.tipos_tarefa_preventiva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read tipos_tarefa_preventiva"
  ON public.tipos_tarefa_preventiva FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage tipos_tarefa_preventiva"
  ON public.tipos_tarefa_preventiva FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_tipos_tarefa_preventiva_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_tipos_tarefa_preventiva_atualizado_em
  BEFORE UPDATE ON public.tipos_tarefa_preventiva
  FOR EACH ROW EXECUTE FUNCTION public.set_tipos_tarefa_preventiva_atualizado_em();

-- Seed dos 4 tipos atuais (universais)
INSERT INTO public.tipos_tarefa_preventiva (auvo_task_type_id, descricao, aplica_a_categoria, ativo)
VALUES
  ('180175', 'Preventiva (padrão)', NULL, true),
  ('180176', 'Preventiva (variante)', NULL, true),
  ('202616', 'Preventiva Higienização', NULL, true),
  ('235724', 'Preventiva Extra', NULL, true)
ON CONFLICT (auvo_task_type_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- ITEM 2: Tabela consolidada de preventivas por equipamento
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.equipamento_preventiva_consolidado (
  equip_id UUID PRIMARY KEY REFERENCES public.equipamentos_auvo(id) ON DELETE CASCADE,
  auvo_equipment_id TEXT,
  identificador TEXT,
  nome TEXT,
  cliente TEXT,
  grupo_id UUID,
  categoria TEXT,
  marca TEXT,
  tipo_id UUID,
  tipo_nome TEXT,
  criticidade TEXT,
  periodicidade TEXT,
  periodicidade_meses INTEGER,
  horas_por_tecnico NUMERIC,
  qtd_tecnicos INTEGER,
  ht_por_ocorrencia NUMERIC,
  equip_status TEXT,
  ultima_preventiva DATE,
  ultima_preventiva_task_id TEXT,
  ultima_preventiva_tecnico TEXT,
  ultima_preventiva_link TEXT,
  proxima_preventiva DATE,
  proxima_source TEXT,   -- 'plano' | 'calculada' | null
  status_preventiva TEXT, -- 'nunca' | 'vencido' | 'em_dia'
  total_tarefas INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.equipamento_preventiva_consolidado TO authenticated;
GRANT ALL ON public.equipamento_preventiva_consolidado TO service_role;

ALTER TABLE public.equipamento_preventiva_consolidado ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read consolidado"
  ON public.equipamento_preventiva_consolidado FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_consolidado_cliente ON public.equipamento_preventiva_consolidado (cliente);
CREATE INDEX IF NOT EXISTS idx_consolidado_grupo ON public.equipamento_preventiva_consolidado (grupo_id);
CREATE INDEX IF NOT EXISTS idx_consolidado_status ON public.equipamento_preventiva_consolidado (status_preventiva);
CREATE INDEX IF NOT EXISTS idx_consolidado_proxima ON public.equipamento_preventiva_consolidado (proxima_preventiva);
