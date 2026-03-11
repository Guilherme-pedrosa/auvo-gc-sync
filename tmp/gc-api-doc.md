# Content from https://gestaoclick.docs.apiary.io/

- [Documentation](https://gestaoclick.docs.apiary.io/)
- [Inspector](https://gestaoclick.docs.apiary.io/traffic)

### API

beteltecnologia •gestaoclick

[Create New API Project](https://gestaoclick.docs.apiary.io/create-api)

Help

Apiary Powered Documentation

[Sign in](https://login.apiary.io/login?redirect=https%3A%2F%2Fgestaoclick.docs.apiary.io%2F) with Apiary account.


[Download\\
\\
API Blueprint](https://gestaoclick.docs.apiary.io/api-description-document)

### Introduction

[Introdução](https://gestaoclick.docs.apiary.io/introduction/introducao)

[Autenticação](https://gestaoclick.docs.apiary.io/introduction/autenticacao)

[Limite de requisições](https://gestaoclick.docs.apiary.io/introduction/limite-de-requisicoes)

[Limites de registros](https://gestaoclick.docs.apiary.io/introduction/limites-de-registros)

[Atribuição de usuário](https://gestaoclick.docs.apiary.io/introduction/atribuicao-de-usuario)

[Atribuição de loja](https://gestaoclick.docs.apiary.io/introduction/atribuicao-de-loja)

### Reference

[Clientes](https://gestaoclick.docs.apiary.io/reference/0)

[Fornecedores](https://gestaoclick.docs.apiary.io/reference/0)

[Funcionários](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras de cadastros](https://gestaoclick.docs.apiary.io/reference/0)

[Transportadoras](https://gestaoclick.docs.apiary.io/reference/0)

[Tipos de contatos](https://gestaoclick.docs.apiary.io/reference/0)

[Tipos de endereços](https://gestaoclick.docs.apiary.io/reference/0)

[Estados](https://gestaoclick.docs.apiary.io/reference/0)

[Cidades](https://gestaoclick.docs.apiary.io/reference/0)

[Produtos](https://gestaoclick.docs.apiary.io/reference/0)

[Grupos de produtos](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras de produtos](https://gestaoclick.docs.apiary.io/reference/0)

[Serviços](https://gestaoclick.docs.apiary.io/reference/0)

[Orçamentos](https://gestaoclick.docs.apiary.io/reference/0)

[Situações de orçamentos](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras de orçamentos](https://gestaoclick.docs.apiary.io/reference/0)

[Vendas](https://gestaoclick.docs.apiary.io/reference/0)

[Situações de vendas](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras vendas](https://gestaoclick.docs.apiary.io/reference/0)

[Ordens de serviços](https://gestaoclick.docs.apiary.io/reference/0)

[Situações de OS](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras ordens serviço](https://gestaoclick.docs.apiary.io/reference/0)

[Compras](https://gestaoclick.docs.apiary.io/reference/0)

[Situações de compras](https://gestaoclick.docs.apiary.io/reference/0)

[Notas Fiscais de Produtos](https://gestaoclick.docs.apiary.io/reference/0)

[Notas Fiscais de Consumidores](https://gestaoclick.docs.apiary.io/reference/0)

[Notas Fiscais de Serviços](https://gestaoclick.docs.apiary.io/reference/0)

[Pagamentos](https://gestaoclick.docs.apiary.io/reference/0)

[Recebimentos](https://gestaoclick.docs.apiary.io/reference/0)

[Campos extras financeiros](https://gestaoclick.docs.apiary.io/reference/0)

[Formas pagamentos](https://gestaoclick.docs.apiary.io/reference/0)

[Contas bancárias](https://gestaoclick.docs.apiary.io/reference/0)

[Planos de contas](https://gestaoclick.docs.apiary.io/reference/0)

[Centros de custos](https://gestaoclick.docs.apiary.io/reference/0)

[Usuários](https://gestaoclick.docs.apiary.io/reference/0)

[Lojas](https://gestaoclick.docs.apiary.io/reference/0)

# API

### Introduction

### Introdução

A Integração via API é uma solução utilizada na integração de sistemas e na comunicação entre aplicações diferentes. Com esta tecnologia é possível que novas aplicações possam interagir com aquelas que já existem e que sistemas desenvolvidos em plataformas diferentes sejam compatíveis. Desta forma é possível integrar nosso sistema com diversos outros aplicativos, sendo assim, os dados integrados ficaram na nuvem e você terá a possibilidade de alterar, selecionar e excluir quando quiser.

### Autenticação

Para que você possa acessar a API, você deve possui uma conta e gerar o código de Access Token e o Secret Access Token da aplicação que você usará. Você deverá enviar estas informações nos parâmetros HEADER toda vez que acessar uma URL da API.
Exemplo de parametros de paginação

&pagina=10

&ordenacao=nome

&direcao=desc

### Limite de requisições

As chamadas à nossa API são limitadas a no máximo 3 requisições por segundo e no máximo 30.000 requisições por dia. Esse limite é controlado por empresa.

Caso seja ultrapassado o limite a requisição retornará o status 429 (too many requests) e a mensagem O limite de requisicoes foi atingido.

### Limites de registros

Todas as requisições GET são limitadas por página com no máximo 100 registros cada.

### Atribuição de usuário

Para clientes que possuem mais de um usuário cadastrado no sistema, deve se usar o campo usuario\_id como parametro de atribuição. Caso este parametro não seja informado, a API irá priorizar o usuário master do sistema.

_Para conhecer os ids dos **usuários**, faça um GET em /api/usuarios/_

### Atribuição de loja

Para clientes que possuem mais de uma loja cadastrada no sistema, deve se usar o campo loja\_id no tipo de envio GET ou POST como parametro de atribuição. Caso este parametro não seja informado, a API irá priorizar a loja matriz ou a loja que o usuário tenha permissão de acesso.

_Para conhecer os ids das **lojas**, faça um GET em /api/lojas/_

### Reference

## Clientes

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/clientes/listar)

**Filtros**

- tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica, ES = Estrangeiro)

- nome (string)

- cpf\_cnpj (string)

- telefone (string)

- email (string)

- situacao (1 = ativo, 0 = inativo)

- cidade\_id (int)


_Para conhecer os ids das **cidades**, faça um GET em /api/cidades/_

- estado (string)


_Ao buscar por estado utilizar as siglas(MG,SP,RJ,RR..)_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/clientes/cadastrar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ ou ES

- nome (string)


**Atribuição de usuário**

- usuario\_id


_Para conhecer os ids das **usuários**, faça um GET em /api/usuarios/_


Caso este parametro não seja informado, a API irá priorizar o usuário master do sistema.

**Atribuição de loja**

- loja\_id


_Para conhecer os ids das **lojas**, faça um GET em /api/lojas/_


Caso este parametro não seja informado, a API irá priorizar a loja matriz ou a loja que o usuário tenha permissão de acesso.

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/clientes/visualizar)

Lista os dados de um cliente específico. Basta acrescentar o parametro com o id do cliente.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/clientes/editar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ ou ES

- nome (string)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/clientes/deletar)

Exclui um cliente específico. Basta acrescentar o parametro com o id do cliente.

## Fornecedores

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/fornecedores/listar)

**Filtros**

- tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica, ES = Estrangeiro)

- nome (string)

- cpf\_cnpj (string)

- telefone (string)

- email (string)

- situacao (1 = ativo, 0 = inativo)

- cidade\_id (int)


_Para conhecer os ids das **cidades**, faça um GET em /api/cidades/_

- estado (string)


_Ao buscar por estado utilizar as siglas(MG,SP,RJ,RR..)_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/fornecedores/cadastrar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ ou ES

- nome (string)


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/fornecedores/visualizar)

Lista os dados de um fornecedor específico. Basta acrescentar o parametro com o id do fornecedor.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/fornecedores/editar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ ou ES

- nome (string)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/fornecedores/deletar)

Exclui um fornecedor específico. Basta acrescentar o parametro com o id do fornecedor.

## Funcionários

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/funcionarios/listar)

**Filtros**

- nome (string)

## Campos extras de cadastros

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-cadastros/listar)

Lista campos extras de clientes, fornecedores e funcionários.

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-cadastros/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-cadastros/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-cadastros/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-cadastros/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Transportadoras

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/transportadoras/listar)

**Filtros**

- tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica)

- nome (string)

- telefone (string)

- email (string)


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/transportadoras/cadastrar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ

- nome (string)


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/transportadoras/visualizar)

Lista os dados de uma transportadora específica. Basta acrescentar o parametro com o id da transportadora.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/transportadoras/editar)

**Campos obrigatórios**

- tipo\_pessoa (string) - PF, PJ

- nome (string)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/transportadoras/deletar)

Exclui uma transportadora específica. Basta acrescentar o parametro com o id da transportadora.

## Tipos de contatos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/tipos-de-contatos/listar)

## Tipos de endereços

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/tipos-de-enderecos/listar)

## Estados

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/estados/listar)

## Cidades

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/cidades/listar)

**Filtros**

- estado\_id (int)


_Para conhecer os ids dos **estados**, faça um GET em /api/estados/_

## Produtos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/produtos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- nome (string)

- codigo (string)

- grupo\_id (int)


_Para conhecer os ids dos **grupos de produtos**, faça um GET em /api/grupos\_produtos/_

- fornecedor\_id (int)


_Para conhecer os ids dos **fornecedores**, faça um GET em /api/fornecedores/_

- ativo (1 = sim, 0 = não)


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/produtos/cadastrar)

**Campos obrigatórios**

- nome (string)

- codigo\_interno (string)

- valor\_custo (float)


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/produtos/visualizar)

Lista os dados de um produto específico. Basta acrescentar o parametro com o id do produto.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/produtos/editar)

**Campos obrigatórios**

- nome (string)

- codigo\_interno (string)

- valor\_custo (float)


**Orientações**

- Para definir os valores de venda por tipo, basta fornecer um array com os valores, incluindo os campos tipo\_id e valor\_venda. Se os dados de valores não forem informados, os valores de venda permanecerão inalterados.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/produtos/deletar)

## Grupos de produtos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/grupos-de-produtos/listar)

Listagem dos grupos de produtos

## Campos extras de produtos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-produtos/listar)

Lista campos extras de produtos e serviços

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-produtos/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-produtos/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-produtos/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-produtos/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Serviços

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/servicos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- nome (string)

- valor\_inicio (float)

- valor\_fim (float)


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/servicos/cadastrar)

**Campos obrigatórios**

- nome (string)

- codigo (string)


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/servicos/visualizar)

Lista os dados de um serviço específico. Basta acrescentar o parametro com o id do serviço.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/servicos/editar)

**Campos obrigatórios**

- nome (string)

- codigo (string)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/servicos/deletar)

## Orçamentos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- tipo (tipo = produto, tipo = servico)

- codigo (int)

- nome (string)

- situacao\_id (int)


_Para conhecer os ids das **situações de orçamentos**, faça um GET em /api/situacoes\_orcamentos/_

- data\_inicio:


_Orçamentos que estão configurados com a data a partir do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_inicio=2020-01-01)._

- data\_fim:


_Orçamentos que estão configurados com a data a até do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_fim=2020-01-31)._

- cliente\_id (int)


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/cadastrar)

**Campos obrigatórios**

- tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


Podem ser registrados dois tipos de orçamentos. Orçamentos de produtos e Orçamentos de serviços. Para isso basta especificar o campo **tipo**.

##### Gerar parcelas automaticamente

Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a **data do orçamento** \+ **dias da 1º parcela** da forma\_pagamento\_id configurado no sistema.

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/visualizar)

Lista os dados de um orçamento específico. Basta acrescentar o parametro com o id da venda.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/editar)

**Campos obrigatórios**

- tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/deletar)

Exclui um orçamento específico. Basta acrescentar o parametro com o id do orçamento.

[**Gerar parcelas**](https://gestaoclick.docs.apiary.io/reference/0/orcamentos/gerar-parcelas)

**Campos obrigatórios**:

- valor\_total (float)

- forma\_pagamento\_id (int)

- numero\_parcelas (int)


## Situações de orçamentos

### Attributes

Valores para o campo **tipo\_lancamento**:

0 = Não lança

1 = Lança estoque e financeiro

2 = Lança somente estoque

3 = Lança somente financeiro

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/situacoes-de-orcamentos/listar)

## Campos extras de orçamentos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-orcamentos/listar)

Lista campos extras de orçamentos.

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-orcamentos/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido".

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list".


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-orcamentos/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-orcamentos/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-de-orcamentos/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Vendas

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/vendas/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- tipo (tipo = produto, tipo = servico, tipo = vendas\_balcao)

- codigo (int)

- nome (string)

- situacao\_id (int)


_Para conhecer os ids das **situações de vendas**, faça um GET em /api/situacoes\_vendas/_

- data\_inicio:


_Vendas que estão configuradas com a data a partir do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_inicio=2020-01-01)._

- data\_fim:


_Vendas que estão configuradas com a data a até do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_fim=2020-01-31)._

- cliente\_id (int)


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/vendas/cadastrar)

**Campos obrigatórios**

- tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


Podem ser registrados dois tipos de vendas. Vendas de produtos e Vendas de serviços. Para isso basta especificar o campo **tipo**.

##### Gerar parcelas automaticamente

Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a **data da venda** \+ **dias da 1º parcela** da forma\_pagamento\_id configurado no sistema.

**plano\_contas\_id:** (int) Opcional. Plano de contas.

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/vendas/visualizar)

Lista os dados de uma venda específica. Basta acrescentar o parametro com o id da venda.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/vendas/editar)

**Campos obrigatórios**

- tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/vendas/deletar)

Exclui uma venda específica. Basta acrescentar o parametro com o id da venda.

[**Gerar parcelas**](https://gestaoclick.docs.apiary.io/reference/0/vendas/gerar-parcelas)

**Campos obrigatórios**:

- valor\_total (float)

- forma\_pagamento\_id (int)

- numero\_parcelas (int)


## Situações de vendas

### Attributes

Valores para o campo **tipo\_lancamento**:

0 = Não lança

1 = Lança estoque e financeiro

2 = Lança somente estoque

3 = Lança somente financeiro

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/situacoes-de-vendas/listar)

## Campos extras vendas

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-vendas/listar)

Lista campos extras de vendas.

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-vendas/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-vendas/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-vendas/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-vendas/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Ordens de serviços

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- codigo (int)

- nome (string)

- situacao\_id (int)


_Para conhecer os ids das **situações de ordens de serviços**, faça um GET em /api/situacoes\_ordens\_servicos/_

- data\_inicio:


_Ordens de serviços que estão configuradas com a data a partir do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_inicio=2020-01-01)._

- data\_fim:


_Ordens de serviços que estão configuradas com a data a até do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_fim=2020-01-31)._

- cliente\_id (int)


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/cadastrar)

