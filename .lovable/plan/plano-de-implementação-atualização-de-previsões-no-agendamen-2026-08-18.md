# Plano de Implementação: Atualização de Previsões no Agendamento

Este plano descreve as alterações necessárias para que, ao arrastar uma previsão no Agendamento de Equipe, o sistema altere o registro existente (responsável e/ou data) em vez de criar um novo.

## Alterações Técnicas

### 1. Frontend: Escala de Técnicos (90 Dias)
- Modificar o manipulador de `onDrop` (`handleDragDrop`) em `src/pages/operacional/AgendamentoEquipePage.tsx`.
- Detectar se o item arrastado é uma previsão (`status === 'PREVISAO'`).
- Em vez de apenas salvar as novas coordenadas, garantir que a mutação de salvamento utilize o `id` do agendamento existente para realizar um `UPDATE` no banco de dados.
- Garantir que a lógica de "mudar o planejamento" seja respeitada, atualizando os campos `data`, `colaborador_id` e `colaborador_nome` do registro original.

### 2. Hooks: Salvamento de Agendamento
- Revisar `useSaveAgendamento` em `src/hooks/operacional/useAgendamentoEquipe.ts` para confirmar que a lógica de `upsert` (baseada na presença do `id`) está funcionando corretamente para previsões.

### 3. Diálogos de Edição
- Verificar se `AgendamentoEquipeDialog.tsx` permite a alteração de responsável e data para previsões de forma consistente com o comportamento de "arrastar e soltar".

## Segurança e RLS
- Nenhuma alteração de RLS é necessária, pois a tabela `agenda_agendamentos` já permite `UPDATE` para usuários autenticados/admins.

## Validação
- Arrastar uma previsão entre técnicos e datas diferentes na grade e verificar se o card se move (atualiza) em vez de duplicar.
- Verificar no banco de dados se o `id` do registro permanece o mesmo após o movimento.
