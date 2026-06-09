CREATE TABLE public.premiacao_os_compartilhada (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gc_os_codigo TEXT NOT NULL UNIQUE,
  tecnico_secundario TEXT NOT NULL,
  observacao TEXT,
  criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.premiacao_os_compartilhada TO authenticated;
GRANT ALL ON public.premiacao_os_compartilhada TO service_role;

ALTER TABLE public.premiacao_os_compartilhada ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read shared os" ON public.premiacao_os_compartilhada
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert shared os" ON public.premiacao_os_compartilhada
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update shared os" ON public.premiacao_os_compartilhada
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete shared os" ON public.premiacao_os_compartilhada
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_premiacao_os_compartilhada_updated_at
  BEFORE UPDATE ON public.premiacao_os_compartilhada
  FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_at();