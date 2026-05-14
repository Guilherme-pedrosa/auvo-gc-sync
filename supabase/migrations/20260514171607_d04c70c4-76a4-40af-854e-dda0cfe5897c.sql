-- 1) Tabela de auditoria de revisão por OS
CREATE TABLE IF NOT EXISTS public.os_revisao (
  auvo_task_id TEXT PRIMARY KEY,
  status_revisao TEXT NOT NULL CHECK (
    status_revisao IN ('pendente', 'aprovada', 'rejeitada', 'ajustada')
  ),
  alertas_motivo TEXT NOT NULL,
  horas_originais NUMERIC NOT NULL,
  horas_ajustadas NUMERIC,
  justificativa TEXT,
  decidido_por TEXT,
  decidido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_revisao_status
  ON public.os_revisao(status_revisao);

ALTER TABLE public.os_revisao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_os_revisao" ON public.os_revisao;
CREATE POLICY "anon_read_os_revisao" ON public.os_revisao
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "auth_read_os_revisao" ON public.os_revisao;
CREATE POLICY "auth_read_os_revisao" ON public.os_revisao
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_os_revisao" ON public.os_revisao;
CREATE POLICY "auth_write_os_revisao" ON public.os_revisao
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_all_os_revisao" ON public.os_revisao;
CREATE POLICY "service_all_os_revisao" ON public.os_revisao
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger para atualizado_em
CREATE OR REPLACE FUNCTION public.update_os_revisao_atualizado_em()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_os_revisao_updated ON public.os_revisao;
CREATE TRIGGER trg_os_revisao_updated
  BEFORE UPDATE ON public.os_revisao
  FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_atualizado_em();

-- 2) Toggles "requer revisão" por tipo de alerta
ALTER TABLE public.alertas_horas_config
  ADD COLUMN IF NOT EXISTS curta_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS longa_requer_revisao BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excessiva_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS negativa_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS overlap_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sem_checkout_requer_revisao BOOLEAN DEFAULT TRUE;