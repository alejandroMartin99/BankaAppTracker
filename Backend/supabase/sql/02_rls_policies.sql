-- =============================================================================
-- Row Level Security (defensa en profundidad)
-- =============================================================================
-- El backend usa service_role y NO queda limitado por RLS.
-- Estas políticas protegen acceso directo a PostgREST con el JWT del usuario
-- (anon/authenticated), por ejemplo si alguien usa la API de Supabase desde el cliente.
--
-- Revisa nombres de esquema/tablas y ejecútalo en: Supabase → SQL Editor.
-- Storage (bucket avatars): configura políticas aparte en Storage → Policies.

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select_linked" ON public.transactions;
CREATE POLICY "transactions_select_linked"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT ua.account_id
      FROM public.user_accounts ua
      WHERE ua.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "accounts_select_linked" ON public.accounts;
CREATE POLICY "accounts_select_linked"
  ON public.accounts
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT ua.account_id
      FROM public.user_accounts ua
      WHERE ua.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "user_accounts_select_self" ON public.user_accounts;
CREATE POLICY "user_accounts_select_self"
  ON public.user_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Sin políticas de INSERT/UPDATE/DELETE para authenticated: el cliente no debe mutar
-- estas tablas directamente (lo hace el backend con service_role).
