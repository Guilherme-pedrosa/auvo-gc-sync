CREATE TABLE IF NOT EXISTS public.agenda_veiculo_dia (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.agenda_veiculos(id) on delete cascade,
  data date not null,
  texto text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (veiculo_id, data)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_veiculo_dia TO authenticated;
GRANT ALL ON public.agenda_veiculo_dia TO service_role;
ALTER TABLE public.agenda_veiculo_dia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage agenda_veiculo_dia" ON public.agenda_veiculo_dia FOR ALL TO authenticated USING (true) WITH CHECK (true);