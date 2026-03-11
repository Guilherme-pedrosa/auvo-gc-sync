# Content from https://gestaoclick.docs.apiary.io/api-description-document

FORMAT: 1A
HOST: https://api.gestaoclick.com

\# API

\### Introdução

A Integração via API é uma solução utilizada na integração de sistemas e na comunicação entre aplicações diferentes. Com esta tecnologia é possível que novas aplicações possam interagir com aquelas que já existem e que sistemas desenvolvidos em plataformas diferentes sejam compatíveis. Desta forma é possível integrar nosso sistema com diversos outros aplicativos, sendo assim, os dados integrados ficaram na nuvem e você terá a possibilidade de alterar, selecionar e excluir quando quiser.

\### Autenticação
Para que você possa acessar a API, você deve possui uma conta e gerar o código de Access Token e o Secret Access Token da aplicação que você usará. Você deverá enviar estas informações nos parâmetros HEADER toda vez que acessar uma URL da API.
Exemplo de parametros de paginação

&pagina=10

&ordenacao=nome

&direcao=desc

\### Limite de requisições
As chamadas à nossa API são limitadas a no máximo 3 requisições por segundo e no máximo 30.000 requisições por dia. Esse limite é controlado por empresa.

Caso seja ultrapassado o limite a requisição retornará o status 429 (too many requests) e a mensagem O limite de requisicoes foi atingido.

\### Limites de registros
Todas as requisições GET são limitadas por página com no máximo 100 registros cada.

\### Atribuição de usuário
Para clientes que possuem mais de um usuário cadastrado no sistema, deve se usar o campo usuario\_id como parametro de atribuição. Caso este parametro não seja informado, a API irá priorizar o usuário master do sistema.

_Para conhecer os ids dos **usuários**, faça um GET em /api/usuarios/_

\### Atribuição de loja
Para clientes que possuem mais de uma loja cadastrada no sistema, deve se usar o campo loja\_id no tipo de envio GET ou POST como parametro de atribuição. Caso este parametro não seja informado, a API irá priorizar a loja matriz ou a loja que o usuário tenha permissão de acesso.

_Para conhecer os ids das **lojas**, faça um GET em /api/lojas/_

\## Clientes \[/clientes\]

\### Listar \[GET\]

**Filtros**
\+ tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica, ES = Estrangeiro)
\+ nome (string)
\+ cpf\_cnpj (string)
\+ telefone (string)
\+ email (string)
\+ situacao (1 = ativo, 0 = inativo)
\+ cidade\_id (int)

_Para conhecer os ids das **cidades**, faça um GET em /api/cidades/_
\+ estado (string)

_Ao buscar por estado utilizar as siglas(MG,SP,RJ,RR..)_

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 1,
 "total\_da\_pagina": 1,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "8",\
 "tipo\_pessoa": "PF",\
 "nome": "Juao Carlos",\
 "razao\_social": null,\
 "cnpj": null,\
 "inscricao\_estadual": null,\
 "inscricao\_municipal": null,\
 "cpf": "792.727.480-54",\
 "rg": null,\
 "data\_nascimento": "1988-03-30",\
 "telefone": "(11) 3522-8899",\
 "celular": "(96) 9 9194-9455",\
 "fax": null,\
 "email": "donis@itfast.net",\
 "ativo": "1",\
 "contatos": \[\
 {\
 "contato": {\
 "tipo\_id": "1307150",\
 "nome\_tipo": "Email",\
 "nome": "Nome email",\
 "contato": "contato@contato.com",\
 "cargo": "Cargo",\
 "observacao": "Observação"\
 }\
 }\
 \],\
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31260-210",\
 "logradouro": "Rua Cassiano Campolina",\
 "numero": "10",\
 "complemento": null,\
 "bairro": "Dona Clara",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]\
 }\
 \]
 }
\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ ou ES
\+ nome (string)

**Atribuição de usuário**
\+ usuario\_id

_Para conhecer os ids das **usuários**, faça um GET em /api/usuarios/_

Caso este parametro não seja informado, a API irá priorizar o usuário master do sistema.

**Atribuição de loja**
\+ loja\_id

_Para conhecer os ids das **lojas**, faça um GET em /api/lojas/_

Caso este parametro não seja informado, a API irá priorizar a loja matriz ou a loja que o usuário tenha permissão de acesso.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PF",
 "nome": "Otávio Juan Benício da Rosa",
 "razao\_social": "",
 "cnpj": "",
 "inscricao\_estadual": "",
 "inscricao\_municipal": "",
 "cpf": "477.182.526-20",
 "rg": "49.660.357-7",
 "data\_nascimento": "1945-05-16",
 "telefone": "(11) 2533-3532",
 "celular": "(96) 2641-9455",
 "fax": "",
 "email": "otaviojuanbeniciodarosa-99@agaxtur.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Kevin Otávio Luan Cavalcanti",\
 "contato": "kevinotavioluancavalcanti-85@casabellavidros.com.br",\
 "cargo": "Gerente",\
 "observacao": "\[-------\]"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31110-700",\
 "logradouro": "Rua Itararé",\
 "numero": "329",\
 "complemento": "",\
 "bairro": "Concórdia",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "9",
 "tipo\_pessoa": "PF",
 "nome": "Otávio Juan Benício da Rosa",
 "razao\_social": null,
 "cnpj": null,
 "inscricao\_estadual": "",
 "inscricao\_municipal": null,
 "cpf": "477.182.526-20",
 "rg": "49.660.357-7",
 "data\_nascimento": "1945-05-16",
 "telefone": "(11) 2533-3532",
 "celular": "(96) 2641-9455",
 "fax": "",
 "email": "otaviojuanbeniciodarosa-99@agaxtur.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Kevin Otávio Luan Cavalcanti",\
 "contato": "kevinotavioluancavalcanti-85@casabellavidros.com.br",\
 "cargo": "Gerente",\
 "observacao": "\[-------\]"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31110-700",\
 "logradouro": "Rua Itararé",\
 "numero": "329",\
 "complemento": "",\
 "bairro": "Concórdia",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }
\### Visualizar \[GET /clientes/{id}\]

Lista os dados de um cliente específico. Basta acrescentar o parametro com o id do cliente.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "9",
 "tipo\_pessoa": "PF",
 "nome": "Otávio Juan Benício da Rosa II",
 "razao\_social": null,
 "cnpj": null,
 "inscricao\_estadual": "",
 "inscricao\_municipal": null,
 "cpf": "477.182.526-20",
 "rg": "49.660.357-7",
 "data\_nascimento": "1945-05-16",
 "telefone": "(11) 2533-3532",
 "celular": "(96) 2641-9455",
 "fax": "",
 "email": "otaviojuanbeniciodarosa-99@agaxtur.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "tipo\_id": "1307150",\
 "nome\_tipo": "Email",\
 "nome": "Nome email",\
 "contato": "contato@contato.com",\
 "cargo": "Cargo",\
 "observacao": "Observação"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31110-700",\
 "logradouro": "Rua Itararé",\
 "numero": "329",\
 "complemento": "",\
 "bairro": "Concórdia",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }
\### Editar \[PUT /clientes/{id}\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ ou ES
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PF",
 "nome": "Otávio Juan Benício da Rosa",
 "razao\_social": "",
 "cnpj": "",
 "inscricao\_estadual": "",
 "inscricao\_municipal": "",
 "cpf": "477.182.526-20",
 "rg": "49.660.357-7",
 "data\_nascimento": "1945-05-16",
 "telefone": "(11) 2533-3532",
 "celular": "(96) 2641-9455",
 "fax": "",
 "email": "otaviojuanbeniciodarosa-99@agaxtur.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Kevin Otávio Luan Cavalcanti",\
 "contato": "kevinotavioluancavalcanti-85@casabellavidros.com.br",\
 "cargo": "Gerente",\
 "observacao": "\[---\[\]----\]"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31110-700",\
 "logradouro": "Rua Itararé",\
 "numero": "329",\
 "complemento": "CASA 01",\
 "bairro": "Concórdia",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "9",
 "tipo\_pessoa": "PF",
 "nome": "Otávio Juan Benício da Rosa II",
 "razao\_social": null,
 "cnpj": null,
 "inscricao\_estadual": "",
 "inscricao\_municipal": null,
 "cpf": "477.182.526-20",
 "rg": "49.660.357-7",
 "data\_nascimento": null,
 "telefone": "(11) 2533-3532",
 "celular": "(96) 2641-9455",
 "fax": "",
 "email": "otaviojuanbeniciodarosa-99@agaxtur.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Kevin Otávio Luan Cavalcanti",\
 "contato": "kevinotavioluancavalcanti-85@casabellavidros.com.br",\
 "cargo": "Gerente",\
 "observacao": "\[---\[\]----\]"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31110-700",\
 "logradouro": "Rua Itararé",\
 "numero": "329",\
 "complemento": "CASA 01",\
 "bairro": "Concórdia",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Deletar \[DELETE /clientes/{id}\]

Exclui um cliente específico. Basta acrescentar o parametro com o id do cliente.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Cliente excluido com sucesso"
 }

\## Fornecedores \[/fornecedores\]

\### Listar \[GET\]

