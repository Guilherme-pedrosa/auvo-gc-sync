
-- Drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "authenticated_read_map" ON public.auvo_gc_usuario_map;
DROP POLICY IF EXISTS "authenticated_insert_map" ON public.auvo_gc_usuario_map;
DROP POLICY IF EXISTS "authenticated_update_map" ON public.auvo_gc_usuario_map;
DROP POLICY IF EXISTS "service_role_all_map" ON public.auvo_gc_usuario_map;

-- Permissive policies for authenticated users
CREATE POLICY "authenticated_read_map" ON public.auvo_gc_usuario_map
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_map" ON public.auvo_gc_usuario_map
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update_map" ON public.auvo_gc_usuario_map
  FOR UPDATE TO authenticated USING (true);

-- Permissive policy for service role
CREATE POLICY "service_role_all_map" ON public.auvo_gc_usuario_map
  FOR ALL TO service_role USING (true);

-- Also fix anon access for edge function inserts to sync_log
DROP POLICY IF EXISTS "service_role_all" ON public.auvo_gc_sync_log;
CREATE POLICY "service_role_all" ON public.auvo_gc_sync_log
  FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON public.auvo_gc_sync_log;
CREATE POLICY "authenticated_read" ON public.auvo_gc_sync_log
  FOR SELECT TO authenticated USING (true);

-- Allow anon to read sync logs and mappings (no auth required in this app)
CREATE POLICY "anon_read_map" ON public.auvo_gc_usuario_map
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_map" ON public.auvo_gc_usuario_map
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_map" ON public.auvo_gc_usuario_map
  FOR UPDATE TO anon USING (true);

CREATE POLICY "anon_read_log" ON public.auvo_gc_sync_log
  FOR SELECT TO anon USING (true);
