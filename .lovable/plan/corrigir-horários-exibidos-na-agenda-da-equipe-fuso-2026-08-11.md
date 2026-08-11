# Corrigir horários exibidos na Agenda da Equipe (fuso)

## O problema confirmado
As tarefas 78208834 / 78220203 / 78221039 estão gravadas em `tarefas_central` com:

```text
check_in_iso = 2026-08-10 20:34:49+00
hora_inicio  = 20:34:49
```

O Auvo devolve o horário **já no relógio do Brasil** (20:34), mas o valor é salvo marcado como `+00` (UTC). O campo `hora_inicio` usa o relógio bruto e fica certo; já o card do quadro converte o timestamp para o fuso do navegador e subtrai 3 horas, mostrando 17:34. Daí a divergência da imagem (17:34 → 17:37) contra o horário real (20:34 → 20:37).

## O que será feito

1. **Exibição do relógio (correção principal)**
   - `formatWorkedClock` em `src/lib/agendaWorkedTime.ts` passa a formatar com `timeZone: "UTC"`, ou seja, mostra exatamente o relógio que o Auvo enviou, sem deslocamento.
   - Mesma regra aplicada nos demais pontos que mostram check-in/check-out da agenda (card do quadro e diálogo de detalhe da tarefa).

2. **Duração não muda**
   - O total trabalhado continua vindo de `duracao_decimal` (duração oficial do Auvo) ou da diferença check-in → check-out; como ambos têm o mesmo deslocamento, os minutos já estavam corretos (4h20, 18min, 3min permanecem).

3. **Testes**
   - Estender `src/test/agenda-worked-time.test.ts` com um caso `2026-08-10T20:34:49+00` → deve exibir `20:34`, garantindo independência do fuso da máquina.

## Detalhes técnicos
- Alteração somente de apresentação; nada é reescrito no banco e nenhuma sincronização é reprocessada, evitando risco em dados históricos.
- Não será usada conversão para `America/Sao_Paulo`, pois os timestamps não são UTC reais — aplicar o fuso brasileiro subtrairia 3h novamente.