-- Adiciona coluna de percentual para divisão de OS
ALTER TABLE public.premiacao_os_compartilhada ADD COLUMN IF NOT EXISTS percentual numeric DEFAULT 50;

-- Atualiza o comentário da tabela
COMMENT ON COLUMN public.premiacao_os_compartilhada.percentual IS 'Percentual da OS que pertence ao técnico secundário';
