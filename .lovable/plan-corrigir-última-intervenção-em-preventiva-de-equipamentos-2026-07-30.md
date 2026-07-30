# Corrigir "Última intervenção" em Preventiva de Equipamentos

## O que foi verificado no banco

Equipamento `#CHAPA TRAMONTINA 1 BOTÃO` (Auvo 6022164, NIP NAPOLI - REDE IZ):

- A tarefa **77297232** (Visita Preventiva Contrato, Finalizada, 23/07/2026) **existe** na tabela de vínculos, mas foi gravada só hoje às **19:31** (sincronização manual). Antes disso a tarefa mais recente era 27/06/2026 — por isso a tela mostrava 27/06.
- A linha do consolidado desse equipamento está com `atualizado_em` **06:05 de hoje**, `ultima_preventiva = null`, `status = nunca`, `total_tarefas = 0`. Ou seja: mesmo agora, com o vínculo já no banco, a coluna de preventiva/próxima continua desatualizada até alguém clicar em "Recalcular consolidado".

## Causa raiz (duas falhas encadeadas)

1. **A rotina diária não captura preventivas recentes.** O cron `equipamentos-preventivos-daily` (07:40) chama `equipment-sync` com `phase: "all"` e janela de 60 dias, **sem** o filtro por tipos preventivos e sem o modo de janelas em lote que a tela usa. Esse caminho baixa a base inteira do período e é o que estoura/entrega parcial, deixando tarefas como a de 23/07 fora do banco por dias. O botão "Sincronizar" da tela usa outro caminho (`phase: "2-batch"` + `preventiveTaskTypes` + janela de 18 meses) e trouxe a tarefa na hora.
2. **O consolidado roda antes e nunca depois do sync.** A consolidação acontece de madrugada e o sync de tarefas às 07:40; nada dispara `preventiva-consolidar` após a ingestão. Resultado: a coluna "última preventiva / próxima preventiva" fica sempre um ciclo atrás dos vínculos.

## Correção proposta

1. **Alinhar o cron diário ao caminho que funciona**: substituir a chamada `phase: "all"` por
   - `phase: "1"` (catálogo/marcas) e
   - `phase: "2-batch"` com `preventiveTaskTypes` (lidos de `tipos_tarefa_preventiva`), `finalizedOnly: true` e janela deslizante (hoje − 18 meses → hoje), igual ao botão da tela.
2. **Encadear a consolidação**: após o `2-batch`, o `equipment-sync` chama `preventiva-consolidar` (ou um segundo cron alguns minutos depois do sync). Assim "última preventiva", "próxima" e status ficam corretos sem clique manual.
3. **Reprocessar agora** a janela dos últimos 18 meses e rodar a consolidação uma vez, para corrigir o caso NIP NAPOLI e todos os equipamentos com o mesmo atraso.
4. **Fallback na tela** (proteção): quando o consolidado estiver mais antigo que o vínculo mais recente do equipamento, calcular última preventiva a partir de `equipamento_tarefas_auvo` em vez de mostrar "Sem registro". Isso evita que qualquer atraso futuro de cron volte a exibir dado errado.

## Detalhes técnicos

- Arquivos: `supabase/functions/equipment-sync/index.ts` (encadear consolidar ao fim do `2-batch`), nova migração com `cron.unschedule('equipamentos-preventivos-daily')` + `cron.schedule` no formato novo, `src/pages/financeiro/EquipamentosPreventivosPage.tsx` (fallback quando `consolidado.atualizado_em` < vínculo mais recente).
- Nenhuma alteração de schema; nenhum dado de tarefa é apagado (upsert por `auvo_equipment_id + auvo_task_id`).
- Validação: reconsultar o equipamento 6022164 e confirmar `ultima_preventiva = 2026-07-23`, tarefa 77297232, e a tela exibindo 23/07/2026.
