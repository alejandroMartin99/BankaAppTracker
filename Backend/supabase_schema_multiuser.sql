-- =============================================
-- BANKAAPPTRACKER - Schema multi-usuario (primera aproximación)
-- =============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- Compatible con schema existente. Añade tablas para auth y ownership.

-- Usuarios (para registro/login futuro)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas bancarias (parametrizadas, vinculadas a config/accounts.yaml)
-- identifier: sufijo IBAN (ej. 716552) o 'revolut' para Revolut
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier VARCHAR(20) NOT NULL,
    name VARCHAR(50) NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'ibercaja',
    is_shared BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(identifier, source)
);

-- Quién puede ver cada cuenta (para cuentas shared, varios usuarios)
CREATE TABLE IF NOT EXISTS account_owners (
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (account_id, user_id)
);

-- Añadir user_id a transactions (opcional, para saber quién subió)
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id);

-- Añadir account_slug a transactions para filtrar por ownership
-- account_slug: 'ibercaja_716552', 'ibercaja_716650', 'revolut'
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_slug VARCHAR(50);
-- CREATE INDEX IF NOT EXISTS idx_transactions_account_slug ON transactions(account_slug);

-- Datos iniciales (ejemplo - ajustar según config/accounts.yaml)
-- INSERT INTO accounts (identifier, name, source, is_shared) VALUES
--   ('716552', 'Conjunta', 'ibercaja', true),
--   ('716650', 'Personal', 'ibercaja', false),
--   ('default', 'Revolut', 'revolut', false)
-- ON CONFLICT DO NOTHING;
