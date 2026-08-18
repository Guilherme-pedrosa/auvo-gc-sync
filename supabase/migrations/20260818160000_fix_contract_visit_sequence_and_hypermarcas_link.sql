-- Uma execução sempre ocupa a primeira visita contratada ainda não cumprida.
-- A proximidade de um card futuro não pode pular a 1ª visita e marcar a 2ª.
CREATE OR REPLACE FUNCTION public.normalizar_numero_nova_visita_contratual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primeiro_numero_livre integer;
BEGIN
  SELECT numero
  INTO v_primeiro_numero_livre
  FROM generate_series(
    1,
    GREATEST((
      SELECT cfg.qtd_visitas
      FROM public.contratos_visitas_config cfg
      WHERE cfg.id = NEW.contrato_visita_config_id
    ), 1)
  ) numero
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.contratos_visitas_execucoes execucao
    WHERE execucao.contrato_visita_config_id = NEW.contrato_visita_config_id
      AND execucao.competencia = NEW.competencia
      AND execucao.visita_numero = numero
  )
  ORDER BY numero
  LIMIT 1;

  IF v_primeiro_numero_livre IS NOT NULL
     AND NEW.visita_numero > v_primeiro_numero_livre THEN
    NEW.visita_numero := v_primeiro_numero_livre;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalizar_numero_nova_visita_contratual
  ON public.contratos_visitas_execucoes;
CREATE TRIGGER trg_normalizar_numero_nova_visita_contratual
  BEFORE INSERT
  ON public.contratos_visitas_execucoes
  FOR EACH ROW
  EXECUTE FUNCTION public.normalizar_numero_nova_visita_contratual();

REVOKE ALL ON FUNCTION public.normalizar_numero_nova_visita_contratual()
  FROM PUBLIC;

-- O contrato foi cadastrado com o apelido "hyper Marcas", enquanto a relação
-- oficial RH > Clientes liga o GC NEWPORT GOIANIA ao Auvo HYPER MARCAS. Mantém
-- o nome do contrato e corrige somente sua chave de cliente para o alias Auvo
-- já vinculado, sem aproximação por substring ou por grupo SODEXO.
UPDATE public.contratos contrato
SET cliente_nome = cliente.nome_auvo,
    atualizado_em = now()
FROM public.rh_clientes cliente
WHERE public.normalizar_cliente_visita(contrato.nome) = 'hyper-marcas'
  AND public.normalizar_cliente_visita(contrato.cliente_nome) = 'hyper-marcas'
  AND cliente.ativo = true
  AND lower(COALESCE(cliente.vinculo_status, '')) = 'vinculado'
  AND public.normalizar_cliente_visita(cliente.nome_auvo)
      = 'sodexo-do-brasil-comercial-s-a-hyper-marcas';

-- Reprocessa os dias deste mês da Hypermarcas. A execução real passa a ser a
-- 1ª visita e o próximo card permanece como 2ª visita planejada.
DO $$
DECLARE
  day_row record;
BEGIN
  FOR day_row IN
    SELECT DISTINCT tarefa.cliente, tarefa.data_tarefa
    FROM public.tarefas_central tarefa
    WHERE date_trunc('month', tarefa.data_tarefa)::date
          = date_trunc('month', current_date)::date
      AND public.cliente_rh_chave(tarefa.cliente) = public.cliente_rh_chave(
        'SODEXO DO BRASIL COMERCIAL S.A. HYPER MARCAS'
      )
    ORDER BY tarefa.data_tarefa, tarefa.cliente
  LOOP
    PERFORM public.reconciliar_dia_visita_contratual(
      day_row.cliente, day_row.data_tarefa
    );
    PERFORM public.reconciliar_dia_visita_contratual_agendada(
      day_row.cliente, day_row.data_tarefa
    );
  END LOOP;
END;
$$;

