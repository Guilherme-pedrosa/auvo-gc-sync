
-- Item 1: chave do plano por cliente
ALTER TABLE public.equipamento_plano_preventivo
  ADD COLUMN IF NOT EXISTS cliente_nome TEXT;

-- Backfill: cliente vem do equipamento pelo identificador (== codigo_barras_auvo no plano)
UPDATE public.equipamento_plano_preventivo p
SET cliente_nome = ea.cliente
FROM public.equipamentos_auvo ea
WHERE ea.identificador = p.codigo_barras_auvo
  AND p.cliente_nome IS NULL;

-- Fallback: se ainda houver algum sem cliente resolvido, usa o nome do grupo [Auto] {cliente}
UPDATE public.equipamento_plano_preventivo p
SET cliente_nome = regexp_replace(g.nome, '^\[Auto\]\s*', '')
FROM public.grupos_clientes g
WHERE p.grupo_id = g.id
  AND p.cliente_nome IS NULL
  AND g.nome LIKE '[Auto]%';

-- Se ainda nulo, usa o próprio grupo como placeholder (raro; mantém integridade da NOT NULL)
UPDATE public.equipamento_plano_preventivo p
SET cliente_nome = COALESCE(cliente_nome, 'DESCONHECIDO_' || grupo_id::text)
WHERE cliente_nome IS NULL;

ALTER TABLE public.equipamento_plano_preventivo
  ALTER COLUMN cliente_nome SET NOT NULL;

-- Troca a UNIQUE: agora é por CLIENTE, não por grupo
ALTER TABLE public.equipamento_plano_preventivo
  DROP CONSTRAINT IF EXISTS uq_plano;

ALTER TABLE public.equipamento_plano_preventivo
  ADD CONSTRAINT uq_plano_cliente
  UNIQUE (cliente_nome, codigo_barras_auvo, ano_referencia);

CREATE INDEX IF NOT EXISTS idx_epp_cliente_ano
  ON public.equipamento_plano_preventivo (cliente_nome, ano_referencia);
