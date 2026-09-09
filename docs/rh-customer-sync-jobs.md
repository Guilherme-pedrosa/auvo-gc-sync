# Sincronização de clientes RH em lotes

`rh-clientes-sync-gc` inicia sincronizações e consultas por documento com HTTP 202 e um `jobId`. O progresso fica em `rh_customer_sync_jobs`; as páginas coletadas ficam em `rh_customer_sync_pages`. A interface acompanha o mesmo job e o cron `rh-customer-sync-worker` continua trabalhos pendentes a cada minuto, inclusive quando a tela é fechada.

Cada execução processa até 20 etapas, deixa de iniciar etapas após 35 segundos e limita o trabalho a 55 segundos. Uma etapa coleta uma página, reconcilia um cliente GC, consulta um cliente RH ou persiste até 20 clientes exclusivos do Auvo. A reconciliação aguarda a coleta completa do Auvo para detectar correspondências ambíguas em páginas posteriores.

Uma concessão global de 120 segundos impede trabalhadores simultâneos. O cursor só avança após confirmação da etapa. Uma concessão expirada durante escrita é encerrada com `UNCERTAIN_WRITE`; a escrita não é repetida automaticamente. Antes de iniciar outro job após esse erro, conferir o cliente nos sistemas e o cursor registrado. Falhas normais também ficam registradas no job.

## Implantação

1. Aplicar `supabase/migrations/20260909150000_rh_customer_sync_jobs.sql` antes do código novo. A migração cria tabelas, funções e o cron; não altera cadastros de clientes. As tabelas e RPCs são restritas a `service_role`.
2. Publicar especificamente a Edge Function, com autenticação de implantação do Supabase:

   ```sh
   supabase functions deploy rh-clientes-sync-gc --project-ref bysljmkwkxrkovsaodxv --no-verify-jwt --use-api
   ```

3. Publicar o frontend que acompanha os jobs. O merge no GitHub ou a publicação do site Lovable, isoladamente, não comprovam a atualização da função.
4. Verificar a versão sem iniciar uma sincronização: enviar `{"action":"link","requestVersion":"gc-auvo-v2"}` sem ID de cliente para a função. A validação deve responder `ok:false`, erro de cliente não informado e `runtimeVersion:"rh-customer-jobs-v1"`. Essa chamada também é segura na versão anterior.

Não usar `action:"version"` ou `action:"continue"` para descobrir uma versão antiga: versões anteriores interpretavam ações desconhecidas como sincronização completa. A continuação da interface e do cron usa o envelope `{"action":"lookup_document","rhClientIds":[],"continueJob":true,"jobId":"..."}`, rejeitado pela validação antiga antes de acessar os provedores. O cron omite `jobId` para selecionar um trabalho pendente.

## Verificação

```sh
node --test tests/rh-clientes-continuation.test.mjs tests/rh-customer-runner.test.mjs tests/rh-customer-endpoint.test.mjs
deno check --node-modules-dir=none supabase/functions/rh-clientes-sync-gc/index.ts
```

Consultar `id`, `status`, `state`, `error`, `mutation_in_flight` e `updated_at` em `rh_customer_sync_jobs` para distinguir trabalho em andamento de falha. O fim do acompanhamento da interface após 15 minutos não cancela o job no servidor.
