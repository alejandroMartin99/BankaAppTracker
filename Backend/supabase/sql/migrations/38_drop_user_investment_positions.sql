-- Rollback: cartera MyInvestor (posiciones importadas PDF/XLSX)
-- Ejecutar en Supabase → SQL Editor

DROP POLICY IF EXISTS "user_investment_positions_delete_own" ON public.user_investment_positions;
DROP POLICY IF EXISTS "user_investment_positions_insert_own" ON public.user_investment_positions;
DROP POLICY IF EXISTS "user_investment_positions_select_own" ON public.user_investment_positions;

DROP TABLE IF EXISTS public.user_investment_positions;
