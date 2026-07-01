ALTER TABLE public.plano_preventivo_item
  DROP CONSTRAINT IF EXISTS plano_preventivo_item_grupo_id_ano_referencia_equipamento_n_key;

ALTER TABLE public.plano_preventivo_item
  ADD CONSTRAINT plano_preventivo_item_grupo_ano_equipamento_id_key
  UNIQUE (grupo_id, ano_referencia, equipamento_auvo_id);
