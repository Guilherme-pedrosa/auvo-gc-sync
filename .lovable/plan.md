# Plano de Implementação: Log de Previsões e Layout do Rodapé

Implementar o rastreamento de quem criou/alterou as previsões de agendamento e exibir um log expansível no rodapé da página de "Chegada Orçamentos".

## Alterações Funcionais

### 1. Backend & Data (Supabase)
- Utilizar a coluna `criado_por` (UUID) e `atualizado_em` da tabela `agenda_agendamentos` que já existem.
- Nota: O campo `criado_por` é preenchido automaticamente pela política de RLS do banco (auth.uid()) ou manualmente no insert.

### 2. Componente: AgendarTarefaDialog.tsx
- Atualizar a função `handleSaveForecast` para garantir que o `criado_por` seja enviado no `Insert` caso não seja automático no banco (usando o ID do usuário logado).
- Adicionar uma consulta rápida para pegar o `auth.uid()` antes de salvar.

### 3. Página: AgendamentoPage.tsx
- **Interface de Log**: Criar um componente de rodapé fixo.
- **Linha Recolhida**: Uma barra discreta com "Log de Previsões" e ícone de expansão.
- **Conteúdo Expandido**: Lista mostrando:
  - Horário da ação.
  - Nome do usuário (via join com profiles ou e-mail/ID).
  - Documento (Orçamento/OS) e técnico escalado.
- **Busca de Logs**: Novo `useQuery` para buscar os últimos agendamentos atualizados.

## Detalhes Técnicos
- Rodapé: `fixed bottom-0 left-0 right-0` com `z-index` apropriado.
- Join `criado_por` com `rh_colaboradores` ou `profiles` se disponível.
- Se o banco não tiver o nome do usuário administrativo, usaremos o ID truncado.

## Próximos Passos
1. Modificar `AgendarTarefaDialog.tsx` para garantir o log de autoria.
2. Criar o componente de log expansível em `AgendamentoPage.tsx`.
