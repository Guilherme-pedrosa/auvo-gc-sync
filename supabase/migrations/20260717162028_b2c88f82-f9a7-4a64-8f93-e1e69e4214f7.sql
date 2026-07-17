
-- med_tipos_aso
CREATE TABLE public.med_tipos_aso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  periodicidade_meses integer,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_tipos_aso TO authenticated;
GRANT ALL ON public.med_tipos_aso TO service_role;
ALTER TABLE public.med_tipos_aso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_tipos_aso_read" ON public.med_tipos_aso FOR SELECT TO authenticated USING (true);
CREATE POLICY "med_tipos_aso_admin_write" ON public.med_tipos_aso FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER med_tipos_aso_upd BEFORE UPDATE ON public.med_tipos_aso FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

-- med_clinicas
CREATE TABLE public.med_clinicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  contato text,
  endereco text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_clinicas TO authenticated;
GRANT ALL ON public.med_clinicas TO service_role;
ALTER TABLE public.med_clinicas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_clinicas_read" ON public.med_clinicas FOR SELECT TO authenticated USING (true);
CREATE POLICY "med_clinicas_admin_write" ON public.med_clinicas FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE TRIGGER med_clinicas_upd BEFORE UPDATE ON public.med_clinicas FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

-- med_agendamentos
CREATE TABLE public.med_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.rh_colaboradores(id) ON DELETE CASCADE,
  tipo_id uuid NOT NULL REFERENCES public.med_tipos_aso(id),
  data date NOT NULL,
  hora time,
  clinica_id uuid REFERENCES public.med_clinicas(id),
  observacoes text,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','confirmado','realizado','cancelado')),
  aso_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_agendamentos TO authenticated;
GRANT ALL ON public.med_agendamentos TO service_role;
ALTER TABLE public.med_agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_agenda_read" ON public.med_agendamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "med_agenda_admin_write" ON public.med_agendamentos FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX idx_med_agenda_data ON public.med_agendamentos(data);
CREATE INDEX idx_med_agenda_colab ON public.med_agendamentos(colaborador_id);
CREATE TRIGGER med_agenda_upd BEFORE UPDATE ON public.med_agendamentos FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

-- med_aso
CREATE TABLE public.med_aso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.rh_colaboradores(id) ON DELETE CASCADE,
  tipo_id uuid NOT NULL REFERENCES public.med_tipos_aso(id),
  data_emissao date NOT NULL,
  data_validade date,
  clinica_id uuid REFERENCES public.med_clinicas(id),
  medico_nome text,
  medico_crm text,
  situacao text NOT NULL DEFAULT 'valido' CHECK (situacao IN ('valido','vencido','substituido')),
  documento_id uuid REFERENCES public.rh_colaborador_docs(id) ON DELETE SET NULL,
  agendamento_id uuid REFERENCES public.med_agendamentos(id) ON DELETE SET NULL,
  vigente boolean NOT NULL DEFAULT true,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_aso TO authenticated;
GRANT ALL ON public.med_aso TO service_role;
ALTER TABLE public.med_aso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_aso_read" ON public.med_aso FOR SELECT TO authenticated USING (true);
CREATE POLICY "med_aso_admin_write" ON public.med_aso FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE UNIQUE INDEX uq_med_aso_vigente ON public.med_aso(colaborador_id) WHERE vigente = true;
CREATE INDEX idx_med_aso_colab ON public.med_aso(colaborador_id);
CREATE INDEX idx_med_aso_validade ON public.med_aso(data_validade);
CREATE TRIGGER med_aso_upd BEFORE UPDATE ON public.med_aso FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

-- fk med_agendamentos.aso_id -> med_aso.id (agora que med_aso existe)
ALTER TABLE public.med_agendamentos
  ADD CONSTRAINT med_agendamentos_aso_id_fkey
  FOREIGN KEY (aso_id) REFERENCES public.med_aso(id) ON DELETE SET NULL;

-- med_historico
CREATE TABLE public.med_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.rh_colaboradores(id) ON DELETE CASCADE,
  evento text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);
GRANT SELECT, INSERT ON public.med_historico TO authenticated;
GRANT ALL ON public.med_historico TO service_role;
ALTER TABLE public.med_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_hist_read" ON public.med_historico FOR SELECT TO authenticated USING (true);
CREATE POLICY "med_hist_insert" ON public.med_historico FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE INDEX idx_med_hist_colab ON public.med_historico(colaborador_id, criado_em DESC);

-- Trigger: ao inserir ASO vigente, marca anteriores como substituídos
CREATE OR REPLACE FUNCTION public.med_aso_apply_vigente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.vigente THEN
    UPDATE public.med_aso
      SET vigente = false,
          situacao = CASE WHEN situacao='valido' THEN 'substituido' ELSE situacao END
    WHERE colaborador_id = NEW.colaborador_id
      AND id <> NEW.id
      AND vigente = true;
  END IF;

  -- calcula validade se ausente, usando periodicidade do tipo
  IF NEW.data_validade IS NULL THEN
    SELECT (NEW.data_emissao + make_interval(months => t.periodicidade_meses))::date
      INTO NEW.data_validade
    FROM public.med_tipos_aso t
    WHERE t.id = NEW.tipo_id AND t.periodicidade_meses IS NOT NULL;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER med_aso_biu_vigente BEFORE INSERT OR UPDATE ON public.med_aso
  FOR EACH ROW EXECUTE FUNCTION public.med_aso_apply_vigente();

-- Seed tipos padrão
INSERT INTO public.med_tipos_aso (codigo, nome, periodicidade_meses) VALUES
  ('ADMISSIONAL','Admissional',NULL),
  ('PERIODICO','Periódico',12),
  ('RETORNO','Retorno ao Trabalho',NULL),
  ('MUDANCA_FUNCAO','Mudança de Função',NULL),
  ('DEMISSIONAL','Demissional',NULL);
