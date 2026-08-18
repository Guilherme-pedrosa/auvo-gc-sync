-- Previsões contratuais continuam editáveis até a visita daquele slot ser
-- efetivamente cumprida. Ajustes e exclusões manuais sobrevivem aos próximos
-- abastecimentos automáticos da agenda.

ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS contrato_visita_ajuste_manual boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_agenda_contrato_visita_ajuste_manual
  ON public.agenda_agendamentos (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero
  )
  WHERE contrato_visita_ajuste_manual = true;

CREATE TABLE IF NOT EXISTS public.agenda_contrato_visita_exclusoes (
  contrato_visita_config_id uuid NOT NULL
    REFERENCES public.contratos_visitas_config(id) ON DELETE CASCADE,
  contrato_visita_competencia date NOT NULL,
  contrato_visita_numero integer NOT NULL,
  excluido_por uuid DEFAULT auth.uid(),
  excluido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero
  )
);

ALTER TABLE public.agenda_contrato_visita_exclusoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read contract visit exclusions"
  ON public.agenda_contrato_visita_exclusoes;
CREATE POLICY "auth read contract visit exclusions"
  ON public.agenda_contrato_visita_exclusoes
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.agenda_contrato_visita_exclusoes TO authenticated;
GRANT ALL ON public.agenda_contrato_visita_exclusoes TO service_role;

-- Exclusões em cascata do próprio contrato/configuração precisam remover
-- também os ajustes protegidos; isso não libera os reconciliadores comuns.
CREATE OR REPLACE FUNCTION public.permitir_exclusao_cascata_previsao_contratual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.excluir_previsao_contratual', 'on', true);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_permitir_exclusao_cascata_previsao_contratual
  ON public.contratos_visitas_config;
CREATE TRIGGER trg_permitir_exclusao_cascata_previsao_contratual
  BEFORE DELETE ON public.contratos_visitas_config
  FOR EACH ROW
  EXECUTE FUNCTION public.permitir_exclusao_cascata_previsao_contratual();

