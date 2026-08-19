-- Remove os cards contratuais duplicados (mesmo cliente/dia/colaborador/execucao)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
      PARTITION BY cliente, data, COALESCE(colaborador_id::text,''),
                   COALESCE(contrato_visita_config_id::text,''),
                   COALESCE(contrato_visita_execucao_id::text,'')
      ORDER BY criado_em ASC
    ) rn
  FROM public.agenda_agendamentos
  WHERE origem = 'CONTRATO'
)
DELETE FROM public.agenda_agendamentos a USING ranked r
WHERE a.id = r.id AND r.rn > 1;

-- Impede que a reconciliacao crie o mesmo card contratual duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS agenda_contrato_card_unico
ON public.agenda_agendamentos (
  cliente, data,
  COALESCE(colaborador_id::text,''),
  COALESCE(contrato_visita_config_id::text,''),
  COALESCE(contrato_visita_execucao_id::text,'')
)
WHERE origem = 'CONTRATO';