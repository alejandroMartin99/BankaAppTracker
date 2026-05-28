-- Aisla cuentas globales Revolut/Pluxee por usuario y migra transacciones.
-- Ejecutar DESPUÉS de 35_user_account_shares.sql.

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- 1) Convertir cuentas multiusuario existentes en compartición explícita (compatibilidad).
  INSERT INTO public.user_account_shares (owner_user_id, viewer_user_id, account_id, can_view, can_edit, can_delete)
  SELECT ua1.user_id, ua2.user_id, ua1.account_id, TRUE, TRUE, TRUE
  FROM public.user_accounts ua1
  JOIN public.user_accounts ua2
    ON ua1.account_id = ua2.account_id
   AND ua1.user_id <> ua2.user_id
  JOIN public.accounts a
    ON a.id = ua1.account_id
  WHERE a.source IN ('ibercaja', 'santander')
  ON CONFLICT (owner_user_id, viewer_user_id, account_id) DO NOTHING;

  -- 2) Duplicar cuentas Revolut/Pluxee por usuario cuando la cuenta actual es global.
  --    Criterio: stable_key no contiene "__" y source en ('revolut','pluxee').
  CREATE TEMP TABLE tmp_account_user_map ON COMMIT DROP AS
  SELECT
    a.id AS old_account_id,
    ua.user_id,
    gen_random_uuid() AS new_account_id,
    a.source,
    a.display_name,
    a.stable_key AS old_stable_key,
    a.stable_key || '__' || replace(left(ua.user_id::text, 8), '-', '') AS new_stable_key
  FROM public.accounts a
  JOIN public.user_accounts ua
    ON ua.account_id = a.id
  WHERE a.source IN ('revolut', 'pluxee')
    AND position('__' in a.stable_key) = 0;

  INSERT INTO public.accounts (id, stable_key, display_name, source)
  SELECT m.new_account_id, m.new_stable_key, m.display_name, m.source
  FROM tmp_account_user_map m
  ON CONFLICT (stable_key) DO NOTHING;

  -- 3) Reasignar vínculos user_accounts a las cuentas nuevas por usuario.
  DELETE FROM public.user_accounts ua
  USING tmp_account_user_map m
  WHERE ua.account_id = m.old_account_id
    AND ua.user_id = m.user_id;

  INSERT INTO public.user_accounts (user_id, account_id)
  SELECT m.user_id, m.new_account_id
  FROM tmp_account_user_map m
  ON CONFLICT (user_id, account_id) DO NOTHING;

  -- 4) Copiar transacciones por usuario con account_id nuevo y transaction_id único.
  FOR rec IN
    SELECT old_account_id, user_id, new_account_id
    FROM tmp_account_user_map
  LOOP
    INSERT INTO public.transactions (
      transaction_id, account_id, dt_date, importe, saldo, cuenta, descripcion,
      categoria, subcategoria, bizum_mensaje, referencia, created_at
    )
    SELECT
      left(
        t.transaction_id || '_' || replace(left(rec.user_id::text, 8), '-', ''),
        64
      ) AS transaction_id,
      rec.new_account_id,
      t.dt_date, t.importe, t.saldo, t.cuenta, t.descripcion,
      t.categoria, t.subcategoria, t.bizum_mensaje, t.referencia, t.created_at
    FROM public.transactions t
    WHERE t.account_id = rec.old_account_id
    ON CONFLICT (transaction_id) DO NOTHING;
  END LOOP;

  -- 5) Eliminar transacciones antiguas de cuentas globales Revolut/Pluxee.
  DELETE FROM public.transactions t
  USING (
    SELECT DISTINCT old_account_id
    FROM tmp_account_user_map
  ) d
  WHERE t.account_id = d.old_account_id;

  -- 6) Limpiar user_account_shares de cuentas antiguas y borrar cuentas antiguas sin vínculos.
  DELETE FROM public.user_account_shares s
  USING (
    SELECT DISTINCT old_account_id
    FROM tmp_account_user_map
  ) d
  WHERE s.account_id = d.old_account_id;

  DELETE FROM public.accounts a
  USING (
    SELECT DISTINCT old_account_id
    FROM tmp_account_user_map
  ) d
  WHERE a.id = d.old_account_id
    AND NOT EXISTS (
      SELECT 1 FROM public.user_accounts ua WHERE ua.account_id = a.id
    );
END;
$$;

