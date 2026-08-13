# Plano de Implementação: Filtro e Atualização de Nomenclatura Divergente (RH > Clientes)

Este plano detalha a implementação do filtro para clientes com nomes divergentes entre GestãoClick (GC) e Auvo, e a funcionalidade de atualização em massa dos nomes no Auvo para igualar ao GC.

## Alterações Técnicas

### Frontend
- **Página de Clientes (RH)**:
    - Adição do filtro "Divergência de Nome" no seletor de situação do vínculo (já existente, mas agora integrado com ações em massa).
    - Implementação de seleção múltipla de clientes (Checkbox).
    - Adição de botão de ação em massa: "Atualizar Nomes no Auvo (Usar Nome GC)".
    - Lógica de processamento em lote com feedback visual (toasts).
- **Integração Backend**:
    - Criação de utilitário `src/lib/updateAuvoName.ts` para invocar a Edge Function de atualização.
    - Correção de importação faltante (`useQueryClient`) em `ClientesRhPage.tsx`.

### Backend (Edge Functions)
- **Função `rh-clientes-sync-gc`**:
    - Adição da ação `update_auvo_name`.
    - Lógica para buscar o cliente no Auvo e realizar o `PUT` de atualização apenas do campo `name` (preservando outros dados).

## Detalhes de Segurança e Consistência
- A funcionalidade só estará disponível para clientes que já possuem um vínculo ativo (`auvo_cliente_id` presente).
- O processo utiliza a estratégia "GET completo -> Merge -> PUT" para evitar sobrescrita acidental de dados no Auvo, conforme definido na memória do projeto.

## Testes e Verificação
- Verificar se o filtro "Divergência de Nome" isola corretamente os clientes com `areNamesDivergent === true`.
- Testar a atualização de um cliente individual e depois em lote.
- Confirmar se o cache do frontend é invalidado após a operação, removendo os itens do filtro de divergência.
