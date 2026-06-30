
CREATE TABLE public.plano_preventivo_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_clientes(id) ON DELETE CASCADE,
  ano_referencia int NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int,
  equipamento_nome text NOT NULL,
  equipamento_auvo_id uuid REFERENCES public.equipamentos_auvo(id) ON DELETE SET NULL,
  match_confianca text,
  categoria text,
  criticidade text,
  periodicidade text NOT NULL,
  periodicidade_meses int NOT NULL,
  horas_total numeric NOT NULL DEFAULT 0,
  meses_planejados int[] NOT NULL DEFAULT '{}',
  proxima_data date,
  ultima_execucao_data date,
  ultima_execucao_task_id text,
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, ano_referencia, equipamento_nome)
);

CREATE INDEX idx_ppi_grupo_ano ON public.plano_preventivo_item(grupo_id, ano_referencia);
CREATE INDEX idx_ppi_auvo ON public.plano_preventivo_item(equipamento_auvo_id) WHERE equipamento_auvo_id IS NOT NULL;
CREATE INDEX idx_ppi_proxima ON public.plano_preventivo_item(proxima_data) WHERE ativo;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_preventivo_item TO authenticated;
GRANT ALL ON public.plano_preventivo_item TO service_role;

ALTER TABLE public.plano_preventivo_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all ppi" ON public.plano_preventivo_item FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ppi_updated BEFORE UPDATE ON public.plano_preventivo_item
  FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_atualizado_em();

CREATE TABLE public.plano_preventivo_execucao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.plano_preventivo_item(id) ON DELETE CASCADE,
  mes_planejado int,
  data_planejada date,
  data_realizada date NOT NULL,
  task_id text,
  task_type_id text,
  horas_decimal numeric,
  origem text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, task_id)
);

CREATE INDEX idx_ppe_item ON public.plano_preventivo_execucao(item_id);
CREATE INDEX idx_ppe_data ON public.plano_preventivo_execucao(data_realizada);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_preventivo_execucao TO authenticated;
GRANT ALL ON public.plano_preventivo_execucao TO service_role;

ALTER TABLE public.plano_preventivo_execucao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all ppe" ON public.plano_preventivo_execucao FOR ALL TO authenticated USING (true) WITH CHECK (true);
