UPDATE public.contratos
SET premiacao_preventiva_hora = ROUND(valor_hora * 0.05, 2)
WHERE valor_hora IS NOT NULL AND valor_hora > 0;