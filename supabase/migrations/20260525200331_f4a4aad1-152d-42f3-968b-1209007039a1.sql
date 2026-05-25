CREATE TABLE public.os_retornos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_os_codigo text NOT NULL UNIQUE,
  tecnico_retorno text NOT NULL,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);

ALTER TABLE public.os_retornos ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_os_retornos ON public.os_retornos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY service_all_os_retornos ON public.os_retornos FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_os_retornos_codigo ON public.os_retornos(gc_os_codigo);