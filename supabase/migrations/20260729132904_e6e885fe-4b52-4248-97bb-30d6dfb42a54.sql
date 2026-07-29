CREATE TABLE public.os_observacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_os_id text,
  gc_os_codigo text,
  auvo_task_id text,
  cliente text,
  texto text NOT NULL,
  autor_id uuid,
  autor_nome text,
  sincronizado_gc boolean NOT NULL DEFAULT false,
  erro_gc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_observacoes TO authenticated;
GRANT ALL ON public.os_observacoes TO service_role;

ALTER TABLE public.os_observacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem ver observacoes"
ON public.os_observacoes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados podem criar observacoes"
ON public.os_observacoes FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autor ou admin pode atualizar observacoes"
ON public.os_observacoes FOR UPDATE TO authenticated
USING (autor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (autor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin pode remover observacoes"
ON public.os_observacoes FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_os_observacoes_os ON public.os_observacoes (gc_os_id, created_at DESC);
CREATE INDEX idx_os_observacoes_cliente ON public.os_observacoes (cliente, created_at DESC);

CREATE OR REPLACE FUNCTION public.os_observacoes_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_os_observacoes_updated_at
BEFORE UPDATE ON public.os_observacoes
FOR EACH ROW EXECUTE FUNCTION public.os_observacoes_set_updated_at();