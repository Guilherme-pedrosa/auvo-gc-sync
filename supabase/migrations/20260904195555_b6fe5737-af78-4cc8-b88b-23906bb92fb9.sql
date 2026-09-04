CREATE TABLE public.gc_produto_estoque_cache (
  produto_key TEXT PRIMARY KEY,
  produto_id TEXT NOT NULL,
  variacao_id TEXT,
  estoque NUMERIC NOT NULL DEFAULT 0,
  verificado BOOLEAN NOT NULL DEFAULT false,
  atualizado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.gc_produto_estoque_cache TO authenticated;
GRANT ALL ON public.gc_produto_estoque_cache TO service_role;

ALTER TABLE public.gc_produto_estoque_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read estoque cache"
ON public.gc_produto_estoque_cache
FOR SELECT
TO authenticated
USING (true);