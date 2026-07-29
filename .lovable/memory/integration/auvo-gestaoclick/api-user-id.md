---
name: GC API usuario_id obrigatório
description: Toda requisição à API do GestãoClick deve levar usuario_id do usuário da API (1320473)
type: constraint
---
Toda e qualquer chamada a `api.gestaoclick.com` (GET, POST, PUT, DELETE) deve incluir o parâmetro de query `usuario_id` do usuário da API GC (padrão `1320473`, override via env `GC_API_USER_ID`). Sem isso o GC atribui/rejeita a ação no usuário errado.

Implementação: `supabase/functions/_shared/gc-user.ts` exporta `installGcUsuarioId()`, que intercepta o `fetch` global e injeta `usuario_id` em todas as URLs do host do GC. Toda edge function que fala com o GC deve chamar `installGcUsuarioId()` no topo do arquivo.

Não confundir com `usuario_id` dentro do payload (PUT/POST), que representa o autor da ação (perfil Supabase) — esse continua sendo mapeado separadamente.