**Filtros**
\+ tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica, ES = Estrangeiro)
\+ nome (string)
\+ cpf\_cnpj (string)
\+ telefone (string)
\+ email (string)
\+ situacao (1 = ativo, 0 = inativo)
\+ cidade\_id (int)

_Para conhecer os ids das **cidades**, faça um GET em /api/cidades/_
\+ estado (string)

_Ao buscar por estado utilizar as siglas(MG,SP,RJ,RR..)_

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_da\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "3",\
 "tipo\_pessoa": "PJ",\
 "nome": "Samuel e Bento Corretores Associados ME",\
 "razao\_social": "Samuel e Bento Corretores Associados ME",\
 "cnpj": "36.058.120/0001-97",\
 "inscricao\_estadual": "",\
 "inscricao\_municipal": "",\
 "cpf": null,\
 "rg": null,\
 "data\_nascimento": null,\
 "telefone": "(11) 3625-2222",\
 "celular": "",\
 "email": "bento@samuelebento.com",\
 "ativo": "1",\
 "contatos": \[\],\
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "30310-480",\
 "logradouro": "Rua Grajaú",\
 "numero": "533",\
 "complemento": "",\
 "bairro": "Anchieta",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]\
 },\
 {\
 "id": "4",\
 "tipo\_pessoa": "PJ",\
 "nome": "Erick Jacquin Telas Ltda",\
 "razao\_social": "Erick Jacquin Telas Ltda",\
 "cnpj": "43.937.086/0001-96",\
 "inscricao\_estadual": "123951753",\
 "inscricao\_municipal": "",\
 "cpf": null,\
 "rg": null,\
 "data\_nascimento": null,\
 "telefone": "(11) 2533-3532",\
 "celular": "",\
 "email": "compras@erickelarissatelasltda.com.br",\
 "ativo": "1",\
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],\
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]\
 }\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ ou ES
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PJ",
 "nome": "Erick Jacquin Telas Ltda",
 "razao\_social": "Erick Jacquin Telas Ltda",
 "cnpj": "43.937.086/0001-96",
 "inscricao\_estadual": "123951753",
 "inscricao\_municipal": "",
 "cpf": "",
 "rg": "",
 "data\_nascimento": "",
 "telefone": "(11) 2533-3532",
 "celular": "",
 "fax": "",
 "email": "compras@erickelarissatelasltda.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "4",
 "tipo\_pessoa": "PJ",
 "nome": "Erick Jacquin Telas Ltda",
 "razao\_social": "Erick Jacquin Telas Ltda",
 "cnpj": "43.937.086/0001-96",
 "inscricao\_estadual": "123951753",
 "inscricao\_municipal": "",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(11) 2533-3532",
 "celular": "",
 "email": "compras@erickelarissatelasltda.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Visualizar \[GET /fornecedores/{id}\]

Lista os dados de um fornecedor específico. Basta acrescentar o parametro com o id do fornecedor.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "4",
 "tipo\_pessoa": "PJ",
 "nome": "Erick Jacquin Telas Ltda",
 "razao\_social": "Erick Jacquin Telas Ltda",
 "cnpj": "43.937.086/0001-96",
 "inscricao\_estadual": "123951753",
 "inscricao\_municipal": "",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(11) 2533-3532",
 "celular": "",
 "email": "compras@erickelarissatelasltda.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Editar \[PUT /fornecedores/{id}\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ ou ES
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PJ",
 "nome": "Erick Jacquin Restaurante",
 "razao\_social": "Erick Jacquin Restaurante",
 "cnpj": "43.937.086/0001-96",
 "inscricao\_estadual": "123951753",
 "inscricao\_municipal": "",
 "cpf": "",
 "rg": "",
 "data\_nascimento": "",
 "telefone": "(11) 2533-3532",
 "celular": "",
 "fax": "",
 "email": "compras@erickelarissatelasltda.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "4",
 "tipo\_pessoa": "PJ",
 "nome": "Erick Jacquin Restaurante",
 "razao\_social": "Erick Jacquin Restaurante",
 "cnpj": "43.937.086/0001-96",
 "inscricao\_estadual": "123951753",
 "inscricao\_municipal": "",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(11) 2533-3532",
 "celular": "",
 "email": "compras@erickelarissatelasltda.com.br",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Luan Nicolas Costas",\
 "contato": "luan@teste.com.br",\
 "cargo": "Atendente",\
 "observacao": "Contato de Luan"\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31565-090",\
 "logradouro": "Rua Osvaldo Teixeira de Carvalho",\
 "numero": "50",\
 "complemento": "",\
 "bairro": "Santa Branca",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Deletar \[DELETE /fornecedores/{id}\]

Exclui um fornecedor específico. Basta acrescentar o parametro com o id do fornecedor.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Fornecedor removido com sucesso!"
 }

\## Funcionários \[/funcionarios\]

\### Listar \[GET\]

**Filtros**
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 5,
 "total\_da\_pagina": 5,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "1",\
 "nome": "Ronei Marcos"\
 },\
 {\
 "id": "2",\
 "nome": "Emerson Coelho"\
 },\
 {\
 "id": "3",\
 "nome": "Pedro Henrique"\
 },\
 {\
 "id": "4",\
 "nome": "Wesley Rosa"\
 },\
 {\
 "id": "5",\
 "nome": "Linus Torvalds"\
 }\
 \]
 }

\## Campos extras de cadastros \[/atributos\_cadastros\]

\### Listar \[GET\]
Lista campos extras de clientes, fornecedores e funcionários.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_paginas": 1,
 "total\_registros\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "1",\
 "nome": "Registro",\
 "tipo": "numeros",\
 "modificado\_em": "2025-01-21 00:58:11",\
 "cadastrado\_em": "2025-01-21 00:58:11"\
 },\
 {\
 "id": "2",\
 "nome": "Campo Aux",\
 "tipo": "texto\_simples",\
 "modificado\_em": "2025-01-21 00:58:36",\
 "cadastrado\_em": "2025-01-21 00:58:36"\
 }\
 \]
 }

\### Cadastrar \[POST /atributos\_cadastros\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Registro",
 "tipo": "numeros",
 "opcoes": \[\]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Registro",
 "tipo": "numeros",
 "empresa\_id": "75798",
 "permitir\_excluir": "1",
 "usuario\_id": "131036",
 "nome\_usuario": "Controle 1",
 "cadastrado\_em": "2025-04-14 17:47:04",
 "modificado\_em": "2025-04-14 17:47:04",
 "opcoes": \[\]
 }
 }

\### Editar \[PUT /atributos\_cadastros/{id}\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Documentos",
 "tipo": "check\_list",
 "opcoes": \[\
 {"nome": "RG"},\
 {"nome": "CNH"}\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Documentos",
 "tipo": "check\_list",
 "empresa\_id": "75798",
 "permitir\_excluir": "1",
 "usuario\_id": "1",
 "nome\_usuario": "Usuario",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "RG"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "CNH"\
 }\
 \]
 }
 }

\### Visualizar \[GET /atributos\_cadastros/{id}\]
Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "tipo": "numeros",
 "empresa\_id": "75798",
 "permitir\_excluir": "1",
 "nome": "Documento",
 "usuario\_id": "1",
 "nome\_usuario": "Usuario",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\]
 }
 }

\### Deletar \[DELETE /atributos\_cadastros/{id}\]
Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Campo extra removido com sucesso!"
 }

\## Transportadoras \[/transportadoras\]

\### Listar \[GET\]

**Filtros**
\+ tipo\_pessoa (PF = pessoa física, PJ = pessoa jurídica)
\+ nome (string)
\+ telefone (string)
\+ email (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_da\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "6",\
 "tipo\_pessoa": "PJ",\
 "nome": "Edson e Carlos Eduardo Limpeza",\
 "razao\_social": "Edson e Carlos Eduardo Limpeza ME",\
 "cnpj": "22.359.529/0001-39",\
 "inscricao\_estadual": "472.736.113.437",\
 "inscricao\_municipal": "987415531",\
 "cpf": null,\
 "rg": null,\
 "data\_nascimento": null,\
 "telefone": "(31) 2707-9510",\
 "celular": "(31) 98874-9510",\
 "email": "producao@edsonecarloseduardolimpezame.com.br",\
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "ativo": "1",\
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],\
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]\
 },\
 {\
 "id": "5",\
 "tipo\_pessoa": "PJ",\
 "nome": "Rapid Transportadora",\
 "razao\_social": "Rapid Transportadora LTDA",\
 "cnpj": "20.215.683/0001-01",\
 "inscricao\_estadual": "299154930974",\
 "inscricao\_municipal": "859471123",\
 "cpf": null,\
 "rg": null,\
 "data\_nascimento": null,\
 "telefone": "(31) 2533-3532",\
 "celular": "",\
 "email": "contato@rapidtransportadora.com.br",\
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "ativo": "1",\
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Alan Mathison Turing",\
 "contato": "alan@rapid.com.br",\
 "cargo": "Diretor",\
 "observacao": "Criador da máquina de Turing"\
 }\
 },\
 {\
 "contato": {\
 "nome": "Dennis Ritchie",\
 "contato": "debbus@rapid.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Criador do C e do Unix."\
 }\
 }\
 \],\
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31010-202",\
 "logradouro": "Rua Oitocentos e Quarenta e Um",\
 "numero": "628",\
 "complemento": "",\
 "bairro": "Santa Tereza",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]\
 },\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PJ",
 "nome": "Edson e Carlos Eduardo Limpeza",
 "razao\_social": "Edson e Carlos Eduardo Limpeza ME",
 "cnpj": "22.359.529/0001-39",
 "inscricao\_estadual": "472.736.113.437",
 "inscricao\_municipal": "987415531",
 "cpf": "",
 "rg": "",
 "data\_nascimento": "",
 "telefone": "(31) 2707-9510",
 "celular": "(31) 98874-9510",
 "email": "producao@edsonecarloseduardolimpezame.com.br",
 "observacoes": " Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "6",
 "tipo\_pessoa": "PJ",
 "nome": "Edson e Carlos Eduardo Limpeza",
 "razao\_social": "Edson e Carlos Eduardo Limpeza ME",
 "cnpj": "22.359.529/0001-39",
 "inscricao\_estadual": "472.736.113.437",
 "inscricao\_municipal": "987415531",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(31) 2707-9510",
 "celular": "(31) 9 8874-95",
 "email": "producao@edsonecarloseduardolimpezame.com.br",
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Visualizar \[GET /transportadoras/{id}\]

