-- O limite do GestãoClick é compartilhado pela empresa (30 mil chamadas/dia).
-- A descoberta de clientes novos consulta somente as páginas mais recentes;
-- uma reconciliação completa diária continua capturando edições antigas.
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
