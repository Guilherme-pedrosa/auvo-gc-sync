DELETE FROM tarefas_central WHERE auvo_task_id = '74235544' AND (orientacao IS NULL OR orientacao = '');
DELETE FROM agenda_agendamentos WHERE id IN ('912c0b47-fff3-4c86-8d4b-d0da0cf2d392', '52f76182-31ee-4a97-b9f4-09ec8896c713', '52f67005-77ac-4f66-ba4a-413958a5e858') AND origem = 'MANUAL';
UPDATE tarefas_central SET orientacao = 'Sem orientacao' WHERE auvo_task_id = '74235544' AND orientacao IS NULL;
