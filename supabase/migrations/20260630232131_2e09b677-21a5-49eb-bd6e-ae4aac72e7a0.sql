-- Deactivate legacy tipos_equipamento that pre-date the catálogo (sem prioridade)
UPDATE public.tipos_equipamento
SET ativo = false, updated_at = now()
WHERE prioridade IS NULL AND ativo = true;