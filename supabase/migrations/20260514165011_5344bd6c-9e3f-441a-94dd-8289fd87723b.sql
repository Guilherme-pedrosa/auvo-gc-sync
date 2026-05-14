CREATE TABLE IF NOT EXISTS public.alertas_horas_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limite_minimo_minutos INTEGER NOT NULL DEFAULT 45,
  limite_maximo_horas NUMERIC NOT NULL DEFAULT 8,
  limite_excessivo_horas NUMERIC NOT NULL DEFAULT 12,
  detectar_overlap_tecnico BOOLEAN NOT NULL DEFAULT TRUE,
  detectar_horas_negativas BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.alertas_horas_config 
  (limite_minimo_minutos, limite_maximo_horas, limite_excessivo_horas)
SELECT 45, 8, 12
WHERE NOT EXISTS (SELECT 1 FROM public.alertas_horas_config);

ALTER TABLE public.alertas_horas_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_alertas_config" ON public.alertas_horas_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_read_alertas_config" ON public.alertas_horas_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_alertas_config" ON public.alertas_horas_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_all_alertas_config" ON public.alertas_horas_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);