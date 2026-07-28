# Migração OMIE → GestãoClick: Requisitos & Entrevista

Este plano NÃO altera código. É um artefato de consultoria para conduzir a descoberta com o cliente e mapear a migração. Ao final, se você quiser, transformamos isso em um checklist dentro do WAI ERP ou em edge functions de importação.

---

## 1. Objetivo da migração

Antes de qualquer coisa, alinhar com o cliente:
- **Por que sair do OMIE?** (custo, funcionalidade faltante, integração com Auvo, suporte, etc.)
- **Data-alvo do go-live no GestãoClick (GC)?**
- **Estratégia de corte:** *big bang* (vira a chave num dia) ou *coexistência* (OMIE roda até fechar o mês/ano fiscal e GC começa em paralelo).
- **Quem é o dono da migração** do lado do cliente (financeiro, TI, comercial)?
- Há **obrigação fiscal** aberta no OMIE (NF-e/NFS-e emitidas, apurações) que precisa continuar acessível?

---

## 2. Roteiro de entrevista (blocos temáticos)

### Bloco A — Perfil da operação
1. Regime tributário (Simples, Lucro Presumido, Real)?
2. Quantas empresas/filiais/CNPJs estão no OMIE hoje?
3. Volume médio mensal: NF-e, NFS-e, boletos, OS, orçamentos, movimentações de estoque.
4. Quantos usuários e quais perfis usam o OMIE hoje?
5. Módulos do OMIE em uso: Financeiro, Vendas, Estoque, Serviços, Produção, Compras, CRM, Contratos?

### Bloco B — Cadastros (dados mestres)
6. Clientes: quantos ativos? Há duplicidades conhecidas?
7. Fornecedores: quantidade e dados obrigatórios (contato, dados bancários)?
8. Produtos: SKU, unidade, NCM, CFOP, CEST, preço, custo, estoque atual por depósito.
9. Serviços: código municipal, alíquota ISS, descrição padrão.
10. Categorias financeiras (plano de contas) e centros de custo — a estrutura precisa ser replicada?
11. Vendedores/técnicos e comissionamento.
12. Formas e condições de pagamento.
13. Tabelas de preço, descontos, campanhas.

### Bloco C — Financeiro
14. Contas a receber em aberto (títulos + parcelas + boletos gerados).
15. Contas a pagar em aberto.
16. Contas bancárias, saldos, conciliação e integração bancária (quais bancos).
17. Boletos: quem é o convênio hoje? Vai manter no GC?
18. Fluxo de caixa histórico — precisa migrar ou basta relatório PDF?
19. Cheques, cartões, PIX — meios em uso.

### Bloco D — Vendas / Faturamento
20. Pedidos em aberto (não faturados).
21. Orçamentos ativos.
22. Contratos recorrentes / faturamento recorrente.
23. Séries e numeração de NF-e/NFS-e (o GC continua a numeração?).
24. Certificado digital A1 disponível?

### Bloco E — Estoque
25. Depósitos/locais de estoque.
26. Saldo atual por SKU (data de corte).
27. Kits/composições, produção, ordens de produção.
28. Movimentações históricas — migrar ou apenas saldo inicial?

### Bloco F — OS e Serviços (relevante pra base atual do WAI)
29. OS em aberto no OMIE? Formato, campos customizados, anexos.
30. Integração com Auvo já existe? Como está mapeada hoje?
31. Fluxo de aprovação de orçamento → OS → faturamento.

### Bloco G — Integrações e periféricos
32. Sistemas conectados ao OMIE hoje (e-commerce, marketplaces, CRM, BI, Auvo, WAI, contabilidade).
33. Webhooks/API keys ativos.
34. Relatórios/dashboards externos que consomem dados do OMIE.
35. Escritório de contabilidade — como recebe hoje (SPED, XMLs, planilhas)?

### Bloco H — Documentos e histórico
36. XMLs de NF-e/NFS-e emitidos (guarda de 5 anos) — onde ficam?
37. Anexos em OS/pedidos/clientes.
38. Histórico de e-mails/logs de envio.

