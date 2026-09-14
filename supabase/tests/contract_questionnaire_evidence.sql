-- Deve rodar apos o seed e a migration, em PostgreSQL/PGlite efemero.
DO $$
BEGIN
  ASSERT escopo_questionarios_visita(NULL, '[]', '[{"questionnaireId":215148}]') IS TRUE;
  ASSERT escopo_questionarios_visita('215148', '[]', '[{"questionnaireId":224444}]') IS NULL;
  ASSERT escopo_questionarios_visita('224444', '[]', '[{"questionnaireId":215148}]') IS NULL;
  ASSERT escopo_questionarios_visita(NULL, '[{"questionnaireId":"215148"}]', NULL) IS TRUE;
  ASSERT escopo_questionarios_visita(NULL, '[]', '{"questionnaireId":215148}') IS TRUE;
  ASSERT escopo_questionarios_visita(NULL, '{}', '"invalido"') IS FALSE;
  ASSERT escopo_questionarios_visita('214757', '[]', NULL) IS FALSE;
  ASSERT atividade_e_limpeza_coifa('180795', 'HIGIENIZAÇÃO DE COIFAS', NULL, '[]') IS FALSE,
    'Nome/tipo nao podem substituir o questionario contratual';

  PERFORM reconciliar_dia_visita_contratual('Cliente A', current_date - 2);
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes) = 1;
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes) = 7.3,
    'Horas devem vir uma vez da linha operacional finalizada';
  ASSERT (SELECT tarefa_ids FROM contratos_visitas_execucoes) = ARRAY['500001'];
  PERFORM reconciliar_dia_visita_contratual('Cliente A', current_date - 2);
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes) = 1, 'Reconciliacao deve ser idempotente';
END;
$$;

-- Exclusao em qualquer espelho prevalece e limpa a apropriacao existente.
UPDATE tarefas_central SET outros_questionarios = '[{"questionnaireId":224444}]'
WHERE mirror_key='auvo:500001';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes) = 0,
    'Trigger de outros_questionarios precisa reagir, inclusive em espelho pausado';
END; $$;
UPDATE tarefas_central SET outros_questionarios = NULL WHERE mirror_key='auvo:500001';

-- Mesmo task id em outro cliente/dia nao herda o questionario da tarefa A.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal) VALUES
  ('outro-cliente','500001','Cliente B',current_date - 2,'Tecnico A',true,'Finalizada',2),
  ('outro-dia','500001','Cliente A',current_date - 3,'Tecnico A',true,'Finalizada',3);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes
    WHERE contrato_id='20000000-0000-0000-0000-000000000002') = 0;
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes WHERE data_realizada=current_date - 3) = 0;
END; $$;

-- Ordem inversa: o INSERT do espelho incompleto com questionario deve
-- reconciliar uma tarefa que ja tem um espelho operacional finalizado.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal) VALUES
  ('finalizada-primeiro','500002','Cliente A',current_date - 4,'Tecnico A',true,'Finalizada',4);
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal,questionario_id) VALUES
  ('questionario-depois','500002','Cliente A',current_date - 4,'Tecnico A',false,'Pausada',3.9,'215148'),
  ('so-incompleta','500003','Cliente A',current_date - 5,'Tecnico A',false,'Pausada',3.9,'215148');
DO $$ BEGIN
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes WHERE data_realizada=current_date - 4) = 4,
    'INSERT de evidencia apos espelho finalizado precisa reconciliar a tarefa';
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes WHERE data_realizada=current_date - 5) = 0,
    'Questionario e horas sem conclusao nao realizam a visita';
END; $$;

-- Evidencia que chega apenas em outros_questionarios transfere a execucao
-- da manutencao para a coifa, sem deixar a apropriacao antiga duplicada.
UPDATE tarefas_central SET outros_questionarios = '[{"questionnaireId":215148}]'
WHERE mirror_key='outro-cliente';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes
    WHERE contrato_id='20000000-0000-0000-0000-000000000003') = 0;
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes
    WHERE contrato_id='20000000-0000-0000-0000-000000000002') = 2;
