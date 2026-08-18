-- Evita que os upserts em lote do Auvo recalcularem a mesma visita centenas
-- de vezes. A regra contratual continua completa, inclusive os vinculos de
-- RH > Clientes e a classificacao pelos questionarios 215148/224444.

-- Nomes iguais nao precisam consultar RH > Clientes. Quando os nomes diferem,
-- a amarracao oficial continua sendo a fonte de verdade.
CREATE OR REPLACE FUNCTION public.clientes_rh_relacionados(
  p_cliente_a text,
  p_cliente_b text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.normalizar_cliente_visita(p_cliente_a)
       = public.normalizar_cliente_visita(p_cliente_b)
      THEN true
    ELSE public.cliente_rh_chave(p_cliente_a) = public.cliente_rh_chave(p_cliente_b)
  END;
$$;

-- Os aliases oficiais continuam resolvendo nomes diferentes sem varredura
-- repetida da tabela de RH.
CREATE INDEX IF NOT EXISTS idx_rh_clientes_nome_vinculado_normalizado
  ON public.rh_clientes ((public.normalizar_cliente_visita(nome)))
  WHERE ativo = true AND lower(COALESCE(vinculo_status, '')) = 'vinculado';
CREATE INDEX IF NOT EXISTS idx_rh_clientes_nome_gc_vinculado_normalizado
  ON public.rh_clientes ((public.normalizar_cliente_visita(nome_gc)))
  WHERE ativo = true AND lower(COALESCE(vinculo_status, '')) = 'vinculado';
CREATE INDEX IF NOT EXISTS idx_rh_clientes_nome_auvo_vinculado_normalizado
  ON public.rh_clientes ((public.normalizar_cliente_visita(nome_auvo)))
  WHERE ativo = true AND lower(COALESCE(vinculo_status, '')) = 'vinculado';
CREATE INDEX IF NOT EXISTS idx_rh_clientes_fantasia_vinculado_normalizado
  ON public.rh_clientes ((public.normalizar_cliente_visita(nome_fantasia)))
  WHERE ativo = true AND lower(COALESCE(vinculo_status, '')) = 'vinculado';

CREATE INDEX IF NOT EXISTS idx_contratos_nome
  ON public.contratos (nome);
CREATE INDEX IF NOT EXISTS idx_tarefas_central_dia_tarefa_atualizacao
  ON public.tarefas_central (data_tarefa, auvo_task_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_contrato_config_data_tipo
  ON public.agenda_agendamentos (contrato_visita_config_id, data, previsao_tipo)
  WHERE origem = 'CONTRATO';
CREATE INDEX IF NOT EXISTS idx_execucao_contrato_config_competencia_numero
  ON public.contratos_visitas_execucoes (
    contrato_visita_config_id, competencia, visita_numero
  );

CREATE OR REPLACE FUNCTION public.cliente_rh_chave(p_cliente text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT 'rh:' || cliente.id::text
      FROM public.rh_clientes cliente
      WHERE cliente.ativo = true
        AND lower(COALESCE(cliente.vinculo_status, '')) = 'vinculado'
        AND (
          public.normalizar_cliente_visita(cliente.nome)
            = public.normalizar_cliente_visita(p_cliente)
          OR public.normalizar_cliente_visita(cliente.nome_gc)
            = public.normalizar_cliente_visita(p_cliente)
          OR public.normalizar_cliente_visita(cliente.nome_auvo)
            = public.normalizar_cliente_visita(p_cliente)
          OR public.normalizar_cliente_visita(cliente.nome_fantasia)
            = public.normalizar_cliente_visita(p_cliente)
        )
      ORDER BY cliente.atualizado_em DESC NULLS LAST, cliente.id
      LIMIT 1
    ),
    public.normalizar_cliente_visita(p_cliente)
  );
$$;

-- Uma alteracao que nao muda nenhum dado operacional sai antes de consultar
-- tarefas, contratos ou RH. Se cliente/data nao mudaram, o dia e processado
-- uma unica vez, em vez de uma vez para OLD e outra para NEW.
CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
     AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa
     AND OLD.auvo_task_id IS NOT DISTINCT FROM NEW.auvo_task_id
     AND OLD.tecnico IS NOT DISTINCT FROM NEW.tecnico
     AND OLD.hora_inicio IS NOT DISTINCT FROM NEW.hora_inicio
     AND OLD.hora_fim IS NOT DISTINCT FROM NEW.hora_fim
     AND OLD.status_auvo IS NOT DISTINCT FROM NEW.status_auvo
     AND OLD.questionario_id IS NOT DISTINCT FROM NEW.questionario_id
     AND OLD.questionario_respostas IS NOT DISTINCT FROM NEW.questionario_respostas THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.data_tarefa IS NOT NULL
     AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR OLD.cliente IS DISTINCT FROM NEW.cliente
       OR OLD.data_tarefa IS DISTINCT FROM NEW.data_tarefa
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.data_tarefa IS NOT NULL
     AND NULLIF(trim(NEW.cliente), '') IS NOT NULL THEN
    PERFORM public.reconciliar_dia_visita_contratual_agendada(
      NEW.cliente, NEW.data_tarefa
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_reconciliar_visita_contratual_agendada
  ON public.tarefas_central;
CREATE TRIGGER trg_tarefa_reconciliar_visita_contratual_agendada
  AFTER INSERT OR DELETE OR UPDATE OF cliente, data_tarefa, auvo_task_id,
    tecnico, hora_inicio, hora_fim, status_auvo,
    questionario_id, questionario_respostas
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa();

-- A visita realizada tambem precisa reagir quando o questionario chega depois
-- do snapshot inicial. O mesmo dia e reconciliado uma unica vez.
CREATE OR REPLACE FUNCTION public.atualizar_visita_contratual_por_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
     AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa
     AND OLD.auvo_task_id IS NOT DISTINCT FROM NEW.auvo_task_id
     AND OLD.duracao_decimal IS NOT DISTINCT FROM NEW.duracao_decimal
     AND OLD.check_out IS NOT DISTINCT FROM NEW.check_out
     AND OLD.data_conclusao IS NOT DISTINCT FROM NEW.data_conclusao
     AND OLD.status_auvo IS NOT DISTINCT FROM NEW.status_auvo
     AND OLD.tecnico IS NOT DISTINCT FROM NEW.tecnico
     AND OLD.check_in_iso IS NOT DISTINCT FROM NEW.check_in_iso
     AND OLD.check_out_iso IS NOT DISTINCT FROM NEW.check_out_iso
     AND OLD.questionario_id IS NOT DISTINCT FROM NEW.questionario_id
     AND OLD.questionario_respostas IS NOT DISTINCT FROM NEW.questionario_respostas THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.data_tarefa IS NOT NULL
     AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR OLD.cliente IS DISTINCT FROM NEW.cliente
       OR OLD.data_tarefa IS DISTINCT FROM NEW.data_tarefa
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.data_tarefa IS NOT NULL
     AND NULLIF(trim(NEW.cliente), '') IS NOT NULL
     AND COALESCE(NEW.duracao_decimal, 0) > 0
     AND (
       NEW.check_out IS TRUE
       OR NEW.data_conclusao IS NOT NULL
       OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%finaliz%'
       OR public.normalizar_cliente_visita(NEW.status_auvo) LIKE '%conclu%'
     ) THEN
    PERFORM public.reconciliar_dia_visita_contratual(
      NEW.cliente, NEW.data_tarefa
    );
  ELSIF TG_OP = 'UPDATE'
        AND OLD.data_tarefa IS NOT NULL
        AND NULLIF(trim(OLD.cliente), '') IS NOT NULL
        AND OLD.cliente IS NOT DISTINCT FROM NEW.cliente
        AND OLD.data_tarefa IS NOT DISTINCT FROM NEW.data_tarefa THEN
    -- Se uma tarefa deixou de ser valida, limpa/recalcula a apropriacao antiga.
    PERFORM public.reconciliar_dia_visita_contratual(
      OLD.cliente, OLD.data_tarefa
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_reconciliar_visita_contratual
  ON public.tarefas_central;
CREATE TRIGGER trg_tarefa_reconciliar_visita_contratual
  AFTER INSERT OR DELETE OR UPDATE OF cliente, data_tarefa, auvo_task_id,
    duracao_decimal, check_out, data_conclusao, status_auvo, tecnico,
    check_in_iso, check_out_iso, questionario_id, questionario_respostas
  ON public.tarefas_central
  FOR EACH ROW
  EXECUTE FUNCTION public.atualizar_visita_contratual_por_tarefa();

REVOKE ALL ON FUNCTION public.clientes_rh_relacionados(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_rh_chave(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atualizar_visita_contratual_agendada_por_tarefa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atualizar_visita_contratual_por_tarefa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clientes_rh_relacionados(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cliente_rh_chave(text)
  TO authenticated, service_role;
