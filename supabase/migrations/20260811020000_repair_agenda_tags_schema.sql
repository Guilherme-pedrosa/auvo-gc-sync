-- Reparo idempotente das tags da Escala de Tecnicos.
-- Pode ser executado tanto em bancos sem as tabelas quanto nos que receberam
-- apenas uma das migrations anteriores.

CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2563EB',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

UPDATE public.tags
SET color = '#2563EB'
WHERE color IS NULL OR color !~ '^#[0-9A-Fa-f]{6}$';

CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique_ci
  ON public.tags (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.agenda_agendamento_tags (
  agendamento_id uuid NOT NULL
    REFERENCES public.agenda_agendamentos(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL
    REFERENCES public.tags(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agendamento_id, tag_id)
);

CREATE INDEX IF NOT EXISTS agenda_agendamento_tags_tag_id_idx
  ON public.agenda_agendamento_tags(tag_id);

CREATE OR REPLACE FUNCTION public.agenda_set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tags_upd ON public.tags;
CREATE TRIGGER trg_tags_upd
BEFORE UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.agenda_set_atualizado_em();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_agendamento_tags TO authenticated;
GRANT ALL ON public.agenda_agendamento_tags TO service_role;

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_agendamento_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth manage agenda tags" ON public.tags;
DROP POLICY IF EXISTS "tags_auth_all" ON public.tags;
CREATE POLICY "auth manage agenda tags"
  ON public.tags FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth manage agenda tag links" ON public.agenda_agendamento_tags;
DROP POLICY IF EXISTS "agenda_tags_auth_all" ON public.agenda_agendamento_tags;
CREATE POLICY "auth manage agenda tag links"
  ON public.agenda_agendamento_tags FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Forca o PostgREST a enxergar as novas relacoes imediatamente apos o commit.
NOTIFY pgrst, 'reload schema';
