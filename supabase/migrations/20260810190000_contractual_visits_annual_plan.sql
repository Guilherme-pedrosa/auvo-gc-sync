-- Transforma a configuração mensal isolada em regra recorrente para o ano inteiro.
-- A carga de cada visita é derivada das horas/mês do contrato:
-- horas contratadas / visitas / técnicos. Nada desta estrutura envia duração ao Auvo.

ALTER TABLE public.contratos_visitas_config
  ADD COLUMN IF NOT EXISTS semanas_mes smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS planejamento_pendente boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS planejamento_atualizado_em timestamptz;

ALTER TABLE public.contratos_visitas_config
  DROP CONSTRAINT IF EXISTS contratos_visitas_config_semanas_check;

ALTER TABLE public.contratos_visitas_config
  ADD CONSTRAINT contratos_visitas_config_semanas_check CHECK (
    cardinality(semanas_mes) >= 1
    AND semanas_mes <@ ARRAY[1,2,3,4,5]::smallint[]
  );

COMMENT ON COLUMN public.contratos_visitas_config.duracao_minutos IS
  'Valor técnico derivado de contratos.horas_mes_contratadas / qtd_visitas / qtd_tecnicos. Não é enviado ao Auvo.';

COMMENT ON COLUMN public.contratos_visitas_config.semanas_mes IS
  'Semanas do mês permitidas para distribuir as previsões anuais (1 a 5).';

CREATE INDEX IF NOT EXISTS idx_contratos_visitas_planejamento_pendente
  ON public.contratos_visitas_config (planejamento_pendente, atualizado_em)
  WHERE ativo = true;

CREATE OR REPLACE FUNCTION public.marcar_planejamento_visitas_contrato_pendente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.nome IS DISTINCT FROM NEW.nome
     OR OLD.grupo_id IS DISTINCT FROM NEW.grupo_id
     OR OLD.cliente_nome IS DISTINCT FROM NEW.cliente_nome
     OR OLD.horas_mes_contratadas IS DISTINCT FROM NEW.horas_mes_contratadas
     OR OLD.vigencia_inicio IS DISTINCT FROM NEW.vigencia_inicio
     OR OLD.vigencia_fim IS DISTINCT FROM NEW.vigencia_fim
     OR OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    UPDATE public.contratos_visitas_config
    SET planejamento_pendente = true,
        atualizado_em = now()
    WHERE contrato_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contrato_planejamento_visitas_pendente ON public.contratos;
CREATE TRIGGER trg_contrato_planejamento_visitas_pendente
  AFTER UPDATE OF nome, grupo_id, cliente_nome, horas_mes_contratadas,
                  vigencia_inicio, vigencia_fim, ativo
  ON public.contratos
  FOR EACH ROW
  EXECUTE FUNCTION public.marcar_planejamento_visitas_contrato_pendente();

-- Configurações existentes precisam ser recalculadas na primeira abertura da visão anual.
UPDATE public.contratos_visitas_config
SET planejamento_pendente = true
WHERE ativo = true;

-- Substitui somente previsões futuras, em uma única transação. Se qualquer linha
-- for inválida, o PostgreSQL desfaz também a exclusão e mantém a agenda anterior.
CREATE OR REPLACE FUNCTION public.reconciliar_previsoes_visitas_contratuais(
  p_config_id uuid,
  p_ano integer,
  p_data_corte date,
  p_duracao_minutos integer,
  p_linhas jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrato_id uuid;
  v_inseridas integer := 0;
  v_inicio date := make_date(p_ano, 1, 1);
  v_fim date := make_date(p_ano, 12, 31);
BEGIN
  IF p_ano < 2000 OR p_ano > 2200 OR p_data_corte < v_inicio OR p_data_corte > v_fim THEN
    RAISE EXCEPTION 'Ano ou data de corte inválidos';
  END IF;
  IF p_duracao_minutos < 1 OR p_duracao_minutos > 1440 THEN
    RAISE EXCEPTION 'Carga da visita inválida';
  END IF;
  IF jsonb_typeof(COALESCE(p_linhas, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Linhas do planejamento devem ser um array';
  END IF;

  SELECT contrato_id INTO v_contrato_id
  FROM public.contratos_visitas_config
  WHERE id = p_config_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração contratual não encontrada'; END IF;

  DELETE FROM public.agenda_agendamentos
  WHERE origem = 'CONTRATO'
    AND contrato_visita_config_id = p_config_id
    AND data BETWEEN p_data_corte AND v_fim;

  IF jsonb_array_length(COALESCE(p_linhas, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.agenda_agendamentos (
      data, hora_inicio, hora_fim, colaborador_id, colaborador_nome,
      cliente, descricao, status, origem, auvo_task_id, gc_os_codigo,
      gc_orcamento_codigo, previsao_continuidade, previsao_tipo,
      previsao_detalhes, contrato_id, contrato_visita_config_id,
      contrato_visita_competencia, contrato_visita_numero, criado_por
    )
    SELECT
      linha.data, linha.hora_inicio, linha.hora_fim, linha.colaborador_id,
      linha.colaborador_nome, linha.cliente, linha.descricao,
      'PREVISAO_CONTRATUAL', 'CONTRATO', NULL, NULL, NULL, true, 'CONTRATO',
      linha.previsao_detalhes, v_contrato_id, p_config_id,
      linha.contrato_visita_competencia, linha.contrato_visita_numero,
      linha.criado_por
    FROM jsonb_to_recordset(p_linhas) AS linha(
      data date,
      hora_inicio time,
      hora_fim time,
      colaborador_id uuid,
      colaborador_nome text,
      cliente text,
      descricao text,
      previsao_detalhes text,
      contrato_visita_competencia date,
      contrato_visita_numero integer,
      criado_por uuid
    )
    WHERE linha.data BETWEEN p_data_corte AND v_fim;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
  END IF;

  UPDATE public.contratos_visitas_config
  SET duracao_minutos = p_duracao_minutos,
      planejamento_pendente = false,
      planejamento_atualizado_em = now(),
      atualizado_em = now()
  WHERE id = p_config_id;

  RETURN v_inseridas;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_previsoes_visitas_contratuais(uuid, integer, date, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconciliar_previsoes_visitas_contratuais(uuid, integer, date, integer, jsonb)
  TO authenticated, service_role;