**Campos obrigatórios**

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


##### Gerar parcelas automaticamente

Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a **data da OS** \+ **dias da 1º parcela** da forma\_pagamento\_id configurado no sistema.

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/visualizar)

Lista os dados de uma venda específica. Basta acrescentar o parametro com o id da venda.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/editar)

**Campos obrigatórios**

- tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)

- codigo (int)

- cliente\_id (int)

- situacao\_id (int)

- data (date)


**Informações adicionais**

- O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.

- O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/deletar)

Exclui uma OS específica. Basta acrescentar o parametro com o id da OS.

[**Gerar parcelas**](https://gestaoclick.docs.apiary.io/reference/0/ordens-de-servicos/gerar-parcelas)

**Campos obrigatórios**:

- valor\_total (float)

- forma\_pagamento\_id (int)

- numero\_parcelas (int)


## Situações de OS

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/situacoes-de-os/listar)

## Campos extras ordens serviço

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-ordens-servico/listar)

Lista campos extras de ordens de serviço.

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-ordens-servico/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-ordens-servico/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-ordens-servico/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-ordens-servico/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Compras

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/compras/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- codigo (int)

- situacao\_id (int)


_Para conhecer os ids das **situações de compras**, faça um GET em /api/situacoes\_compras/_

- fornecedor\_id (int)


