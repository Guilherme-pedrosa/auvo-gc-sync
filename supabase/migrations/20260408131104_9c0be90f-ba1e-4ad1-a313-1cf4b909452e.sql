DROP INDEX IF EXISTS equipamentos_auvo_auvo_id_unique;
CREATE UNIQUE INDEX equipamentos_auvo_auvo_id_unique ON public.equipamentos_auvo (auvo_equipment_id);