-- Portal de preventivas: histórico consultado por item/data.
CREATE INDEX IF NOT EXISTS idx_plano_preventivo_execucao_item_data
  ON public.plano_preventivo_execucao (item_id, data_realizada DESC);
CREATE INDEX IF NOT EXISTS idx_plano_preventivo_execucao_task
  ON public.plano_preventivo_execucao (task_id)
  WHERE task_id IS NOT NULL;

-- Mantém o vínculo estável do equipamento com o cliente do Auvo mesmo quando o
-- nome é alterado na plataforma.
ALTER TABLE public.equipamentos_auvo
  ADD COLUMN IF NOT EXISTS auvo_customer_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_equipamentos_auvo_customer
  ON public.equipamentos_auvo (auvo_customer_id)
  WHERE auvo_customer_id IS NOT NULL;

-- Cadastro central RH > Clientes: os IDs são a fonte de verdade; os nomes dos
-- dois sistemas ficam separados para permitir auditoria de divergências.
ALTER TABLE public.rh_clientes
  ADD COLUMN IF NOT EXISTS auvo_cliente_id BIGINT,
  ADD COLUMN IF NOT EXISTS nome_gc TEXT,
  ADD COLUMN IF NOT EXISTS nome_auvo TEXT,
  ADD COLUMN IF NOT EXISTS auvo_external_id TEXT,
  ADD COLUMN IF NOT EXISTS vinculo_status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS vinculo_metodo TEXT,
  ADD COLUMN IF NOT EXISTS vinculo_confianca NUMERIC,
  ADD COLUMN IF NOT EXISTS auvo_sync_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auvo_sync_erro TEXT;

ALTER TABLE public.rh_clientes DROP CONSTRAINT IF EXISTS rh_clientes_origem_check;
ALTER TABLE public.rh_clientes
  ADD CONSTRAINT rh_clientes_origem_check
  CHECK (origem IN ('cache', 'gc', 'auvo', 'gc_auvo', 'manual'));

ALTER TABLE public.rh_clientes DROP CONSTRAINT IF EXISTS rh_clientes_vinculo_status_check;
ALTER TABLE public.rh_clientes
  ADD CONSTRAINT rh_clientes_vinculo_status_check
  CHECK (vinculo_status IN ('vinculado', 'pendente', 'ambiguo', 'erro'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_rh_clientes_auvo_cliente_id
  ON public.rh_clientes (auvo_cliente_id)
  WHERE auvo_cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rh_clientes_vinculo_status
  ON public.rh_clientes (vinculo_status);

ALTER TABLE public.auvo_clientes_cache
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS nome_legal TEXT;

CREATE INDEX IF NOT EXISTS idx_auvo_clientes_cache_external_id
  ON public.auvo_clientes_cache (external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auvo_clientes_cache_cpf_cnpj
  ON public.auvo_clientes_cache (cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL;

-- O GestãoClick não oferece webhook de clientes nesta integração. Uma varredura
-- idempotente a cada 10 minutos cria no Auvo somente os novos IDs do GC.
-- Remove o job legado: além de atualizar apenas o espelho do Auvo, ele apontava
-- para localhost e portanto nunca atualizaria o projeto hospedado.
SELECT cron.unschedule('sync-auvo-customers-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-auvo-customers-daily');

SELECT cron.unschedule('sync-clientes-gc-auvo-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-clientes-gc-auvo-10min');

SELECT cron.schedule(
  'sync-clientes-gc-auvo-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/rh-clientes-sync-gc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object(
      'autoCreateAuvo', true,
      'source', 'cron',
      'mode', 'incremental'
    )
  ) AS request_id;
  $$
);

SELECT cron.unschedule('sync-clientes-gc-auvo-full-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-clientes-gc-auvo-full-daily');

SELECT cron.schedule(
  'sync-clientes-gc-auvo-full-daily',
  '20 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/rh-clientes-sync-gc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object(
      'autoCreateAuvo', true,
      'source', 'cron-full',
      'mode', 'full'
    )
  ) AS request_id;
  $$
);

NOTIFY pgrst, 'reload schema';