_Para conhecer os ids dos **fornecedores**, faça um GET em /api/fornecedores/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/compras/cadastrar)

**Campos obrigatórios**

- codigo (int)

- fornecedor\_id (int)

- situacao\_id (int)

- data (date)


##### Gerar parcelas automaticamente

Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a data da compra + Dias da 1º Parcela da forma\_pagamento\_id configurado no sistema.

**plano\_contas\_id:** (int) Opcional. Plano de contas.

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/compras/visualizar)

Lista os dados de uma compra específica. Basta acrescentar o parametro com o id da compra.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/compras/editar)

**Campos obrigatórios**

- codigo (int)

- fornecedor\_id (int)

- situacao\_id (int)

- data (date)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/compras/deletar)

Exclui uma compra específica. Basta acrescentar o parametro com o id da compra.

[**Gerar parcelas**](https://gestaoclick.docs.apiary.io/reference/0/compras/gerar-parcelas)

**Campos obrigatórios**:

- valor\_total (float)

- numero\_parcelas (int)


## Situações de compras

### Attributes

Valores para o campo **tipo\_lancamento**:

0 = Não lança

1 = Lança estoque e financeiro

2 = Lança somente estoque

3 = Lança somente financeiro

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/situacoes-de-compras/listar)

## Notas Fiscais de Produtos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/listar)

