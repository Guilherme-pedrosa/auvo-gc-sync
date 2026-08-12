# Auditoria read-only — auvo-task-update / create-task

## Resultado da coleta de logs

A consulta de logs da Edge Function `auvo-task-update` (sem filtro e com filtro `create-task`) retornou **nenhum registro** na janela de retenção disponível agora. Portanto **não é possível apresentar horário, reqId, status, mensagem RAW do Auvo nem payload de invocações recentes** — não há dados a exibir. Nada foi alterado: sem deploy, sem commit, sem POST de teste ao Auvo.

Apenas `central-sync` e `followup-kanban` aparecem com eventos recentes (só "shutdown"), indicando janela de log curta e nenhuma invocação de `auvo-task-update` dentro dela.

## Comparação: a correção do payload 400 atingiu `create-task`?

Comparando os dois blocos em `supabase/functions/auvo-task-update/index.ts`:

| Item | `create-preventive-task` (~1179-1360) | `create-task` (~1459-1610) |
|---|---|---|
| `checkinType` no payload | Sim, fixo `1` (l. 1250) | Sim, `Number(checkinType) \|\| 1` (l. 1524) |
| `orientation` truncada em 500 | Sim (l. 1251) | Sim (l. 1525) |
| Retentativa em HTTP 400 sem `questionnaireId`/`equipmentsId` | **Sim** (l. 1281-1289) | **Não existe** |
| Log do corpo RAW do erro | RAW completo (l. 1303) | Truncado em 800 chars (l. 1568) |
| Log do payload enviado | Não | Não (volta na resposta, mas não vai ao log) |

Conclusão: a correção chegou **parcialmente** ao `create-task`. As duas partes de contrato (`checkinType` e limite de 500 no `orientation`) estão nos dois caminhos, mas o **fallback de retentativa em 400 sem os campos opcionais existe apenas no `create-preventive-task`**. Se o 400 vier de questionário/equipamento incompatível, `create-task` falha direto.

## Observações adicionais (somente diagnóstico)

- `create-task` chama `ensureTaskTypeDuration`, que pode criar variante de tipo `[WEDO:...]`; um 500 nessa etapa é do endpoint de tipos, não do POST /tasks, e cai no tipo base.
- `create-task` segue adiante mesmo quando `GET /customers/{id}` falha (l. 1490-1492), enviando `address: "Endereço não informado"` e `latitude/longitude: 0` — candidato plausível a 400 do Auvo.
- `taskDate` é enviado como string local sem timezone (`YYYY-MM-DDTHH:mm:00`) nos dois caminhos.

## Próximo passo sugerido (nada feito ainda)

1. Reproduzir uma criação real pela tela para gerar logs novos e reler os logs dentro da janela de retenção — assim capturamos horário, reqId, status e a mensagem RAW verdadeira.
2. Depois (mudança de código, só com sua aprovação): logar em `create-task` o payload sanitizado e a resposta RAW completa, e portar para ele o mesmo fallback de 400 sem campos opcionais já existente na preventiva.