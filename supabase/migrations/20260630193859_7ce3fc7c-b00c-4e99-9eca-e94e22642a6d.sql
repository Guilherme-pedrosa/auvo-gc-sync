-- 1. Extensão de contratos
ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS horas_mes_contratadas numeric;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE public.preventiva_periodicidade AS ENUM ('MENSAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.preventiva_criticidade AS ENUM ('CRITICA','ALTA','MEDIA','BAIXA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.preventiva_status AS ENUM ('RASCUNHO','VIGENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Plano por equipamento
CREATE TABLE IF NOT EXISTS public.equipamento_plano_preventivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_clientes(id) ON DELETE CASCADE,
  codigo_barras_auvo text NOT NULL,
  ano_referencia int NOT NULL,
  horas_estimadas_total numeric NOT NULL,
  horas_por_tecnico numeric NOT NULL,
  qtd_tecnicos int NOT NULL DEFAULT 1,
  periodicidade public.preventiva_periodicidade NOT NULL,
  criticidade public.preventiva_criticidade NOT NULL DEFAULT 'MEDIA',
  mes_inicio_ciclo int NOT NULL DEFAULT 1 CHECK (mes_inicio_ciclo BETWEEN 1 AND 12),
  ativo boolean NOT NULL DEFAULT true,
  data_inativacao date,
  adiamentos_count int NOT NULL DEFAULT 0,
  status public.preventiva_status NOT NULL DEFAULT 'RASCUNHO',
  observacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_plano UNIQUE (grupo_id, codigo_barras_auvo, ano_referencia),
  CONSTRAINT chk_horas_consistentes CHECK (qtd_tecnicos >= 1 AND horas_por_tecnico > 0)
);

CREATE INDEX IF NOT EXISTS idx_plano_grupo_ano ON public.equipamento_plano_preventivo(grupo_id, ano_referencia);
CREATE INDEX IF NOT EXISTS idx_plano_codbarras ON public.equipamento_plano_preventivo(codigo_barras_auvo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipamento_plano_preventivo TO authenticated;
GRANT ALL ON public.equipamento_plano_preventivo TO service_role;

ALTER TABLE public.equipamento_plano_preventivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read plano preventivo" ON public.equipamento_plano_preventivo
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert plano preventivo" ON public.equipamento_plano_preventivo
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update plano preventivo" ON public.equipamento_plano_preventivo
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete plano preventivo" ON public.equipamento_plano_preventivo
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_plano_updated
  BEFORE UPDATE ON public.equipamento_plano_preventivo
  FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_at();

-- 4. Exceções (paradas programadas por mês)
CREATE TABLE IF NOT EXISTS public.equipamento_plano_excecoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.equipamento_plano_preventivo(id) ON DELETE CASCADE,
  mes int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  motivo text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_excecao UNIQUE (plano_id, mes)
);

CREATE INDEX IF NOT EXISTS idx_excecao_plano ON public.equipamento_plano_excecoes(plano_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipamento_plano_excecoes TO authenticated;
GRANT ALL ON public.equipamento_plano_excecoes TO service_role;

ALTER TABLE public.equipamento_plano_excecoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read excecao plano" ON public.equipamento_plano_excecoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write excecao plano" ON public.equipamento_plano_excecoes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Log de adiamentos (carry-over) para auditoria
CREATE TABLE IF NOT EXISTS public.equipamento_plano_adiamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.equipamento_plano_preventivo(id) ON DELETE CASCADE,
  mes_origem int NOT NULL CHECK (mes_origem BETWEEN 1 AND 12),
  mes_destino int NOT NULL CHECK (mes_destino BETWEEN 1 AND 12),
  ano_referencia int NOT NULL,
  justificativa text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adiamento_plano ON public.equipamento_plano_adiamentos(plano_id, ano_referencia);

GRANT SELECT, INSERT ON public.equipamento_plano_adiamentos TO authenticated;
GRANT ALL ON public.equipamento_plano_adiamentos TO service_role;

ALTER TABLE public.equipamento_plano_adiamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read adiamento" ON public.equipamento_plano_adiamentos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert adiamento" ON public.equipamento_plano_adiamentos
  FOR INSERT TO authenticated WITH CHECK (true);