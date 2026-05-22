-- Migración: dt_date de DATE a TIMESTAMPTZ para almacenar hh:mm:ss ficticias (Ibercaja).
-- Revolut ya envía hora real. Sin esto, las hh:mm:ss de Ibercaja se truncarían.
-- Ejecutar en Supabase Dashboard > SQL Editor.

ALTER TABLE public.transactions
  ALTER COLUMN dt_date TYPE TIMESTAMPTZ
  USING dt_date::date + time '00:00:00' AT TIME ZONE 'UTC';
