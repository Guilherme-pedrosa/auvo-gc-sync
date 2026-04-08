CREATE TABLE public.equipamentos_auvo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  identificador text,
  cliente text,
  categoria text,
  status text DEFAULT 'Ativo',
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE public.equipamentos_auvo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read equipamentos_auvo"
  ON public.equipamentos_auvo
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage equipamentos_auvo"
  ON public.equipamentos_auvo
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));