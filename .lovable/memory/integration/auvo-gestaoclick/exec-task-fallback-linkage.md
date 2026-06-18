---
name: Exec task fallback linkage (73344)
description: Fallback to link GC OS to tarefas_central via TAREFA EXECUÇÃO (73344) when TAREFA OS (73343) is wrong/duplicated
type: feature
---
No `central-sync`, além do vínculo principal por TAREFA OS (73343), existe um
fallback de late linkage por TAREFA EXECUÇÃO (73344). Ele executa tanto no
fluxo completo quanto no `gc_status_only` (após `refreshGcOsFieldsForPeriod`).

Regras:
- Só preenche linhas locais onde `gc_os_id IS NULL` (não sobrescreve vínculos
  feitos via 73343).
- Itera sobre todas as OS GC retornadas no período e tenta `UPDATE` por
  `auvo_task_id = <exec_task_id>`.
- Motivo: para premiação o que importa é o 73344. Se 73343 estiver duplicado/
  errado (ex.: copiado de outra OS), a OS sumia da premiação. Este fallback
  recupera o vínculo automaticamente.
- Não cria shells novas — apenas casa OS GC com linhas Auvo já existentes.