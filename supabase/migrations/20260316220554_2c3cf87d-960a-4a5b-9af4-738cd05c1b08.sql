
CREATE TABLE public.kanban_oficina_cache (
  auvo_task_id text NOT NULL PRIMARY KEY,
  dados jsonb NOT NULL,
  coluna text NOT NULL DEFAULT 'entrada',
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.kanban_oficina_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_oficina_cache" ON public.kanban_oficina_cache FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_oficina_cache" ON public.kanban_oficina_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_oficina_cache" ON public.kanban_oficina_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
