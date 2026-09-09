-- Customer reconciliation is resumed in bounded invocations instead of keeping
-- a user HTTP request open through every GC and Auvo collection page.
CREATE TABLE IF NOT EXISTS public.rh_customer_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 300),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  result jsonb,
  error text,
  lease_token uuid,
  lease_until timestamptz,
  mutation_in_flight boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'running' AND lease_token IS NULL AND lease_until IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_customer_sync_jobs_one_active_request
  ON public.rh_customer_sync_jobs (request_key) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS rh_customer_sync_jobs_pending
  ON public.rh_customer_sync_jobs (created_at, id) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS public.rh_customer_sync_pages (
  job_id uuid NOT NULL REFERENCES public.rh_customer_sync_jobs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source ~ '^[a-zA-Z0-9_-]{1,80}$'),
  page integer NOT NULL CHECK (page >= 1),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'array'),
  PRIMARY KEY (job_id, source, page)
);

ALTER TABLE public.rh_customer_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_customer_sync_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_customer_sync_jobs, public.rh_customer_sync_pages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rh_customer_sync_jobs, public.rh_customer_sync_pages TO service_role;

CREATE OR REPLACE FUNCTION public.rh_customer_sync_start_job(
  p_request_key text, p_payload jsonb, p_initial_state jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_job public.rh_customer_sync_jobs%ROWTYPE;
BEGIN
  -- Identical active submissions share one job; unrelated submissions queue.
  PERFORM pg_advisory_xact_lock(hashtextextended('rh-customer-request:' || p_request_key, 0));
  SELECT * INTO v_job FROM public.rh_customer_sync_jobs
    WHERE request_key = p_request_key AND status IN ('queued', 'running')
    ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(v_job); END IF;
  INSERT INTO public.rh_customer_sync_jobs (request_key, payload, state)
    VALUES (p_request_key, p_payload, p_initial_state) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rh_customer_sync_claim_job(p_job_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_job public.rh_customer_sync_jobs%ROWTYPE;
BEGIN
  -- A project-wide lease prevents separate jobs from racing customer mutations.
  PERFORM pg_advisory_xact_lock(hashtextextended('rh-customer-sync-global-lease', 0));
  UPDATE public.rh_customer_sync_jobs
    SET status = 'failed',
        error = 'UNCERTAIN_WRITE: execução interrompida durante uma escrita externa; verificar o resultado antes de uma nova tentativa.',
        lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE status = 'running' AND lease_until <= clock_timestamp() AND mutation_in_flight;
  UPDATE public.rh_customer_sync_jobs
    SET status = 'queued', lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
    WHERE status = 'running' AND lease_until <= clock_timestamp() AND NOT mutation_in_flight;
  IF EXISTS (SELECT 1 FROM public.rh_customer_sync_jobs WHERE status = 'running') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_job FROM public.rh_customer_sync_jobs
    WHERE status = 'queued' AND (p_job_id IS NULL OR id = p_job_id)
    ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.rh_customer_sync_jobs
    SET status = 'running', lease_token = gen_random_uuid(),
        lease_until = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
    WHERE id = v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rh_customer_sync_update_job(
  p_job_id uuid, p_lease_token uuid, p_operation text, p_value jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_job public.rh_customer_sync_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.rh_customer_sync_jobs
    WHERE id = p_job_id AND status = 'running' AND lease_token = p_lease_token
      AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR v_job.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'RH_JOB_LEASE_LOST: concessão expirada ou substituída';
  END IF;
  IF p_operation = 'checkpoint' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'RH_JOB_INVALID_STATE'; END IF;
    UPDATE public.rh_customer_sync_jobs SET state = p_value, mutation_in_flight = false,
      updated_at = clock_timestamp() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_operation = 'begin_mutation' THEN
    IF v_job.mutation_in_flight THEN RAISE EXCEPTION 'RH_JOB_UNCHECKPOINTED_WRITE'; END IF;
    UPDATE public.rh_customer_sync_jobs SET mutation_in_flight = true,
      updated_at = clock_timestamp() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_operation = 'complete' THEN
    IF v_job.mutation_in_flight THEN RAISE EXCEPTION 'RH_JOB_UNCHECKPOINTED_WRITE'; END IF;
    UPDATE public.rh_customer_sync_jobs SET status = 'succeeded', result = p_value, error = NULL,
      lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_operation = 'fail' THEN
    UPDATE public.rh_customer_sync_jobs SET status = 'failed',
      error = CASE WHEN v_job.mutation_in_flight THEN 'UNCERTAIN_WRITE: ' ELSE '' END
        || left(COALESCE(p_value #>> '{}', 'Falha na sincronização de clientes.'), 1500),
      lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_operation = 'release' THEN
    IF v_job.mutation_in_flight THEN RAISE EXCEPTION 'RH_JOB_UNCHECKPOINTED_WRITE'; END IF;
    UPDATE public.rh_customer_sync_jobs SET status = 'queued', lease_token = NULL,
      lease_until = NULL, updated_at = clock_timestamp()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSE
    RAISE EXCEPTION 'RH_JOB_INVALID_OPERATION';
  END IF;
  RETURN to_jsonb(v_job);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rh_customer_sync_save_page(
  p_job_id uuid, p_lease_token uuid, p_source text, p_page integer, p_data jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_lease_until timestamptz;
BEGIN
  -- Lock the job until staging is committed so an expired owner cannot overwrite
  -- a page after its lease has been claimed by another invocation.
  SELECT lease_until INTO v_lease_until FROM public.rh_customer_sync_jobs
    WHERE id = p_job_id AND status = 'running' AND lease_token = p_lease_token
      AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR v_lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'RH_JOB_LEASE_LOST: concessão expirada ou substituída';
  END IF;
  INSERT INTO public.rh_customer_sync_pages (job_id, source, page, data)
    VALUES (p_job_id, p_source, p_page, p_data)
    ON CONFLICT (job_id, source, page) DO UPDATE SET data = EXCLUDED.data;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.rh_customer_sync_start_job(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_customer_sync_claim_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_customer_sync_update_job(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_customer_sync_save_page(uuid, uuid, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_customer_sync_start_job(text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_customer_sync_claim_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_customer_sync_update_job(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_customer_sync_save_page(uuid, uuid, text, integer, jsonb) TO service_role;

-- Named cron.schedule updates this job idempotently. Existing business schedules
-- remain responsible for creating incremental/full jobs; this only resumes them.
SELECT cron.schedule(
  'rh-customer-sync-worker', '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/rh-clientes-sync-gc',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"lookup_document","rhClientIds":[],"continueJob":true}'::jsonb,
    timeout_milliseconds := 100000
  ) WHERE EXISTS (
    SELECT 1 FROM public.rh_customer_sync_jobs WHERE status IN ('queued', 'running')
  );
  $cron$
);
