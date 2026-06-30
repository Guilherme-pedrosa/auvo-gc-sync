
ALTER TABLE public.tipos_equipamento ADD COLUMN IF NOT EXISTS prioridade int;
CREATE INDEX IF NOT EXISTS idx_tipos_equipamento_prioridade ON public.tipos_equipamento (prioridade) WHERE ativo = true;

INSERT INTO public.tipos_equipamento
  (prioridade, nome, categoria, periodicidade, criticidade, horas_por_tecnico, qtd_tecnicos, palavras_chave, ativo)
VALUES
-- EXCLUSÃO / FORA DE ESCOPO
(10, 'Excluir - Ar condicionado', 'EXCLUIR', 'ANUAL', 'BAIXA', 0, 1,
  ARRAY['ar condicionado','ar condicionada','climatizador','climatizadora','inverter gree','split'], false),
(11, 'Excluir - Comodato/Locado', 'EXCLUIR', 'ANUAL', 'BAIXA', 0, 1,
  ARRAY['comodato','cleanlab','clean lab','locada ecolab','locada'], false),
(12, 'Excluir - Não-equipamento', 'EXCLUIR', 'ANUAL', 'BAIXA', 0, 1,
  ARRAY['qr code','porta de acesso','identificador','filtro soft','unidade distribuidora de gas','torneira','obras'], false),
-- ESPECÍFICOS PESADOS
(20, 'iVario Rational', 'Cocção', 'TRIMESTRAL', 'ALTA', 6, 1, ARRAY['ivario'], true),
(21, 'Ultracongelador', 'Refrigeração', 'SEMESTRAL', 'CRITICA', 6, 1, ARRAY['ultracongelador','blast','irinox'], true),
(22, 'Caldeira', 'Vapor', 'SEMESTRAL', 'CRITICA', 6, 1, ARRAY['caldeira'], true),
(23, 'Adega/Câmara fria', 'Refrigeração', 'TRIMESTRAL', 'CRITICA', 6, 2,
  ARRAY['adega','camara fria','camara congelad','camara refrigerad','câmara fria','câmara congelad','câmara refrigerad'], true),
(24, 'Câmara de fermentação', 'Cocção', 'SEMESTRAL', 'MEDIA', 4, 1,
  ARRAY['camara de ferment','câmara de ferment','camara ferment'], true),
-- GELO / BEBEDOURO
(30, 'Máquina de gelo', 'Refrigeração', 'MENSAL', 'ALTA', 4, 1, ARRAY['maquina de gelo','máquina de gelo'], true),
(31, 'Bebedouro', 'Refrigeração', 'BIMESTRAL', 'BAIXA', 2, 1, ARRAY['bebedouro','filtro soft star'], true),
-- FORNOS
(40, 'Forno Flex', 'Cocção', 'SEMESTRAL', 'ALTA', 4, 1, ARRAY['forno flex','fornoflex'], true),
(41, 'Forno combinado', 'Cocção', 'TRIMESTRAL', 'ALTA', 4, 1,
  ARRAY['forno combinado','rational','unox','cheftop','combimaster','selfcooking','scc','cmp','convector'], true),
(42, 'Forno Prática', 'Cocção', 'SEMESTRAL', 'ALTA', 3, 1, ARRAY['forno pratica','forno prática','miniconv','lastro'], true),
(43, 'Forno (demais)', 'Cocção', 'SEMESTRAL', 'ALTA', 2.5, 1, ARRAY['forno','josper','ramalhos','gpaniz','granchef'], true),
-- GÁS / FOGO
(50, 'Cozedor de massas', 'Cocção', 'SEMESTRAL', 'MEDIA', 3, 1, ARRAY['cozedor de massa','cozedor'], true),
(51, 'Banho-maria', 'Cocção', 'SEMESTRAL', 'MEDIA', 2.5, 1, ARRAY['banho maria','banho-maria'], true),
(52, 'Fogão/Chapa/Broiler', 'Cocção', 'TRIMESTRAL', 'MEDIA', 3, 1,
  ARRAY['fogao','fogão','cooktop','chapa','char broiler','chapa broiler','grelha','frigideira','churrasqueira'], true),
