-- Reservas do saldo de uma baixa parcial não podem promover/reagendar uma OS de lote anterior.
-- Conserva datas, técnicos, documentos anteriores e tarefas reais.
CREATE OR REPLACE FUNCTION public.guard_partial_balance_forecast()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  arrival jsonb;
BEGIN
  -- Um formulário aberto antes da conversão não pode apagar o vínculo real.
  IF TG_OP = 'UPDATE'
     AND NULLIF(btrim(OLD.auvo_task_id), '') IS NOT NULL
     AND NEW.origem = 'MANUAL'
     AND NEW.previsao_continuidade IS TRUE
     AND NULLIF(btrim(NEW.auvo_task_id), '') IS NULL THEN
    RAISE EXCEPTION 'Esta previsão já foi convertida em tarefa. Atualize a agenda e abra o agendamento atual.';
  END IF;

  IF NEW.previsao_continuidade IS TRUE
     AND NEW.origem = 'MANUAL'
     AND NULLIF(btrim(NEW.auvo_task_id), '') IS NULL
     AND NEW.previsao_tipo = 'ORCAMENTO_EXECUCAO' THEN
    SELECT item INTO arrival
    FROM public.compras_chegadas_snapshot snapshot,
      LATERAL jsonb_array_elements(snapshot.payload->'itens') item
    WHERE snapshot.id = 'default'
      AND item->>'grupo' = 'baixa_parcial'
      AND item->>'orcamento_codigo' = NEW.gc_orcamento_codigo
    LIMIT 1;

    IF arrival IS NOT NULL THEN
      NEW.previsao_tipo := 'SALDO_BAIXA_PARCIAL';
      NEW.conversao_status := CASE
        WHEN arrival->>'saldo_baixa_parcial_status' IS DISTINCT FROM 'verified' THEN 'SALDO_A_CONFIRMAR'
        WHEN jsonb_array_length(COALESCE(arrival->'produtos', '[]'::jsonb)) = 0 THEN 'SALDO_ENCERRADO'
        ELSE 'SALDO_PENDENTE'
      END;
      NEW.conversao_erro := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Roda após trg_normalizar_previsao_manual_sem_tarefa, inclusive em clientes antigos.
DROP TRIGGER IF EXISTS z_guard_partial_balance_forecast ON public.agenda_agendamentos;
CREATE TRIGGER z_guard_partial_balance_forecast
BEFORE INSERT OR UPDATE ON public.agenda_agendamentos
FOR EACH ROW EXECUTE FUNCTION public.guard_partial_balance_forecast();

-- Aciona a mesma regra apenas nas reservas pendentes identificadas pelo snapshot oficial.
UPDATE public.agenda_agendamentos agenda
SET previsao_tipo = agenda.previsao_tipo, atualizado_em = now()
WHERE agenda.previsao_continuidade IS TRUE
  AND agenda.origem = 'MANUAL'
  AND NULLIF(btrim(agenda.auvo_task_id), '') IS NULL
  AND agenda.previsao_tipo = 'ORCAMENTO_EXECUCAO'
  AND EXISTS (
    SELECT 1 FROM public.compras_chegadas_snapshot snapshot,
      LATERAL jsonb_array_elements(snapshot.payload->'itens') item
    WHERE snapshot.id = 'default'
      AND item->>'grupo' = 'baixa_parcial'
      AND item->>'orcamento_codigo' = agenda.gc_orcamento_codigo
  );
