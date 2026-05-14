-- AÇÃO 1 — Tabela os_revisao
CREATE TABLE IF NOT EXISTS public.os_revisao (
  auvo_task_id TEXT PRIMARY KEY,
  status_revisao TEXT NOT NULL CHECK (
    status_revisao IN ('pendente','aprovada','rejeitada','ajustada')
  ),
  alertas_motivo TEXT NOT NULL,
  horas_originais NUMERIC NOT NULL,
  horas_ajustadas NUMERIC,
  justificativa TEXT,
  decidido_por TEXT,
  decidido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_revisao_status
  ON public.os_revisao(status_revisao);

ALTER TABLE public.os_revisao ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='os_revisao' AND policyname='anon_read_revisao') THEN
    CREATE POLICY "anon_read_revisao" ON public.os_revisao FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='os_revisao' AND policyname='auth_all_revisao') THEN
    CREATE POLICY "auth_all_revisao" ON public.os_revisao FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='os_revisao' AND policyname='service_all_revisao') THEN
    CREATE POLICY "service_all_revisao" ON public.os_revisao FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_os_revisao_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revisao_updated ON public.os_revisao;
CREATE TRIGGER trg_revisao_updated BEFORE UPDATE ON public.os_revisao
  FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_at();

-- AÇÃO 2 — Colunas em valor_hora_config
ALTER TABLE public.valor_hora_config
  ADD COLUMN IF NOT EXISTS valor_hora_fds NUMERIC,
  ADD COLUMN IF NOT EXISTS taxa_fixa_emergencial NUMERIC,
  ADD COLUMN IF NOT EXISTS aplica_taxa_emergencial BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS task_types_emergenciais TEXT;

-- AÇÃO 3 — alertas_horas_config: garantir tabela, linha padrão e colunas
CREATE TABLE IF NOT EXISTS public.alertas_horas_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limite_minimo_minutos INTEGER NOT NULL DEFAULT 45,
  limite_maximo_horas NUMERIC NOT NULL DEFAULT 8,
  limite_excessivo_horas NUMERIC NOT NULL DEFAULT 12,
  detectar_overlap_tecnico BOOLEAN NOT NULL DEFAULT TRUE,
  detectar_horas_negativas BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.alertas_horas_config DEFAULT VALUES
  ON CONFLICT DO NOTHING;

ALTER TABLE public.alertas_horas_config
  ADD COLUMN IF NOT EXISTS curta_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS longa_requer_revisao BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excessiva_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS negativa_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS overlap_requer_revisao BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sem_janela_requer_revisao BOOLEAN DEFAULT TRUE;

ALTER TABLE public.alertas_horas_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alertas_horas_config' AND policyname='anon_read_alertas') THEN
    CREATE POLICY "anon_read_alertas" ON public.alertas_horas_config FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alertas_horas_config' AND policyname='auth_all_alertas') THEN
    CREATE POLICY "auth_all_alertas" ON public.alertas_horas_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;