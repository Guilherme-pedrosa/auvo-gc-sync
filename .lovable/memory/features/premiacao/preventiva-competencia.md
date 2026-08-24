---
name: Premiação preventiva — mês de competência
description: Preventiva de contrato entra no mês da EXECUÇÃO (data_conclusao), não no mês agendado
type: feature
---
Na função `premiacao`, as visitas preventivas de contrato (task types Auvo
180176 e 180175) são atribuídas ao mês pela **data de conclusão/execução**
(`data_conclusao`), com fallback para `data_tarefa` quando não houver conclusão.

A query busca uma janela ampliada (±60 dias do mês) por `data_tarefa` e depois
filtra pela data efetiva. Assim uma tarefa agendada em 29/07 mas executada em
10/08 é paga em agosto, nunca em julho.
