-- Cache compartilhado do enriquecimento GestãoClick usado no acompanhamento em tempo real.
-- O Auvo continua sendo consultado a cada minuto; OS/orçamentos do GC são reutilizados
-- por pelo menos 15 minutos, mesmo com várias telas abertas simultaneamente.
CREATE TABLE IF NOT EXISTS public.realtime_tracking_gc_cache (
  cache_key text PRIMARY KEY,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  os_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  orc_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz,
  refresh_started_at timestamptz,
  blocked_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.realtime_tracking_gc_cache ENABLE ROW LEVEL SECURITY;

-- Somente as Edge Functions (service_role) acessam este cache. Não há policy pública.
REVOKE ALL ON TABLE public.realtime_tracking_gc_cache FROM anon, authenticated;
GRANT ALL ON TABLE public.realtime_tracking_gc_cache TO service_role;

CREATE OR REPLACE FUNCTION public.claim_realtime_tracking_gc_refresh(
  p_cache_key text,
  p_data_inicio date,
  p_data_fim date,
  p_force boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  global_cache public.realtime_tracking_gc_cache%ROWTYPE;
  current_cache public.realtime_tracking_gc_cache%ROWTYPE;
BEGIN
  INSERT INTO public.realtime_tracking_gc_cache (cache_key, data_inicio, data_fim)
  VALUES ('__global__', DATE '1970-01-01', DATE '1970-01-01')
  ON CONFLICT (cache_key) DO NOTHING;

  INSERT INTO public.realtime_tracking_gc_cache (cache_key, data_inicio, data_fim)
  VALUES (p_cache_key, p_data_inicio, p_data_fim)
  ON CONFLICT (cache_key) DO NOTHING;

  -- A trava e o circuito são globais: trocar de data ou abrir outra janela não
  -- pode iniciar outra paginação completa enquanto uma já está rodando.
  SELECT *
  INTO global_cache
  FROM public.realtime_tracking_gc_cache
  WHERE cache_key = '__global__'
  FOR UPDATE;

  IF global_cache.blocked_until IS NOT NULL AND global_cache.blocked_until > now() THEN
    RETURN false;
  END IF;

  IF global_cache.refresh_started_at IS NOT NULL
     AND global_cache.refresh_started_at > now() - interval '15 minutes' THEN
    RETURN false;
  END IF;

  IF NOT p_force
     AND global_cache.refreshed_at IS NOT NULL
     AND global_cache.refreshed_at > now() - interval '15 minutes' THEN
    RETURN false;
  END IF;

  SELECT *
  INTO current_cache
  FROM public.realtime_tracking_gc_cache
  WHERE cache_key = p_cache_key
  FOR UPDATE;

  IF current_cache.blocked_until IS NOT NULL AND current_cache.blocked_until > now() THEN
    RETURN false;
  END IF;

  IF current_cache.refresh_started_at IS NOT NULL
     AND current_cache.refresh_started_at > now() - interval '15 minutes' THEN
    RETURN false;
  END IF;

  IF NOT p_force
     AND current_cache.refreshed_at IS NOT NULL
     AND current_cache.refreshed_at > now() - interval '15 minutes' THEN
    RETURN false;
  END IF;

  UPDATE public.realtime_tracking_gc_cache
  SET refresh_started_at = now(),
      data_inicio = p_data_inicio,
      data_fim = p_data_fim,
      last_error = NULL,
      updated_at = now()
  WHERE cache_key = p_cache_key;

  UPDATE public.realtime_tracking_gc_cache
  SET refresh_started_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE cache_key = '__global__';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_realtime_tracking_gc_refresh(text, date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_realtime_tracking_gc_refresh(text, date, date, boolean) TO service_role;
