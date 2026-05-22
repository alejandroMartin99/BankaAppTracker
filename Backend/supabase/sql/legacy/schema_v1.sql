-- =============================================
-- BANKAAPPTRACKER - Schema con categorización
-- =============================================
-- Ejecutar en: Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE NOT NULL,
    account_number VARCHAR(50),
    amount DECIMAL(12, 2) NOT NULL,
    balance DECIMAL(12, 2),        -- saldo tras la operación
    currency VARCHAR(3) DEFAULT 'EUR',
    concept VARCHAR(100),          -- concepto (TARJETA VISA, BIZUM, etc.)
    description TEXT,              -- descripción completa
    transaction_date DATE NOT NULL,
    bank_type VARCHAR(20) DEFAULT 'ibercaja',
    -- Categorización
    category VARCHAR(50),
    subcategory VARCHAR(100),
    transaction_type VARCHAR(10),  -- 'ingreso' o 'gasto'
    -- Datos Bizum
    bizum_message TEXT,           -- mensaje del bizum (contacto va en subcategory)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);

-- Si ya tienes la tabla, añade las columnas nuevas:
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance DECIMAL(12, 2);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS concept VARCHAR(100);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category VARCHAR(50);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(10);
-- ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bizum_message TEXT;
