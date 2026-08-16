# Plano de Preventivas - Melhorias Visuais e de Dados

O usuário solicitou melhorias no módulo de Planos de Preventiva para facilitar o acompanhamento das manutenções executadas.

## Mudanças propostas

### Backend (Edge Function: `preventiva-consolidar`)
- A função já popula a tabela `plano_preventivo_execucao`.
- Vou garantir que a sincronização identifique corretamente as preventivas realizadas dentro dos meses planejados e também as realizadas fora do planejado (mas no mesmo ano).

### Frontend (Página: `src/pages/financeiro/PlanosPreventivosPage.tsx`)
- **Destaque Visual**: Na tabela de edição do plano, as células dos meses que tiveram preventivas concretizadas (registradas em `plano_preventivo_execucao`) ficarão verdes.
- **Novas Colunas**: Adicionar colunas explícitas para "Última Preventiva" e "Próxima Preventiva" na tabela principal de planos.
- **Histórico no Dialog**: No diálogo de edição, exibir a data da última execução para cada equipamento de forma mais clara.

## Detalhes Técnicos
- Buscar dados de `plano_preventivo_execucao` ao carregar os detalhes do plano no `EditarPlanoDialog`.
- Mapear as execuções para os meses correspondentes para aplicar a classe `bg-green-500` ou similar.
- Atualizar a interface para refletir o conteúdo da imagem de referência (exibindo datas e status).
