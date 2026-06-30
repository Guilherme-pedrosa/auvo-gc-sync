DROP TRIGGER IF EXISTS trg_tipos_equipamento_updated ON public.tipos_equipamento;
CREATE TRIGGER trg_tipos_equipamento_updated
BEFORE UPDATE ON public.tipos_equipamento
FOR EACH ROW EXECUTE FUNCTION public.set_plano_preventivo_item_updated_at();