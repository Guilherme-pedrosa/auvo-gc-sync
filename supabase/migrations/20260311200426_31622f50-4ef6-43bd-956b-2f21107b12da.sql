CREATE TABLE IF NOT EXISTS public.auvo_gc_usuario_map (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_user_id      TEXT NOT NULL UNIQUE,
  auvo_user_nome    TEXT NOT NULL,
  gc_vendedor_id    TEXT NOT NULL,
  gc_vendedor_nome  TEXT NOT NULL,
  ativo             BOOLEAN DEFAULT true,
  criado_em         TIMESTAMPTZ DEFAULT now(),
  atualizado_em     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auvo_gc_map_auvo_id ON public.auvo_gc_usuario_map (auvo_user_id);

ALTER TABLE public.auvo_gc_usuario_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_map" ON public.auvo_gc_usuario_map
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_map" ON public.auvo_gc_usuario_map
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert_map" ON public.auvo_gc_usuario_map
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update_map" ON public.auvo_gc_usuario_map
  FOR UPDATE TO authenticated USING (true);