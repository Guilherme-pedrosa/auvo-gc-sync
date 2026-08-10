create table if not exists public.auvo_clientes_cache (
    id uuid primary key default gen_random_uuid(),
    auvo_id bigint unique not null,
    nome text not null,
    ativo boolean default true,
    endereco text,
    cidade text,
    estado text,
    bairro text,
    cep text,
    atualizado_em timestamptz default now()
);

grant select, insert, update, delete on public.auvo_clientes_cache to authenticated;
grant all on public.auvo_clientes_cache to service_role;

alter table public.auvo_clientes_cache enable row level security;

create policy "Authenticated users can select auvo_clientes_cache"
on public.auvo_clientes_cache
for select
to authenticated
using (true);
