-- Serie histórica (nav / cierre) por ISIN o cripto para el gráfico de Inversión.
-- Se actualiza desde el backend (yfinance) cada ~2 h; el cliente recibe siempre el horizonte 5y y filtra el periodo en memoria.
-- Ejecutar en Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.investment_benchmark_series_cache (
    instrument_key TEXT PRIMARY KEY,
    yahoo_symbol TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_benchmark_series_cache_updated
    ON public.investment_benchmark_series_cache (updated_at DESC);

COMMENT ON TABLE public.investment_benchmark_series_cache IS 'Cierre histórico (p. ej. 5y mensual) por IE00… o CRYPTO:BTC-USD; solo backend (service role)';

ALTER TABLE public.investment_benchmark_series_cache ENABLE ROW LEVEL SECURITY;
