
CREATE TABLE public.os_operation_locks (
  gc_os_id TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operation TEXT NOT NULL DEFAULT 'update',
  PRIMARY KEY (gc_os_id)
);

-- Auto-expire locks after 2 minutes (safety net)
CREATE OR REPLACE FUNCTION public.cleanup_expired_os_locks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.os_operation_locks WHERE locked_at < now() - interval '2 minutes';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_os_locks
  BEFORE INSERT ON public.os_operation_locks
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_expired_os_locks();

ALTER TABLE public.os_operation_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage os locks"
  ON public.os_operation_locks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Also allow service_role (edge functions)
CREATE POLICY "Service role full access to os locks"
  ON public.os_operation_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
