-- Dependencias adicionais para exercitar a FK e os triggers reais de anotacao.
CREATE ROLE anon;
ALTER TABLE contratos_visitas_execucoes
  ADD COLUMN criado_em timestamptz DEFAULT now(),
  ADD CONSTRAINT test_execution_slot UNIQUE (contrato_visita_config_id, competencia, visita_numero);
ALTER TABLE agenda_agendamentos
  ADD COLUMN contrato_visita_horas_realizadas numeric(12,4),
  ADD COLUMN contrato_visita_tarefas_detalhes jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN contrato_visita_ajuste_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN atualizado_em timestamptz DEFAULT now();
