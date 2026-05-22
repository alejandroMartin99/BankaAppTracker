-- Patrones de pago recurrente ocultados por el usuario (falsos positivos).
-- Ejecutar en Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.user_recurring_payment_dismissed (
    user_id UUID NOT NULL,
    pattern_key TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_user_recurring_payment_dismissed_user
    ON public.user_recurring_payment_dismissed (user_id);

ALTER TABLE public.user_recurring_payment_dismissed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_recurring_payment_dismissed_select_own" ON public.user_recurring_payment_dismissed;
CREATE POLICY "user_recurring_payment_dismissed_select_own"
    ON public.user_recurring_payment_dismissed
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_recurring_payment_dismissed_insert_own" ON public.user_recurring_payment_dismissed;
CREATE POLICY "user_recurring_payment_dismissed_insert_own"
    ON public.user_recurring_payment_dismissed
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_recurring_payment_dismissed_update_own" ON public.user_recurring_payment_dismissed;
CREATE POLICY "user_recurring_payment_dismissed_update_own"
    ON public.user_recurring_payment_dismissed
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
