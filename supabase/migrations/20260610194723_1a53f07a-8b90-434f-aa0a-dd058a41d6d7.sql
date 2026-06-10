ALTER TABLE public.os_retornos
  ADD COLUMN IF NOT EXISTS mes_desconto text,
  ADD COLUMN IF NOT EXISTS tecnico_original text,
  ADD COLUMN IF NOT EXISTS valor_desconto numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_saida_original date,
  ADD COLUMN IF NOT EXISTS cliente_original text;

CREATE INDEX IF NOT EXISTS idx_os_retornos_mes_desconto
  ON public.os_retornos(mes_desconto)
  WHERE mes_desconto IS NOT NULL;