CREATE TABLE IF NOT EXISTS public.contratos_visitas_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id uuid NOT NULL,
    qtd_visitas integer NOT NULL DEFAULT 1,
    qtd_tecnicos integer NOT NULL DEFAULT 1,
    duracao_minutos integer NOT NULL DEFAULT 120,
    hora_inicio time NOT NULL DEFAULT '08:00',
    tecnico_ids uuid[] DEFAULT '{}',
    dias_semana integer[] DEFAULT '{1,2,3,4,5}',
    observacao text,
    ativo boolean NOT NULL DEFAULT true,
    criado_por uuid,
    criado_em timestamp with time zone NOT NULL DEFAULT now(),
    atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contratos_visitas_config TO authenticated;
GRANT ALL ON public.contratos_visitas_config TO service_role;

ALTER TABLE public.contratos_visitas_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read visits config" ON public.contratos_visitas_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write visits config" ON public.contratos_visitas_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS contrato_id uuid;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS contrato_visita_config_id uuid;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS contrato_visita_competencia text;
ALTER TABLE public.agenda_agendamentos ADD COLUMN IF NOT EXISTS contrato_visita_numero integer;
