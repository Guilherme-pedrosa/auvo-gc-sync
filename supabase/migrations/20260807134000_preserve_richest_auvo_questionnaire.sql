create or replace function public.preserve_richest_auvo_questionnaire()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_answer_count integer := 0;
  new_answer_count integer := 0;
begin
  if jsonb_typeof(old.questionario_respostas) = 'array' then
    select coalesce(sum(
      case
        when jsonb_typeof(item -> 'answers') = 'array' then jsonb_array_length(item -> 'answers')
        else 1
      end
    ), 0)::integer
    into old_answer_count
    from jsonb_array_elements(old.questionario_respostas) item;
  end if;

  if jsonb_typeof(new.questionario_respostas) = 'array' then
    select coalesce(sum(
      case
        when jsonb_typeof(item -> 'answers') = 'array' then jsonb_array_length(item -> 'answers')
        else 1
      end
    ), 0)::integer
    into new_answer_count
    from jsonb_array_elements(new.questionario_respostas) item;
  end if;

  if old_answer_count > new_answer_count then
    new.questionario_respostas := old.questionario_respostas;
    new.questionario_preenchido := old.questionario_preenchido;
    new.questionario_id := coalesce(old.questionario_id, new.questionario_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_richest_auvo_questionnaire on public.tarefas_central;

create trigger trg_preserve_richest_auvo_questionnaire
before update of questionario_respostas, questionario_preenchido, questionario_id
on public.tarefas_central
for each row
execute function public.preserve_richest_auvo_questionnaire();
