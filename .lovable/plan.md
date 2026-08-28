# Auditoria somente leitura: Auvo GC Sync ↔ FleetDesk

## Diagnóstico comprovado

- Os secrets `TVH_SERVICE_ROLE_KEY` e `TVH_SUPABASE_URL` estão configurados neste projeto. A presença foi confirmada; a validade e as permissões do valor não foram expostas nem confirmadas.
- As duas funções protegidas testadas (`tvh-veiculos-sync` e `sync-tvh-telemetrias`) responderam HTTP 200 com `ok: false` e `Não autenticado`. Portanto, a chamada diagnóstica não alcançou o FleetDesk e não permite concluir se o `TVH_SERVICE_ROLE_KEY` lê ou chama os endpoints remotamente.
- No código atual, `tvh-veiculos-sync` não usa `TVH_SERVICE_ROLE_KEY`: atribui sempre a chave pública hardcoded a `tvhKey` (linhas 17–18 e 118–123). Essa função consulta:
  - `GET /rest/v1/vehicles?select=id,placa,modelo,marca,status,km_atual&order=placa.asc`
  - `GET /rest/v1/maintenance_tickets?select=vehicle_id,titulo,prioridade,status,descricao,created_at,tipo&tipo=eq.nao_conformidade&order=created_at.desc`
- `sync-tvh-telemetrias` lê `TVH_SERVICE_ROLE_KEY`, mas a chamada efetiva de `cron-sync-rotaexata` usa sempre a chave pública hardcoded (linhas 47–50 e 77–80). O endpoint consumido é:
  - `POST /functions/v1/cron-sync-rotaexata` com corpo `{}`
- A função `premiacao` também consulta o FleetDesk e contém fallback público hardcoded. Os endpoints e campos usados são:
  - `GET /rest/v1/daily_vehicle_km?select=motorista_nome,km_percorrido,telemetrias,data` com filtro de `data` e paginação por `range`
  - `GET /rest/v1/vehicle_telemetry_events?select=motorista_nome,data` com filtro de `data` e paginação por `range`
- Foram encontradas chaves públicas hardcoded no source em `supabase/functions/tvh-veiculos-sync/index.ts`, `supabase/functions/sync-tvh-telemetrias/index.ts` e `supabase/functions/premiacao/index.ts`. Os valores não foram impressos.
- O código também contém URLs fallback hardcoded do FleetDesk nos mesmos fluxos.
- Não foi encontrada referência a `checklist-photos` no source pesquisado deste projeto. Isso comprova apenas que este projeto não referencia esse bucket no código local; não comprova que o bucket não tenha outros consumidores no próprio FleetDesk.
- O teste relacionado encontrado é `src/test/tvh-veiculos-sync.test.ts`; ele valida a lista local de status e a tolerância a falha dos tickets, mas não valida autenticação server-side, uso do secret, permissão REST ou chamada ao cron. Não há módulos de teste Deno para essas duas Edge Functions; a execução direcionada retornou “No test modules found”.

## Limite atual da auditoria ao vivo

Não é possível classificar neste momento o `TVH_SERVICE_ROLE_KEY` como funcional ou inválido: as funções chamadoras exigem um usuário autenticado antes de executar e o diagnóstico disponível não tinha uma sessão autenticada. Não houve tentativa de imprimir, extrair ou transportar o secret. Essa verificação deve ser repetida com uma sessão autorizada e registrando somente status HTTP, `ok`, códigos de erro e contagens — nunca tokens ou payloads sensíveis.

## Plano mínimo antes de revogar o acesso anônimo

1. **Executar o smoke test autenticado e somente leitura**
   - Invocar `tvh-veiculos-sync` e `sync-tvh-telemetrias` com sessão autorizada.
   - Confirmar separadamente: leitura de `vehicles`, leitura de `maintenance_tickets` e chamada de `cron-sync-rotaexata`.
   - Capturar apenas sucesso/falha, status, código retornado, tempo limite e contagens. Validar também se a resposta é JSON e se o formato esperado está presente.
   - Se o fluxo de telemetria aceitar apenas chave pública, registrar isso como incompatibilidade de contrato; não manter o fallback anônimo como solução definitiva.

2. **Trocar os três consumidores para credencial server-side exclusiva**
   - `tvh-veiculos-sync`: usar obrigatoriamente `TVH_SERVICE_ROLE_KEY`; remover chave pública hardcoded e fallback anônimo. Validar que URL e secret estão presentes e falhar de forma controlada sem fazer chamada pública.
   - `sync-tvh-telemetrias`: usar `TVH_SERVICE_ROLE_KEY` na chamada do cron, após confirmar no smoke test que o endpoint FleetDesk aceita esse tipo de autenticação. Se não aceitar, criar no FleetDesk um contrato server-to-server dedicado, sem reabrir SELECT anônimo.
   - `premiacao`: remover fallback público e aceitar somente `TVH_SERVICE_ROLE_KEY`; remover logs que exibem prefixo/tamanho da chave.
   - Manter a autenticação do usuário na entrada das funções e validar resposta/status do FleetDesk; erros externos continuarão sendo retornados no contrato resiliente já usado pelo projeto (`HTTP 200` com `ok: false`).

3. **Validar o conjunto exato de dependências**
   - Confirmar no FleetDesk se os quatro endpoints acima continuam existindo, quais colunas são obrigatórias e se a paginação por `range` permanece suportada.
   - Confirmar que `maintenance_tickets` pode ser lida pelo secret sem depender de política para `anon`.
   - Confirmar no FleetDesk se há consumidores independentes de `checklist-photos`; este projeto não apresenta uso local desse bucket.

4. **Revogar anon somente após os testes**
   - Remover as permissões/políticas anônimas de `vehicles`, `maintenance_tickets`, `daily_vehicle_km` e `vehicle_telemetry_events` no FleetDesk somente depois de o smoke test server-to-server passar.
   - Tornar `checklist-photos` privado apenas após o inventário de consumidores; como não há uso local identificado, ele é candidato independente, mas não deve ser alterado com base somente nesta auditoria.
   - Repetir os fluxos de sincronização, premiação e agenda após a revogação, verificando que não há chamadas diretas do navegador ao FleetDesk.

## Testes e rollback

- **Testes positivos:** leitura REST com secret; chamada do cron com secret; sincronização de veículos com e sem tickets; telemetria com resposta parcial; premiação com paginação acima de um lote.
- **Testes negativos:** ausência do secret, secret inválido, endpoint 401/403, timeout, JSON inválido, coluna ausente e resposta parcial. Nenhum desses testes deve exibir valores de secrets.
- **Regressão:** ampliar o teste existente para garantir ausência de JWT hardcoded/fallback público e uso efetivo de `TVH_SERVICE_ROLE_KEY`; adicionar testes Deno ou mocks para os contratos HTTP das duas funções.
- **Rollback:** reverter a revisão das Edge Functions para a última versão funcional e, se o FleetDesk já tiver sido endurecido, restaurar temporariamente apenas a permissão mínima necessária enquanto a incompatibilidade é corrigida. Não reintroduzir chaves públicas no source; qualquer exceção deve ser temporária, documentada e removida após a correção.

Nenhum arquivo, migration, secret ou configuração foi alterado nesta etapa.