-- A visita executada deve ocupar o proprio card que antes era previsao.
-- O registro consolidado continua sendo a fonte das horas e tarefas, mas nao
-- cria uma faixa paralela na Agenda de Tecnicos.

ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS contrato_visita_execucao_id uuid,
  ADD COLUMN IF NOT EXISTS contrato_visita_realizada_em date,
  ADD COLUMN IF NOT EXISTS contrato_visita_horas_realizadas numeric(12,4),
  ADD COLUMN IF NOT EXISTS contrato_visita_tarefa_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contrato_visita_tecnicos text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contrato_visita_tarefas_detalhes jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.agenda_agendamentos
    ADD CONSTRAINT agenda_agendamentos_contrato_visita_execucao_id_fkey
    FOREIGN KEY (contrato_visita_execucao_id)
    REFERENCES public.contratos_visitas_execucoes(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_agenda_contrato_visita_execucao
  ON public.agenda_agendamentos (contrato_visita_execucao_id)
  WHERE contrato_visita_execucao_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.materializar_card_visita_contratual(
  p_execucao_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exec public.contratos_visitas_execucoes%ROWTYPE;
  v_hora_inicio time;
  v_hora_fim time;
  v_afetadas integer := 0;
  v_inseridas integer := 0;
BEGIN
  SELECT * INTO v_exec
  FROM public.contratos_visitas_execucoes
  WHERE id = p_execucao_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT
    min(NULLIF(substring(detail->>'check_in' FROM 'T([0-9]{2}:[0-9]{2})'), '')::time),
    max(NULLIF(substring(detail->>'check_out' FROM 'T([0-9]{2}:[0-9]{2})'), '')::time)
  INTO v_hora_inicio, v_hora_fim
  FROM jsonb_array_elements(COALESCE(v_exec.tarefas_detalhes, '[]'::jsonb)) detail;

  SELECT
    COALESCE(v_hora_inicio, cfg.hora_inicio),
    COALESCE(
      v_hora_fim,
      COALESCE(v_hora_inicio, cfg.hora_inicio)
        + make_interval(mins => GREATEST(cfg.duracao_minutos, 1))
    )
  INTO v_hora_inicio, v_hora_fim
  FROM public.contratos_visitas_config cfg
  WHERE cfg.id = v_exec.contrato_visita_config_id;

  -- Converte o card planejado, preservando sua identidade e sua linha na grade.
  UPDATE public.agenda_agendamentos agenda
  SET data = v_exec.data_realizada,
      hora_inicio = COALESCE(v_hora_inicio, agenda.hora_inicio),
      hora_fim = COALESCE(v_hora_fim, agenda.hora_fim),
      cliente = v_exec.cliente,
      descricao = 'Visita contratual realizada',
      status = 'REALIZADA',
      previsao_continuidade = false,
      previsao_tipo = 'CONTRATO_REALIZADO',
      previsao_detalhes = format(
        '%s visita realizada em %s · %s tarefa(s) · %s horas reais',
        v_exec.visita_numero || 'ª',
        to_char(v_exec.data_realizada, 'DD/MM/YYYY'),
        cardinality(v_exec.tarefa_ids),
        trim(to_char(v_exec.horas_trabalhadas, 'FM999990D00'))
      ),
      duracao_planejada_minutos = NULL,
      contrato_visita_execucao_id = v_exec.id,
      contrato_visita_realizada_em = v_exec.data_realizada,
      contrato_visita_horas_realizadas = v_exec.horas_trabalhadas,
      contrato_visita_tarefa_ids = v_exec.tarefa_ids,
      contrato_visita_tecnicos = v_exec.tecnicos,
      contrato_visita_tarefas_detalhes = v_exec.tarefas_detalhes,
      atualizado_em = now()
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_exec.contrato_visita_config_id
    AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = v_exec.competencia
    AND agenda.contrato_visita_numero = v_exec.visita_numero;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  -- A regra antiga apagou cards ja realizados. Para o historico, refaz o card
  -- nas linhas dos tecnicos encontrados pelas proprias tarefas da visita.
  IF v_afetadas = 0 THEN
    WITH tecnicos_reais AS (
      SELECT DISTINCT agenda.colaborador_id, agenda.colaborador_nome
      FROM public.agenda_agendamentos agenda
      WHERE agenda.auvo_task_id = ANY(v_exec.tarefa_ids)
        AND agenda.colaborador_id IS NOT NULL
      UNION
      SELECT DISTINCT rh.id, rh.nome
      FROM unnest(v_exec.tecnicos) tecnico(nome)
      JOIN public.rh_colaboradores rh
        ON public.normalizar_cliente_visita(rh.nome) = public.normalizar_cliente_visita(tecnico.nome)
        OR public.normalizar_cliente_visita(rh.nome) LIKE public.normalizar_cliente_visita(tecnico.nome) || '-%'
        OR public.normalizar_cliente_visita(tecnico.nome) LIKE public.normalizar_cliente_visita(rh.nome) || '-%'
      WHERE rh.ativo = true
    )
    INSERT INTO public.agenda_agendamentos (
      data, hora_inicio, hora_fim, colaborador_id, colaborador_nome,
      cliente, descricao, status, origem, auvo_task_id,
      previsao_continuidade, previsao_tipo, previsao_detalhes,
      contrato_id, contrato_visita_config_id, contrato_visita_competencia,
      contrato_visita_numero, duracao_planejada_minutos,
      contrato_visita_execucao_id, contrato_visita_realizada_em,
      contrato_visita_horas_realizadas, contrato_visita_tarefa_ids,
      contrato_visita_tecnicos, contrato_visita_tarefas_detalhes
    )
    SELECT
      v_exec.data_realizada,
      COALESCE(v_hora_inicio, time '08:00'),
      COALESCE(v_hora_fim, time '18:00'),
      tecnico.colaborador_id,
      tecnico.colaborador_nome,
      v_exec.cliente,
      'Visita contratual realizada',
      'REALIZADA',
      'CONTRATO',
      NULL,
      false,
      'CONTRATO_REALIZADO',
      format(
        '%s visita realizada em %s · %s tarefa(s) · %s horas reais',
        v_exec.visita_numero || 'ª',
        to_char(v_exec.data_realizada, 'DD/MM/YYYY'),
        cardinality(v_exec.tarefa_ids),
        trim(to_char(v_exec.horas_trabalhadas, 'FM999990D00'))
      ),
      v_exec.contrato_id,
      v_exec.contrato_visita_config_id,
      v_exec.competencia::text,
      v_exec.visita_numero,
      NULL,
      v_exec.id,
      v_exec.data_realizada,
      v_exec.horas_trabalhadas,
      v_exec.tarefa_ids,
      v_exec.tecnicos,
      v_exec.tarefas_detalhes
    FROM tecnicos_reais tecnico;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
    v_afetadas := v_afetadas + v_inseridas;
  END IF;

  -- Ultimo fallback: usa os tecnicos planejados na configuracao do contrato.
  IF v_afetadas = 0 THEN
    INSERT INTO public.agenda_agendamentos (
      data, hora_inicio, hora_fim, colaborador_id, colaborador_nome,
      cliente, descricao, status, origem, auvo_task_id,
      previsao_continuidade, previsao_tipo, previsao_detalhes,
      contrato_id, contrato_visita_config_id, contrato_visita_competencia,
      contrato_visita_numero, duracao_planejada_minutos,
      contrato_visita_execucao_id, contrato_visita_realizada_em,
      contrato_visita_horas_realizadas, contrato_visita_tarefa_ids,
      contrato_visita_tecnicos, contrato_visita_tarefas_detalhes
    )
    SELECT
      v_exec.data_realizada,
      COALESCE(v_hora_inicio, time '08:00'),
      COALESCE(v_hora_fim, time '18:00'),
      rh.id,
      rh.nome,
      v_exec.cliente,
      'Visita contratual realizada',
      'REALIZADA',
      'CONTRATO',
      NULL,
      false,
      'CONTRATO_REALIZADO',
      format('%sª visita realizada · %s horas reais', v_exec.visita_numero, trim(to_char(v_exec.horas_trabalhadas, 'FM999990D00'))),
      v_exec.contrato_id,
      v_exec.contrato_visita_config_id,
      v_exec.competencia::text,
      v_exec.visita_numero,
      NULL,
      v_exec.id,
      v_exec.data_realizada,
      v_exec.horas_trabalhadas,
      v_exec.tarefa_ids,
      v_exec.tecnicos,
      v_exec.tarefas_detalhes
    FROM public.contratos_visitas_config cfg
    CROSS JOIN LATERAL unnest(COALESCE(cfg.tecnico_ids, '{}'::uuid[])) tecnico_id
    JOIN public.rh_colaboradores rh ON rh.id = tecnico_id
    WHERE cfg.id = v_exec.contrato_visita_config_id;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
    v_afetadas := v_afetadas + v_inseridas;
  END IF;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.materializar_card_visita_contratual(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materializar_card_visita_contratual(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.atualizar_card_visita_contratual_por_execucao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.materializar_card_visita_contratual(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_execucao_materializar_card_visita_contratual
  ON public.contratos_visitas_execucoes;
CREATE TRIGGER trg_execucao_materializar_card_visita_contratual
  AFTER INSERT OR UPDATE OF data_realizada, horas_trabalhadas, tarefa_ids,
    tecnicos, tarefas_detalhes, visita_numero
  ON public.contratos_visitas_execucoes
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_card_visita_contratual_por_execucao();

-- A funcao antiga tenta apagar a previsao logo apos reconhecer a visita.
-- Intercepta essa exclusao e preserva o mesmo card ja convertido.
CREATE OR REPLACE FUNCTION public.proteger_card_visita_contratual_realizada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_execucao_id uuid;
BEGIN
  IF OLD.origem IS DISTINCT FROM 'CONTRATO'
     OR OLD.contrato_visita_config_id IS NULL
     OR OLD.contrato_visita_competencia IS NULL
     OR OLD.contrato_visita_numero IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT execucao.id INTO v_execucao_id
  FROM public.contratos_visitas_execucoes execucao
  WHERE execucao.contrato_visita_config_id = OLD.contrato_visita_config_id
    AND execucao.competencia = date_trunc('month', OLD.contrato_visita_competencia::date)::date
    AND execucao.visita_numero = OLD.contrato_visita_numero
  LIMIT 1;

  IF v_execucao_id IS NOT NULL THEN
    PERFORM public.materializar_card_visita_contratual(v_execucao_id);
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_card_visita_contratual_realizada
  ON public.agenda_agendamentos;
CREATE TRIGGER trg_proteger_card_visita_contratual_realizada
  BEFORE DELETE ON public.agenda_agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_card_visita_contratual_realizada();

-- Restaura imediatamente os cards historicos apagados pela implementacao anterior.
DO $$
DECLARE
  execucao record;
BEGIN
  FOR execucao IN
    SELECT id FROM public.contratos_visitas_execucoes ORDER BY data_realizada, id
  LOOP
    PERFORM public.materializar_card_visita_contratual(execucao.id);
  END LOOP;
END;
$$;
