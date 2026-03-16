-- Client groups
CREATE TABLE public.grupos_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grupos_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_grupos" ON public.grupos_clientes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_grupos" ON public.grupos_clientes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_all_grupos" ON public.grupos_clientes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Group members (client names mapped to groups)
CREATE TABLE public.grupo_cliente_membros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid REFERENCES public.grupos_clientes(id) ON DELETE CASCADE NOT NULL,
  cliente_nome text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, cliente_nome)
);

ALTER TABLE public.grupo_cliente_membros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_membros" ON public.grupo_cliente_membros
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_membros" ON public.grupo_cliente_membros
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_all_membros" ON public.grupo_cliente_membros
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hourly rate config per technician + client/group
CREATE TABLE public.valor_hora_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tecnico_nome text NOT NULL,
  tipo_referencia text NOT NULL DEFAULT 'cliente',
  referencia_nome text NOT NULL,
  grupo_id uuid REFERENCES public.grupos_clientes(id) ON DELETE CASCADE,
  valor_hora numeric NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.valor_hora_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_valor_hora" ON public.valor_hora_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_valor_hora" ON public.valor_hora_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_all_valor_hora" ON public.valor_hora_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);