Lista os dados de uma transportadora específica. Basta acrescentar o parametro com o id da transportadora.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "6",
 "tipo\_pessoa": "PJ",
 "nome": "Edson e Carlos Eduardo Limpeza",
 "razao\_social": "Edson e Carlos Eduardo Limpeza ME",
 "cnpj": "22.359.529/0001-39",
 "inscricao\_estadual": "472.736.113.437",
 "inscricao\_municipal": "987415531",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(31) 2707-9510",
 "celular": "(31) 9 8874-95",
 "email": "producao@edsonecarloseduardolimpezame.com.br",
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Editar \[PUT /transportadoras/{id}\]

**Campos obrigatórios**
\+ tipo\_pessoa (string) - PF, PJ
\+ nome (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo\_pessoa": "PJ",
 "nome": "Edson e Hudson Limpeza",
 "razao\_social": "Edson e Hudson Limpeza ME",
 "cnpj": "22.359.529/0001-39",
 "inscricao\_estadual": "472.736.113.437",
 "inscricao\_municipal": "987415531",
 "cpf": "",
 "rg": "",
 "data\_nascimento": "",
 "telefone": "(31) 2707-9510",
 "celular": "(31) 9 8874-9510",
 "email": "producao@edsonecarloseduardolimpezame.com.br",
 "observacoes": " Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "6",
 "tipo\_pessoa": "PJ",
 "nome": "Edson e Hudson Limpeza",
 "razao\_social": "Edson e Hudson Limpeza ME",
 "cnpj": "22.359.529/0001-39",
 "inscricao\_estadual": "472.736.113.437",
 "inscricao\_municipal": "987415531",
 "cpf": null,
 "rg": null,
 "data\_nascimento": null,
 "telefone": "(31) 2707-9510",
 "celular": "(31) 9 8874-95",
 "email": "producao@edsonecarloseduardolimpezame.com.br",
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "ativo": "1",
 "contatos": \[\
 {\
 "contato": {\
 "nome": "Lavínia Analu Lorena Moura",\
 "contato": "lavinia@limpeza.com.br",\
 "cargo": "Diretor",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 },\
 {\
 "contato": {\
 "nome": "Agatha Bruna",\
 "contato": "Agatha@limpeza.com.br",\
 "cargo": "Diretor II",\
 "observacao": "Lorem ipsum dolor sit amet, consectetur adipiscing elit."\
 }\
 }\
 \],
 "enderecos": \[\
 {\
 "endereco": {\
 "cep": "31748-040",\
 "logradouro": "Rua Aldemiro Fernandes Torres",\
 "numero": "509",\
 "complemento": "",\
 "bairro": "Jaqueline",\
 "cidade\_id": "1411",\
 "nome\_cidade": "Belo Horizonte",\
 "estado": "MG"\
 }\
 }\
 \]
 }
 }

\### Deletar \[DELETE /transportadoras/{id}\]

Exclui uma transportadora específica. Basta acrescentar o parametro com o id da transportadora.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Transportadora removida com sucesso!"
 }

\## Tipos de contatos \[/tipos\_contatos\]

\### Listar \[GET\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 3,
 "total\_da\_pagina": 3,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "109",\
 "nome": "E-mail"\
 },\
 {\
 "id": "110",\
 "nome": "Facebook"\
 },\
 {\
 "id": "111",\
 "nome": "Skype"\
 }\
 \]
 }

\## Tipos de endereços \[/tipos\_enderecos\]

\### Listar \[GET\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 3,
 "total\_da\_pagina": 3,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "68",\
 "nome": "Comercial"\
 },\
 {\
 "id": "69",\
 "nome": "Residencial"\
 },\
 {\
 "id": "70",\
 "nome": "Entrega"\
 }\
 \]
 }

\## Estados \[/estados\]

\### Listar \[GET\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 27,
 "total\_da\_pagina": 20,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": 2,
 "proxima\_url": "/api/estados?pagina=2"
 },
 "data": \[\
 {\
 "id": "1",\
 "codigo": "12",\
 "nome": "Acre",\
 "sigla": "AC"\
 },\
 {\
 "id": "2",\
 "codigo": "27",\
 "nome": "Alagoas",\
 "sigla": "AL"\
 },\
 {\
 "id": "4",\
 "codigo": "16",\
 "nome": "Amapá",\
 "sigla": "AP"\
 },\
 {\
 "id": "3",\
 "codigo": "13",\
 "nome": "Amazonas",\
 "sigla": "AM"\
 },\
 {\
 "id": "5",\
 "codigo": "29",\
 "nome": "Bahia",\
 "sigla": "BA"\
 },\
 {\
 "id": "6",\
 "codigo": "23",\
 "nome": "Ceará",\
 "sigla": "CE"\
 },\
 {\
 "id": "7",\
 "codigo": "53",\
 "nome": "Distrito Federal",\
 "sigla": "DF"\
 },\
 {\
 "id": "8",\
 "codigo": "32",\
 "nome": "Espírito Santo",\
 "sigla": "ES"\
 },\
 {\
 "id": "9",\
 "codigo": "52",\
 "nome": "Goiás",\
 "sigla": "GO"\
 },\
 {\
 "id": "10",\
 "codigo": "21",\
 "nome": "Maranhão",\
 "sigla": "MA"\
 },\
 {\
 "id": "13",\
 "codigo": "51",\
 "nome": "Mato Grosso",\
 "sigla": "MT"\
 },\
 {\
 "id": "12",\
 "codigo": "50",\
 "nome": "Mato Grosso Do Sul",\
 "sigla": "MS"\
 },\
 {\
 "id": "11",\
 "codigo": "31",\
 "nome": "Minas Gerais",\
 "sigla": "MG"\
 },\
 {\
 "id": "14",\
 "codigo": "15",\
 "nome": "Pará",\
 "sigla": "PA"\
 },\
 {\
 "id": "15",\
 "codigo": "25",\
 "nome": "Paraíba",\
 "sigla": "PB"\
 },\
 {\
 "id": "18",\
 "codigo": "41",\
 "nome": "Paraná",\
 "sigla": "PR"\
 },\
 {\
 "id": "16",\
 "codigo": "26",\
 "nome": "Pernambuco",\
 "sigla": "PE"\
 },\
 {\
 "id": "17",\
 "codigo": "22",\
 "nome": "Piauí",\
 "sigla": "PI"\
 },\
 {\
 "id": "19",\
 "codigo": "33",\
 "nome": "Rio De Janeiro",\
 "sigla": "RJ"\
 },\
 {\
 "id": "20",\
 "codigo": "24",\
 "nome": "Rio Grande Do Norte",\
 "sigla": "RN"\
 }\
 \]
 }

\## Cidades \[/cidades\]

\### Listar \[GET\]

**Filtros**
\+ estado\_id (int)

