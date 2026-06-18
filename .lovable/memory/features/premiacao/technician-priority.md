---
name: Premiação technician priority (TAREFA EXECUÇÃO)
description: Prioridade de resolução do técnico na premiação — 73344 (execução) é a fonte da verdade
type: feature
---
Na função `premiacao`, o técnico de cada OS é resolvido nesta ordem:

1. **Retorno manual** (`os_retornos.tecnico_retorno`) — override explícito.
2. **Técnico da TAREFA EXECUÇÃO (73344)** — fonte da verdade. Quem executou
   é quem ganha a premiação. A TAREFA OS (73343) é IRRELEVANTE para premiação.
3. **Vendedor do GC** (`detail.nome_vendedor`) — fallback quando a execução
   não tem técnico.
4. **"Sem vendedor"** — bucket de revisão manual.

O técnico de execução vem do mapa `tecnicoByExecTask`, populado a partir das
linhas em `tarefas_central` cujo `auvo_task_id` casa com os IDs em
`gc_os_tarefa_exec` da OS GC.

A flag `divergente_execucao` permanece para alertar visualmente quando o
vendedor do GC difere do técnico de execução, mas a premiação SEMPRE vai pro
técnico de execução (não pro vendedor).