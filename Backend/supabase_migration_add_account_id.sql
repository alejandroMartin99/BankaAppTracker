-- =============================================
-- Migración: añade account_id a transactions (sin modificar columnas existentes)
-- =============================================
-- Ejecutar en Supabase Dashboard > SQL Editor
-- Requiere que exista la tabla transactions con el esquema actual.

-- 1. Tabla accounts (si no existe)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stable_key VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    source VARCHAR(20) NOT NULL DEFAULT 'ibercaja',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla user_accounts (si no existe)
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_id)
);

-- 3. Añadir SOLO la columna account_id a transactions (no se modifica ninguna existente)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- 4. Índice para filtrar por account_id
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