_Para conhecer os ids dos **estados**, faça um GET em /api/estados/_

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 79,
 "total\_da\_pagina": 20,
 "pagina\_atual": 2,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": 1,
 "url\_anterior": "/api/cidades?estado=12&pagina=1",
 "proxima\_pagina": 3,
 "proxima\_url": "/api/cidades?estado=12&pagina=3"
 },
 "data": \[\
 {\
 "id": "2219",\
 "codigo": "5002803",\
 "nome": "Caracol"\
 },\
 {\
 "id": "2220",\
 "codigo": "5002902",\
 "nome": "Cassilândia"\
 },\
 {\
 "id": "2221",\
 "codigo": "5002951",\
 "nome": "Chapadão do Sul"\
 },\
 {\
 "id": "2222",\
 "codigo": "5003108",\
 "nome": "Corguinho"\
 },\
 {\
 "id": "2223",\
 "codigo": "5003157",\
 "nome": "Coronel Sapucaia"\
 },\
 {\
 "id": "2224",\
 "codigo": "5003207",\
 "nome": "Corumbá"\
 },\
 {\
 "id": "2225",\
 "codigo": "5003256",\
 "nome": "Costa Rica"\
 },\
 {\
 "id": "2226",\
 "codigo": "5003306",\
 "nome": "Coxim"\
 },\
 {\
 "id": "2227",\
 "codigo": "5003454",\
 "nome": "Deodápolis"\
 },\
 {\
 "id": "2228",\
 "codigo": "5003488",\
 "nome": "Dois Irmãos do Buriti"\
 },\
 {\
 "id": "2229",\
 "codigo": "5003504",\
 "nome": "Douradina"\
 },\
 {\
 "id": "2230",\
 "codigo": "5003702",\
 "nome": "Dourados"\
 },\
 {\
 "id": "2231",\
 "codigo": "5003751",\
 "nome": "Eldorado"\
 },\
 {\
 "id": "2232",\
 "codigo": "5003801",\
 "nome": "Fátima do Sul"\
 },\
 {\
 "id": "2233",\
 "codigo": "5003900",\
 "nome": "Figueirão"\
 },\
 {\
 "id": "2234",\
 "codigo": "5004007",\
 "nome": "Glória de Dourados"\
 },\
 {\
 "id": "2235",\
 "codigo": "5004106",\
 "nome": "Guia Lopes da Laguna"\
 },\
 {\
 "id": "2236",\
 "codigo": "5004304",\
 "nome": "Iguatemi"\
 },\
 {\
 "id": "2237",\
 "codigo": "5004403",\
 "nome": "Inocência"\
 },\
 {\
 "id": "2238",\
 "codigo": "5004502",\
 "nome": "Itaporã"\
 }\
 \]
 }

\## Produtos \[/produtos\]

\### Listar \[GET\]

**Filtros**
\+ loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/
\+ nome (string)
\+ codigo (string)
\+ grupo\_id (int)

_Para conhecer os ids dos **grupos de produtos**, faça um GET em /api/grupos\_produtos/_
\+ fornecedor\_id (int)

_Para conhecer os ids dos **fornecedores**, faça um GET em /api/fornecedores/_
\+ ativo (1 = sim, 0 = não)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_paginas": 1,
 "total\_registros\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "320",\
 "nome": "Blusão Masc Moletom",\
 "codigo\_interno": "0222",\
 "codigo\_barra": "2031754031703",\
 "possui\_variacao": "1",\
 "possui\_composicao": "0",\
 "movimenta\_estoque": "1",\
 "peso": "0.000",\
 "largura": "0.000",\
 "altura": "0.000",\
 "comprimento": "0.000",\
 "ativo": "1",\
 "grupo\_id": "803218",\
 "nome\_grupo": "Eletrônicos",\
 "descricao": "",\
 "estoque": 60,\
 "valor\_custo": "80.0000",\
 "valor\_venda": "120.0000",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \],\
 "variacoes": \[\
 {\
 "variacao": {\
 "id": "478",\
 "nome": "Creme",\
 "estoque": "10.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "41.18",\
 "valor\_custo": "85.0000",\
 "valor\_venda": "120.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "41.18",\
 "valor\_custo": "85.0000",\
 "valor\_venda": "120.0000"\
 }\
 \]\
 }\
 },\
 {\
 "variacao": {\
 "id": "480",\
 "nome": "Marrom",\
 "estoque": "20.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \]\
 }\
 },\
 {\
 "variacao": {\
 "id": "482",\
 "nome": "Azul Escuro",\
 "estoque": "30.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \]\
 }\
 }\
 \],\
 "fiscal": {\
 "ncm": "",\
 "cest": "",\
 "peso\_liquido": null,\
 "peso\_bruto": null,\
 "valor\_aproximado\_tributos": null,\
 "valor\_fixo\_pis": null,\
 "valor\_fixo\_pis\_st": null,\
 "valor\_fixo\_confins": null,\
 "valor\_fixo\_confins\_st": null\
 }\
 },\
 {\
 "id": "319",\
 "nome": "Smart TV 4K LED 50",\
 "codigo\_interno": "011111",\
 "codigo\_barra": "2086871760609",\
 "possui\_variacao": "0",\
 "possui\_composicao": "0",\
 "movimenta\_estoque": "1",\
 "peso": "0.000",\
 "largura": "0.000",\
 "altura": "0.000",\
 "comprimento": "0.000",\
 "ativo": "1",\
 "grupo\_id": "803218",\
 "nome\_grupo": "Eletrônicos",\
 "descricao": "",\
 "estoque": 10,\
 "valor\_custo": "1500.2000",\
 "valor\_venda": "1725.2300",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "1500.2000",\
 "valor\_venda": "1725.2300"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "1500.2000",\
 "valor\_venda": "1950.2600"\
 }\
 \],\
 "variacoes": \[\
 {\
 "variacao": {\
 "id": "476",\
 "nome": "",\
 "estoque": "10.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "1500.2000",\
 "valor\_venda": "1725.2300"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "1500.2000",\
 "valor\_venda": "1950.2600"\
 }\
 \]\
 }\
 }\
 \],\
 "fiscal": {\
 "ncm": "85044060",\
 "cest": "",\
 "peso\_liquido": "20.000",\
 "peso\_bruto": "20.000",\
 "valor\_aproximado\_tributos": null,\
 "valor\_fixo\_pis": null,\
 "valor\_fixo\_pis\_st": null,\
 "valor\_fixo\_confins": null,\
 "valor\_fixo\_confins\_st": null\
 }\
 }\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ nome (string)
\+ codigo\_interno (string)
\+ valor\_custo (float)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Televisão Smart TV - LED 32",
 "codigo\_interno": "32355564390",
 "codigo\_barra": "98412200100",
 "largura": "80",
 "altura": "50",
 "comprimento": "8",
 "ativo": "1",
 "grupo\_id": "803218",
 "nome\_grupo": "Eletrônicos",
 "descricao": "Televisão Smart TV com wi-fi 32 Polegadas",
 "estoque": "10",
 "valor\_custo": "700.62",
 "valor\_venda": "850.99",
 "ncm": "11010010",
 "cest": "0100200",
 "peso\_liquido": "1,000",
 "peso\_bruto": "1,550",
 "valor\_aproximado\_tributos": "1,00",
 "valor\_fixo\_pis": "1,0000",
 "valor\_fixo\_pis\_st": "3.00",
 "valor\_fixo\_confins": "4.00",
 "valor\_fixo\_confins\_st": "6.00",
 "fornecedores": \[\
 {\
 "fornecedor\_id": "241"\
 },\
 {\
 "fornecedor\_id": "169"\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "43",
 "nome": "Televisão Smart TV - LED 32",
 "codigo\_interno": "32355564390",
 "codigo\_barra": "98412200100",
 "possui\_variacao": "0",
 "possui\_composicao": "0",
 "movimenta\_estoque": "1",
 "peso": null,
 "largura": "80.000",
 "altura": "50.000",
 "comprimento": "8.000",
 "ativo": "1",
 "grupo\_id": "803218",
 "nome\_grupo": "Eletrônicos",
 "descricao": "Televisão Smart TV com wi-fi 32 Polegadas",
 "estoque": 10,
 "valor\_custo": "700.62",
 "valor\_venda": "850.99",
 "valores": \[\
 {\
 "tipo\_id": "90858",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 },\
 {\
 "tipo\_id": "90856",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 },\
 {\
 "tipo\_id": "90853",\
 "nome\_tipo": "Loja virtual",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 }\
 \],
 "variacoes": \[\
 {\
 "variacao": {\
 "id": "231",\
 "nome": "",\
 "estoque": "10.00",\
 "valores": \[\
 {\
 "tipo\_id": "90858",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 },\
 {\
 "tipo\_id": "90856",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 },\
 {\
 "tipo\_id": "90853",\
 "nome\_tipo": "Loja virtual",\
 "lucro\_utilizado": "21.46",\
 "valor\_custo": "750.99"\
 "valor\_venda": "850.99"\
 }\
 \],\
 }\
 }\
 \],
 "fiscal": {
 "ncm": "11010010",
 "cest": "0100200",
 "peso\_liquido": "1.000",
 "peso\_bruto": "1.000",
 "valor\_aproximado\_tributos": "1.00",
 "valor\_fixo\_pis": "1.00",
 "valor\_fixo\_pis\_st": "3.00",
 "valor\_fixo\_confins": "4.00",
 "valor\_fixo\_confins\_st": "6.00"
 }
 }
 }

\### Visualizar \[GET /produtos/{id}\]

