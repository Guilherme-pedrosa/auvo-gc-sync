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

-- Planejamento conhece o tipo operacional; realizacao aguarda a prova 215148.
DO $$ BEGIN
  ASSERT escopo_agendado_visita('180795','HIGIENIZAÇÃO DE COIFAS',NULL,'[]',NULL) IS TRUE;
  ASSERT escopo_agendado_visita('246515','[WEDO:180795:480] HIGIENIZAÇÃO DE COIFAS · 8h',NULL,'[]',NULL) IS TRUE;
  ASSERT escopo_agendado_visita('180795','HIGIENIZAÇÃO DE COIFAS','224444','[]',NULL) IS NULL;
  ASSERT escopo_agendado_visita('180175','Preventiva + OS',NULL,'[]',NULL) IS FALSE;
  ASSERT escopo_agendado_visita(NULL,'Verificar coifa',NULL,'[]',NULL) IS FALSE,
    'Mencao textual livre nao identifica tipo operacional contratado';
  ASSERT escopo_realizado_visita(ARRAY[false],true) IS NULL;
  ASSERT escopo_realizado_visita(ARRAY[false,true],true) IS TRUE,
    'Um espelho sem questionario nao bloqueia o 215148 de outro espelho';
  ASSERT escopo_realizado_visita(ARRAY[true,NULL::boolean],true) IS NULL,
    '224444 deve excluir mesmo se outro espelho tem 215148';
  ASSERT escopo_realizado_visita(ARRAY[false],false) IS FALSE,
    'Questionarios de manutencao normal continuam permitidos';
END; $$;

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

-- UPDATE que corrige a data de um espelho incompleto tambem precisa levar
-- sua evidencia ao destino, onde o espelho finalizado ja existe.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal,questionario_id) VALUES
  ('concluida-destino-data','500004','Cliente A',current_date-8,'Tecnico A',true,'Finalizada',5,NULL),
  ('questionario-origem-data','500004','Cliente A',current_date-9,'Tecnico A',false,'Pausada',4.9,'215148');
UPDATE tarefas_central SET data_tarefa=current_date-8
WHERE mirror_key='questionario-origem-data';
DO $$ BEGIN
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes WHERE data_realizada=current_date-8) = 5,
    'UPDATE da data deve reconciliar o destino usando o espelho finalizado';
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes WHERE data_realizada=current_date-9) = 0,
    'O espelho incompleto nao pode deixar execucao na data anterior';
END; $$;

-- O mesmo vale para a correcao de cliente. A apropriacao de manutencao no
-- destino deve dar lugar a coifa, sem atribuir uma visita ao cliente antigo.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal,questionario_id) VALUES
  ('concluida-destino-cliente','500005','Cliente B',current_date-10,'Tecnico A',true,'Finalizada',6,NULL),
  ('questionario-origem-cliente','500005','Cliente A',current_date-10,'Tecnico A',false,'Pausada',5.9,'215148');
UPDATE tarefas_central SET cliente='Cliente B'
WHERE mirror_key='questionario-origem-cliente';
DO $$ BEGIN
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes
    WHERE data_realizada=current_date-10 AND contrato_id='20000000-0000-0000-0000-000000000002') = 6,
    'UPDATE do cliente deve reconciliar o destino usando o espelho finalizado';
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes
    WHERE data_realizada=current_date-10 AND contrato_id='20000000-0000-0000-0000-000000000003') = 0,
    'A apropriacao de manutencao anterior no destino deve ser removida';
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes
    WHERE data_realizada=current_date-10 AND cliente='Cliente A') = 0,
    'O espelho incompleto nao pode deixar execucao no cliente anterior';
END; $$;

-- Evidencia que chega apenas em outros_questionarios transfere a execucao
-- da manutencao para a coifa, sem deixar a apropriacao antiga duplicada.
UPDATE tarefas_central SET outros_questionarios = '[{"questionnaireId":215148}]'
WHERE mirror_key='outro-cliente';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes
    WHERE contrato_id='20000000-0000-0000-0000-000000000003') = 0;
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes
    WHERE contrato_id='20000000-0000-0000-0000-000000000002' AND data_realizada=current_date-2) = 2;
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

-- Tipo 180795 sem respostas deve gerar previsao de coifa, nunca de manutencao.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  status_auvo,task_type_id,descricao) VALUES
  ('planejada-coifa','980001','Cliente B',current_date+10,'Tecnico A','Aberta','180795','HIGIENIZAÇÃO DE COIFAS'),
  ('planejada-tipo-corrigido','980002','Cliente B',current_date+11,'Tecnico A','Aberta',NULL,'Tipo nao informado'),
  ('planejada-wrapper-corrigido','980003','Cliente B',current_date+12,'Tecnico A','Aberta','246515','Tipo nao informado');