Listagem de notas fiscais de produtos

**Dados do emitente**

_Os dados do emitente só são exibidos após a emissão da NF-e._

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/cadastrar)

**Orientações e requisitos**

- Para cadastrar uma NF-e via API, é necessário que as naturezas de operação estejam previamente padronizadas conforme os tipos definidos pelo sistema: Venda, Venda para não contribuinte, Venda para contribuinte, Cupom Fiscal ou Compra. Essa padronização pode ser realizada na configuração de Natureza de Operação.

**Campos obrigatórios**

- loja\_id (int)

- tipo\_nf (int)

- id\_destinatario/id\_fornecedor (int)

- produtos (array)


**Atribuição de cliente**

- id\_destinatario


_Para obter os ids dos **clientes**, faça um GET em /api/clientes/_


**Atribuição de fornecedor**

- id\_fornecedor


_Para obter os ids dos **fornecedores**, faça um GET em /api/fornecedores/_


**Tipo de nota fiscal**

- tipo\_nf (0 = Entrada, 1 = Saída)


_Para cadastrar e emitir uma NF-e de Entrada via API, é obrigatório que exista uma natureza de operação padronizada como Compra no sistema. Essa configuração pode ser feita na tela de Naturezas de Operação._


**Tipo de atendimento**

- tipo\_atendimento


