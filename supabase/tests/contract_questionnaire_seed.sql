INSERT INTO contrato_tipos VALUES
  ('10000000-0000-0000-0000-000000000001','Higienização de coifas'),
  ('10000000-0000-0000-0000-000000000002','Manutenção Preventiva');
INSERT INTO contratos(id,nome,cliente_nome,tipo_id) VALUES
  ('20000000-0000-0000-0000-000000000001','Coifa A','Cliente A','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','Coifa B','Cliente B','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003','Manutencao B','Cliente B','10000000-0000-0000-0000-000000000002');
INSERT INTO contratos_visitas_config(id,contrato_id) VALUES
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003');
INSERT INTO rh_colaboradores(id,nome) VALUES ('40000000-0000-0000-0000-000000000001','Tecnico A');
-- O questionario esta no espelho pausado;
-- o espelho finalizado possui a duracao definitiva, mas nao o questionario.
INSERT INTO tarefas_central(mirror_key,auvo_task_id,cliente,data_tarefa,tecnico,
  check_out,status_auvo,duracao_decimal,questionario_id,atualizado_em) VALUES
  ('auvo:500001','500001','Cliente A',current_date - 2,'Tecnico A',
    false,'Pausada',7.25,'215148',now() - interval '1 hour'),
  ('gc:500001','500001','Cliente A',current_date - 2,'Tecnico A',
    true,'Finalizada',7.3,NULL,now());
