-- Cache persistente do mapa de OS. Uma mesma unidade pode aparecer em dezenas
-- de OS; geocodificamos o endereço uma vez e reaproveitamos o ponto.
CREATE TABLE IF NOT EXISTS public.os_map_geocoding_cache (
  address_key text PRIMARY KEY,
  query_address text NOT NULL,
  latitude double precision,
  longitude double precision,
  formatted_address text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ok', 'not_found', 'error')),
  provider_status text,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  geocoded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_map_geocoding_cache_status_updated
  ON public.os_map_geocoding_cache (status, updated_at DESC);

ALTER TABLE public.os_map_geocoding_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_map_geocoding_cache_authenticated_read
  ON public.os_map_geocoding_cache;
CREATE POLICY os_map_geocoding_cache_authenticated_read
  ON public.os_map_geocoding_cache
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.os_map_geocoding_cache TO authenticated;
GRANT ALL ON public.os_map_geocoding_cache TO service_role;

COMMENT ON TABLE public.os_map_geocoding_cache IS
  'Cache de geocodificação do Kanban/Mapa de OS, indexado pelo endereço normalizado.';
