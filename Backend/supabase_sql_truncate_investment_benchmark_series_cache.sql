-- Ejecutar en Supabase → SQL Editor (service role no es necesario aquí; TRUNCATE requiere permisos DDL o ser owner).
-- Vacía la caché de series de benchmarks; después vuelve a llenar con:
--   python scripts/rebuild_investment_benchmark_series_cache.py --full-rebuild
--   (desde la carpeta Backend, con .env y venv activos)

TRUNCATE TABLE public.investment_benchmark_series_cache;
