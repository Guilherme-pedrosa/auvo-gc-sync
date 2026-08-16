# Plano de Melhoria: Estabilidade e Visual da Sincronização de Preventivas

O usuário relatou um erro de protocolo HTTP/2 (SendRequest) na sincronização de preventivas, acompanhado de uma longa lista de IDs, e solicitou melhorias visuais no módulo de Planos Preventivos (marcação verde para preventivas realizadas e colunas de datas).

## Problema Técnico
O erro `http2 error: stream error detected: unspecific protocol error detected` ocorre quando uma Edge Function tenta enviar um payload muito grande ou quando há muitos redirecionamentos/falhas de rede no `fetch`. A lista de IDs sugere que o sistema está tentando passar centenas de parâmetros na URL ou no corpo da requisição de uma vez só.

## Ações

### 1. Robustez no Backend (Edge Functions)
- **Otimização de Payload**: Ajustar `equipment-sync` e `preventiva-consolidar` para processar em lotes menores e evitar o estouro de buffers HTTP/2.
- **Tratamento de Erros**: Garantir que erros de rede ou de protocolo não quebrem a interface, retornando uma resposta JSON amigável em vez de um erro bruto do Deno/HTTP.
- **Divisão de Tarefas**: Assegurar que a sincronização automática (cron) e a manual não entrem em conflito por recursos.

### 2. Melhorias Visuais (Planos Preventivos)
- **Marcação Verde**: Na tela de edição do Plano Preventivo (`PlanosPreventivosPage.tsx`), destacar em verde as células dos meses onde houve execução real da preventiva (baseado no histórico do Auvo).
- **Novas Colunas**: Adicionar colunas "Última Preventiva" e "Próxima Preventiva" na listagem principal dos planos para visibilidade imediata.
- **Sincronização de Histórico**: Garantir que o `preventiva-consolidar` preencha corretamente a tabela `plano_preventivo_execucao` para alimentar o visual verde.

### 3. Frontend (Tratamento de Erro)
- **Captura de Erros**: Melhorar o `catch` no `EquipamentosPreventivosPage.tsx` para que, se a Edge Function falhar com erro de protocolo, a mensagem exibida seja "Erro de conexão (lote muito grande)" com sugestão de reduzir o filtro, em vez do log técnico bruto.

## Detalhes Técnicos
- Arquivos: `supabase/functions/preventiva-consolidar/index.ts`, `src/pages/financeiro/PlanosPreventivosPage.tsx`, `src/pages/financeiro/EquipamentosPreventivosPage.tsx`.
- Lógica de cores: Comparar `meses_planejados` com os meses presentes em `plano_preventivo_execucao` para o item.
- Lógica de datas: Buscar `ultima_preventiva` e `proxima_preventiva` da tabela consolidada e exibir no grid.
