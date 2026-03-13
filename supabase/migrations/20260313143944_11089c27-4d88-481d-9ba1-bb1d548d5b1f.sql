
CREATE TABLE public.kanban_orcamentos_cache (
  auvo_task_id TEXT PRIMARY KEY,
  dados JSONB NOT NULL,
  coluna TEXT NOT NULL DEFAULT 'a_fazer',
  posicao INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Metadata: last sync timestamp
CREATE TABLE public.kanban_sync_meta (
  id TEXT PRIMARY KEY DEFAULT 'default',
  ultimo_sync TIMESTAMP WITH TIME ZONE,
  periodo_inicio TEXT,
  periodo_fim TEXT
);

ALTER TABLE public.kanban_orcamentos_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kanban_sync_meta ENABLE ROW LEVEL SECURITY;

-- RLS: allow anon and authenticated full access (no login required)
CREATE POLICY "anon_all_cache" ON public.kanban_orcamentos_cache FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_cache" ON public.kanban_orcamentos_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_cache" ON public.kanban_orcamentos_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_meta" ON public.kanban_sync_meta FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_meta" ON public.kanban_sync_meta FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_meta" ON public.kanban_sync_meta FOR ALL TO service_role USING (true) WITH CHECK (true);
