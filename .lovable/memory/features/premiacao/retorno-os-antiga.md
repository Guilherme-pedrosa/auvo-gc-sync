---
name: Retorno OS Antiga (clawback)
description: Lançamento de retorno em OS de mês anterior aplica desconto no mês vigente para o técnico original
type: feature
---
Quando o usuário lança um retorno via "Retorno OS antiga" na Premiação:
- Edge function `os-retorno-preview` busca a OS via GC v2 (`?codigo=`) → detalhe `/api/ordens_servicos/{id}` e calcula comissão simplificada (1% peças + 15% serviços, exceto deslocamento/hospedagem).
- Salva em `os_retornos` os campos snapshot: `mes_desconto`, `tecnico_original`, `valor_desconto`, `data_saida_original`, `cliente_original`.
- Edge `premiacao` separa retornos por presença de `mes_desconto`:
  - SEM `mes_desconto` → comportamento legado (reatribui premiação ao `tecnico_retorno`).
  - COM `mes_desconto = month` → clawback: desconta `valor_desconto` do técnico ORIGINAL (matching por primeiro nome normalizado) como `reducoes` entry e subtrai do `comissao_final`. Se o técnico não tem OS no mês, cria entrada apenas para exibir o desconto.
- Conflito por `gc_os_codigo`: o upsert sobrescreve lançamentos anteriores para a mesma OS.