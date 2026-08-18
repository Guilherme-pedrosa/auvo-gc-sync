-- A execução é preservada em contratos_visitas_execucoes. O card da agenda
-- pode ser substituído pelo reconciliador quando surgem tarefas Auvo mais
-- precisas para o mesmo slot; bloquear o DELETE criava dois cards idênticos.
DROP TRIGGER IF EXISTS trg_proteger_card_visita_contratual_realizada
  ON public.agenda_agendamentos;

-- Mantém uma linha por técnico/slot. Quando já existe um card alinhado às
-- tarefas Auvo, ele vence o card anual genérico.
WITH ranked AS (
  SELECT
    agenda.id,
    row_number() OVER (
      PARTITION BY
        agenda.contrato_visita_config_id,
        agenda.contrato_visita_competencia,
        agenda.contrato_visita_numero,
        COALESCE(
          agenda.colaborador_id::text,
          lower(trim(COALESCE(agenda.colaborador_nome, '')))
        )
      ORDER BY
        (agenda.descricao ILIKE '%tarefas Auvo%') DESC,
        cardinality(COALESCE(agenda.contrato_visita_tarefa_ids, '{}')) DESC,
        agenda.atualizado_em DESC NULLS LAST,
        agenda.criado_em DESC NULLS LAST,
        agenda.id DESC
    ) AS position
  FROM public.agenda_agendamentos agenda
  WHERE agenda.origem = 'CONTRATO'
    AND agenda.previsao_tipo = 'CONTRATO'
    AND agenda.contrato_visita_config_id IS NOT NULL
    AND agenda.contrato_visita_competencia IS NOT NULL
    AND agenda.contrato_visita_numero IS NOT NULL
)
DELETE FROM public.agenda_agendamentos agenda
USING ranked duplicate
WHERE agenda.id = duplicate.id
  AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agenda_contrato_slot_tecnico_unique
  ON public.agenda_agendamentos (
    contrato_visita_config_id,
    contrato_visita_competencia,
    contrato_visita_numero,
    COALESCE(
      colaborador_id::text,
      lower(trim(COALESCE(colaborador_nome, '')))
    )
  )
  WHERE origem = 'CONTRATO'
    AND previsao_tipo = 'CONTRATO'
    AND contrato_visita_config_id IS NOT NULL
    AND contrato_visita_competencia IS NOT NULL
    AND contrato_visita_numero IS NOT NULL;