Lista os dados de um produto específico. Basta acrescentar o parametro com o id do produto.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "320",
 "nome": "Blusão Masc Moletom",
 "codigo\_interno": "0222",
 "codigo\_barra": "2031754031703",
 "possui\_variacao": "1",
 "possui\_composicao": "0",
 "movimenta\_estoque": "1",
 "peso": "0.000",
 "largura": "0.000",
 "altura": "0.000",
 "comprimento": "0.000",
 "ativo": "1",
 "grupo\_id": "803218",
 "nome\_grupo": "Eletrônicos",
 "descricao": "",
 "estoque": 60,
 "valor\_custo": "80.0000",
 "valor\_venda": "120.0000",
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \],
 "variacoes": \[\
 {\
 "variacao": {\
 "id": "478",\
 "nome": "Creme",\
 "estoque": "10.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "41.18",\
 "valor\_custo": "85.0000",\
 "valor\_venda": "120.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "41.18",\
 "valor\_custo": "85.0000",\
 "valor\_venda": "120.0000"\
 }\
 \]\
 }\
 },\
 {\
 "variacao": {\
 "id": "480",\
 "nome": "Marrom",\
 "estoque": "20.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \]\
 }\
 },\
 {\
 "variacao": {\
 "id": "482",\
 "nome": "Azul Escuro",\
 "estoque": "30.00",\
 "valores": \[\
 {\
 "tipo\_id": "90864",\
 "nome\_tipo": "Varejo",\
 "lucro\_utilizado": "15.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "92.0000"\
 },\
 {\
 "tipo\_id": "90872",\
 "nome\_tipo": "Atacado",\
 "lucro\_utilizado": "30.00",\
 "valor\_custo": "80.0000",\
 "valor\_venda": "104.0000"\
 }\
 \]\
 }\
 }\
 \],
 "fiscal": {
 "ncm": "",
 "cest": "",
 "peso\_liquido": null,
 "peso\_bruto": null,
 "valor\_aproximado\_tributos": null,
 "valor\_fixo\_pis": null,
 "valor\_fixo\_pis\_st": null,
 "valor\_fixo\_confins": null,
 "valor\_fixo\_confins\_st": null
 }
 }
 }

\### Editar \[PUT /produtos/{id}\]

**Campos obrigatórios**
\+ nome (string)
\+ codigo\_interno (string)
\+ valor\_custo (float)

**Orientações**
\+ \+ Para definir os valores de venda por tipo, basta fornecer um array com os valores, incluindo os campos tipo\_id e valor\_venda. Se os dados de valores não forem informados, os valores de venda permanecerão inalterados.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Televisão Smart TV - Plasma 52 P",
 "codigo\_interno": "97845678",
 "codigo\_barra": "8995874587451",
 "largura": "80",
 "altura": "50",
 "comprimento": "8",
 "ativo": "1",
 "grupo\_id": "803218",
 "nome\_grupo": "Eletrônicos",
 "descricao": "Televisão Smart TV Plasma com wi-fi 52 Polegadas",
 "estoque": "10",
 "valor\_custo": 12.00,
 "valores": \[\
 {\
 "tipo\_id": "90937",\
 "valor\_venda": 10.00\
 },\
 {\
 "tipo\_id": "90938",\
 "valor\_venda": 18.00\
 }\
 \],
 "ncm": "11010010",
 "cest": "0100200",
 "peso\_liquido": "1,000",
 "peso\_bruto": "1,550",
 "valor\_aproximado\_tributos": 1.00,
 "valor\_fixo\_pis": "1,0000",
 "valor\_fixo\_pis\_st": 3.00,
 "valor\_fixo\_confins": 4.00,
 "valor\_fixo\_confins\_st": 6.00
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "22",
 "nome": "Televisão Smart TV - Plasma 52 P",
 "codigo\_interno": "97845678",
 "codigo\_barra": "8995874587451",
 "possui\_variacao": "0",
 "possui\_composicao": "0",
 "movimenta\_estoque": "1",
 "peso": null,
 "largura": "80.000",
 "altura": "50.000",
 "comprimento": "8.000",
 "ativo": "1",
 "grupo\_id": "803218",
 "nome\_grupo": "Eletrônicos",
 "descricao": "Televisão Smart TV Plasma com wi-fi 52 Polegadas",
 "estoque": 10,
 "valor\_custo": "12.0000",
 "valor\_venda": "10.00",
 "cadastrado\_em": "2024-03-12 14:30:36",
 "modificado\_em": "2024-11-01 11:46:10",
 "valores": \[\
 {\
 "tipo\_id": "90937",\
 "nome\_tipo": "valor de venda novo",\
 "lucro\_utilizado": "0",\
 "valor\_custo": "12",\
 "valor\_venda": "10.00"\
 },\
 {\
 "tipo\_id": "90938",\
 "nome\_tipo": "novo valor",\
 "lucro\_utilizado": "0",\
 "valor\_custo": "12",\
 "valor\_venda": "18.00"\
 }\
 \],
 "variacoes": \[\
 {\
 "variacao": {\
 "id": "232",\
 "nome": "",\
 "estoque": "10.00"\
 }\
 }\
 \],
 "fiscal": {
 "ncm": "11010010",
 "cest": "0100200",
 "peso\_liquido": "1.000",
 "peso\_bruto": "1.000",
 "valor\_aproximado\_tributos": "1.00",
 "valor\_fixo\_pis": "1.00",
 "valor\_fixo\_pis\_st": "3.00",
 "valor\_fixo\_confins": "4.00",
 "valor\_fixo\_confins\_st": "6.00"
 }
 }
 }

\### Deletar \[DELETE /produtos/{id}\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

\## Grupos de produtos \[/grupos\_produtos\]

\### Listar \[GET\]

Listagem dos grupos de produtos

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_da\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "801358",\
 "nome": "Celulares"\
 },\
 {\
 "id": "801356",\
 "nome": "Eletrônicos"\
 }\
 \]
 }

\## Campos extras de produtos \[/atributos\_produtos\]

\### Listar \[GET\]
Lista campos extras de produtos e serviços

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_paginas": 1,
 "total\_registros\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "1",\
 "nome": "Registro",\
 "tipo": "numeros",\
 "modificado\_em": "2025-01-21 00:58:11",\
 "cadastrado\_em": "2025-01-21 00:58:11"\
 },\
 {\
 "id": "2",\
 "nome": "Documentos",\
 "tipo": "texto\_simples",\
 "modificado\_em": "2025-01-21 00:58:36",\
 "cadastrado\_em": "2025-01-21 00:58:36"\
 }\
 \]
 }

\### Cadastrar \[POST /atributos\_produtos\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Arquivos",
 "tipo": "check\_list",
 "opcoes": \[\
 {"nome": "RG"},\
 {"nome": "CNH"}\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Arquivos",
 "tipo": "check\_list",
 "cadastrado\_em": "2025-04-14 17:47:04",
 "modificado\_em": "2025-04-14 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "RG"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "CNH"\
 }\
 \]
 }
 }

\### Editar \[PUT /atributos\_produtos/{id}\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Documentos",
 "tipo": "check\_list",
 "opcoes": \[\
 {"nome": "RG"},\
 {"nome": "CNH"}\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Documentos",
 "tipo": "check\_list",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "RG"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "CNH"\
 }\
 \]
 }
 }

\### Visualizar \[GET /atributos\_produtos/{id}\]
Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "tipo": "numeros",
 "nome": "Registro",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\]
 }
 }

\### Deletar \[DELETE /atributos\_produtos/{id}\]
Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Campo extra removido com sucesso!"
 }

\## Serviços \[/servicos\]

\### Listar \[GET\]

**Filtros**
\+ loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/
\+ nome (string)
\+ valor\_inicio (float)
\+ valor\_fim (float)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_da\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "19",\
 "codigo": "2086340109007",\
 "nome": "Formatação de computador",\
 "valor\_venda": "12.00",\
 "observacoes": ""\
 },\
 {\
 "id": "44",\
 "codigo": "19841915891",\
 "nome": "Manutenção de celular",\
 "valor\_venda": "50.00",\
 "observacoes": "Manutenção em geral"\
 }\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ nome (string)
\+ codigo (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "codigo": "19841915891",
 "nome": "Manutenção de celular",
 "valor\_venda": 50.00,
 "observacoes": "Manutenção em geral"
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "44",
 "codigo": "19841915891",
 "nome": "Manutenção de celular",
 "valor\_venda": "50.00",
 "observacoes": "Manutenção em geral"
 }
 }

\### Visualizar \[GET /produtos/{id}\]

Lista os dados de um serviço específico. Basta acrescentar o parametro com o id do serviço.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "44",
 "codigo": "19841915891",
 "nome": "Manutenção de celulares",
 "valor\_venda": "50.00",
 "observacoes": "Manutenção em geral, inclusive software"
 }
 }

\### Editar \[PUT /servicos/{id}\]

**Campos obrigatórios**
\+ nome (string)
\+ codigo (string)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "codigo": "19841915891",
 "nome": "Manutenção de celulares",
 "valor\_venda": 50.00,
 "observacoes": "Manutenção em geral, inclusive software"
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "44",
 "codigo": "19841915891",
 "nome": "Manutenção de celulares",
 "valor\_venda": "50.00",
 "observacoes": "Manutenção em geral, inclusive software"
 }
 }

\### Deletar \[DELETE /servicos/{id}\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Serviço removido com sucesso!"
 }

\## Orçamentos \[/orcamentos\]

\### Listar \[GET\]

**Filtros**
\+ loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/
\+ tipo (tipo = produto, tipo = servico)
\+ codigo (int)
\+ nome (string)
\+ situacao\_id (int)

_Para conhecer os ids das **situações de orçamentos**, faça um GET em /api/situacoes\_orcamentos/_

\+ data\_inicio:

_Orçamentos que estão configurados com a data a partir do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_inicio=2020-01-01)._
\+ data\_fim:

_Orçamentos que estão configurados com a data a até do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_fim=2020-01-31)._

\+ cliente\_id (int)

_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_
\+ centro\_custo\_id (int)

