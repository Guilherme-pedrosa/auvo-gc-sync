---
name: WD não é Grupo IZ
description: WD COMÉRCIO nunca pertence ao Grupo IZ. Em filtros de grupo, exibir o nome do cliente que casou com o grupo (não o lado oposto).
type: constraint
---
"WD COMÉRCIO" / "WD COMERCIO E IMPORTACAO LTDA" **NÃO** é membro do Grupo IZ.

Membros reais do Grupo IZ: 1929 TRATTORIA MODERNA, Alata - Rede IZ, ENTTRES COCINA DE MEZCLA, FAMU RESTAURANTE, FULLES KITCHEN LTDA, GRA BISTRO, IZ RESTAURANTE.

**Bug recorrente**: tarefas com `cliente="WD COMÉRCIO"` (Auvo) e `gc_os_cliente="1929 TRATTORIA MODERNA"` (GC) — ou vice-versa — passavam pelo filtro de grupo (porque o lado GC casa) mas eram exibidas com o nome Auvo "WD COMÉRCIO" no Resumo por Cliente, dando a falsa impressão de que WD pertence ao grupo.

**Why**: o agrupamento usava `t.cliente || t.gc_os_cliente` cego, ignorando qual dos dois lados realmente pertencia ao grupo filtrado.

**How to apply**: Quando há filtro de grupo ativo, sempre exibir como nome de cliente o lado (Auvo ou GC) que estritamente casa com um membro do grupo. Implementado em `HorasTrabalhadasTab.tsx` via `resolveDisplayCliente()`.
