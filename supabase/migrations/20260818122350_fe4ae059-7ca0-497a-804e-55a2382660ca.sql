-- Create table for contract types
CREATE TABLE public.contrato_tipos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL UNIQUE,
    criado_em timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Add column to contratos table
ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS tipo_id uuid REFERENCES public.contrato_tipos(id) ON DELETE SET NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contrato_tipos TO authenticated;
GRANT ALL ON public.contrato_tipos TO service_role;

-- RLS
ALTER TABLE public.contrato_tipos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_contrato_tipos" ON public.contrato_tipos
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_manage_contrato_tipos" ON public.contrato_tipos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Initial data
INSERT INTO public.contrato_tipos (nome) VALUES 
('Higienização de coifas'),
('Manutenção Preventiva')
ON CONFLICT (nome) DO NOTHING;