_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 22,
 "total\_da\_pagina": 2,
 "pagina\_atual": 2,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": 1,
 "url\_anterior": "/api/orcamentos?pagina=1",
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "497",\
 "codigo": "57",\
 "cliente\_id": "6",\
 "nome\_cliente": "Jarvis Stark",\
 "vendedor\_id": "45",\
 "nome\_vendedor": "João da Silva",\
 "tecnico\_id": null,\
 "nome\_tecnico": null,\
 "data": "2020-01-27",\
 "previsao\_entrega": null,\
 "situacao\_id": "3150",\
 "nome\_situacao": "Confirmado",\
 "valor\_total": "60.00",\
 "transportadora\_id": null,\
 "nome\_transportadora": "",\
 "centro\_custo\_id": "1",\
 "nome\_centro\_custo": "Centro de Custo 01",\
 "aos\_cuidados\_de": null,\
 "validade": null,\
 "introducao": null,\
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "valor\_frete": "0.00",\
 "nome\_canal\_venda": "Kautrite III",\
 "nome\_loja": "Savassi",\
 "valor\_custo": "0.00",\
 "condicao\_pagamento": "parcelado",\
 "situacao\_financeiro": "1",\
 "situacao\_estoque": "1",\
 "forma\_pagamento\_id": "539408",\
 "data\_primeira\_parcela": "2020-01-27",\
 "numero\_parcelas": "3",\
 "intervalo\_dias": "30",\
 "hash": "GAbaqwexcAW",\
 "equipamentos": \[\],\
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "20.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Plano Padrão 01",\
 "observacao": null\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "20.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Plano Padrão 01",\
 "observacao": null\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-03-27",\
 "valor": "20.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Plano Padrão 01",\
 "observacao": null\
 }\
 }\
 \],\
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.00",\
 "valor\_venda": "5.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": null,\
 "valor\_total": "5.50"\
 }\
 },\
 {\
 "produto": {\
 "produto\_id": 1238788,\
 "variacao\_id": 4152213,\
 "nome\_produto": "Teste 02",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": "UND",\
 "quantidade": "1.00",\
 "tipo\_valor\_id": "90858",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "0.00",\
 "valor\_venda": "54.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": null,\
 "valor\_total": "54.50"\
 }\
 }\
 \],\
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "25.0000",\
 "tipo\_desconto": "%",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": "5.0000",\
 "valor\_total": "23.75"\
 }\
 }\
 \]\
 }\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)
\+ codigo (int)
\+ cliente\_id (int)
\+ situacao\_id (int)
\+ data (date)

**Informações adicionais**
\+ O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.
\+ O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.

Podem ser registrados dois tipos de orçamentos. Orçamentos de produtos e Orçamentos de serviços. Para isso basta especificar o campo **tipo**.

\##### Gerar parcelas automaticamente
Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a **data do orçamento** \+ **dias da 1º parcela** da forma\_pagamento\_id configurado no sistema.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "cliente\_id": 7,
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": 0,
 "nome\_transportadora": "",
 "centro\_custo\_id": 1,
 "nome\_centro\_custo": "Centro de Custo 01",
 "transportadora\_id": null,
 "aos\_cuidados\_de": null,
 "validade": "30 dias",
 "introducao": null,
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "nome\_canal\_venda": "Presencial",
 "nome\_loja": "Savassi",
 "valor\_frete": 0,
 "desconto\_valor": "",
 "desconto\_porcentagem": "0",
 "exibir\_pagamento": "0",
 "condicao\_pagamento": "parcelado",
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": 4878064,\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "pedido\_id": "8574616"\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": 4878064,\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "pedido\_id": "8574616"\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "id": "28272998",\
 "nome\_produto": "Teste 01",\
 "variacao\_id": "1246454",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": "UND",\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": "5.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "desconto\_porcentagem": "0"\
 }\
 },\
 {\
 "produto": {\
 "id": "5423530",\
 "nome\_produto": "Teste 02",\
 "variacao\_id": null,\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": "UND",\
 "quantidade": "1",\
 "tipo\_valor\_id": 90858,\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": 42.50,\
 "valor\_venda": 54.50,\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "0"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": 60,\
 "tipo\_desconto" : "R$",\
 "desconto\_valor": "0",\
 "desconto\_porcentagem": "0"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "513",
 "codigo": "58",
 "cliente\_id": "7",
 "nome\_cliente": "Tiago flheflj",
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": "60.00",
 "transportadora\_id": null,
 "nome\_transportadora": "",
 "centro\_custo\_id": "1",
 "nome\_centro\_custo": "Centro de Custo 01",
 "aos\_cuidados\_de": null,
 "validade": "30 dias",
 "introducao": null,
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "valor\_frete": "0.00",
 "nome\_canal\_venda": "Kautrite III",
 "nome\_loja": "Savassi",
 "valor\_custo": "0.00",
 "condicao\_pagamento": "parcelado",
 "situacao\_financeiro": "0",
 "situacao\_estoque": "0",
 "forma\_pagamento\_id": "539408",
 "data\_primeira\_parcela": "2020-01-27",
 "numero\_parcelas": "2",
 "intervalo\_dias": "30",
 "hash": "GAbaqwexcAW",
 "equipamentos": \[\],
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.00",\
 "valor\_venda": "5.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "5.50"\
 }\
 },\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Teste 02",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": "UND",\
 "quantidade": "1.00",\
 "tipo\_valor\_id": "90858",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "0.00",\
 "valor\_venda": "54.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "54.50"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "354",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "60.0000",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.0000",\
 "desconto\_porcentagem": "0.0000",\
 "valor\_total": "60.00"\
 }\
 }\
 \]
 }
 }
\### Visualizar \[GET /orcamentos/{id}\]

Lista os dados de um orçamento específico. Basta acrescentar o parametro com o id da venda.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "513",
 "codigo": "58",
 "cliente\_id": "7",
 "nome\_cliente": "Tiago flheflj",
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": "60.00",
 "transportadora\_id": null,
 "nome\_transportadora": "",
 "centro\_custo\_id": "1",
 "nome\_centro\_custo": "Centro de Custo 01",
 "aos\_cuidados\_de": null,
 "validade": "30 dias",
 "introducao": null,
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "valor\_frete": "0.00",
 "nome\_canal\_venda": "Kautrite III",
 "nome\_loja": "Savassi",
 "valor\_custo": "0.00",
 "condicao\_pagamento": "parcelado",
 "situacao\_financeiro": "1",
 "situacao\_estoque": "1",
 "forma\_pagamento\_id": "539408",
 "data\_primeira\_parcela": "2020-01-27",
 "numero\_parcelas": "2",
 "intervalo\_dias": "30",
 "hash": "GAbaqwexcAW",
 "equipamentos": \[\],
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35.00",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": "4878064",\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.00",\
 "valor\_venda": "5.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "5.50"\
 }\
 },\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Teste 02",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": "UND",\
 "quantidade": "1.00",\
 "tipo\_valor\_id": "90858",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "0.00",\
 "valor\_venda": "54.50",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "54.50"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "25.0000",\
 "tipo\_desconto": "%",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": "5.0000",\
 "valor\_total": "23.75"\
 }\
 }\
 \]
 }
 }
\### Editar \[PUT /orcamentos/{id}\]

**Campos obrigatórios**
\+ tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)
\+ codigo (int)
\+ cliente\_id (int)
\+ situacao\_id (int)
\+ data (date)

**Informações adicionais**
\+ O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.
\+ O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "cliente\_id": 7,
 "nome\_cliente": "Tiago flheflj",
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": 0,
 "nome\_transportadora": "",
 "transportadora\_id": null,
 "aos\_cuidados\_de": null,
 "validade": "30 dias",
 "introducao": null,
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "nome\_canal\_venda": "Presencial",
 "nome\_loja": "Savassi",
 "valor\_frete": 0,
 "desconto\_valor": "",
 "desconto\_porcentagem": "0",
 "condicao\_pagamento": "parcelado",
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": 4878064,\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "pedido\_id": "8574616"\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35",\
 "forma\_pagamento\_id": "539408",\
 "nome\_forma\_pagamento": "BCash",\
 "plano\_contas\_id": 4878064,\
 "nome\_plano\_conta": "Ruga API - Sem Rota NEW2",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "pedido\_id": "8574616"\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "id": "28272998",\
 "nome\_produto": "Celular 10A",\
 "variacao\_id": "1246454",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": 5.50,\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00"\
 }\
 },\
 {\
 "produto": {\
 "id": "5423530",\
 "tipo": "S",\
 "nome\_produto": "teste",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": 54.50,\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "0"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": 60,\
 "tipo\_desconto" : "R$",\
 "desconto\_valor": "0",\
 "desconto\_porcentagem": "0"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "521478",
 "codigo": "98565574",
 "cliente\_id": "1156997",
 "vendedor\_id": "45",
 "nome\_vendedor": "Marcos Vinicius Otávio Barros",
 "data": "2020-01-27",
 "previsao\_entrega": "2018-10-16",
 "situacao\_id": "294341",
 "nome\_situacao": "Em aberto",
 "valor\_total": "69.90",
 "transportadora\_id": "58457",
 "nome\_transportadora": "Rapidex",
 "centro\_custo\_id": "1",
 "nome\_centro\_custo": "Centro de Custo 01",
 "aos\_cuidados\_de": "Nelson",
 "validade": "30 dias",
 "introducao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "observacoes\_interna": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",
 "valor\_frete": "5.00",
 "nome\_canal\_venda": "Presencial",
 "nome\_loja": "Matriz",
 "condicao\_pagamento": "parcelado",
 "situacao\_financeiro": "1",
 "situacao\_estoque": "1",
 "forma\_pagamento\_id": "539408",
 "data\_primeira\_parcela": "2020-01-27",
 "numero\_parcelas": "2",
 "intervalo\_dias": "30",
 "hash": "GAbaqwexcAW",
 "pagamentos": \[\
 {\
 "pagamento": {\
 "pedido\_id": "2156448",\
 "data\_vencimento": "2020-01-27",\
 "valor": "25",\
 "forma\_pagamento\_id": "200754",\
 "nome\_forma\_pagamento": "Boleto bradesco",\
 "plano\_contas\_id": "2541",\
 "nome\_plano\_conta": "Administração",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "pedido\_id": "2156448",\
 "data\_vencimento": "2020-01-27",\
 "valor": "35.96",\
 "forma\_pagamento\_id": "200754",\
 "nome\_forma\_pagamento": "Boleto bradesco",\
 "plano\_contas\_id": "2541",\
 "nome\_plano\_conta": "Administração",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "id": "3035767",\
 "produto\_id": "2141430",\
 "nome\_produto": "Celular 10A",\
 "variacao\_id": "1246454",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": "UND",\
 "quantidade": "1",\
 "tipo\_valor\_id": "37998",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "250.62",\
 "valor\_venda": "500",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "550.30"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "358",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "60.0000",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.0000",\
 "desconto\_porcentagem": "0.0000",\
 "valor\_total": "60.00"\
 }\
 }\
 \]
 }
 }

