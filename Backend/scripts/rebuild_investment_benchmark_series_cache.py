"""
Vacía public.investment_benchmark_series_cache y vuelve a descargar Yahoo → Supabase.

Uso (desde la carpeta Backend):
  .\\venv\\Scripts\\python.exe scripts\\rebuild_investment_benchmark_series_cache.py

Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_KEY) en el entorno / .env.
"""

from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main() -> None:
    from app.api.services.investment_benchmarks import run_refresh_investment_benchmark_cache
    from app.api.services.supabase.supabase_service import supabase_service

    if not supabase_service.is_connected():
        print("Supabase no conectado: revisa SUPABASE_URL y clave en .env")
        sys.exit(1)
    n = supabase_service.clear_investment_benchmark_series_cache()
    print(f"Filas borradas (claves): {n}")
    print("Descargando yfinance y escribiendo caché…")
    run_refresh_investment_benchmark_cache()
    print("Listo.")


if __name__ == "__main__":
    main()
