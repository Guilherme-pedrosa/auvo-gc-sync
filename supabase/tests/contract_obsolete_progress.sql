BEGIN;

INSERT INTO contrato_tipos(id, nome) VALUES
  ('11000000-0000-0000-0000-000000000001', 'Higienização de coifas');
INSERT INTO contratos(id, nome, cliente_nome) VALUES
  ('21000000-0000-0000-0000-000000000001', 'Manutencao Exemplo', 'Cliente Exemplo'),
  ('21000000-0000-0000-0000-000000000002', 'Manutencao Separada', 'Cliente Separado'),
  ('21000000-0000-0000-0000-000000000003', 'Manutencao Correcao', 'Cliente Correcao'),
  ('21000000-0000-0000-0000-000000000004', 'Coifa Correcao', 'Cliente Correcao');
UPDATE contratos SET tipo_id = '11000000-0000-0000-0000-000000000001'
WHERE id = '21000000-0000-0000-0000-000000000004';
INSERT INTO contratos_visitas_config(id, contrato_id) VALUES
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002'),
  ('31000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000003'),
  ('31000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000004');

-- Tres cards do mesmo slot, inclusive remarcado para o mes seguinte. O array
-- mistura duas tarefas realizadas e tres planejadas que devem permanecer.
INSERT INTO agenda_agendamentos (
  id, data, hora_inicio, hora_fim, colaborador_id, colaborador_nome, cliente,
  descricao, origem, previsao_tipo, status, previsao_continuidade,
  contrato_id, contrato_visita_config_id, contrato_visita_competencia,
  contrato_visita_numero, duracao_planejada_minutos,
  contrato_visita_tarefa_ids, contrato_visita_ajuste_manual
) SELECT
  ('41000000-0000-0000-0000-00000000000' || n)::uuid,
  CASE n WHEN 1 THEN DATE '2026-01-27' WHEN 2 THEN DATE '2026-02-02' ELSE DATE '2026-01-29' END,
  TIME '09:30', TIME '11:15',
  ('51000000-0000-0000-0000-00000000000' || n)::uuid, 'Tecnico ' || n,
  'Cliente Exemplo', 'Planejamento preservado', 'CONTRATO', 'CONTRATO',
  'PREVISAO_CONTRATUAL', true, '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001', '2026-01-01', 4, 105,
  CASE WHEN n < 3 THEN ARRAY['700001','700002','700003','700004','700005'] ELSE '{}'::text[] END,
  n < 3
FROM generate_series(1, 3) n;

-- Outra visita e outro contrato nao podem sofrer a limpeza.
INSERT INTO agenda_agendamentos (
  id, data, hora_inicio, hora_fim, cliente, origem, previsao_tipo,
  contrato_id, contrato_visita_config_id, contrato_visita_competencia,
  contrato_visita_numero, status, previsao_continuidade, duracao_planejada_minutos
) VALUES
  ('41000000-0000-0000-0000-000000000004', '2026-01-30', '08:00', '10:00',
   'Cliente Exemplo', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '2026-01-01', 5, 'PREVISAO_CONTRATUAL', true, 120),
  ('41000000-0000-0000-0000-000000000005', '2026-01-27', '08:00', '10:00',
   'Cliente Separado', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000002',
   '31000000-0000-0000-0000-000000000002', '2026-01-01', 4, 'PREVISAO_CONTRATUAL', true, 120);

INSERT INTO contratos_visitas_execucoes (
  id, contrato_id, contrato_visita_config_id, competencia, visita_numero,
  data_realizada, cliente, cliente_chave, horas_trabalhadas, tarefa_ids, tecnicos, tarefas_detalhes
) VALUES
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '2026-01-01', 4, '2026-01-14',
   'Cliente Exemplo', 'cliente exemplo', 16.5, ARRAY['700001','700002'], ARRAY['Tecnico A'],
   '[{"tarefa_id":"700001","horas":8},{"tarefa_id":"700002","horas":8.5}]'),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '2026-01-01', 5, '2026-01-15',
   'Cliente Exemplo', 'cliente exemplo', 2, ARRAY['700006'], ARRAY['Tecnico B'],
   '[{"tarefa_id":"700006","horas":2}]'),
  ('61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002',
   '31000000-0000-0000-0000-000000000002', '2026-01-01', 4, '2026-01-14',
   'Cliente Separado', 'cliente separado', 1, ARRAY['700007'], ARRAY['Tecnico C'],
   '[{"tarefa_id":"700007","horas":1}]');

