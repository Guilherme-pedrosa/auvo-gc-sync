
ALTER TABLE public.rh_colaborador_docs ADD COLUMN IF NOT EXISTS arquivo_sha256 text;
CREATE INDEX IF NOT EXISTS idx_rh_colab_docs_sha256 ON public.rh_colaborador_docs(arquivo_sha256);
CREATE INDEX IF NOT EXISTS idx_rh_colab_docs_colab_type ON public.rh_colaborador_docs(colaborador_id, document_type_id);
