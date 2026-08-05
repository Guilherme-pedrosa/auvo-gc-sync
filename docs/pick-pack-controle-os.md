# Integração Controle OS → Pick & Pack

A função `pick-pack-controle-os` expõe a mesma base consolidada usada pelo Controle OS (`tarefas_central`) para o Pick & Pack.

## Segurança

Configure o mesmo valor aleatório nos dois projetos:

- Sync GC: `PICK_PACK_INTEGRATION_KEY`
- Pick & Pack: `SYNCGC_INTEGRATION_KEY`

No Pick & Pack, configure também:

- `SYNCGC_CONTROL_OS_URL=https://bysljmkwkxrkovsaodxv.supabase.co/functions/v1/pick-pack-controle-os`

O segredo nunca é enviado ao navegador. O navegador chama uma função intermediária do Pick & Pack, que faz a comunicação servidor a servidor.

## Contrato atual

A resposta contém:

- OS abertas conforme a mesma whitelist do Controle OS;
- vínculos exatos de Tarefa OS (`73343`) e Tarefa Execução (`73344`);
- técnico, data e status da tarefa de execução;
- tarefas do período que ainda não possuem OS vinculada;
- metadados de origem e atualização.

O contrato pode ser ampliado futuramente para o encontro de contas entre orçamento, pedido de compra, previsão de chegada e previsão de execução sem trocar a identidade das OS.
