-- Configuración y confirmación de hipotecas por usuario
-- Ejecutar en Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.user_mortgage_settings (
    user_id UUID PRIMARY KEY,
    principal NUMERIC(14,2) NOT NULL DEFAULT 0,
    annual_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
    term_years INTEGER NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_mortgage_receipts (
    user_id UUID NOT NULL,
    transaction_id BIGINT NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    included_in_calculation BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, transaction_id)
);

ALTER TABLE public.user_mortgage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mortgage_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_mortgage_settings_select_own" ON public.user_mortgage_settings;
CREATE POLICY "user_mortgage_settings_select_own"
    ON public.user_mortgage_settings
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_mortgage_settings_upsert_own" ON public.user_mortgage_settings;
CREATE POLICY "user_mortgage_settings_upsert_own"
    ON public.user_mortgage_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_mortgage_settings_update_own" ON public.user_mortgage_settings;
CREATE POLICY "user_mortgage_settings_update_own"
    ON public.user_mortgage_settings
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_mortgage_receipts_select_own" ON public.user_mortgage_receipts;
CREATE POLICY "user_mortgage_receipts_select_own"
    ON public.user_mortgage_receipts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_mortgage_receipts_insert_own" ON public.user_mortgage_receipts;
CREATE POLICY "user_mortgage_receipts_insert_own"
    ON public.user_mortgage_receipts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_mortgage_receipts_update_own" ON public.user_mortgage_receipts;
CREATE POLICY "user_mortgage_receipts_update_own"
    ON public.user_mortgage_receipts
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

