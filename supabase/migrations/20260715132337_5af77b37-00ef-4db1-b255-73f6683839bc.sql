
-- Novo tipo: Contrato de Trabalho (CLT)
INSERT INTO public.rh_document_types (code, name, scope, requires_expiry, ativo, pacote_padrao)
VALUES ('CONTRATO_CLT', 'Contrato de Trabalho (CLT)', 'TECHNICIAN', false, true, ARRAY['CLT'])
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      scope = EXCLUDED.scope,
      ativo = true;

-- Zera pacote_padrao de todos os TECHNICIAN
UPDATE public.rh_document_types
   SET pacote_padrao = ARRAY[]::text[]
 WHERE scope = 'TECHNICIAN';

-- MEI
UPDATE public.rh_document_types
   SET pacote_padrao = ARRAY['MEI']
 WHERE scope = 'TECHNICIAN'
   AND code IN ('CARTAO_CNPJ_MEI','CONTRATO_TRABALHO','PROFICIENCIA','NR1','NR6','NR35');

-- CLT
UPDATE public.rh_document_types
   SET pacote_padrao = ARRAY['CLT']
 WHERE scope = 'TECHNICIAN'
   AND code IN ('CTPS','CONTRATO_CLT');

-- Comuns (MEI + CLT)
UPDATE public.rh_document_types
   SET pacote_padrao = ARRAY['MEI','CLT']
 WHERE scope = 'TECHNICIAN'
   AND code IN ('ASO','FICHA_EPI','FICHA_REGISTRO','ORDEM_SERVICO_INTERNA','CNH','NR10','NR12');