DO $$ BEGIN
  IF (SELECT count(*) FROM agenda_agendamentos WHERE status = 'CUMPRIDA_NO_MES') <> 5 THEN
    RAISE EXCEPTION 'baseline nao materializou os cinco cards';
  END IF;
END $$;

CREATE TEMP TABLE unchanged_cards AS
SELECT id, to_jsonb(agenda) AS snapshot
FROM agenda_agendamentos agenda
WHERE id IN ('41000000-0000-0000-0000-000000000004', '41000000-0000-0000-0000-000000000005');
CREATE TEMP TABLE preserved_calendar AS
SELECT id, jsonb_build_array(data, hora_inicio, hora_fim, colaborador_id,
  colaborador_nome, cliente, descricao, origem, previsao_tipo, contrato_id,
  contrato_visita_config_id, contrato_visita_competencia, contrato_visita_numero,
  contrato_visita_ajuste_manual, contrato_visita_tecnicos) AS snapshot
FROM agenda_agendamentos
WHERE contrato_visita_execucao_id = '61000000-0000-0000-0000-000000000001';

DELETE FROM contratos_visitas_execucoes WHERE id = '61000000-0000-0000-0000-000000000001';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM agenda_agendamentos agenda JOIN preserved_calendar USING (id)
    WHERE contrato_visita_execucao_id IS NOT NULL
      OR contrato_visita_realizada_em IS NOT NULL
      OR contrato_visita_horas_realizadas IS NOT NULL
      OR contrato_visita_tarefas_detalhes <> '[]'::jsonb
      OR status <> 'PREVISAO_CONTRATUAL'
      OR previsao_continuidade IS DISTINCT FROM true
      OR duracao_planejada_minutos <> 105
      OR previsao_detalhes LIKE 'Visita já realizada%'
  ) THEN RAISE EXCEPTION 'execucao removida manteve anotacao realizada'; END IF;

  IF (SELECT contrato_visita_tarefa_ids FROM agenda_agendamentos
      WHERE id = '41000000-0000-0000-0000-000000000001') <> ARRAY['700003','700004','700005']
    OR (SELECT contrato_visita_tarefa_ids FROM agenda_agendamentos
      WHERE id = '41000000-0000-0000-0000-000000000002') <> ARRAY['700003','700004','700005']
    OR (SELECT cardinality(contrato_visita_tarefa_ids) FROM agenda_agendamentos
      WHERE id = '41000000-0000-0000-0000-000000000003') <> 0
  THEN RAISE EXCEPTION 'limpeza removeu vinculos planejados ou preservou tarefas realizadas'; END IF;

  IF EXISTS (
    SELECT 1 FROM agenda_agendamentos agenda JOIN preserved_calendar anterior USING (id)
    WHERE jsonb_build_array(data, hora_inicio, hora_fim, colaborador_id,
      colaborador_nome, cliente, descricao, origem, previsao_tipo, contrato_id,
      contrato_visita_config_id, contrato_visita_competencia, contrato_visita_numero,
      contrato_visita_ajuste_manual, contrato_visita_tecnicos) <> anterior.snapshot
  ) OR (SELECT count(*) FROM agenda_agendamentos) <> 5
  THEN RAISE EXCEPTION 'limpeza alterou planejamento ou recriou cards'; END IF;

  IF EXISTS (
    SELECT 1 FROM agenda_agendamentos agenda JOIN unchanged_cards anterior USING (id)
    WHERE to_jsonb(agenda) <> anterior.snapshot
  ) THEN RAISE EXCEPTION 'limpeza afetou outro contrato ou outra visita'; END IF;
END $$;

-- A reaplicacao nao altera o estado; uma execucao nova continua materializando.
DELETE FROM contratos_visitas_execucoes WHERE id = '61000000-0000-0000-0000-000000000001';
INSERT INTO contratos_visitas_execucoes (
  id, contrato_id, contrato_visita_config_id, competencia, visita_numero,
  data_realizada, cliente, cliente_chave, horas_trabalhadas, tarefa_ids, tarefas_detalhes
) VALUES (
  '61000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001', '2026-01-01', 4, '2026-01-16',
  'Cliente Exemplo', 'cliente exemplo', 3, ARRAY['700008'], '[{"tarefa_id":"700008","horas":3}]'
);
DO $$ BEGIN
  IF (SELECT count(*) FROM agenda_agendamentos
      WHERE contrato_visita_execucao_id = '61000000-0000-0000-0000-000000000004'
        AND status = 'CUMPRIDA_NO_MES' AND contrato_visita_horas_realizadas = 3) <> 3
  THEN RAISE EXCEPTION 'limpeza impediu anotacao da nova execucao'; END IF;