_0 - Não se aplica_

_1 - Operação presencial_

_2 - Operação não presencial, pela Internet_

_3 - Operação não presencial, Teleatendimento_

_9 - Operação não presencial, outros_


**Atribuição de campos dos produtos**

- produto\_id (int)

- variacao\_id (int) - Opcional

- codigo\_produto (string)

- nome\_produto (string)

- unidade (string)

- quantidade (int)

- valor\_venda (int)

- valor\_custo (int)

- NCM (string)


_Ao informar o produto\_id, os dados do produto serão preenchidos automaticamente. É possível, porém, substituir esses valores informando manualmente os respectivos campos no payload._


**Atribuição de variação**

- variacao\_id


_Para obter os ids das **variações** de um produto, faça um GET em /api/produtos/. O campo correspondente é variacao\_api\_id._


**Atribuição de forma de pagamento**

- pagamento (array)

- forma\_pagamento\_id (int)

- valor\_pagamento (int)

- data\_vencimento (string)

- codigo\_autorizacao (string)


_Caso queira informar os dados de forma de pagamento na nota fiscal, basta informar o array de pagamento e dentro de pagamento, informe a forma\_pagamento\_id e valor\_pagamento_


**Emissão automática**

_Caso queira que uma NF-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/visualizar)

Lista os dados de uma NF-e específica. Basta acrescentar o parametro com o id da NF-e.

**Dados do emitente**

_Os dados do emitente só são exibidos após a emissão da NF-e._

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/editar)

**Orientações e requisitos**

- Para editar uma NF-e via API, é necessário que as naturezas de operação estejam previamente padronizadas conforme os tipos definidos pelo sistema: Venda, Venda para não contribuinte, Venda para contribuinte, Cupom Fiscal ou Compra. Essa padronização pode ser realizada na configuração de Natureza de Operação.

**Campos obrigatórios**

- loja\_id (int)

- tipo\_nf (int)

- id\_destinatario/id\_fornecedor (int)

- produtos (array)


**Atribuição de cliente**

- id\_destinatario


_Para obter os ids dos **clientes**, faça um GET em /api/clientes/_


**Atribuição de fornecedor**

- id\_fornecedor


_Para obter os ids dos **fornecedores**, faça um GET em /api/fornecedores/_


**Tipo de nota fiscal**

- tipo\_nf (0 = Entrada, 1 = Saída)


_Para editar e emitir uma NF-e de Entrada via API, é obrigatório que exista uma natureza de operação padronizada como Compra no sistema. Essa configuração pode ser feita na tela de Naturezas de Operação._


**Tipo de atendimento**

- tipo\_atendimento


_0 - Não se aplica_

_1 - Operação presencial_

_2 - Operação não presencial, pela Internet_

_3 - Operação não presencial, Teleatendimento_

_9 - Operação não presencial, outros_


**Atribuição de campos dos produtos**

- produto\_id (int)

- variacao\_id (int) - Opcional

- codigo\_produto (string)

- nome\_produto (string)

- unidade (string)

- quantidade (int)

- valor\_venda (int)

- valor\_custo (int)

- NCM (string)


_Ao informar o produto\_id, os dados do produto serão preenchidos automaticamente. É possível, porém, substituir esses valores informando manualmente os respectivos campos no payload._


**Atribuição de variação**

- variacao\_id


_Para obter os ids das **variações** de um produto, faça um GET em /api/produtos/. O campo correspondente é variacao\_api\_id._


**Atribuição de forma de pagamento**

- pagamento (array)

- forma\_pagamento\_id (int)

- valor\_pagamento (int)

- data\_vencimento (string)