### Bloco I — Governança e go-live
39. Ambiente de homologação no GC antes do corte?
40. Plano de treinamento dos usuários.
41. Plano de contingência (e se der errado no dia D?).
42. Data de congelamento do OMIE (freeze) e janela de importação.

---

## 3. Requisitos de migração (a preencher com as respostas)

Para cada domínio abaixo, o levantamento precisa produzir:
- **Fonte** (relatório/export do OMIE — CSV, XLSX, API, XML).
- **Destino** (entidade equivalente no GC — via API `/api/clientes`, `/api/produtos`, `/api/ordens_servicos`, `/api/contas_receber`, `/api/contas_pagar`, `/api/orcamentos`, etc.).
- **Mapeamento de campos** (de → para, com transformação).
- **Regras de deduplicação** (CPF/CNPJ, código interno).
- **Data de corte** (o que migra como saldo, o que migra como histórico).
- **Validação pós-carga** (conferência de totais).

Domínios mínimos:

```text
1. Empresas / filiais
2. Usuários e permissões
3. Clientes            (dedup por CPF/CNPJ)
4. Fornecedores        (dedup por CPF/CNPJ)
5. Produtos            (dedup por código; NCM/CFOP obrigatórios)
6. Serviços
7. Plano de contas / categorias financeiras
8. Centros de custo
9. Formas e condições de pagamento
10. Tabelas de preço
11. Estoque — saldo inicial por depósito
12. Contas bancárias + saldos iniciais
13. Contas a receber em aberto (títulos + parcelas)
14. Contas a pagar em aberto
15. Orçamentos em aberto
16. Pedidos / OS em aberto
17. Contratos recorrentes
18. Vendedores / comissões
19. Anexos / XMLs históricos (armazenamento externo se GC não suportar)
```

---

## 4. Estratégia de execução recomendada

1. **Fase 1 — Descoberta (1 semana)**: rodar o questionário acima, coletar exports de amostra do OMIE, validar limites e formatos da API GC.
2. **Fase 2 — Mapeamento (1–2 semanas)**: planilha "de-para" campo a campo, definir regras de dedup e transformações (ex.: normalizar CNPJ, converter datas ISO, arredondamentos financeiros).
3. **Fase 3 — Carga em homologação**: importar cadastros primeiro (clientes, produtos), depois saldos, por último títulos em aberto. Conferir totais.
4. **Fase 4 — Simulação de corte**: emitir 1 NF-e, 1 boleto, 1 OS no GC em ambiente real com dados migrados.
5. **Fase 5 — Freeze do OMIE + carga final + go-live**: janela definida (idealmente fim de semana / virada de mês).
6. **Fase 6 — Acompanhamento assistido (2–4 semanas)**: suporte próximo, ajustes finos, garantia de que contabilidade recebeu tudo.

---

## 5. Riscos a comunicar ao cliente

- **API do GC é destrutiva em PUT** (padrão da nossa integração exige GET → merge → PUT). Migração precisa respeitar isso.
- **Numeração fiscal** não pode ser reiniciada sem alinhar com contabilidade.
- **Histórico de XMLs** de 5 anos: guarda legal continua sendo do cliente, independente do sistema.
- **Boletos já emitidos** no OMIE continuam válidos e devem ser baixados no GC manualmente ou via importação de retorno bancário.
- **Integrações existentes** (Auvo, e-commerce, contabilidade) precisam ser reapontadas — não é automático.

---

## 6. Entregáveis desta consultoria

- Questionário respondido (Blocos A–I).
- Planilha "de-para" por domínio.
- Cronograma com data de freeze e go-live.
- Checklist de validação pós-carga (totais bateram? títulos em aberto conferem? saldos de estoque idem?).
- Plano de rollback.

---

## Próximo passo sugerido

Se quiser, posso transformar este questionário em:
- **(a)** um PDF/DOCX pronto para você enviar ao cliente, ou
- **(b)** uma tela dentro do WAI ERP ("Onboarding de Cliente / Migração") que registra as respostas e gera o checklist automaticamente, ou
- **(c)** já começar a esboçar as **edge functions de importação em massa** (clientes, produtos, títulos) usando o `gc-proxy` que já temos.

Me diga qual caminho seguir que eu detalho o plano técnico.