END $$;

-- Integracao real: chega o questionario no espelho Auvo depois da linha GC
-- finalizada. O slot nominal esta em outro dia e nao sera apagado/replanejado.
INSERT INTO agenda_agendamentos (
  id, data, hora_inicio, hora_fim, cliente, origem, previsao_tipo,
  contrato_id, contrato_visita_config_id, contrato_visita_competencia,
  contrato_visita_numero, status, previsao_continuidade, duracao_planejada_minutos,
  contrato_visita_ajuste_manual
) VALUES
  ('41000000-0000-0000-0000-000000000006', '2026-05-20', '08:00', '10:00',
   'Cliente Correcao', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000003',
   '31000000-0000-0000-0000-000000000003', '2026-05-01', 1, 'PREVISAO_CONTRATUAL', true, 120, true),
  ('41000000-0000-0000-0000-000000000007', '2026-05-22', '09:00', '17:00',
   'Cliente Correcao', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000004',
   '31000000-0000-0000-0000-000000000004', '2026-05-01', 1, 'PREVISAO_CONTRATUAL', true, 480, true);
INSERT INTO tarefas_central(mirror_key, auvo_task_id, cliente, data_tarefa, tecnico,
  check_out, status_auvo, duracao_decimal, questionario_id) VALUES
  ('gc:710001', '710001', 'Cliente Correcao', '2026-05-03', 'Tecnico A', true, 'Finalizada', 7.5, NULL);
DO $$ BEGIN
  IF (SELECT status FROM agenda_agendamentos WHERE id = '41000000-0000-0000-0000-000000000006') <> 'CUMPRIDA_NO_MES'
  THEN RAISE EXCEPTION 'integracao nao reproduziu classificacao inicial de manutencao'; END IF;
END $$;
INSERT INTO tarefas_central(mirror_key, auvo_task_id, cliente, data_tarefa, tecnico,
  check_out, status_auvo, duracao_decimal, questionario_id) VALUES
  ('auvo:710001', '710001', 'Cliente Correcao', '2026-05-03', 'Tecnico A', false, 'Pausada', 7.4, '215148');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM contratos_visitas_execucoes
      WHERE contrato_visita_config_id = '31000000-0000-0000-0000-000000000003')
    OR (SELECT count(*) FROM contratos_visitas_execucoes
      WHERE contrato_visita_config_id = '31000000-0000-0000-0000-000000000004' AND horas_trabalhadas = 7.5) <> 1
  THEN RAISE EXCEPTION 'correcao nao transferiu execucao de manutencao para coifa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_agendamentos WHERE id = '41000000-0000-0000-0000-000000000006'
      AND data = '2026-05-20' AND contrato_visita_ajuste_manual = true
      AND status = 'PREVISAO_CONTRATUAL' AND contrato_visita_execucao_id IS NULL
      AND contrato_visita_realizada_em IS NULL AND contrato_visita_horas_realizadas IS NULL
      AND contrato_visita_tarefas_detalhes = '[]'::jsonb AND cardinality(contrato_visita_tarefa_ids) = 0
  ) THEN RAISE EXCEPTION 'reclassificacao deixou manutencao cumprida sem execucao'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_agendamentos WHERE id = '41000000-0000-0000-0000-000000000007'
      AND data = '2026-05-22' AND contrato_visita_ajuste_manual = true
      AND status = 'CUMPRIDA_NO_MES' AND contrato_visita_execucao_id IS NOT NULL
      AND contrato_visita_horas_realizadas = 7.5 AND contrato_visita_tarefa_ids = ARRAY['710001']
  ) THEN RAISE EXCEPTION 'reclassificacao nao anotou coifa mantendo data nominal'; END IF;
END $$;

-- Dia misto: somente a tarefa de coifa sai da execucao de manutencao.
-- O vinculo planejado que nunca foi realizado continua no mesmo cartao.
INSERT INTO agenda_agendamentos (
  id, data, hora_inicio, hora_fim, cliente, origem, previsao_tipo,
  contrato_id, contrato_visita_config_id, contrato_visita_competencia,
  contrato_visita_numero, status, previsao_continuidade, duracao_planejada_minutos,
  contrato_visita_tarefa_ids, contrato_visita_ajuste_manual
) VALUES
  ('41000000-0000-0000-0000-000000000008', '2026-06-20', '08:00', '10:00',
   'Cliente Correcao', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000003',
   '31000000-0000-0000-0000-000000000003', '2026-06-01', 1, 'PREVISAO_CONTRATUAL', true, 120,
   ARRAY['720001','720002','720003'], true),
  ('41000000-0000-0000-0000-000000000009', '2026-06-22', '09:00', '17:00',
   'Cliente Correcao', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000004',
   '31000000-0000-0000-0000-000000000004', '2026-06-01', 1, 'PREVISAO_CONTRATUAL', true, 480,
   '{}', true);