- codigo\_autorizacao (string)


_Caso queira informar os dados de forma de pagamento na nota fiscal, basta informar o array de pagamento e dentro de pagamento, informe a forma\_pagamento\_id e valor\_pagamento_


**Emissão automática**

_Caso queira que uma NF-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/deletar)

Exclui uma NF-e específica. Basta acrescentar o parametro com o id do NF-e.

[**Emitir**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/emitir)

Envia o comando de emissão para uma NF-e específica. Basta acrescentar o parametro com o id do NF-e.

[**Cancelar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-produtos/cancelar)

Envia o comando de cancelamento para uma NF-e específica. Basta acrescentar o parametro com o id do NF-e e informar o motivo no body de requisição.

**Motivos de cancelamento**

- motivo (string)


_Informe o campo motivo e insira o motivo de cancelamento. O limite máximo de caracteres para o campo de motivo de cancelamento de uma NF-e é de 200 caracteres._


## Notas Fiscais de Consumidores

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/listar)

Listagem de notas fiscais de consumidores

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/cadastrar)

**Orientações e requisitos**

- Para cadastrar uma NFC-e via API, é necessário que as naturezas de operação estejam previamente padronizadas conforme os tipos definidos pelo sistema: Venda, Venda para não contribuinte, Venda para contribuinte ou Cupom Fiscal. Essa padronização pode ser realizada na configuração de Natureza de Operação.


**Campos obrigatórios**

- loja\_id (int)

- produtos (array)

- pagamento (array)


**Tipo de atendimento**

- tipo\_atendimento (1 = Operação presencial, 4 = NFC-e em operação com entrega a domicílio)


_Caso não informe o tipo\_atendimento, por padrão será 1 (Operação presencial)._


**Atribuição de cliente**

- id\_destinatario


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_


**Atribuição de campos dos produtos**

- produto\_id (int)

- variacao\_id (int) - Opcional

- codigo\_produto (string)

- nome\_produto (string)

- unidade (string)

- quantidade (int)

- valor\_venda (int)

- valor\_custo (int)

- NCM (string)


_Ao informar o produto\_id, os dados do produto serão preenchidos automaticamente. É possível, porém, substituir esses valores informando manualmente os respectivos campos no payload._


**Atribuição de variação**

- variacao\_id


_Para obter os ids das **variações** de um produto, faça um GET em /api/produtos/. O campo correspondente é variacao\_api\_id._


**Atribuição de forma de pagamento**

- pagamento (array)

- forma\_pagamento\_id (int)

- valor\_pagamento (int)

- data\_vencimento (string)

- codigo\_autorizacao (string)


_Para informar os dados de forma de pagamento na nota fiscal, basta informar o array de pagamento e dentro de pagamento, informe a forma\_pagamento\_id e valor\_pagamento_


**Emissão automática**

_Caso queira que uma NFC-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/visualizar)

Lista os dados de uma NFC-e específica. Basta acrescentar o parametro com o id da NFC-e.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/editar)

**Orientações e requisitos**

- Para cadastrar uma NFC-e via API, é necessário que as naturezas de operação estejam previamente padronizadas conforme os tipos definidos pelo sistema: Venda, Venda para não contribuinte, Venda para contribuinte ou Cupom Fiscal. Essa padronização pode ser realizada na configuração de Natureza de Operação.


**Campos obrigatórios**

- loja\_id (int)

- produtos (array)

- pagamento (array)


**Tipo de atendimento**

- tipo\_atendimento (1 = Operação presencial, 4 = NFC-e em operação com entrega a domicílio)


_Caso não informe o tipo\_atendimento, por padrão será 1 (Operação presencial)._


**Atribuição de cliente**

- id\_destinatario


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_


**Atribuição de campos dos produtos**

- produto\_id (int)

- variacao\_id (int) - Opcional

- codigo\_produto (string)

- nome\_produto (string)

- unidade (string)

- quantidade (int)

- valor\_venda (int)

- valor\_custo (int)

- NCM (string)


_Ao informar o produto\_id, os dados do produto serão preenchidos automaticamente. É possível, porém, substituir esses valores informando manualmente os respectivos campos no payload._


**Atribuição de variação**

- variacao\_id


_Para obter os ids das **variações** de um produto, faça um GET em /api/produtos/. O campo correspondente é variacao\_api\_id._


**Atribuição de forma de pagamento**

- pagamento (array)

- forma\_pagamento\_id (int)

- valor\_pagamento (int)

- data\_vencimento (string)

- codigo\_autorizacao (string)


