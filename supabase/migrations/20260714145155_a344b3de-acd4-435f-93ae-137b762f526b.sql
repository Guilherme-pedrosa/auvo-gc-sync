alter table public.tarefas_central
  add column if not exists gc_orc_valor_produtos numeric default null,
  add column if not exists gc_orc_valor_servicos numeric default null;

comment on column public.tarefas_central.gc_orc_valor_produtos is 'Valor de produtos do orçamento GestãoClick';
comment on column public.tarefas_central.gc_orc_valor_servicos is 'Valor de serviços do orçamento GestãoClick';