\### Deletar \[DELETE /orcamentos/{id}\]

Exclui um orçamento específico. Basta acrescentar o parametro com o id do orçamento.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Orçamento excluido com sucesso"
 }

\### Gerar parcelas \[POST /orcamentos/gerar\_parcelas\]

**Campos obrigatórios**:
\+ valor\_total (float)
\+ forma\_pagamento\_id (int)
\+ numero\_parcelas (int)

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "valor\_total": 100.00,
 "forma\_pagamento\_id": 579722,
 "intervalo\_dias": 30,
 "data\_primeira\_parcela": "2019-12-10",
 "numero\_parcelas": 3
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": \[\
 {\
 "data\_vencimento": "2020-01-27",\
 "valor": 33.33,\
 "forma\_pagamento\_id": "579722",\
 "nome\_forma\_pagamento": "BB"\
 },\
 {\
 "data\_vencimento": "2020-02-27",\
 "valor": 33.33,\
 "forma\_pagamento\_id": "579722",\
 "nome\_forma\_pagamento": "BB"\
 },\
 {\
 "data\_vencimento": "2020-03-27",\
 "valor": 33.34,\
 "forma\_pagamento\_id": "579722",\
 "nome\_forma\_pagamento": "BB"\
 }\
 \]
 }

\## Situações de orçamentos \[/situacoes\_orcamentos\]

Valores para o campo **tipo\_lancamento**:

0 = Não lança

1 = Lança estoque e financeiro

2 = Lança somente estoque

3 = Lança somente financeiro

\### Listar \[GET\]

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 4,
 "total\_paginas": 4,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "6919",\
 "nome": "Confirmado",\
 "padrao": "1"\
 },\
 {\
 "id": "6917",\
 "nome": "Em aberto",\
 "padrao": "0"\
 },\
 {\
 "id": "6918",\
 "nome": "Em andamento",\
 "padrao": "0"\
 }\
 {\
 "id": "6920",\
 "nome": "Cancelado",\
 "padrao": "0"\
 }\
 \]
 }

\## Campos extras de orçamentos \[/atributos\_orcamentos\]

\### Listar \[GET\]
Lista campos extras de orçamentos.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 2,
 "total\_paginas": 1,
 "total\_registros\_pagina": 2,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "1",\
 "nome": "Registro",\
 "tipo": "numeros",\
 "exibir\_impressao": "Sim",\
 "modificado\_em": "2025-01-21 00:58:11",\
 "cadastrado\_em": "2025-01-21 00:58:11"\
 },\
 {\
 "id": "2",\
 "nome": "Campo Aux",\
 "tipo": "texto\_simples",\
 "exibir\_impressao": "Não",\
 "modificado\_em": "2025-01-21 00:58:36",\
 "cadastrado\_em": "2025-01-21 00:58:36"\
 }\
 \]
 }

\### Cadastrar \[POST /atributos\_orcamentos\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido".
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list".
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Comprovante",
 "tipo": "check\_list",
 "exibir\_impressao": "Sim",
 "opcoes": \[\
 {"nome": "PIX"},\
 {"nome": "Boleto"}\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Comprovante",
 "tipo": "check\_list",
 "exibir\_impressao": "Sim",
 "permitir\_excluir": "1",
 "usuario\_id": "131036",
 "nome\_usuario": "Controle 1",
 "cadastrado\_em": "2025-04-14 17:47:04",
 "modificado\_em": "2025-04-14 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "PIX"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "Boleto"\
 }\
 \]
 }
 }

\### Editar \[PUT /atributos\_orcamentos/{id}\]

**Campos obrigatórios**
\+ nome (string)
\+ tipo (string) Tipos permitidos: cpf, cnpj, check\_list, data, numeros, texto\_simples.
\+ exibir\_impressao (string), Opções: "Sim", "Não" ou "Quando preenchido"
\+ opcoes\* (array) Obrigatório nos campos extras do tipo "check\_list"
\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "nome": "Documentos",
 "tipo": "check\_list",
 "exibir\_impressao": "Não",
 "opcoes": \[\
 {"nome": "RG"},\
 {"nome": "CNH"},\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Documentos",
 "tipo": "check\_list",
 "exibir\_impressao": "Não",
 "permitir\_excluir": "1",
 "usuario\_id": "1",
 "nome\_usuario": "Usuario",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "RH"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "CNH"\
 }\
 \]
 }
 }

\### Visualizar \[GET /atributos\_orcamentos/{id}\]
Visualiza um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "1",
 "nome": "Documentos",
 "tipo": "check\_list",
 "exibir\_impressao": "Não",
 "permitir\_excluir": "1",
 "usuario\_id": "1",
 "nome\_usuario": "Usuario",
 "cadastrado\_em": "2025-04-15 17:47:04",
 "modificado\_em": "2025-04-15 17:47:04",
 "opcoes": \[\
 {\
 "id": "1",\
 "atributo\_id": "5",\
 "nome": "CPF"\
 },\
 {\
 "id": "2",\
 "atributo\_id": "5",\
 "nome": "CNH"\
 }\
 \]
 }
 }

\### Deletar \[DELETE /atributos\_orcamentos/{id}\]
Exclui um campo extra específico. Basta acrescentar o parâmetro com o id do campo extra.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": "Campo extra removido com sucesso!"
 }

\## Vendas \[/vendas\]

\### Listar \[GET\]

**Filtros**
\+ loja\_id (int)
Para conhecer os ids das lojas, faça um GET em /api/lojas/
\+ tipo (tipo = produto, tipo = servico, tipo = vendas\_balcao)
\+ codigo (int)
\+ nome (string)
\+ situacao\_id (int)

_Para conhecer os ids das **situações de vendas**, faça um GET em /api/situacoes\_vendas/_

\+ data\_inicio:

_Vendas que estão configuradas com a data a partir do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_inicio=2020-01-01)._
\+ data\_fim:

_Vendas que estão configuradas com a data a até do filtro especificado. A data deve estar no formato AAAA-MM-DD (ex: ?data\_fim=2020-01-31)._

\+ cliente\_id (int)

_Para conhecer os ids dos **clientes**, faça um GET em /api/clientes/_
\+ centro\_custo\_id (int)

_Para conhecer os ids dos **centros de custos**, faça um GET em /api/centros\_custos/_

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "meta": {
 "total\_registros": 1,
 "total\_da\_pagina": 1,
 "pagina\_atual": 1,
 "limite\_por\_pagina": 20,
 "pagina\_anterior": null,
 "url\_anterior": null,
 "proxima\_pagina": null,
 "proxima\_url": null
 },
 "data": \[\
 {\
 "id": "505",\
 "codigo": "795",\
 "cliente\_id": "1",\
 "nome\_cliente": "Ronei Marcos Silva Marques",\
 "vendedor\_id": "45",\
 "nome\_vendedor": "João da Silva",\
 "tecnico\_id": null,\
 "nome\_tecnico": null,\
 "data": "2020-01-27",\
 "previsao\_entrega": null,\
 "situacao\_id": "3150",\
 "nome\_situacao": "Confirmado",\
 "valor\_total": "60.00",\
 "transportadora\_id": null,\
 "nome\_transportadora": null,\
 "centro\_custo\_id": "1",\
 "nome\_centro\_custo": "Centro de Custo 01",\
 "aos\_cuidados\_de": null,\
 "validade": null,\
 "introducao": null,\
 "observacoes": null,\
 "observacoes\_interna": null,\
 "valor\_frete": "0.00",\
 "nome\_canal\_venda": "Kautrite III",\
 "nome\_loja": "Savassi",\
 "valor\_custo": "0.00",\
 "condicao\_pagamento": "parcelado",\
 "situacao\_financeiro": "1",\
 "situacao\_estoque": "1",\
 "forma\_pagamento\_id": "579722",\
 "data\_primeira\_parcela": "2020-01-27",\
 "numero\_parcelas": "2",\
 "intervalo\_dias": "30",\
 "hash": "wpQseRf",\
 "equipamentos": \[\],\
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25.00",\
 "forma\_pagamento\_id": "579722",\
 "nome\_forma\_pagamento": "BB",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35.00",\
 "forma\_pagamento\_id": "579722",\
 "nome\_forma\_pagamento": "BB",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],\
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": null,\
 "detalhes": "Lorem Ipsum is simply dummy text of the",\
 "movimenta\_estoque": "0",\
 "possui\_variacao": "0",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.00",\
 "valor\_venda": "60.00",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": null,\
 "valor\_total": "60.00"\
 }\
 }\
 \],\
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "25.0000",\
 "tipo\_desconto": "%",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": "5.0000",\
 "valor\_total": "23.75"\
 }\
 }\
 \]\
 }\
 \]
 }

