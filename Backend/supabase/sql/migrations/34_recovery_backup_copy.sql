-- Crea schema recovery y función RPC para copiar solo transactions a backup.
-- Ejecutar en Supabase SQL Editor.

CREATE SCHEMA IF NOT EXISTS recovery;

CREATE TABLE IF NOT EXISTS recovery.transactions (LIKE public.transactions INCLUDING ALL);

CREATE OR REPLACE FUNCTION public.copy_public_transactions_to_recovery()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, recovery
AS $$
DECLARE
  result JSONB;
BEGIN
  TRUNCATE TABLE recovery.transactions;
  INSERT INTO recovery.transactions SELECT * FROM public.transactions;

  result := jsonb_build_object(
    'ok', true,
    'transactions', (SELECT COUNT(*) FROM recovery.transactions)
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.copy_public_transactions_to_recovery() FROM PUBLIC;
