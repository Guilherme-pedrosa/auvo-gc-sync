CREATE TABLE IF NOT EXISTS public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#3B82F6',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_auth_all" ON public.tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.agenda_agendamento_tags (
  agendamento_id uuid not null references public.agenda_agendamentos(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (agendamento_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_agendamento_tags TO authenticated;
GRANT ALL ON public.agenda_agendamento_tags TO service_role;
ALTER TABLE public.agenda_agendamento_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agenda_tags_auth_all" ON public.agenda_agendamento_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_agenda_agendamento_tags_tag ON public.agenda_agendamento_tags(tag_id);