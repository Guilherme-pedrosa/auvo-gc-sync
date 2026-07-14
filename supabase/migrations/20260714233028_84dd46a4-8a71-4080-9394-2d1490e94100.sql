
INSERT INTO public.rh_document_types (code, name, scope, requires_expiry, ativo) VALUES
('ALVARA_BOMBEIRO','Alvará dos Bombeiros','COMPANY',true,true),
('ALTERACAO_CONTRATUAL','Alteração Contratual','COMPANY',false,true),
('CARTAO_CNPJ','Cartão CNPJ','COMPANY',false,true),
('CERT_ATIV_ECON','Certificado de Atividade Econômica','COMPANY',false,true),
('INSC_ESTADUAL','Inscrição Estadual','COMPANY',false,true),
('INSC_MUNICIPAL','Inscrição Municipal','COMPANY',false,true),
('SINTEGRA','SINTEGRA','COMPANY',false,true),
('ENQUADRAMENTO_ME','Enquadramento ME','COMPANY',false,true),
('FATURAMENTO','Faturamento','COMPANY',false,true),
('FICHA_CADASTRAL','Ficha Cadastral','COMPANY',false,true),
('APR','APR','COMPANY',true,true),
('APOLICE_SEGURO_VIDA','Apólice de Seguro de Vida','COMPANY',true,true),
('CNH_SOCIO','CNH do Sócio','COMPANY',true,true),
('CONTRATO_LOCACAO','Contrato de Locação','COMPANY',true,true),
('REGIMENTO_INTERNO','Regimento Interno','COMPANY',false,true),
('PCMSO','PCMSO','COMPANY',true,true),
('PGR','PGR','COMPANY',true,true),
('COMPROVANTE_CONTA','Comprovante de Conta Bancária','COMPANY',false,true),
('TERMO_BANCO','Termo Banco','COMPANY',false,true),
('TERMO_TITULARIDADE_CONTA','Termo de Titularidade de Conta','COMPANY',false,true),
('TERMO_INEXIST_ALOJAMENTO','Termo de Inexistência de Alojamento','COMPANY',false,true)
ON CONFLICT (code) DO NOTHING;
