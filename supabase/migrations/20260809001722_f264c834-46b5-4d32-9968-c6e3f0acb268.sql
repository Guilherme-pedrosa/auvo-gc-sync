CREATE TABLE public.agenda_veiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  placa text,
  modelo text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_veiculos TO authenticated;
GRANT ALL ON public.agenda_veiculos TO service_role;
ALTER TABLE public.agenda_veiculos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read veiculos" ON public.agenda_veiculos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write veiculos" ON public.agenda_veiculos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.agenda_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fim time NOT NULL,
  colaborador_id uuid REFERENCES public.rh_colaboradores(id) ON DELETE SET NULL,
  colaborador_nome text NOT NULL,
  veiculo_id uuid REFERENCES public.agenda_veiculos(id) ON DELETE SET NULL,
  cliente text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'AGENDADO',
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_agendamentos TO authenticated;
GRANT ALL ON public.agenda_agendamentos TO service_role;
ALTER TABLE public.agenda_agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read agendamentos" ON public.agenda_agendamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write agendamentos" ON public.agenda_agendamentos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_agenda_agendamentos_data ON public.agenda_agendamentos(data);

CREATE OR REPLACE FUNCTION public.agenda_set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_agenda_veiculos_upd BEFORE UPDATE ON public.agenda_veiculos
FOR EACH ROW EXECUTE FUNCTION public.agenda_set_atualizado_em();
CREATE TRIGGER trg_agenda_agendamentos_upd BEFORE UPDATE ON public.agenda_agendamentos
FOR EACH ROW EXECUTE FUNCTION public.agenda_set_atualizado_em();

INSERT INTO public.agenda_veiculos (nome, modelo, ordem) VALUES
('SAVEIRO G5','Volkswagen Saveiro',1),
('SAVEIRO G6','Volkswagen Saveiro',2),
('MONTANA','Chevrolet Montana',3),
('OFICINA','Sem veículo / Oficina',4);