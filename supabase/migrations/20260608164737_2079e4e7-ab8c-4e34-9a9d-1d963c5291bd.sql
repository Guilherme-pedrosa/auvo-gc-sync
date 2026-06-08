
CREATE TABLE public.orcamento_aprovacao_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_orcamento_id text NOT NULL,
  gc_orcamento_codigo text,
  cliente text,
  acao text NOT NULL,
  situacao_id_antes text,
  situacao_id_depois text,
  observacao text,
  termo_aceito boolean DEFAULT false,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_nome text,
  user_email text,
  ip text,
  user_agent text,
  detalhes jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orc_aprov_log_orc ON public.orcamento_aprovacao_log(gc_orcamento_id);
CREATE INDEX idx_orc_aprov_log_user ON public.orcamento_aprovacao_log(user_id);

GRANT SELECT ON public.orcamento_aprovacao_log TO authenticated;
GRANT ALL ON public.orcamento_aprovacao_log TO service_role;

ALTER TABLE public.orcamento_aprovacao_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem todos logs"
  ON public.orcamento_aprovacao_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Usuário vê seus próprios logs"
  ON public.orcamento_aprovacao_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
