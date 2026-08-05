ALTER TABLE public.premiacao_os_compartilhada
  DROP CONSTRAINT IF EXISTS premiacao_os_compartilhada_gc_os_codigo_key;

CREATE UNIQUE INDEX IF NOT EXISTS premiacao_os_compartilhada_os_tecnico_key
  ON public.premiacao_os_compartilhada (gc_os_codigo, tecnico_secundario);

ALTER TABLE public.premiacao_os_compartilhada
  ALTER COLUMN percentual SET DEFAULT 50;
