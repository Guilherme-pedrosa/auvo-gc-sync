-- Tabela de log da sincronização Auvo → GC
CREATE TABLE IF NOT EXISTS public.auvo_gc_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  os_candidatas   INT DEFAULT 0,
  os_atualizadas  INT DEFAULT 0,
  os_com_pendencia INT DEFAULT 0,
  os_sem_pendencia INT DEFAULT 0,
  os_nao_encontradas INT DEFAULT 0,
  erros           INT DEFAULT 0,
  dry_run         BOOLEAN DEFAULT false,
  duracao_ms      INT,
  detalhes        JSONB,
  observacao      TEXT
);

-- Index para consultas por data
CREATE INDEX IF NOT EXISTS idx_auvo_sync_log_data ON public.auvo_gc_sync_log (executado_em DESC);

-- RLS: somente service role pode inserir, authenticated pode ler
ALTER TABLE public.auvo_gc_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.auvo_gc_sync_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read" ON public.auvo_gc_sync_log
  FOR SELECT TO authenticated USING (true);