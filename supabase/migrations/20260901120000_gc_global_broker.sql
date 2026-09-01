-- GestãoClick limita a empresa inteira a 3 req/s e 30.000 req/dia. Estes
-- contadores vivem no único proxy compartilhado para que todos os projetos
-- disputem o mesmo orçamento, em vez de cada banco imaginar que tem 30.000.
CREATE TABLE IF NOT EXISTS public.gc_broker_daily_usage (
  usage_date date PRIMARY KEY,
  total_requests integer NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
  read_requests integer NOT NULL DEFAULT 0 CHECK (read_requests >= 0),
  write_requests integer NOT NULL DEFAULT 0 CHECK (write_requests >= 0),
  next_allowed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  blocked_until timestamptz,
  last_provider_status integer,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.gc_broker_source_usage (
  usage_date date NOT NULL,
  source text NOT NULL,
  upstream_reads integer NOT NULL DEFAULT 0,
  upstream_writes integer NOT NULL DEFAULT 0,
  cache_hits integer NOT NULL DEFAULT 0,
  stale_hits integer NOT NULL DEFAULT 0,
  denied_requests integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (usage_date, source)
);

CREATE TABLE IF NOT EXISTS public.gc_broker_cache (
  cache_key text PRIMARY KEY,
  endpoint text NOT NULL,
  response_body jsonb,
  response_status integer,
  expires_at timestamptz,
  stale_until timestamptz,
  refresh_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS gc_broker_cache_expiry_idx ON public.gc_broker_cache (expires_at);
CREATE INDEX IF NOT EXISTS gc_broker_cache_endpoint_idx ON public.gc_broker_cache (endpoint);

ALTER TABLE public.gc_broker_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gc_broker_source_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gc_broker_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.gc_broker_acquire_slot(
  _is_write boolean,
  _source text,
  _daily_cap integer DEFAULT 27000,
  _write_reserve integer DEFAULT 3000,
  _min_interval_ms integer DEFAULT 350
)
RETURNS TABLE (
  allowed boolean,
  wait_ms integer,
  total_requests integer,
  read_requests integer,
  write_requests integer,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := timezone('America/Sao_Paulo', clock_timestamp())::date;
  _now timestamptz := clock_timestamp();
  _row public.gc_broker_daily_usage%ROWTYPE;
  _slot_at timestamptz;
  _wait integer;
  _read_cap integer := greatest(0, _daily_cap - _write_reserve);
  _safe_source text := left(coalesce(nullif(trim(_source), ''), 'unknown'), 80);
BEGIN
  INSERT INTO public.gc_broker_daily_usage (usage_date)
  VALUES (_today)
  ON CONFLICT (usage_date) DO NOTHING;

  SELECT * INTO _row
  FROM public.gc_broker_daily_usage
  WHERE usage_date = _today
  FOR UPDATE;

  IF _row.blocked_until IS NOT NULL AND _row.blocked_until > _now THEN
    INSERT INTO public.gc_broker_source_usage (usage_date, source, denied_requests)
    VALUES (_today, _safe_source, 1)
    ON CONFLICT (usage_date, source) DO UPDATE
      SET denied_requests = gc_broker_source_usage.denied_requests + 1,
          updated_at = _now;
    RETURN QUERY SELECT false, 0, _row.total_requests, _row.read_requests,
      _row.write_requests, 'provider_blocked'::text;
    RETURN;
  END IF;

  IF _row.total_requests >= _daily_cap OR (NOT _is_write AND _row.read_requests >= _read_cap) THEN
    INSERT INTO public.gc_broker_source_usage (usage_date, source, denied_requests)
    VALUES (_today, _safe_source, 1)
    ON CONFLICT (usage_date, source) DO UPDATE
      SET denied_requests = gc_broker_source_usage.denied_requests + 1,
          updated_at = _now;
    RETURN QUERY SELECT false, 0, _row.total_requests, _row.read_requests,
      _row.write_requests,
      CASE WHEN _row.total_requests >= _daily_cap THEN 'daily_cap' ELSE 'write_reserve' END::text;
    RETURN;
  END IF;

  _slot_at := greatest(_now, _row.next_allowed_at);
  _wait := greatest(0, ceil(extract(epoch FROM (_slot_at - _now)) * 1000)::integer);

  -- Não criamos uma fila de dezenas de segundos numa rajada. A leitura usa
  -- cache e o chamador pode tentar novamente sem gastar a cota do provedor.
  IF _wait > 5000 THEN
    INSERT INTO public.gc_broker_source_usage (usage_date, source, denied_requests)
    VALUES (_today, _safe_source, 1)
    ON CONFLICT (usage_date, source) DO UPDATE
      SET denied_requests = gc_broker_source_usage.denied_requests + 1,
          updated_at = _now;
    RETURN QUERY SELECT false, _wait, _row.total_requests, _row.read_requests,
      _row.write_requests, 'burst_limit'::text;
    RETURN;
  END IF;

  UPDATE public.gc_broker_daily_usage AS usage
  SET total_requests = usage.total_requests + 1,
      read_requests = usage.read_requests + CASE WHEN _is_write THEN 0 ELSE 1 END,
      write_requests = usage.write_requests + CASE WHEN _is_write THEN 1 ELSE 0 END,
      next_allowed_at = _slot_at + make_interval(secs => _min_interval_ms / 1000.0),
      updated_at = _now
  WHERE usage.usage_date = _today
  RETURNING * INTO _row;

  INSERT INTO public.gc_broker_source_usage (usage_date, source, upstream_reads, upstream_writes)
  VALUES (
    _today, _safe_source,
    CASE WHEN _is_write THEN 0 ELSE 1 END,
    CASE WHEN _is_write THEN 1 ELSE 0 END
  )
  ON CONFLICT (usage_date, source) DO UPDATE
    SET upstream_reads = gc_broker_source_usage.upstream_reads + EXCLUDED.upstream_reads,
        upstream_writes = gc_broker_source_usage.upstream_writes + EXCLUDED.upstream_writes,
        updated_at = _now;

  RETURN QUERY SELECT true, _wait, _row.total_requests, _row.read_requests,
    _row.write_requests, 'ok'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.gc_broker_claim_refresh(
  _cache_key text,
  _endpoint text,
  _lock_seconds integer DEFAULT 20
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row_count integer := 0;
BEGIN
  INSERT INTO public.gc_broker_cache (cache_key, endpoint, refresh_started_at)
  VALUES (_cache_key, _endpoint, clock_timestamp())
  ON CONFLICT (cache_key) DO UPDATE
    SET endpoint = EXCLUDED.endpoint,
        refresh_started_at = EXCLUDED.refresh_started_at
  WHERE gc_broker_cache.refresh_started_at IS NULL
     OR gc_broker_cache.refresh_started_at < clock_timestamp() - make_interval(secs => _lock_seconds);
  GET DIAGNOSTICS _row_count = ROW_COUNT;
  RETURN _row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.gc_broker_record_cache_metric(
  _source text,
  _stale boolean DEFAULT false
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.gc_broker_source_usage (usage_date, source, cache_hits, stale_hits)
  VALUES (
    timezone('America/Sao_Paulo', clock_timestamp())::date,
    left(coalesce(nullif(trim(_source), ''), 'unknown'), 80),
    CASE WHEN _stale THEN 0 ELSE 1 END,
    CASE WHEN _stale THEN 1 ELSE 0 END
  )
  ON CONFLICT (usage_date, source) DO UPDATE
    SET cache_hits = gc_broker_source_usage.cache_hits + EXCLUDED.cache_hits,
        stale_hits = gc_broker_source_usage.stale_hits + EXCLUDED.stale_hits,
        updated_at = clock_timestamp();
$$;

CREATE OR REPLACE FUNCTION public.gc_broker_mark_rate_limited(
  _daily boolean,
  _status integer,
  _error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date := timezone('America/Sao_Paulo', clock_timestamp())::date;
  _until timestamptz;
BEGIN
  _until := CASE WHEN _daily THEN
    ((_today + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
  ELSE clock_timestamp() + interval '15 minutes' END;

  INSERT INTO public.gc_broker_daily_usage (usage_date, blocked_until, last_provider_status, last_error)
  VALUES (_today, _until, _status, left(_error, 500))
  ON CONFLICT (usage_date) DO UPDATE
    SET blocked_until = greatest(coalesce(gc_broker_daily_usage.blocked_until, _until), _until),
        last_provider_status = EXCLUDED.last_provider_status,
        last_error = EXCLUDED.last_error,
        updated_at = clock_timestamp();
END;
$$;

REVOKE ALL ON public.gc_broker_daily_usage FROM anon, authenticated;
REVOKE ALL ON public.gc_broker_source_usage FROM anon, authenticated;
REVOKE ALL ON public.gc_broker_cache FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.gc_broker_acquire_slot(boolean, text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gc_broker_claim_refresh(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gc_broker_record_cache_metric(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gc_broker_mark_rate_limited(boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gc_broker_acquire_slot(boolean, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gc_broker_claim_refresh(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gc_broker_record_cache_metric(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.gc_broker_mark_rate_limited(boolean, integer, text) TO service_role;
