-- Promove a previsão criada no orçamento para a tarefa real de execução da OS.
-- A linha da agenda é preservada: técnico, data, horário, veículo e detalhes não se perdem.

ALTER TABLE public.agenda_agendamentos
  ADD COLUMN IF NOT EXISTS previsao_tipo text,
  ADD COLUMN IF NOT EXISTS conversao_status text,
  ADD COLUMN IF NOT EXISTS conversao_erro text,
  ADD COLUMN IF NOT EXISTS conversao_tentada_em timestamptz,
  ADD COLUMN IF NOT EXISTS convertida_em timestamptz;

-- Classifica previsões antigas. A mais recente de cada orçamento é a previsão
-- principal; eventuais cópias para o dia seguinte permanecem como continuidade.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY regexp_replace(COALESCE(gc_orcamento_codigo, ''), '\D', '', 'g')
      ORDER BY atualizado_em DESC, criado_em DESC, id DESC
    ) AS position
  FROM public.agenda_agendamentos
  WHERE gc_orcamento_codigo IS NOT NULL
    AND previsao_continuidade = true
    AND auvo_task_id IS NULL
    AND previsao_tipo IS NULL
)
UPDATE public.agenda_agendamentos AS agenda
SET
  previsao_tipo = CASE WHEN ranked.position = 1 THEN 'ORCAMENTO_EXECUCAO' ELSE 'CONTINUACAO' END,
  conversao_status = CASE WHEN ranked.position = 1 THEN 'AGUARDANDO_OS' ELSE NULL END
FROM ranked
WHERE agenda.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_previsao_execucao_orcamento
  ON public.agenda_agendamentos (
    (regexp_replace(COALESCE(gc_orcamento_codigo, ''), '\D', '', 'g'))
  )
  WHERE previsao_tipo = 'ORCAMENTO_EXECUCAO';

CREATE INDEX IF NOT EXISTS idx_agenda_previsao_conversao_status
  ON public.agenda_agendamentos (conversao_status, atualizado_em)
  WHERE previsao_tipo = 'ORCAMENTO_EXECUCAO';

CREATE OR REPLACE FUNCTION public.promover_previsao_orcamento(
  p_previsao_id uuid,
  p_orcamento_codigo text,
  p_os_codigo text,
  p_auvo_task_id text
)
RETURNS public.agenda_agendamentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.agenda_agendamentos%ROWTYPE;
  v_orcamento text := regexp_replace(COALESCE(p_orcamento_codigo, ''), '\D', '', 'g');
  v_os text := regexp_replace(COALESCE(p_os_codigo, ''), '\D', '', 'g');
  v_task text := regexp_replace(COALESCE(p_auvo_task_id, ''), '\D', '', 'g');
BEGIN
  IF v_orcamento = '' OR v_os = '' OR v_task = '' THEN
    RAISE EXCEPTION 'Orçamento, OS e tarefa Auvo são obrigatórios';
  END IF;

  SELECT * INTO v_row
  FROM public.agenda_agendamentos
  WHERE id = p_previsao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previsão % não encontrada', p_previsao_id;
  END IF;

  IF regexp_replace(COALESCE(v_row.gc_orcamento_codigo, ''), '\D', '', 'g') <> v_orcamento THEN
    RAISE EXCEPTION 'A previsão não pertence ao orçamento %', v_orcamento;
  END IF;

  IF v_row.previsao_tipo IS DISTINCT FROM 'ORCAMENTO_EXECUCAO' THEN
    RAISE EXCEPTION 'A linha informada não é a previsão principal do orçamento';
  END IF;

  -- A sincronização pode ter criado uma segunda linha para a mesma tarefa.
  -- Excluímos somente a duplicata técnica antes de promover a previsão original.
  DELETE FROM public.agenda_agendamentos
  WHERE auvo_task_id = v_task
    AND id <> p_previsao_id;

  UPDATE public.agenda_agendamentos
  SET
    gc_orcamento_codigo = v_orcamento,
    gc_os_codigo = v_os,
    auvo_task_id = v_task,
    origem = 'AUVO',
    status = 'AGENDADO',
    previsao_continuidade = false,
    conversao_status = 'CONVERTIDA',
    conversao_erro = NULL,
    conversao_tentada_em = now(),
    convertida_em = COALESCE(convertida_em, now()),
    atualizado_em = now()
  WHERE id = p_previsao_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.promover_previsao_orcamento(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promover_previsao_orcamento(uuid, text, text, text)
  TO service_role;