
-- 1) Tabela de tipos de equipamento
CREATE TABLE public.tipos_equipamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  categoria text,
  horas_por_tecnico numeric(5,2) NOT NULL DEFAULT 2.5,
  qtd_tecnicos integer NOT NULL DEFAULT 1 CHECK (qtd_tecnicos >= 1),
  periodicidade text NOT NULL DEFAULT 'BIMESTRAL' CHECK (periodicidade IN ('MENSAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL','FILA')),
  criticidade text NOT NULL DEFAULT 'MEDIA' CHECK (criticidade IN ('CRITICA','ALTA','MEDIA','BAIXA')),
  palavras_chave text[] NOT NULL DEFAULT '{}',
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_equipamento TO authenticated;
GRANT ALL ON public.tipos_equipamento TO service_role;

ALTER TABLE public.tipos_equipamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users manage tipos_equipamento"
ON public.tipos_equipamento FOR ALL
TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_tipos_equipamento_updated
BEFORE UPDATE ON public.tipos_equipamento
FOR EACH ROW EXECUTE FUNCTION public.update_os_revisao_at();

-- 2) Vínculo + overrides em equipamentos_auvo
ALTER TABLE public.equipamentos_auvo
  ADD COLUMN IF NOT EXISTS tipo_id uuid REFERENCES public.tipos_equipamento(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_horas_por_tecnico numeric(5,2),
  ADD COLUMN IF NOT EXISTS override_qtd_tecnicos integer,
  ADD COLUMN IF NOT EXISTS override_periodicidade text;

CREATE INDEX IF NOT EXISTS idx_equipamentos_auvo_tipo_id ON public.equipamentos_auvo(tipo_id);

-- 3) Seed dos 28 tipos da Rede IZ
INSERT INTO public.tipos_equipamento (nome, categoria, horas_por_tecnico, qtd_tecnicos, periodicidade, criticidade, palavras_chave) VALUES
('Máquina de gelo','Refrigeração',4,1,'MENSAL','ALTA', ARRAY['maquina de gelo','máquina de gelo']),
('Bebedouro','Hidráulica',2,1,'BIMESTRAL','BAIXA', ARRAY['bebedouro']),
('Adega/Câmara fria','Refrigeração',6,2,'TRIMESTRAL','CRITICA', ARRAY['camara fria','câmara fria','camara congelada','câmara congelada','camara refrigerada','câmara refrigerada','adega','frigobar adega']),
('Balcão refrigerado','Refrigeração',2.5,1,'TRIMESTRAL','ALTA', ARRAY['balcao refrigerado','balcão refrigerado','base refrigerada']),
('Fogão/Chapa/Broiler','Cocção',3,1,'TRIMESTRAL','ALTA', ARRAY['fogao','fogão','cooktop','chapa','char broiler','char-broiler','charbroiler','churrasqueira','grelha']),
('Forno combinado','Cocção',4,1,'TRIMESTRAL','ALTA', ARRAY['forno combinado','rational','unox','pratica combi','prática combi','selfcooking','combimaster','cheftop','convector combi']),
('Fritadeira','Cocção',3,1,'TRIMESTRAL','ALTA', ARRAY['fritadeira']),
('Geladeira (c/ condensador)','Refrigeração',2.5,1,'TRIMESTRAL','ALTA', ARRAY['geladeira vertical','geladeira condensador','geladeira com condensador']),
('Lavadora','Hidráulica',3,1,'TRIMESTRAL','ALTA', ARRAY['lavadora','lava louca','lava-louça','lava louça','lava copo']),
('Maturadora','Refrigeração',2.5,1,'TRIMESTRAL','MEDIA', ARRAY['maturadora']),
('iVario Rational','Cocção',6,1,'TRIMESTRAL','ALTA', ARRAY['ivario','i-vario']),
('Bancada 2,5h','Bancada',2.5,1,'SEMESTRAL','MEDIA', ARRAY['seladora vacuo','seladora a vácuo','desidratador','cortador de frios','modulo aquecido','módulo aquecido','mesa quente']),
('Bancada 2,5h (rampa)','Bancada',2.5,1,'SEMESTRAL','MEDIA', ARRAY['rampa aquecida','rampa']),
('Bancada 2h','Bancada',2,1,'SEMESTRAL','BAIXA', ARRAY['mixer','liquidificador','processador','espremedor','centrifuga','centrífuga','moinho','cafeteira','microondas','micro-ondas']),
('Banho-maria','Cocção',2.5,1,'SEMESTRAL','MEDIA', ARRAY['banho maria','banho-maria']),
('Caldeira','Cocção',6,1,'SEMESTRAL','CRITICA', ARRAY['caldeira']),
('Coifa','Ventilação',4,1,'SEMESTRAL','MEDIA', ARRAY['coifa']),
('Cozedor de massas','Cocção',3,1,'SEMESTRAL','MEDIA', ARRAY['cozedor','cozedor de massas']),
('Câmara fermentação','Padaria',4,1,'SEMESTRAL','MEDIA', ARRAY['camara de fermentacao','câmara de fermentação','camara fermentacao','câmara fermentação','fermentadora','cfk']),
('Forno (demais)','Cocção',2.5,1,'SEMESTRAL','MEDIA', ARRAY['forno josper','josper','forno ramalhos','ramalhos','forno convector','convector']),
('Forno Flex','Cocção',4,1,'SEMESTRAL','ALTA', ARRAY['forno flex','flex']),
('Forno Prática','Cocção',3,1,'SEMESTRAL','MEDIA', ARRAY['forno pratica','forno prática','pratica forno','prática forno','lastro','miniconv']),
('Freezer/Frigobar/Cervejeira','Refrigeração',2.5,1,'SEMESTRAL','MEDIA', ARRAY['freezer','frigobar','cervejeira']),
('Geladeira (Metalfrio/Gelopar)','Refrigeração',2.5,1,'SEMESTRAL','MEDIA', ARRAY['metalfrio','gelopar','geladeira metalfrio','geladeira gelopar']),
('Masseira','Padaria',4,1,'SEMESTRAL','MEDIA', ARRAY['masseira','amassadeira','cilindro','batedeira','maquina de massa','máquina de massa','maquina de pratos','máquina de pratos']),
('Ultracongelador','Refrigeração',6,1,'SEMESTRAL','CRITICA', ARRAY['ultracongelador','ultracongel','blast chiller','blast-chiller']),
('Pozzeto/Sorvete','Refrigeração',4,1,'SEMESTRAL','MEDIA', ARRAY['pozzeto','maquina de sorvete','máquina de sorvete','casquinha']),
('Carrinho (inspeção solda)','Geral',0.67,1,'FILA','BAIXA', ARRAY['carrinho']);
