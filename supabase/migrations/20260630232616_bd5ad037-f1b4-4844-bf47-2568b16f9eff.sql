UPDATE public.tipos_equipamento te
SET ativo = true
WHERE te.ativo = false
  AND te.nome NOT ILIKE 'Excluir%'
  AND EXISTS (SELECT 1 FROM public.equipamentos_auvo e WHERE e.tipo_id = te.id);