-- Drop existing hourly cron (was timing out because of full sync)
SELECT cron.unschedule('central-sync-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'central-sync-hourly');

-- New lightweight hourly: reports_only with rolling 7-day-back / 30-day-forward window
SELECT cron.schedule(
  'central-sync-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/central-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5c2xqbWt3a3hya292c2FvZHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTU5NDIsImV4cCI6MjA4ODgzMTk0Mn0.MeOJPCPTB4gWuDnpIEA5btGgfAOvd63bOm0ApMf4eZA"}'::jsonb,
    body := jsonb_build_object(
      'reports_only', true,
      'start_date', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '7 days','YYYY-MM-DD'),
      'end_date',   to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + INTERVAL '30 days','YYYY-MM-DD')
    )
  ) AS request_id;
  $$
);

-- New 15-minute cron: just refresh GC OS status (super fast, <15s)
SELECT cron.unschedule('central-sync-gc-status') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'central-sync-gc-status');

SELECT cron.schedule(
  'central-sync-gc-status',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/central-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5c2xqbWt3a3hya292c2FvZHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTU5NDIsImV4cCI6MjA4ODgzMTk0Mn0.MeOJPCPTB4gWuDnpIEA5btGgfAOvd63bOm0ApMf4eZA"}'::jsonb,
    body := jsonb_build_object(
      'gc_status_only', true,
      'start_date', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '60 days','YYYY-MM-DD'),
      'end_date',   to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + INTERVAL '30 days','YYYY-MM-DD')
    )
  ) AS request_id;
  $$
);