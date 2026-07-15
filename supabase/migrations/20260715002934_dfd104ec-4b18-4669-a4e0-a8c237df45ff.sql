ALTER TABLE public.rh_document_types
ADD COLUMN IF NOT EXISTS pacote_padrao text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_rh_document_types_pacote_padrao
  ON public.rh_document_types USING GIN (pacote_padrao);

COMMENT ON COLUMN public.rh_document_types.pacote_padrao IS
'Pacotes padrão WD que exigem este documento. Valores: COMPANY, MEI, CLT.';