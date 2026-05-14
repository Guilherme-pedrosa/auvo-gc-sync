-- PR1.5 — Consolidar alertas_horas_config em 1 linha + índice singleton

-- 1. Remover a linha obsoleta (mantém a mais recente com overlap habilitado)
DELETE FROM public.alertas_horas_config
WHERE id = 'd8e0ed76-7fc6-4531-8f7d-c2444a6d4577';

-- 2. Impedir múltiplas linhas no futuro (índice único sobre constante true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_config_singleton
  ON public.alertas_horas_config ((true));
