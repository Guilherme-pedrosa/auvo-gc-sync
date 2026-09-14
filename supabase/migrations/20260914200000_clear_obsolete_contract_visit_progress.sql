-- A FK da execucao usa ON DELETE SET NULL. A anotacao do cartao, porem,
-- tambem guarda data, horas e tarefas: retire a evidencia que deixou de
-- pertencer ao slot, sem deslocar nem recriar o planejamento.
CREATE OR REPLACE FUNCTION public.limpar_evidencia_obsoleta_do_card_programado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tarefas_removidas text[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.contrato_visita_config_id IS NOT DISTINCT FROM NEW.contrato_visita_config_id
     AND OLD.competencia IS NOT DISTINCT FROM NEW.competencia
     AND OLD.visita_numero IS NOT DISTINCT FROM NEW.visita_numero THEN
    -- Uma reclassificacao parcial mantem a execucao de manutencao, mas retira
    -- dela as tarefas de coifa. O materializador preserva tarefa_ids nao vazio;
    -- remova somente essa diferenca antes de ele anotar a execucao atualizada.
    v_tarefas_removidas := ARRAY(
      SELECT tarefa_id FROM unnest(COALESCE(OLD.tarefa_ids, '{}')) tarefas(tarefa_id)
      WHERE tarefa_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(NEW.tarefa_ids, '{}')) atuais(tarefa_id)
        WHERE atuais.tarefa_id = tarefas.tarefa_id
      )
    );

    UPDATE public.agenda_agendamentos agenda
    SET contrato_visita_tarefa_ids = ARRAY(
          SELECT tarefa_id
          FROM unnest(COALESCE(agenda.contrato_visita_tarefa_ids, '{}'))
            WITH ORDINALITY AS tarefas(tarefa_id, posicao)
          WHERE NOT (tarefa_id = ANY(v_tarefas_removidas))
          ORDER BY posicao
        ),
        atualizado_em = now()
    WHERE agenda.origem = 'CONTRATO'
      AND agenda.previsao_tipo = 'CONTRATO'
      AND agenda.contrato_visita_config_id = OLD.contrato_visita_config_id
      AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = OLD.competencia
      AND agenda.contrato_visita_numero = OLD.visita_numero
      AND (agenda.contrato_visita_execucao_id = OLD.id OR (
        agenda.contrato_visita_execucao_id IS NULL
        AND agenda.contrato_visita_realizada_em = OLD.data_realizada
      ))
      AND agenda.contrato_visita_tarefa_ids && v_tarefas_removidas;

    RETURN NEW;
  END IF;

  UPDATE public.agenda_agendamentos agenda
  SET contrato_visita_execucao_id = NULL,
      contrato_visita_realizada_em = NULL,
      contrato_visita_horas_realizadas = NULL,
      contrato_visita_tarefas_detalhes = '[]'::jsonb,
      -- O array tambem pode conter tarefas planejadas que nao pertencem
      -- a execucao removida. Preserve esses vinculos e sua ordem.
      contrato_visita_tarefa_ids = ARRAY(
        SELECT tarefa_id
        FROM unnest(COALESCE(agenda.contrato_visita_tarefa_ids, '{}'))
          WITH ORDINALITY AS tarefas(tarefa_id, posicao)
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(OLD.tarefa_ids, '{}')) realizadas(tarefa_id)
          WHERE realizadas.tarefa_id = tarefas.tarefa_id
        )
        ORDER BY posicao
      ),
      status = CASE WHEN agenda.status = 'CUMPRIDA_NO_MES'
        THEN 'PREVISAO_CONTRATUAL' ELSE agenda.status END,
      previsao_continuidade = true,
      duracao_planejada_minutos = COALESCE(
        agenda.duracao_planejada_minutos,
        CASE
          WHEN agenda.hora_fim > agenda.hora_inicio THEN
            (extract(epoch FROM (agenda.hora_fim - agenda.hora_inicio)) / 60)::integer
          WHEN agenda.hora_fim < agenda.hora_inicio THEN
            1440 + (extract(epoch FROM (agenda.hora_fim - agenda.hora_inicio)) / 60)::integer
        END,
        (SELECT config.duracao_minutos
         FROM public.contratos_visitas_config config
         WHERE config.id = agenda.contrato_visita_config_id)
      ),
      previsao_detalhes = CASE
        WHEN agenda.previsao_detalhes LIKE 'Visita já realizada neste mês em %'
          THEN format('%sª visita contratual prevista', agenda.contrato_visita_numero)
        ELSE agenda.previsao_detalhes
      END,
      atualizado_em = now()
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = OLD.contrato_visita_config_id
    AND date_trunc('month', agenda.contrato_visita_competencia::date)::date = OLD.competencia
    AND agenda.contrato_visita_numero = OLD.visita_numero
    AND (
      agenda.contrato_visita_execucao_id = OLD.id
      OR (
        agenda.contrato_visita_execucao_id IS NULL
        AND agenda.contrato_visita_realizada_em = OLD.data_realizada
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.contratos_visitas_execucoes atual
      WHERE atual.contrato_visita_config_id = OLD.contrato_visita_config_id
        AND atual.competencia = OLD.competencia
        AND atual.visita_numero = OLD.visita_numero
    );

  IF TG_OP = 'UPDATE' THEN
    -- O trigger legado nao observa mudancas de configuracao/competencia.
    -- Agora o slot anterior esta livre; anote o novo sem modificar suas datas.
    PERFORM public.materializar_card_visita_contratual(NEW.id);
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_evidencia_obsoleta_do_card_programado()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_execucao_limpar_card_programado
  ON public.contratos_visitas_execucoes;
CREATE TRIGGER trg_execucao_limpar_card_programado
  AFTER DELETE OR UPDATE OF tarefa_ids, contrato_visita_config_id, competencia, visita_numero
  ON public.contratos_visitas_execucoes
  FOR EACH ROW
  EXECUTE FUNCTION public.limpar_evidencia_obsoleta_do_card_programado();

-- Sem UPDATE de historico: o reparo dos dias auditados dispara o trigger
-- ao remover ou atualizar a apropriacao incorreta, dentro da mesma transacao.
