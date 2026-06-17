---
name: Portal/Admin parity de horas
description: Garante que portal e admin produzem totais idênticos de horas/faturamento por grupo
type: feature
---
O Portal do Cliente (`PortalHorasPage`) e o relatório admin (`HorasTrabalhadasTab`) DEVEM produzir totais idênticos para o mesmo grupo/período.

Regras obrigatórias:
1. `normalizeClient` no portal deve ser BYTE-A-BYTE igual a `normalizeName` em `HorasTrabalhadasTab.tsx` (sem `.normalize("NFD")`/strip de acentos — admin não tira acento).
2. NÃO pré-filtrar tarefas por grupo antes de passar para `HorasTrabalhadasTab`. Use a prop `forcedGrupoId` para o filtro de grupo ser aplicado DENTRO do tab, APÓS a deduplicação por `auvo_task_id`. Pré-filtrar quebra a dedup quando uma mesma OS tem versões com nomes de cliente diferentes (re-sync) — admin descarta a versão antiga, portal a mantém, e os totais divergem.
3. `clientMode=true` força `status="faturavel"` para alertas locais, mas mantém "rejeitada" se houver `revisao.status_revisao === "rejeitada"` (preserva paridade com o admin que conta "em_revisao" no total faturável também).