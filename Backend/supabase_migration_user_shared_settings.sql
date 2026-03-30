-- Preferencias por usuario para la pestaña de Compartidos
-- Ejecutar en Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.user_shared_settings (
    user_id UUID PRIMARY KEY,
    shared_balances_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_shared_settings
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_shared_settings_select_own" ON public.user_shared_settings;
CREATE POLICY "user_shared_settings_select_own"
    ON public.user_shared_settings
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_shared_settings_upsert_own" ON public.user_shared_settings;
CREATE POLICY "user_shared_settings_upsert_own"
    ON public.user_shared_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_shared_settings_update_own" ON public.user_shared_settings;
CREATE POLICY "user_shared_settings_update_own"
    ON public.user_shared_settings
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
