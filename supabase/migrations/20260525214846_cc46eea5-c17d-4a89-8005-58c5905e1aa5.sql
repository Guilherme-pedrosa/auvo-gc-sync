CREATE TABLE public.demerito_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  percentual numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demerito_motivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_demerito_motivos" ON public.demerito_motivos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_demerito_motivos" ON public.demerito_motivos
  FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_demerito_motivos" ON public.demerito_motivos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.demerito_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tecnico_nome text NOT NULL,
  mes text NOT NULL,
  motivo_id uuid REFERENCES public.demerito_motivos(id) ON DELETE RESTRICT,
  motivo_nome text NOT NULL,
  percentual numeric NOT NULL DEFAULT 0,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);

CREATE INDEX idx_demerito_lanc_mes_tec ON public.demerito_lancamentos(mes, tecnico_nome);

ALTER TABLE public.demerito_lancamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_demerito_lanc" ON public.demerito_lancamentos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_demerito_lanc" ON public.demerito_lancamentos
  FOR SELECT TO anon USING (true);
CREATE POLICY "service_all_demerito_lanc" ON public.demerito_lancamentos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.demerito_motivos (nome, percentual) VALUES
  ('Reclamação de cliente', 10),
  ('OS sem código', 5),
  ('OS sem fotos ou sem detalhes', 5),
  ('Advertência', 50);