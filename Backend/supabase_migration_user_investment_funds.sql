-- Fondos/ETF que cada usuario sigue en Inversión (ISIN)
-- Ejecutar en Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.user_investment_funds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    isin TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_investment_funds_isin_upper CHECK (isin ~ '^[A-Z0-9]{12}$'),
    CONSTRAINT user_investment_funds_user_isin UNIQUE (user_id, isin)
);

CREATE INDEX IF NOT EXISTS idx_user_investment_funds_user_sort
    ON public.user_investment_funds (user_id, sort_order ASC, created_at ASC);

COMMENT ON TABLE public.user_investment_funds IS 'Lista de ISIN que el usuario vigila en el módulo Inversión';

ALTER TABLE public.user_investment_funds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_investment_funds_select_own" ON public.user_investment_funds;
CREATE POLICY "user_investment_funds_select_own"
    ON public.user_investment_funds
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_investment_funds_insert_own" ON public.user_investment_funds;
CREATE POLICY "user_investment_funds_insert_own"
    ON public.user_investment_funds
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_investment_funds_delete_own" ON public.user_investment_funds;
CREATE POLICY "user_investment_funds_delete_own"
    ON public.user_investment_funds
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
