# Plano de Implementação: Log de Previsões e Layout do Rodapé

Implementar o rastreamento de quem criou/alterou as previsões de agendamento e exibir um log expansível no rodapé da página de "Chegada Orçamentos", conforme solicitado.

## Alterações Funcionais

### 1. Backend & Data (Supabase)
- Utilizar a coluna `criado_por` (UUID) e `atualizado_em` da tabela `agenda_agendamentos` que já existem no esquema.
- Adicionar suporte à leitura do nome do criador/editor via junção com a tabela `profiles` ou `rh_colaboradores` se necessário, ou usar o `criado_por` para exibir o ID/Email se o nome não estiver disponível diretamente.
- *Nota*: Como o usuário pediu "quem criou", precisaremos garantir que o `auth.uid()` seja gravado no `Insert` do `AgendarTarefaDialog`.

### 2. Componente: AgendarTarefaDialog.tsx
- Atualizar a função `handleSaveForecast` para incluir o `criado_por` no payload de inserção (usando `supabase.auth.getUser()`).
- Garantir que o `atualizado_em` reflita a última mudança.

### 3. Página: AgendamentoPage.tsx
- **Interface de Log**: Criar um componente de rodapé fixo ou absoluto na base da página.
- **Linha Recolhida**: Uma barra discreta com um rótulo como "Log de Previsões" e um ícone de expansão (Chevron).
- **Conteúdo Expandido**: Uma lista (ScrollArea) mostrando:
  - Data/Hora da ação.
  - Nome do usuário que realizou a ação (ou e-mail/ID se o nome não estiver resolvido).
  - Identificador do documento (Orçamento/OS) e a data prevista definida.
  - Tipo de ação (Criação/Edição).
- **Busca de Logs**: Implementar uma consulta `useQuery` específica para buscar os últimos 50 registros de `agenda_agendamentos` ordenados por `atualizado_em` ou `criado_em`.

## Detalhes Técnicos
- O campo `criado_por` na `agenda_agendamentos` é um UUID que referencia a tabela `auth.users`. Para mostrar nomes legíveis, faremos um join com `profiles` (presumindo que exista e tenha o nome) ou exibiremos o ID truncado/email se preferível.
- O layout do rodapé usará Tailwind: `fixed bottom-0 left-0 right-0` (considerando a largura da sidebar) ou dentro da área de scroll principal com `sticky`.

## Próximos Passos
1. Validar se a tabela `profiles` existe para traduzir `criado_por` em nomes.
2. Criar a interface de log expansível.
3. Ajustar o diálogo de agendamento para persistir o autor.
