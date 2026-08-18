-- A contabilizacao contratual e determinada pelo questionario Auvo e pelo
-- tipo real do contrato. Nome/descricao/tipo de tarefa nao classificam coifa.
--
-- 215148: somente contratos do tipo "Higienizacao de coifas";
-- 224444: nunca contabiliza em contrato;
-- demais questionarios: somente contratos que nao sejam de coifa.

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
  SELECT CASE
    WHEN regexp_replace(COALESCE(p_questionario_id, ''), '\D', '', 'g') = '224444'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_questionario_respostas) = 'array'
            THEN p_questionario_respostas ELSE '[]'::jsonb END
        ) resposta
        WHERE regexp_replace(COALESCE(resposta->>'questionnaireId', ''), '\D', '', 'g') = '224444'
      )
      THEN NULL::boolean
    WHEN regexp_replace(COALESCE(p_questionario_id, ''), '\D', '', 'g') = '215148'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_questionario_respostas) = 'array'
            THEN p_questionario_respostas ELSE '[]'::jsonb END
        ) resposta
        WHERE regexp_replace(COALESCE(resposta->>'questionnaireId', ''), '\D', '', 'g') = '215148'
      )
      THEN true
    ELSE false
  END;
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

CREATE OR REPLACE FUNCTION public.contrato_e_limpeza_coifa(p_contrato_nome text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT lower(trim(tipo.nome)) = lower('Higienização de coifas')
    FROM public.contratos contrato
    LEFT JOIN public.contrato_tipos tipo ON tipo.id = contrato.tipo_id
    WHERE contrato.nome = p_contrato_nome
    ORDER BY contrato.ativo DESC, contrato.atualizado_em DESC NULLS LAST, contrato.id
    LIMIT 1
  ), false);
$$;

COMMENT ON FUNCTION public.atividade_e_limpeza_coifa(text, text, text, jsonb) IS
  'TRUE para questionario 215148, NULL para 224444 (excluido), FALSE para os demais.';
COMMENT ON FUNCTION public.contrato_e_limpeza_coifa(text) IS
  'Classifica pelo contrato_tipos ligado em contratos.tipo_id; o nome do contrato nao define o escopo.';

REVOKE ALL ON FUNCTION public.atividade_e_limpeza_coifa(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atividade_e_limpeza_coifa(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contrato_e_limpeza_coifa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atividade_e_limpeza_coifa(text, text, text, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atividade_e_limpeza_coifa(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contrato_e_limpeza_coifa(text)
  TO authenticated, service_role;

-- Saneamento unico dos contratos anteriores a existencia de tipo_id. A partir
-- daqui, toda classificacao em tempo de execucao usa exclusivamente tipo_id.
WITH tipos AS (
  SELECT
    (
      SELECT id
      FROM public.contrato_tipos
      WHERE lower(trim(nome)) = lower('Higienização de coifas')
      ORDER BY id
      LIMIT 1
    ) AS coifa_id,
    (
      SELECT id
      FROM public.contrato_tipos
      WHERE lower(trim(nome)) = lower('Manutenção Preventiva')
      ORDER BY id
      LIMIT 1
    ) AS manutencao_id
)
UPDATE public.contratos contrato
SET tipo_id = CASE
  WHEN public.normalizar_cliente_visita(contrato.nome) LIKE '%coifa%'
    THEN tipos.coifa_id
  ELSE tipos.manutencao_id
END,
atualizado_em = now()
FROM tipos
WHERE contrato.tipo_id IS NULL
  AND tipos.coifa_id IS NOT NULL
  AND tipos.manutencao_id IS NOT NULL;
