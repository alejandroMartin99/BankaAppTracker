-- Compartición explícita de cuentas entre usuarios.
-- Ejecutar en Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.user_account_shares (
    owner_user_id UUID NOT NULL,
    viewer_user_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_user_id, viewer_user_id, account_id),
    CONSTRAINT chk_user_account_shares_not_self CHECK (owner_user_id <> viewer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_account_shares_viewer
    ON public.user_account_shares (viewer_user_id, can_view);

CREATE INDEX IF NOT EXISTS idx_user_account_shares_account
    ON public.user_account_shares (account_id);

ALTER TABLE public.user_account_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_account_shares_select_own_or_viewer" ON public.user_account_shares;
CREATE POLICY "user_account_shares_select_own_or_viewer"
    ON public.user_account_shares
    FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_user_id OR auth.uid() = viewer_user_id);

DROP POLICY IF EXISTS "user_account_shares_insert_owner" ON public.user_account_shares;
CREATE POLICY "user_account_shares_insert_owner"
    ON public.user_account_shares
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "user_account_shares_update_owner" ON public.user_account_shares;
CREATE POLICY "user_account_shares_update_owner"
    ON public.user_account_shares
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_user_id)
    WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "user_account_shares_delete_owner" ON public.user_account_shares;
CREATE POLICY "user_account_shares_delete_owner"
    ON public.user_account_shares
    FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.tg_touch_user_account_shares_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_user_account_shares_updated_at ON public.user_account_shares;
CREATE TRIGGER trg_touch_user_account_shares_updated_at
BEFORE UPDATE ON public.user_account_shares
FOR EACH ROW
EXECUTE FUNCTION public.tg_touch_user_account_shares_updated_at();

