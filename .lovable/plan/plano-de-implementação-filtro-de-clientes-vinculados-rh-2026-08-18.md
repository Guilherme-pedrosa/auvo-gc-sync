# Plano de Implementação: Filtro de Clientes Vinculados RH

O objetivo é garantir que apenas os clientes com vínculos válidos e requisitos cadastrados no módulo de RH sejam exibidos no filtro da tela de **Visitas Contratuais**, evitando a exibição de clientes "misturados" (sem vínculo ou sem requisitos de RH).

## Alterações

### Frontend

1.  **useRh.ts (Hooks)**:
    *   Adicionar um novo hook `useRhClientesVinculados` que filtra os clientes da tabela `rh_clientes` para retornar apenas aqueles com `vinculo_status === 'vinculado'`.
    *   Opcionalmente, integrar uma lógica que verifica se o cliente possui requisitos (NRs, ASOs, etc.) configurados no RH.

2.  **VisitasContratuaisPage.tsx**:
    *   Substituir o uso de `contractsQuery.data` no componente `SearchableSelect` de filtro de clientes pelo novo hook de clientes vinculados do RH.
    *   Garantir que o filtro "Todos os Clientes" no topo da página atue sobre essa base filtrada.

## Detalhes Técnicos

*   **Fonte de Dados**: A tabela `rh_clientes` é a fonte da verdade para o módulo de RH. O filtro deve usar os clientes que passaram pelo processo de "amarração" (vinculação GC ↔ Auvo) realizado em `RH > Clientes`.
*   **Critério de Filtro**: `vinculo_status = 'vinculado'`. Isso garante que o cliente possui um ID de Auvo e um ID de GestãoClick associados.
*   **Consistência**: Ao usar `rh_clientes` em vez de `contratos`, garantimos que o usuário veja apenas os clientes que o RH já preparou e aprovou para operação.

---

Eu atualizarei os hooks de RH para expor os clientes vinculados e ajustarei o seletor na página de Visitas Contratuais para utilizar essa lista filtrada.
