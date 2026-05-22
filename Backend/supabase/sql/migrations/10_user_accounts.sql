-- =============================================
-- BANKAAPPTRACKER - Cuentas por usuario (upload = tu cuenta)
-- =============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- user_id = Supabase auth.users.id
-- Nota: Las transacciones antiguas sin account_identifier no se mostrarán hasta re-subir extractos.

-- Tabla: qué cuentas tiene cada usuario (se crea al subir un extracto)
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id UUID NOT NULL,
    account_identifier VARCHAR(50) NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'ibercaja',
    display_name VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_identifier)
);

-- Añadir account_identifier a transactions para filtrar por usuario
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_identifier VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_transactions_account_identifier ON transactions(account_identifier);

-- Comentario: account_identifier = "ibercaja_716552" | "ibercaja_716650" | "revolut"