(53, 'Fritadeira', 'Cocção', 'TRIMESTRAL', 'MEDIA', 3, 1, ARRAY['fritadeira'], true),
(54, 'Salamandra', 'Cocção', 'SEMESTRAL', 'MEDIA', 2, 1, ARRAY['salamandra'], true),
-- LAVAGEM
(60, 'Lavadora', 'Lavagem', 'TRIMESTRAL', 'MEDIA', 3, 1,
  ARRAY['lava loucas','lava louças','lava copos','ecomax','winterhalter','winter halter','karcher','lavadora','maquina de pratos','máquina de pratos'], true),
-- PREPARO PESADO
(70, 'Masseira', 'Preparo', 'SEMESTRAL', 'MEDIA', 4, 1,
  ARRAY['masseira','amassadeira','cilindro','batedeira','maquina de massas','máquina de massas'], true),
-- COIFA
(80, 'Coifa', 'Exaustão', 'SEMESTRAL', 'MEDIA', 4, 1, ARRAY['coifa'], true),
-- SORVETE
(90, 'Pozzeto', 'Refrigeração', 'SEMESTRAL', 'ALTA', 4, 1, ARRAY['pozzeto'], true),
(91, 'Sorvete/Casquinha', 'Refrigeração', 'SEMESTRAL', 'ALTA', 4, 1, ARRAY['sorvete','casquinha','pigiani','stargel'], true),
-- REFRIGERAÇÃO — ÁRVORE DE DECISÃO
(100, 'Maturadora', 'Refrigeração', 'TRIMESTRAL', 'ALTA', 2.5, 1, ARRAY['maturadora','matura'], true),
(101, 'Balcão refrigerado', 'Refrigeração', 'TRIMESTRAL', 'ALTA', 2.5, 1,
  ARRAY['balcao','balcão','base refrigerada'], true),
(102, 'Geladeira (Metalfrio/Gelopar)', 'Refrigeração', 'SEMESTRAL', 'ALTA', 2.5, 1,
  ARRAY['geladeira metalfrio','geladeira gelopar','refrigerador metalfrio','refrigerador gelopar','gelopar ref','metalfrio ref'], true),
(103, 'Freezer/Frigobar/Cervejeira', 'Refrigeração', 'SEMESTRAL', 'ALTA', 2.5, 1,
  ARRAY['freezer','frigobar','fribogar','cervejeira','stella','stela','budweiser','becks','heineken','imbera','artois','pepsi'], true),
(104, 'Geladeira (c/ condensador)', 'Refrigeração', 'TRIMESTRAL', 'ALTA', 2.5, 1,
  ARRAY['geladeira','refrigerador','marinox','consul'], true),
(105, 'Refrigeração (demais)', 'Refrigeração', 'SEMESTRAL', 'ALTA', 2.5, 1,
  ARRAY['refrigerad','midea','vinho','mamba','venax','eos','fricon','colombina'], true),
-- BANCADA
(110, 'Bancada 2,5h', 'Bancada', 'SEMESTRAL', 'BAIXA', 2.5, 1,
  ARRAY['seladora','desidratador','cortador de frios','fatiador','modulo de aquec','módulo de aquec','mesa de aquec','balcao passe aquec','balcao aquec','passe aquecido','rampa'], true),
(111, 'Bancada 2h', 'Bancada', 'SEMESTRAL', 'BAIXA', 2, 1,
  ARRAY['mixer','liquidificador','processador','espremedor','centrifuga','moinho','moedor','triturador','pacojet','microondas','cafeteira','maquina de cafe','máquina de café','cafe 3 coracoes','juice','maquina de agua','máquina de agua','raspar gelo','raspador','panela de arroz','balanca','balança'], true),
-- FILA
(120, 'Carrinho (inspeção solda)', 'FILA', 'ANUAL', 'BAIXA', 0.67, 1, ARRAY['carrinho'], true)
ON CONFLICT (nome) DO UPDATE SET
  prioridade        = EXCLUDED.prioridade,
  categoria         = EXCLUDED.categoria,
  periodicidade     = EXCLUDED.periodicidade,
  criticidade       = EXCLUDED.criticidade,
  horas_por_tecnico = EXCLUDED.horas_por_tecnico,
  qtd_tecnicos      = EXCLUDED.qtd_tecnicos,
  palavras_chave    = EXCLUDED.palavras_chave,
  ativo             = EXCLUDED.ativo,
  updated_at        = now();
