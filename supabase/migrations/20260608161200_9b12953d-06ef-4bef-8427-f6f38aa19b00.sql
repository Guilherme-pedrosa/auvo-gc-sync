SELECT cron.schedule(
  'equipamentos-preventivos-daily',
  '40 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/equipment-sync',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5c2xqbWt3a3hya292c2FvZHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTU5NDIsImV4cCI6MjA4ODgzMTk0Mn0.MeOJPCPTB4gWuDnpIEA5btGgfAOvd63bOm0ApMf4eZA","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5c2xqbWt3a3hya292c2FvZHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTU5NDIsImV4cCI6MjA4ODgzMTk0Mn0.MeOJPCPTB4gWuDnpIEA5btGgfAOvd63bOm0ApMf4eZA"}'::jsonb,
    body := jsonb_build_object(
      'phase','all',
      'startDate', to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '60 days','YYYY-MM-DD'),
      'endDate',   to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM-DD')
    )
  );
  $$
);