_Para informar os dados de forma de pagamento na nota fiscal, basta informar o array de pagamento e dentro de pagamento, informe a forma\_pagamento\_id e valor\_pagamento_


**Emissão automática**

_Caso queira que uma NFC-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/deletar)

Exclui uma NFC-e específica. Basta acrescentar o parametro com o id do NFC-e.

[**Emitir**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/emitir)

Envia o comando de emissão para uma NFC-e específica. Basta acrescentar o parametro com o id do NFC-e.

[**Cancelar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-consumidores/cancelar)

Envia o comando de cancelamento para uma NFC-e específica. Basta acrescentar o parametro com o id do NFC-e e informar o motivo no body de requisição.

**Motivos de cancelamento**

- motivo (string)


_Informe o campo motivo e insira o motivo de cancelamento. O limite máximo de caracteres para o campo de motivo de cancelamento de uma NFC-e é de 200 caracteres._


## Notas Fiscais de Serviços

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/listar)

Listagem de notas fiscais de serviços

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/cadastrar)

**Campos obrigatórios**

- destinatario\_id\_cliente (int)

- valor\_servico (string)

- codigo\_atividade (string)

- codigo\_natureza\_operacao (string)

- iss\_retido (int)

- cidade\_incidencia\_issqn (string)

- estado\_incidencia\_issqn (string)

- descricao (string)


**Atribuição de cliente**

- destinatario\_id\_cliente


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_


**Retenção de ISS**

_Para reter o ISS, basta informar iss\_retido = 1, para não reter, basta informar iss\_retido = 0._

**Construção cívil**

- construcao\_civil (int)

- codigo\_obra (string)

- codigo\_art (string)


_Para emitir uma NFS-e para construção cívil, basta informar construcao\_civil = 1 e informar os campos codigo\_obra e codigo\_art._


**Emissão automática**

_Caso queira que uma NFS-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/visualizar)

Lista os dados de uma NFS-e específica. Basta acrescentar o parametro com o id da NFS-e.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/editar)

**Campos obrigatórios**

- destinatario\_id\_cliente (int)

- valor\_servico (string)

- codigo\_atividade (string)

- codigo\_natureza\_operacao (string)

- iss\_retido (int)

- cidade\_incidencia\_issqn (string)

- estado\_incidencia\_issqn (string)

- descricao (string)


**Atribuição de cliente**

- destinatario\_id\_cliente


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_


**Retenção de ISS**

_Para reter o ISS, basta informar iss\_retido = 1, para não reter, basta informar iss\_retido = 0._

**Construção cívil**

- construcao\_civil (int)

- codigo\_obra (string)

- codigo\_art (string)


_Para emitir uma NFS-e para construção cívil, basta informar construcao\_civil = 1 e informar os campos codigo\_obra e codigo\_art._


**Emissão automática**

_Caso queira que uma NFS-e seja emitida automaticamente após o cadastro, basta informar envio\_automatico = 1 no body da requisição._

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/deletar)

Exclui uma NFS-e específica. Basta acrescentar o parametro com o id do NFS-e.

[**Emitir**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/emitir)

Envia o comando de emissão para uma NFS-e específica. Basta acrescentar o parametro com o id do NFS-e.

[**Cancelar**](https://gestaoclick.docs.apiary.io/reference/0/notas-fiscais-de-servicos/cancelar)

Envia o comando de cancelamento para uma NFS-e específica. Basta acrescentar o parametro com o id do NFS-e e informar o motivo no body de requisição.

**Motivos de cancelamento**

- motivo (1 = Erro na Emissão, 2 = Serviço não concluído)

## Pagamentos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/pagamentos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- codigo (int)

- nome (string)

- cliente\_id (int)


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_

- fornecedor\_id (int)


_Para conhecer os ids dos **fornecedores**, faça um GET em /api/fornecedores/_

- transportadora\_id (int)


_Para conhecer os ids das **transportadoras**, faça um GET em /api/transportadoras/_

- funcionario\_id (int)


_Para conhecer os ids dos **funcionarios**, faça um GET em /api/funcionarios/_

- data\_inicio (string)

- data\_fim (string)

- valor\_inicio (float)

- valor\_fim (float)

- liquidado (ab = Em aberto, at = Em atraso, pg = Confirmado)

- plano\_contas\_id (int)


_Para conhecer os ids dos **planos de contas**, faça um GET em /api/planos\_contas/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_

- conta\_bancaria\_id (int)


_Para conhecer os ids das **contas bancárias**, faça um GET em /api/contas\_bancarias/_

- forma\_pagamento\_id (int)


_Para conhecer os ids das **formas de pagamentos**, faça um GET em /api/formas\_pagamentos/_


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/pagamentos/cadastrar)

