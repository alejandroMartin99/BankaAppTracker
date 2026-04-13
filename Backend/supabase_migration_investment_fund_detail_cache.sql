-- Caché global de ficha ampliada de fondos (yfinance). Solo la escribe el backend (service role).
-- Ejecutar en Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.investment_fund_detail_cache (
    cache_key TEXT PRIMARY KEY,
    yahoo_symbol TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_fund_detail_cache_updated
    ON public.investment_fund_detail_cache (updated_at DESC);

COMMENT ON TABLE public.investment_fund_detail_cache IS 'Ficha enriquecida por ISIN o símbolo cripto; clave IE00… o CRYPTO:BTC-USD';

ALTER TABLE public.investment_fund_detail_cache ENABLE ROW LEVEL SECURITY;

-- Sin políticas para authenticated: solo backend con service_role escribe/lee.
-- Si en el futuro quieres lectura directa desde el cliente, añade SELECT para authenticated.
