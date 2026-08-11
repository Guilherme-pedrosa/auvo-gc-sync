# Manter histórico de dias sem atrapalhar a navegação

Hoje a escala é gerada a partir do dia atual (90 dias para frente), então os dias já passados simplesmente somem da tela.

## O que muda

- A escala passa a carregar também os dias anteriores (últimos 30 dias, além dos 90 futuros).
- A ordem das colunas continua começando no **dia de hoje**, seguido dos dias futuros — ninguém precisa rolar para achar o dia atual.
- Os dias passados ficam **atrás do dia atual**, ou seja, aparecem depois do bloco futuro, em uma seção "Dias anteriores" recolhida por padrão, com um botão para expandir.
- Ao expandir, as colunas históricas são exibidas em ordem decrescente (mais recente primeiro) e visualmente atenuadas, apenas para consulta.
- Edição/arrasto continuam funcionando nos dias futuros; nas colunas históricas o conteúdo fica somente leitura para evitar alterar registros passados.

## Detalhes técnicos

- `src/pages/operacional/AgendamentoEquipePage.tsx`
  - `dias` passa a ser montado como `diasFuturos` (hoje + 89) e `diasPassados` (30 dias anteriores, ordem decrescente).
  - Novo estado `mostrarPassados` controla a renderização das colunas históricas; a lista efetiva de colunas é `[...diasFuturos, ...(mostrarPassados ? diasPassados : [])]`.
  - `useAgendaSemana` recebe a união completa dos dias (passados + futuros) para que o histórico esteja disponível sem refetch ao expandir.
  - `colSpan` dos estados vazios e o cabeçalho são derivados da lista efetiva de colunas.
  - Célula em dia passado: renderiza o valor sem handlers de clique/drop.
- Sincronizações continuam usando apenas o intervalo futuro (`startDate`/`endDate` do bloco futuro), evitando reprocessar o passado a cada sync.