UPDATE tarefas_central SET task_type_id='180795' WHERE mirror_key='planejada-tipo-corrigido';
UPDATE tarefas_central SET descricao='[WEDO:180795:120] HIGIENIZAÇÃO DE COIFAS · 2h'
WHERE mirror_key='planejada-wrapper-corrigido';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM agenda_agendamentos WHERE data BETWEEN current_date+10 AND current_date+12) = 3;
  ASSERT (SELECT count(*) FROM agenda_agendamentos WHERE data BETWEEN current_date+10 AND current_date+12
    AND contrato_id='20000000-0000-0000-0000-000000000002') = 3,
    'INSERT e alteracoes isoladas de tipo/descricao devem escolher o contrato de coifa';
  ASSERT NOT EXISTS (SELECT 1 FROM contratos_visitas_execucoes WHERE tarefa_ids && ARRAY['980001','980002','980003']),
    'Planejamento de coifa nao comprova realizacao';
END; $$;
UPDATE tarefas_central SET questionario_id='224444' WHERE mirror_key='planejada-coifa';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM agenda_agendamentos WHERE data=current_date+10),
    'Questionario excluido prevalece sobre o tipo planejado';
END; $$;

-- Finalizada sem 215148 fica pendente e sai da manutencao. O questionario
-- vindo posteriormente em outro espelho incompleto libera somente a coifa.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal) VALUES
  ('realizada-tipo-corrigido','980004','Cliente B',current_date-12,'Tecnico A',true,'Finalizada',8);
UPDATE tarefas_central SET task_type_id='180795' WHERE mirror_key='realizada-tipo-corrigido';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM contratos_visitas_execucoes WHERE tarefa_ids @> ARRAY['980004']),
    'Coifa concluida sem 215148 nao pode consumir manutencao nem coifa';
END; $$;
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  status_auvo,questionario_id) VALUES
  ('prova-coifa-depois','980004','Cliente B',current_date-12,'Tecnico A','Pausada','215148');
DO $$ BEGIN
  ASSERT (SELECT horas_trabalhadas FROM contratos_visitas_execucoes WHERE tarefa_ids @> ARRAY['980004']) = 8;
  ASSERT (SELECT contrato_id FROM contratos_visitas_execucoes WHERE tarefa_ids @> ARRAY['980004'])
    = '20000000-0000-0000-0000-000000000002'::uuid;
END; $$;

-- Uma visita nominal cumprida permanece intacta; a nova coifa futura ocupa
-- um slot extra. Contrato vencido nao deve desviar coifa para manutencao.
INSERT INTO contratos(id,nome,cliente_nome,tipo_id,vigencia_fim) VALUES
  ('20000000-0000-0000-0000-000000000006','Coifa D','Cliente D','10000000-0000-0000-0000-000000000001',NULL),
  ('20000000-0000-0000-0000-000000000007','Coifa E','Cliente E','10000000-0000-0000-0000-000000000001',current_date-1),
  ('20000000-0000-0000-0000-000000000008','Manutencao E','Cliente E','10000000-0000-0000-0000-000000000002',NULL);
INSERT INTO contratos_visitas_config(id,contrato_id,qtd_visitas) VALUES
  ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000006',1),
  ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000007',1),
  ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000008',1);
INSERT INTO contratos_visitas_execucoes(contrato_visita_config_id,contrato_id,competencia,
  visita_numero,data_realizada,cliente,cliente_chave,horas_trabalhadas,tarefa_ids)
VALUES ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000006',date_trunc('month',current_date)::date,
  1,date_trunc('month',current_date)::date,'Cliente D','cliente-d',3,ARRAY['980005']);
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,status_auvo,task_type_id) VALUES
  ('coifa-extra','980006','Cliente D',current_date,'Tecnico A','Aberta','180795'),
  ('coifa-fora-vigencia','980007','Cliente E',current_date+14,'Tecnico A','Aberta','180795');
DO $$ BEGIN
  ASSERT (SELECT contrato_visita_numero FROM agenda_agendamentos WHERE cliente='Cliente D') = 2;
  ASSERT (SELECT count(*) FROM contratos_visitas_execucoes WHERE cliente='Cliente D') = 1,
    'Criar previsao extra nao altera execucao nominal anterior';
  ASSERT NOT EXISTS (SELECT 1 FROM agenda_agendamentos WHERE cliente='Cliente E'),
    'Coifa fora da vigencia nao pode cair no contrato de manutencao';
END; $$;
