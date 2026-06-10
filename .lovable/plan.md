## Problema

1. Cron `central-sync-hourly` chama com body `{}` (sync completo, ~3min) e a edge function morre por timeout. `net.http_post` não espera resposta, então o `cron.job_run_details` mente dizendo "succeeded".
2. OS criadas no GC que ainda não têm tarefa Auvo casada (atributo 73343 vazio ou tarefa não baixada) **não aparecem** no Controle OS, ficando invisíveis pra equipe.

## Solução

### 1. Cron leve e confiável
Trocar o cron `central-sync-hourly` (5 * * * *) para:
- Chamar `central-sync` com `reports_only: true` + período curto (últimos 7 dias até +30 dias).
- Esse modo é ~10x mais leve, completa em <30s, não dá timeout.
- Sync completo (6 meses) fica disponível só no botão manual da tela.

Adicionar **segundo cron** `central-sync-gc-status` (a cada 15 min):
- Chama `central-sync` com `gc_status_only: true` — varre só status do GC das OS abertas, completa em <15s.
- Garante que mudanças de situação no GC chegam no banco rápido.

### 2. OS órfã do GC vira card vermelho

**Backend (`central-sync`):** quando uma OS do GC não tem nenhuma tarefa Auvo casada (nem por 73343, nem por 73344), gravar um registro em `tarefas_central` com:
- `auvo_task_id` = `gc-orphan-{gc_os_id}` (chave sintética prefixada)
- `gc_os_*` preenchido normalmente
- `status_auvo` = `"Sem vínculo Auvo"`
- `tecnico` = vazio

Já existe a noção de "Pendente vínculo Auvo" (vi no caso da 9687) — vou estender pra cobrir todas as OS órfãs e padronizar o label.

**Frontend (`OSAbertasTab`):**
- Detectar cards com `status_auvo === "Sem vínculo Auvo"` ou `auvo_task_id` começando com `gc-orphan-`.
- Renderizar com borda/badge vermelho e tooltip explicando: "OS no GC sem tarefa Auvo vinculada — verifique atributo 73343 (TAREFA OS) ou 73344 (TAREFA EXECUÇÃO) na OS".
- Mostrar mesmo quando o filtro de técnico estiver ativo (já que técnico é vazio).

### 3. Sanity check no log
Adicionar no fim do `central-sync` um log explícito:
```
[central-sync] Concluído em Xs | OS GC total: N | órfãs (sem Auvo): M | Auvo tarefas: K
```
Pra ficar fácil monitorar se o cron tá realmente terminando.

## Arquivos

- `supabase/migrations/<novo>.sql` — recriar 2 crons (drop+schedule).
- `supabase/functions/central-sync/index.ts` — gravar OS órfãs como linhas sintéticas; log de resumo.
- `src/components/relatorios/OSAbertasTab.tsx` — estilo vermelho + tooltip pra órfãs.
- `src/pages/financeiro/RelatoriosPage.tsx` — incluir órfãs na lista (`gc_os_id NOT NULL` continua válido).

## Risco

- Linhas sintéticas com `auvo_task_id = gc-orphan-*` precisam ser limpas quando a OS finalmente ganha um vínculo Auvo real. Vou adicionar essa limpeza no próprio `central-sync` (se a OS órfã agora casou com tarefa Auvo, deleta a linha sintética antes do upsert da real).

Posso seguir?