**Campos obrigatórios**

- descricao (string)

- data\_vencimento (date)

- plano\_contas\_id (int)

- forma\_pagamento\_id (int)

- conta\_bancaria\_id (int)

- valor (float)

- data\_competencia (date)


Ao cadastrar é retornado o campo valor\_total (valor + juros - desconto)

[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/pagamentos/visualizar)

Lista os dados de um pagamento específico. Basta acrescentar o parametro com o id do pagamento.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/pagamentos/editar)

**Campos obrigatórios**

- descricao (string)

- data\_vencimento (date)

- plano\_contas\_id (int)

- forma\_pagamento\_id (int)

- conta\_bancaria\_id (int)

- valor (float)

- data\_competencia (date)


Ao cadastrar é retornado o campo valor\_total (valor + juros - desconto)

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/pagamentos/deletar)

Exclui um pagamento específico. Basta acrescentar o parametro com o id do pagamento.

## Recebimentos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/recebimentos/listar)

**Filtros**

- loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/

- codigo (int)

- nome (string)

- cliente\_id (int)


_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_

- fornecedor\_id (int)


_Para conhecer os ids dos **fornecedores**, faça um GET em /api/fornecedores/_

- transportadora\_id (int)


_Para conhecer os ids das **transportadoras**, faça um GET em /api/transportadoras/_

- funcionario\_id (int)


_Para conhecer os ids dos **funcionarios**, faça um GET em /api/funcionarios/_

- data\_inicio (string)

- data\_fim (string)

- valor\_inicio (float)

- valor\_fim (float)

- liquidado (ab = Em aberto, at = Em atraso, pg = Confirmado)

- plano\_contas\_id (int)


_Para conhecer os ids dos **planos de contas**, faça um GET em /api/planos\_contas/_

- centro\_custo\_id (int)


_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_

- conta\_bancaria\_id (int)


_Para conhecer os ids das **contas bancárias**, faça um GET em /api/contas\_bancarias/_

- forma\_pagamento\_id (int)


_Para conhecer os ids das **formas de pagamentos**, faça um GET em /api/formas\_pagamentos/_

- limit (int)


_Limite de resultados por página._


[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/recebimentos/cadastrar)

**Campos obrigatórios**

- descricao (string)

- data\_vencimento (date)

- plano\_contas\_id (int)

- forma\_pagamento\_id (int)

- conta\_bancaria\_id (int)

- valor (float)

- data\_competencia (date)


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/recebimentos/visualizar)

Lista os dados de um recebimento específico. Basta acrescentar o parametro com o id do recebimento.

[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/recebimentos/editar)

**Campos obrigatórios**

- descricao (string)

- data\_vencimento (date)

- plano\_contas\_id (int)

- forma\_pagamento\_id (int)

- conta\_bancaria\_id (int)

- valor (float)

- data\_competencia (date)


[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/recebimentos/deletar)

Exclui um recebimento específico. Basta acrescentar o parametro com o id do recebimento.

## Campos extras financeiros

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-financeiros/listar)

Lista os campos extras de recebimentos e pagamentos.

[**Cadastrar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-financeiros/cadastrar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Editar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-financeiros/editar)

**Campos obrigatórios**

- nome (string)

- tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.

- opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"


[**Visualizar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-financeiros/visualizar)

Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

[**Deletar**](https://gestaoclick.docs.apiary.io/reference/0/campos-extras-financeiros/deletar)

Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

## Formas pagamentos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/formas-pagamentos/listar)

Listagem de formas de pagamentos

## Contas bancárias

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/contas-bancarias/listar)

Listagem de contas bancárias

## Planos de contas

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/planos-de-contas/listar)

**Filtros**

- tipo (D = Débito, C = Crédito)

## Centros de custos

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/centros-de-custos/listar)

Listagem dos centros de custos

## Usuários

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/usuarios/listar)

## Lojas

### Attributes

[**Listar**](https://gestaoclick.docs.apiary.io/reference/0/lojas/listar)

Switch between example and interactive console for customized API calls.

Switch to Console

### No action selected

You can try selecting ‘Listar’ from the left column.

[Learn more about using the documentation.](https://help.apiary.io/tools/interactive-documentation/)

### No action selected

To try out Console, please select an action. E.g. select ‘Listar’ from the left column.

[Learn more about using the documentation.](https://help.apiary.io/tools/interactive-documentation/)