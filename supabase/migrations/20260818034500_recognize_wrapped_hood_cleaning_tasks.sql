-- Tarefas auxiliares criadas pela agenda carregam o tipo Auvo original no
-- marcador [WEDO:<tipo>:<minutos>]. O tipo 180795 continua sendo limpeza de
-- coifa mesmo quando o task_type_id do wrapper e outro.
CREATE OR REPLACE FUNCTION public.atividade_e_limpeza_coifa(
  p_task_type_id text,
  p_descricao text,
  p_questionario_id text,
  p_questionario_respostas jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    regexp_replace(COALESCE(p_questionario_id, ''), '\D', '', 'g') = '215148'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_questionario_respostas) = 'array'
          THEN p_questionario_respostas ELSE '[]'::jsonb END
      ) resposta
      WHERE regexp_replace(COALESCE(resposta->>'questionnaireId', ''), '\D', '', 'g') = '215148'
    )
    OR
    regexp_replace(COALESCE(p_task_type_id, ''), '\D', '', 'g') = '180795'
    OR COALESCE(p_descricao, '') ~* '\[WEDO:180795:'
    OR public.normalizar_cliente_visita(p_descricao) LIKE '%higienizacao-de-coifa%'
    OR public.normalizar_cliente_visita(p_descricao) LIKE '%higieniza%ao-de-coifa%'
    OR public.normalizar_cliente_visita(p_descricao) LIKE '%limpeza-de-coifa%';
$$;

CREATE OR REPLACE FUNCTION public.atividade_e_limpeza_coifa(
  p_task_type_id text,
  p_descricao text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT public.atividade_e_limpeza_coifa(
    p_task_type_id, p_descricao, NULL, NULL
  );
$$;

REVOKE ALL ON FUNCTION public.atividade_e_limpeza_coifa(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atividade_e_limpeza_coifa(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atividade_e_limpeza_coifa(text, text, text, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atividade_e_limpeza_coifa(text, text)
  TO authenticated, service_role;
