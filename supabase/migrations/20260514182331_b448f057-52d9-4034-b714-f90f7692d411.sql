UPDATE public.alertas_horas_config
SET detectar_overlap_tecnico = false,
    overlap_requer_revisao = false,
    atualizado_em = now();