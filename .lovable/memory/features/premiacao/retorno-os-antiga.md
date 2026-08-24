---
name: Retorno OS Antiga (clawback)
description: Lançamento de retorno em OS de mês anterior desconta do técnico que RECEBEU a premiação (tarefa execução), nunca do técnico que atendeu o retorno
type: feature
---
Quando o usuário lança um retorno via "Retorno OS antiga" na Premiação:
- Edge `os-retorno-preview` busca a OS via GC v2 (`?codigo=`) → detalhe `/api/ordens_servicos/{id}` e calcula comissão simplificada (1% peças + 15% serviços, exceto deslocamento/hospedagem).
- **Técnico descontado = quem recebeu a premiação da OS**: resolvido em `tarefas_central` pelo técnico da TAREFA EXECUÇÃO (attr 73344); fallback tarefa OS; último recurso `nome_vendedor` do GC. Retorna `tecnico_original`, `tecnico_vendedor_gc` e `tecnico_fonte`.
- O campo é editável no diálogo ("Técnico descontado (recebeu a premiação)"), separado do "Técnico do retorno (foi atender)" — o técnico do retorno NUNCA é descontado.
- Salva em `os_retornos`: `mes_desconto`, `tecnico_original` (descontado), `valor_desconto`, `data_saida_original`, `cliente_original`.
- Edge `premiacao`: com `mes_desconto = month` → clawback no técnico `tecnico_original` (match por primeiro nome normalizado), como entrada em `reducoes` e subtração do `comissao_final`. Sem `mes_desconto` → legado (reatribui premiação ao `tecnico_retorno`).
- Conflito por `gc_os_codigo`: upsert sobrescreve lançamento anterior da mesma OS.
