-- Agenda a sincronização de clientes para as 04:00 AM todos os dias
-- Usando a URL e a KEY do serviço do próprio projeto configuradas no Vault
select cron.schedule(
    'sync-auvo-customers-daily',
    '0 4 * * *',
    $$
    select net.http_post(
        url := 'http://localhost:54321/functions/v1/auvo-task-update',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('action', 'list-customers', 'forceRefresh', true)
    );
    $$
);