END; $$;

-- Agendada: evidencia no espelho mais antigo e novos dados operacionais no GC.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  status_auvo,questionario_id,atualizado_em) VALUES
  ('agenda-auvo','900001','Cliente B',current_date + 1,'Tecnico A','Agendada','215148',now() - interval '1 hour'),
  ('agenda-gc','900001','Cliente B',current_date + 1,'Tecnico A','Agendada',NULL,now());
DO $$ BEGIN
  PERFORM reconciliar_dia_visita_contratual_agendada('Cliente B',current_date + 1);
  ASSERT (SELECT count(*) FROM agenda_agendamentos WHERE data=current_date + 1) = 1;
  ASSERT (SELECT contrato_id FROM agenda_agendamentos WHERE data=current_date + 1)
    = '20000000-0000-0000-0000-000000000002'::uuid;
  ASSERT (SELECT contrato_visita_tarefa_ids FROM agenda_agendamentos WHERE data=current_date + 1) = ARRAY['900001'];
END; $$;

-- A chegada isolada em outros_questionarios tambem move o card agendado.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,status_auvo)
VALUES ('agenda-outros','900002','Cliente B',current_date + 2,'Tecnico A','Agendada');
UPDATE tarefas_central SET outros_questionarios='[{"questionnaireId":215148}]'
WHERE mirror_key='agenda-outros';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM agenda_agendamentos WHERE data=current_date + 2) = 1;
  ASSERT (SELECT contrato_id FROM agenda_agendamentos WHERE data=current_date + 2)
    = '20000000-0000-0000-0000-000000000002'::uuid;
END; $$;
UPDATE tarefas_central SET outros_questionarios='[{"questionnaireId":215148},{"questionnaireId":224444}]'
WHERE mirror_key='agenda-outros';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM agenda_agendamentos WHERE data=current_date + 2) = 0,
    '224444 deve excluir tambem o card agendado';
END; $$;

-- Dois contratos distintos do mesmo escopo nao podem ficar alternando a
-- apropriacao porque a previsao do contrato escolhido ja foi cumprida.
INSERT INTO contratos(id,nome,cliente_nome,tipo_id) VALUES
  ('20000000-0000-0000-0000-000000000004','Coifa C','Cliente C','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000005','Dutos C','Cliente C','10000000-0000-0000-0000-000000000001');
INSERT INTO contratos_visitas_config(id,contrato_id) VALUES
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005');
INSERT INTO agenda_agendamentos(cliente,data,origem,previsao_tipo,
  contrato_visita_config_id,contrato_visita_competencia,contrato_visita_numero) VALUES
  ('Cliente C',current_date-2,'CONTRATO','CONTRATO','30000000-0000-0000-0000-000000000004',date_trunc('month',current_date-2)::date,1),
  ('Cliente C',current_date+3,'CONTRATO','CONTRATO','30000000-0000-0000-0000-000000000005',date_trunc('month',current_date-2)::date,1);
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal,questionario_id)
VALUES ('teste-multiplos-contratos','990001','Cliente C',current_date-2,'Tecnico A',true,'Finalizada',3,'215148');
DO $$
DECLARE v_execucao uuid;
BEGIN
  SELECT id INTO v_execucao FROM contratos_visitas_execucoes WHERE cliente='Cliente C';
  ASSERT (SELECT contrato_id FROM contratos_visitas_execucoes WHERE id=v_execucao)
    = '20000000-0000-0000-0000-000000000004'::uuid, 'Primeira apropriacao deve usar a previsao mais proxima';
  PERFORM reconciliar_dia_visita_contratual('Cliente C',current_date-2);
  PERFORM reconciliar_dia_visita_contratual('Cliente C',current_date-2);
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes WHERE cliente='Cliente C') = 1;
  ASSERT EXISTS (SELECT 1 FROM contratos_visitas_execucoes WHERE id=v_execucao
    AND contrato_id='20000000-0000-0000-0000-000000000004'),
    'Reconciliacoes repetidas devem preservar id e contrato da execucao valida';
END;
$$;
