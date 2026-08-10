-- Previsoes internas de visitas contratuais.
-- Nenhuma linha desta estrutura cria ou altera tarefa no Auvo ou documento no GestaoClick.

CREATE TABLE IF NOT EXISTS public.contratos_visitas_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  qtd_visitas integer NOT NULL DEFAULT 1 CHECK (qtd_visitas BETWEEN 1 AND 31),
  qtd_tecnicos integer NOT NULL DEFAULT 1 CHECK (qtd_tecnicos BETWEEN 1 AND 10),
  duracao_minutos integer NOT NULL DEFAULT 120 CHECK (duracao_minutos BETWEEN 15 AND 1440),
  hora_inicio time NOT NULL DEFAULT '08:00',
  tecnico_ids uuid[] NOT NULL DEFAULT '{}',
  dias_semana smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratos_visitas_config_contrato_unique UNIQUE (contrato_id),
  CONSTRAINT contratos_visitas_config_tecnicos_check CHECK (cardinality(tecnico_ids) >= qtd_tecnicos),
  CONSTRAINT contratos_visitas_config_dias_check CHECK (
    cardinality(dias_semana) >= 1
    AND dias_semana <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  )
);

CREATE INDEX IF NOT EXISTS idx_contratos_visitas_config_ativo
  ON public.contratos_visitas_config (ativo, contrato_id);

ALTER TABLE public.contratos_visitas_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read contratos visitas config" ON public.contratos_visitas_config;
CREATE POLICY "auth read contratos visitas config"
  ON public.contratos_visitas_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth write contratos visitas config" ON public.contratos_visitas_config;
CREATE POLICY "auth write contratos visitas config"
  ON public.contratos_visitas_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contratos_visitas_config TO authenticated;
GRANT ALL ON public.contratos_visitas_config TO service_role;

DROP TRIGGER IF EXISTS trg_contratos_visitas_config_upd ON public.contratos_visitas_config;
CREATE TRIGGER trg_contratos_visitas_config_upd
  BEFORE UPDATE ON public.contratos_visitas_config
  FOR EACH ROW EXECUTE FUNCTION public.agenda_set_atualizado_em();

ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS contrato_visita_config_id uuid
    REFERENCES public.contratos_visitas_config(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contrato_id uuid
    REFERENCES public.contratos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contrato_visita_competencia date,
  ADD COLUMN IF NOT EXISTS contrato_visita_numero integer;

CREATE INDEX IF NOT EXISTS idx_agenda_contrato_visita_competencia
  ON public.agenda_agendamentos (contrato_visita_config_id, contrato_visita_competencia);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_contrato_visita_tecnico
  ON public.agenda_agendamentos (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero,
    colaborador_id
  )
  WHERE contrato_visita_config_id IS NOT NULL;
