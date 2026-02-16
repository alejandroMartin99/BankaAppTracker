-- =============================================
-- BANKAAPPTRACKER v2 - Schema limpio
-- =============================================
-- Ejecutar en Supabase Dashboard > SQL Editor
-- Los usuarios se gestionan en auth.users (Manage > Users). Este schema es solo para cuentas y transacciones.

-- 1. Cuentas: identificador único (UUID), no el nombre mostrado (el usuario puede personalizarlo luego)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stable_key VARCHAR(50) UNIQUE NOT NULL,  -- "ibercaja_716552" | "revolut"
    display_name VARCHAR(100),               -- nombre mostrado, editable por el usuario
    source VARCHAR(20) NOT NULL DEFAULT 'ibercaja',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Vinculación usuario-cuenta (se crea al subir un extracto)
-- user_id = auth.users.id (Manage > Users)
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_id)
);

-- 3. Transacciones (compatible con pipe existente)
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    dt_date DATE NOT NULL,
    importe DECIMAL(12, 2) NOT NULL,
    saldo DECIMAL(12, 2),
    cuenta VARCHAR(100),          -- nombre mostrado en la transacción (puede venir del extracto)
    descripcion TEXT,
    categoria VARCHAR(50),
    subcategoria VARCHAR(100),
    bizum_mensaje TEXT,
    referencia VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_dt_date ON transactions(dt_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_transaction_id ON transactions(transaction_id);

-- =============================================
-- EMPEZAR DESDE CERO (si ya tienes tablas antiguas):
-- Ejecuta primero esto, luego el script de arriba:
--
--   DROP TABLE IF EXISTS transactions CASCADE;
--   DROP TABLE IF EXISTS user_accounts CASCADE;
--   DROP TABLE IF EXISTS accounts CASCADE;
--   DROP TABLE IF EXISTS user_accounts CASCADE;  -- por si existe de migración anterior
--   ALTER TABLE transactions DROP COLUMN IF EXISTS account_identifier;
--   ALTER TABLE transactions DROP COLUMN IF EXISTS account_id;
--
-- Después ejecuta las CREATE TABLE de este archivo.
-- =============================================