\### Cadastrar \[POST\]

**Campos obrigatórios**
\+ tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)
\+ codigo (int)
\+ cliente\_id (int)
\+ situacao\_id (int)
\+ data (date)

**Informações adicionais**
\+ O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.
\+ O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.

Podem ser registrados dois tipos de vendas. Vendas de produtos e Vendas de serviços. Para isso basta especificar o campo **tipo**.

\##### Gerar parcelas automaticamente
Para gerar parcelas automaticamente basta substituir o parametro pagamentos (array) pelos campos abaixo:

**forma\_pagamento\_id:** (int) Obrigatório

**numero\_parcelas:** (int) Obrigatório

**intervalo\_dias:** (int) Opcional. Caso não seja informado irá considerar o intervalo de dias da forma\_pagamento\_id configurado no sistema.

**data\_primeira\_parcela:** (date) Opcional. Caso não seja informado irá pegar a **data da venda** \+ **dias da 1º parcela** da forma\_pagamento\_id configurado no sistema.

**plano\_contas\_id:** (int) Opcional. Plano de contas.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo":"produto",
 "cliente\_id": "1",
 "vendedor\_id": "45",
 "data": "2020-01-27",
 "prazo\_entrega": "2019-12-06",
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "transportadora\_id": "",
 "centro\_custo\_id": "1",
 "valor\_frete": "0.00",
 "condicao\_pagamento": "parcelado",
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista ",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista ",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": "22",\
 "variacao\_id": "1246454",\
 "detalhes": "Lorem Ipsum is simply dummy text of the",\
 "quantidade": "1",\
 "valor\_venda": "60.00",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Teste 01",\
 "detalhes": "Lorem Ipsum is simply dummy text of the printing and typesetting industry.",\
 "sigla\_unidade": null,\
 "quantidade": "1",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_venda": 60,\
 "tipo\_desconto" : "R$",\
 "desconto\_valor": "0",\
 "desconto\_porcentagem": "0"\
 }\
 }\
 \]
 }

\+ Response 200 (application/json)

 \+ Body

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "515",
 "codigo": "797",
 "cliente\_id": "1",
 "nome\_cliente": "Ronei Marcos Silva Marques",
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": "60.00",
 "transportadora\_id": null,
 "nome\_transportadora": null,
 "centro\_custo\_id": "1",
 "nome\_centro\_custo": "Centro de Custo 01",
 "aos\_cuidados\_de": null,
 "validade": null,
 "introducao": null,
 "observacoes": null,
 "observacoes\_interna": null,
 "valor\_frete": "0.00",
 "nome\_canal\_venda": "Kautrite III",
 "nome\_loja": "Savassi",
 "valor\_custo": "0.00",
 "condicao\_pagamento": "parcelado",
 "situacao\_financeiro": "0",
 "situacao\_estoque": "0",
 "forma\_pagamento\_id": "640517",
 "data\_primeira\_parcela": "2020-01-27",
 "numero\_parcelas": "2",
 "intervalo\_dias": "30",
 "hash": "wpQseRf",
 "equipamentos": \[\],
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25.00",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35.00",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Televisão Smart TV - Plasma 52 P",\
 "detalhes": "Lorem Ipsum is simply dummy text of the",\
 "movimenta\_estoque": "1",\
 "possui\_variacao": "0",\
 "sigla\_unidade": "UND",\
 "quantidade": "1.00",\
 "tipo\_valor\_id": "90858",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "700.62",\
 "valor\_venda": "60.00",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "60.00"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "25.0000",\
 "tipo\_desconto": "%",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": "5.0000",\
 "valor\_total": "23.75"\
 }\
 }\
 \]
 }
 }
\### Visualizar \[GET /vendas/{id}\]

Lista os dados de uma venda específica. Basta acrescentar o parametro com o id da venda.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

\+ Response 200 (application/json)

 {
 "code": 200,
 "status": "success",
 "data": {
 "id": "515",
 "codigo": "797",
 "cliente\_id": "1",
 "nome\_cliente": "Ronei Marcos Silva Marques",
 "vendedor\_id": "45",
 "nome\_vendedor": "João da Silva",
 "tecnico\_id": null,
 "nome\_tecnico": null,
 "data": "2020-01-27",
 "previsao\_entrega": null,
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "valor\_total": "60.00",
 "transportadora\_id": null,
 "nome\_transportadora": null,
 "centro\_custo\_id": "1",
 "nome\_centro\_custo": "Centro de Custo 01",
 "aos\_cuidados\_de": null,
 "validade": null,
 "introducao": null,
 "observacoes": null,
 "observacoes\_interna": null,
 "valor\_frete": "0.00",
 "nome\_canal\_venda": "Kautrite III",
 "nome\_loja": "Savassi",
 "valor\_custo": "0.00",
 "condicao\_pagamento": "parcelado",
 "situacao\_financeiro": "1",
 "situacao\_estoque": "1",
 "forma\_pagamento\_id": "640517",
 "data\_primeira\_parcela": "2020-01-27",
 "numero\_parcelas": "2",
 "intervalo\_dias": "30",
 "hash": "wpQseRf",
 "equipamentos": \[\],
 "pagamentos": \[\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-01-27",\
 "valor": "25.00",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 },\
 {\
 "pagamento": {\
 "data\_vencimento": "2020-02-27",\
 "valor": "35.00",\
 "forma\_pagamento\_id": "640517",\
 "nome\_forma\_pagamento": "Dinheiro à Vista",\
 "plano\_contas\_id": "2514",\
 "nome\_plano\_conta": "Prestações de serviçosAC",\
 "observacao": "Lorem Ipsum is simply dummy text of the printing and typesetting industry."\
 }\
 }\
 \],
 "produtos": \[\
 {\
 "produto": {\
 "produto\_id": 1238787,\
 "variacao\_id": 4152212,\
 "nome\_produto": "Televisão Smart TV - Plasma 52 P",\
 "detalhes": "Lorem Ipsum is simply dummy text of the",\
 "movimenta\_estoque": "1",\
 "possui\_variacao": "0",\
 "sigla\_unidade": "UND",\
 "quantidade": "1.00",\
 "tipo\_valor\_id": "90858",\
 "nome\_tipo\_valor": "Atacado",\
 "valor\_custo": "700.62",\
 "valor\_venda": "60.00",\
 "tipo\_desconto": "R$",\
 "desconto\_valor": "0.00",\
 "desconto\_porcentagem": "0.00",\
 "valor\_total": "60.00"\
 }\
 }\
 \],
 "servicos": \[\
 {\
 "servico": {\
 "id": "351",\
 "servico\_id": "437",\
 "nome\_servico": "Serviço 01",\
 "detalhes": "",\
 "sigla\_unidade": null,\
 "quantidade": "1.00",\
 "tipo\_valor\_id": null,\
 "nome\_tipo\_valor": null,\
 "valor\_custo": "0.0000",\
 "valor\_venda": "25.0000",\
 "tipo\_desconto": "%",\
 "desconto\_valor": null,\
 "desconto\_porcentagem": "5.0000",\
 "valor\_total": "23.75"\
 }\
 }\
 \]
 }
 }
\### Editar \[PUT /vendas/{id}\]

**Campos obrigatórios**
\+ tipo (tipo = produto, tipo = servico, caso não seja informado será passado tipo=produto)
\+ codigo (int)
\+ cliente\_id (int)
\+ situacao\_id (int)
\+ data (date)

**Informações adicionais**
\+ O campo **condicao\_pagamento** deverá ser preenchido com os valores: 'a\_vista' ou 'parcelado'.
\+ O campo **tipo\_desconto** deverá ser preenchido com os valores: 'R$' ou '%'.

\+ Request (application/json)

 \+ Headers

 access-token: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 secret-access-token: YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

 \+ Body

 {
 "tipo":"produto",
 "cliente\_id": "1",
 "vendedor\_id": "45",
 "data": "2020-01-27",
 "prazo\_entrega": "2020-01-06",
 "situacao\_id": "3150",
 "nome\_situacao": "Confirmado",
 "transportadora\_id": "5",
 "centro\_custo\_id": "1",
 "va