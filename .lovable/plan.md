# Plano: Gestão de Previsão de Chegada de Orçamentos

Melhorar a visibilidade e integridade das previsões de execução no módulo "Chegada Orçamentos", alertando sobre atrasos de peças e permitindo consulta detalhada.

## Alterações

### Frontend

- **src/pages/financeiro/AgendamentoPage.tsx**:
    - Atualizar `renderItem` para comparar `data_chegada` (chegada das peças) com `previsao_data` (execução agendada).
    - Se `data_chegada > previsao_data`, aplicar estilo vermelho (`bg-destructive/10 text-destructive`) e adicionar um ícone de alerta com texto "Peças chegam após a data prevista".
    - Garantir que a `data_chegada` exibida no card seja sempre a versão mais recente vinda da API.
    - Implementar um novo diálogo ou expandir o comportamento do clique no card de previsão para mostrar os detalhes do orçamento e peças faltantes (similar ao card de chegada).

- **src/components/financeiro/AgendarTarefaDialog.tsx**:
    - Adicionar um aviso visual dentro do diálogo caso o usuário tente salvar uma previsão para uma data anterior à `data_minima` ou `data_chegada`.

### Backend (Edge Functions)

- **supabase/functions/compras-chegadas/index.ts**:
    - Verificar se o cálculo da `proxima_reposicao` e `data_chegada` está considerando as atualizações mais recentes dos pedidos de compra no GestãoClick.

## Detalhes Técnicos

- Utilizar a função utilitária `getChegadaStatus` e `formatDiaBR` para padronização.
- O alerta de data será baseado em comparação simples de strings ISO (`YYYY-MM-DD`).
- Para os detalhes no card, reutilizaremos os componentes de renderização de peças faltantes já existentes no `AgendamentoPage.tsx`.

## Verificação

- [ ] Simular um orçamento com peças previstas para o dia 25/08 e execução prevista para 20/08 -> Deve ficar vermelho.
- [ ] Validar que ao clicar na previsão, os detalhes do orçamento (peças, valores, PC) aparecem corretamente.
- [ ] Confirmar que a atualização manual (`handleAtualizar`) reflete mudanças de datas vindas do ERP.
