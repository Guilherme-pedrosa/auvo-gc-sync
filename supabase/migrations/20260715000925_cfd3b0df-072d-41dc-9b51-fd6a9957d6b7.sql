INSERT INTO public.rh_document_types (code, name, scope, requires_expiry) VALUES
('NR6', 'NR-6 - EPI', 'TECHNICIAN', true),
('NR12', 'NR-12 - Segurança em Máquinas', 'TECHNICIAN', true),
('CONTRATO_TRABALHO', 'Contrato de Prestação de Serviço', 'TECHNICIAN', false),
('TREINAMENTO_INTERNO', 'Treinamento Interno', 'TECHNICIAN', false),
('FICHA_EPI', 'Ficha de EPI', 'TECHNICIAN', false),
('VACINACAO', 'Caderneta de Vacinação', 'TECHNICIAN', false),
('CCMEI', 'CCMEI - Certificado MEI', 'TECHNICIAN', false),
('DESCRITIVO_FUNCAO', 'Descritivo de Função', 'TECHNICIAN', false),
('CODIGO_CULTURA', 'Código de Cultura', 'TECHNICIAN', false),
('CONFIDENCIALIDADE', 'Termo de Confidencialidade', 'TECHNICIAN', false),
('PROFICIENCIA', 'Termo de Proficiência', 'TECHNICIAN', false),
('TERMO_CARROS', 'Termo de Uso de Veículos', 'TECHNICIAN', false),
('TERMO_AUVO', 'Termo de Uso Auvo', 'TECHNICIAN', false),
('USO_CELULAR', 'Termo de Uso de Celular', 'TECHNICIAN', false),
('ORDEM_SERVICO_INTERNA', 'Ordem de Serviço Interna', 'TECHNICIAN', false),
('COMPROVANTE_PAGAMENTO', 'Comprovante de Pagamento', 'TECHNICIAN', false)
ON CONFLICT (code) DO NOTHING;