CREATE OR REPLACE FUNCTION public.proteger_ajuste_manual_previsao_contratual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.origem = 'CONTRATO'
       AND OLD.previsao_tipo = 'CONTRATO'
       AND OLD.contrato_visita_ajuste_manual = true
       AND COALESCE(
         current_setting('app.excluir_previsao_contratual', true),
         'off'
       ) <> 'on' THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.origem = 'CONTRATO'
     AND NEW.previsao_tipo = 'CONTRATO'
     AND NEW.contrato_visita_config_id IS NOT NULL
     AND NEW.contrato_visita_competencia IS NOT NULL
     AND NEW.contrato_visita_numero IS NOT NULL THEN
    -- Uma exclusão explícita é um tombstone do slot: sincronizações podem
    -- atualizar as tarefas, mas não recriam o card que o usuário removeu.
    IF EXISTS (
      SELECT 1
      FROM public.agenda_contrato_visita_exclusoes exclusao
      WHERE exclusao.contrato_visita_config_id = NEW.contrato_visita_config_id
        AND exclusao.contrato_visita_competencia
            = date_trunc('month', NEW.contrato_visita_competencia::date)::date
        AND exclusao.contrato_visita_numero = NEW.contrato_visita_numero
    ) THEN
      RETURN NULL;
    END IF;

    -- Se o slot foi reposicionado manualmente, o reconciliador não pode
    -- inserir novamente a versão automática na data/técnico originais.
    IF EXISTS (
      SELECT 1
      FROM public.agenda_agendamentos manual
      WHERE manual.origem = 'CONTRATO'
        AND manual.previsao_tipo = 'CONTRATO'
        AND manual.contrato_visita_ajuste_manual = true
        AND manual.contrato_visita_config_id = NEW.contrato_visita_config_id
        AND date_trunc('month', manual.contrato_visita_competencia::date)::date
            = date_trunc('month', NEW.contrato_visita_competencia::date)::date
        AND manual.contrato_visita_numero = NEW.contrato_visita_numero
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_ajuste_manual_previsao_contratual
  ON public.agenda_agendamentos;
CREATE TRIGGER trg_proteger_ajuste_manual_previsao_contratual
  BEFORE INSERT OR DELETE ON public.agenda_agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_ajuste_manual_previsao_contratual();

CREATE OR REPLACE FUNCTION public.mover_previsao_visita_contratual(
  p_agendamento_id uuid,
  p_data date,
  p_colaborador_id uuid,
  p_colaborador_nome text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agenda public.agenda_agendamentos%ROWTYPE;
  v_afetadas integer := 0;
BEGIN
  SELECT * INTO v_agenda
  FROM public.agenda_agendamentos
  WHERE id = p_agendamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previsão contratual não encontrada';
  END IF;
  IF v_agenda.origem <> 'CONTRATO'
     OR v_agenda.previsao_tipo <> 'CONTRATO'
     OR v_agenda.contrato_visita_config_id IS NULL
     OR v_agenda.contrato_visita_competencia IS NULL
     OR v_agenda.contrato_visita_numero IS NULL THEN
    RAISE EXCEPTION 'O registro informado não é uma previsão contratual';
  END IF;
  IF v_agenda.contrato_visita_execucao_id IS NOT NULL
     OR v_agenda.contrato_visita_realizada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Esta visita já foi cumprida e permanece protegida para auditoria';
  END IF;
  IF p_data IS NULL OR p_colaborador_id IS NULL OR NULLIF(trim(p_colaborador_nome), '') IS NULL THEN
    RAISE EXCEPTION 'Data e técnico são obrigatórios';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_agendamentos destino
    WHERE destino.id <> v_agenda.id
      AND destino.origem = 'CONTRATO'
      AND destino.previsao_tipo = 'CONTRATO'
      AND destino.contrato_visita_config_id = v_agenda.contrato_visita_config_id
      AND destino.contrato_visita_competencia = v_agenda.contrato_visita_competencia
      AND destino.contrato_visita_numero = v_agenda.contrato_visita_numero
      AND destino.colaborador_id = p_colaborador_id
  ) THEN
    RAISE EXCEPTION 'Este técnico já possui o card desta visita contratual';
  END IF;

  DELETE FROM public.agenda_contrato_visita_exclusoes
  WHERE contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND contrato_visita_competencia
        = date_trunc('month', v_agenda.contrato_visita_competencia::date)::date
    AND contrato_visita_numero = v_agenda.contrato_visita_numero;

  -- Protege todas as cópias do mesmo card (uma por técnico), evitando que a
  -- próxima sincronização apague colegas que não foram arrastados.
  UPDATE public.agenda_agendamentos agenda
  SET contrato_visita_ajuste_manual = true
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND agenda.contrato_visita_competencia = v_agenda.contrato_visita_competencia
    AND agenda.contrato_visita_numero = v_agenda.contrato_visita_numero;

  UPDATE public.agenda_agendamentos
  SET data = p_data,
      colaborador_id = p_colaborador_id,
      colaborador_nome = trim(p_colaborador_nome),
      contrato_visita_ajuste_manual = true
  WHERE id = p_agendamento_id;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.mover_previsao_visita_contratual(uuid, date, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mover_previsao_visita_contratual(uuid, date, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.excluir_previsao_visita_contratual(
  p_agendamento_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agenda public.agenda_agendamentos%ROWTYPE;
  v_afetadas integer := 0;
BEGIN
  SELECT * INTO v_agenda
  FROM public.agenda_agendamentos
  WHERE id = p_agendamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previsão contratual não encontrada';
  END IF;
  IF v_agenda.origem <> 'CONTRATO'
     OR v_agenda.previsao_tipo <> 'CONTRATO'
     OR v_agenda.contrato_visita_config_id IS NULL
     OR v_agenda.contrato_visita_competencia IS NULL
     OR v_agenda.contrato_visita_numero IS NULL THEN
    RAISE EXCEPTION 'O registro informado não é uma previsão contratual';
  END IF;
  IF v_agenda.contrato_visita_execucao_id IS NOT NULL
     OR v_agenda.contrato_visita_realizada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Esta visita já foi cumprida e permanece protegida para auditoria';
  END IF;

  INSERT INTO public.agenda_contrato_visita_exclusoes (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero,
    excluido_por,
    excluido_em
  ) VALUES (
    v_agenda.contrato_visita_config_id,
    date_trunc('month', v_agenda.contrato_visita_competencia::date)::date,
    v_agenda.contrato_visita_numero,
    auth.uid(),
    now()
  )
  ON CONFLICT (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero
  ) DO UPDATE
  SET excluido_por = EXCLUDED.excluido_por,
      excluido_em = EXCLUDED.excluido_em;

  PERFORM set_config('app.excluir_previsao_contratual', 'on', true);

  -- O card representa uma visita; remove todas as cópias por técnico do slot.
  DELETE FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id = v_agenda.contrato_visita_config_id
    AND agenda.contrato_visita_competencia = v_agenda.contrato_visita_competencia
    AND agenda.contrato_visita_numero = v_agenda.contrato_visita_numero
    AND agenda.contrato_visita_execucao_id IS NULL
    AND agenda.contrato_visita_realizada_em IS NULL;
  GET DIAGNOSTICS v_afetadas = ROW_COUNT;

  RETURN v_afetadas;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_previsao_visita_contratual(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_previsao_visita_contratual(uuid)
  TO authenticated, service_role;
