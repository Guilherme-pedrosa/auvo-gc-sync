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
SET lock_timeout = '2500ms'
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

  BEGIN
    SELECT * INTO _row
    FROM public.gc_broker_daily_usage
    WHERE usage_date = _today
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available OR query_canceled THEN
    RETURN QUERY SELECT false, 1000, 0, 0, 0, 'broker_busy'::text;
    RETURN;
  END;

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

REVOKE ALL ON FUNCTION public.gc_broker_acquire_slot(boolean, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gc_broker_acquire_slot(boolean, text, integer, integer, integer) TO service_role;