INSERT INTO tarefas_central(mirror_key, auvo_task_id, cliente, data_tarefa, tecnico,
  check_out, status_auvo, duracao_decimal, questionario_id) VALUES
  ('gc:720001', '720001', 'Cliente Correcao', '2026-06-03', 'Tecnico A', true, 'Finalizada', 2, NULL),
  ('gc:720002', '720002', 'Cliente Correcao', '2026-06-03', 'Tecnico A', true, 'Finalizada', 1, NULL);
CREATE TEMP TABLE mixed_execution_before AS
  SELECT id FROM contratos_visitas_execucoes
  WHERE contrato_visita_config_id='31000000-0000-0000-0000-000000000003' AND competencia='2026-06-01';
INSERT INTO tarefas_central(mirror_key, auvo_task_id, cliente, data_tarefa, tecnico,
  check_out, status_auvo, duracao_decimal, questionario_id) VALUES
  ('auvo:720001', '720001', 'Cliente Correcao', '2026-06-03', 'Tecnico A', false, 'Pausada', 1.9, '215148');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM contratos_visitas_execucoes e JOIN mixed_execution_before b USING(id)
    WHERE e.horas_trabalhadas=1 AND e.tarefa_ids=ARRAY['720002']
  ) THEN RAISE EXCEPTION 'dia misto perdeu a execucao de manutencao remanescente'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_agendamentos
    WHERE id='41000000-0000-0000-0000-000000000008'
      AND data='2026-06-20' AND hora_inicio='08:00' AND hora_fim='10:00'
      AND contrato_visita_ajuste_manual AND status='CUMPRIDA_NO_MES'
      AND contrato_visita_horas_realizadas=1
      AND contrato_visita_tarefa_ids=ARRAY['720002','720003']
      AND contrato_visita_tarefas_detalhes @> '[{"tarefa_id":"720002"}]'
      AND NOT contrato_visita_tarefas_detalhes @> '[{"tarefa_id":"720001"}]'
  ) THEN RAISE EXCEPTION 'dia misto deixou vinculo de coifa ou perdeu planejamento'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_agendamentos
    WHERE id='41000000-0000-0000-0000-000000000009' AND data='2026-06-22'
      AND contrato_visita_ajuste_manual AND contrato_visita_horas_realizadas=2
      AND contrato_visita_tarefa_ids=ARRAY['720001']
  ) THEN RAISE EXCEPTION 'dia misto nao reconheceu a coifa no contrato correto'; END IF;
END $$;

-- Transferencia de competencia tambem libera o slot anterior, preservando a data nominal.
INSERT INTO agenda_agendamentos (
  id, data, hora_inicio, hora_fim, cliente, origem, previsao_tipo,
  contrato_id, contrato_visita_config_id, contrato_visita_competencia,
  contrato_visita_numero, status, previsao_continuidade, duracao_planejada_minutos,
  contrato_visita_ajuste_manual
) VALUES (
  '41000000-0000-0000-0000-000000000010', '2026-07-22', '09:00', '17:00',
  'Cliente Correcao', 'CONTRATO', 'CONTRATO', '21000000-0000-0000-0000-000000000004',
  '31000000-0000-0000-0000-000000000004', '2026-07-01', 1, 'PREVISAO_CONTRATUAL', true, 480, true
);
UPDATE contratos_visitas_execucoes SET competencia='2026-07-01'
WHERE contrato_visita_config_id='31000000-0000-0000-0000-000000000004' AND competencia='2026-06-01';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM agenda_agendamentos
      WHERE id='41000000-0000-0000-0000-000000000009' AND data='2026-06-22'
        AND status='PREVISAO_CONTRATUAL' AND contrato_visita_execucao_id IS NULL
        AND contrato_visita_horas_realizadas IS NULL AND contrato_visita_tarefa_ids='{}')
    OR NOT EXISTS (SELECT 1 FROM agenda_agendamentos
      WHERE id='41000000-0000-0000-0000-000000000010' AND data='2026-07-22'
        AND status='CUMPRIDA_NO_MES' AND contrato_visita_horas_realizadas=2
        AND contrato_visita_tarefa_ids=ARRAY['720001'])
  THEN RAISE EXCEPTION 'mudanca de competencia deixou evidencia no slot incorreto'; END IF;
END $$;

ROLLBACK;
