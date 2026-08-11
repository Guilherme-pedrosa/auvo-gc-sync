-- Etiquetas personalizadas da Escala de Tecnicos.
-- Os agendamentos continuam exclusivamente em agenda_agendamentos.

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2563EB',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT tags_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE UNIQUE INDEX tags_name_unique_ci
  ON public.tags (lower(btrim(name)));

CREATE TABLE public.agenda_agendamento_tags (
  agendamento_id uuid NOT NULL
    REFERENCES public.agenda_agendamentos(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL
    REFERENCES public.tags(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agendamento_id, tag_id)
);

CREATE INDEX agenda_agendamento_tags_tag_id_idx
  ON public.agenda_agendamento_tags(tag_id);

CREATE TRIGGER trg_tags_upd
BEFORE UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.agenda_set_atualizado_em();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_agendamento_tags TO authenticated;
GRANT ALL ON public.agenda_agendamento_tags TO service_role;

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_agendamento_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth manage agenda tags"
  ON public.tags FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth manage agenda tag links"
  ON public.agenda_agendamento_tags FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
