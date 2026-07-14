alter table public.tarefas_central
  add column if not exists gc_orc_tipo text default null;

comment on column public.tarefas_central.gc_orc_tipo is 'Tipo do orçamento GC: produto ou servico';