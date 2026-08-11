-- Nome não é identificador. GC e Auvo podem possuir clientes distintos com
-- a mesma razão/nome fantasia; os vínculos passam a ser garantidos pelos IDs.
ALTER TABLE public.rh_clientes
  DROP CONSTRAINT IF EXISTS rh_clientes_nome_normalizado_key;

DROP INDEX IF EXISTS public.rh_clientes_nome_normalizado_key;

CREATE INDEX IF NOT EXISTS idx_rh_clientes_nome_normalizado
  ON public.rh_clientes (nome_normalizado);

-- O índice parcial anterior não pode ser inferido por
-- INSERT ... ON CONFLICT (auvo_cliente_id), fazendo o PostgREST rejeitar o
-- lote inteiro. UNIQUE normal já aceita vários NULLs e funciona no upsert.
DROP INDEX IF EXISTS public.uq_rh_clientes_auvo_cliente_id;
ALTER TABLE public.rh_clientes
  DROP CONSTRAINT IF EXISTS rh_clientes_auvo_cliente_id_key;
ALTER TABLE public.rh_clientes
  ADD CONSTRAINT rh_clientes_auvo_cliente_id_key UNIQUE (auvo_cliente_id);

NOTIFY pgrst, 'reload schema';
