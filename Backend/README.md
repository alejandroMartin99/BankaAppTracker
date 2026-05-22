# Backend técnico (FastAPI)

Backend API de BankaAppTracker. Gestiona autenticación, importación de extractos, consultas de transacciones, inversión y simulación hipotecaria.

## Stack

- Python + FastAPI
- Supabase Python client
- yfinance (series de inversión)
- pandas/openpyxl (ingesta de ficheros)

Dependencias: `requirements.txt`.

## Estructura relevante

```text
Backend/
├── app/
│   ├── main.py
│   ├── core/config.py
│   ├── api/
│   │   ├── deps.py
│   │   ├── routers/
│   │   │   ├── get_transactions.py
│   │   │   ├── upload_extract_file.py
│   │   │   └── investment.py
│   │   └── services/
│   │       ├── supabase/supabase_service.py
│   │       ├── pipe_extract_transactions/
│   │       ├── investment_benchmarks.py
│   │       ├── investment_fund_detail.py
│   │       └── account_config.py
├── requirements.txt
└── scripts/
```

## Configuración (`.env`)

Crear `Backend/.env`:

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Variables adicionales importantes:

- `CORS_ORIGINS` (CSV de orígenes permitidos)
- `APP_URL` (URL pública backend)
- `KEEP_ALIVE_INTERVAL_SECONDS`
- `INVESTMENT_BENCHMARK_REFRESH_HOUR` (hora diaria del refresco de benchmarks)
- `ENABLE_DIAGNOSTIC_ENDPOINT` (`true/false`)

## Arranque local

```bash
cd Backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API en `http://localhost:8000`.

## Rutas clave

- `GET /health` - health check
- `GET /test` - diagnóstico (solo si está habilitado)
- `GET /GET/transactions` - listado de transacciones
- `POST /GET/upload-extract-file` - importación de extractos
- `GET /GET/investment/benchmarks` - benchmarks y rentabilidades
- `GET /GET/investment/fund-detail` - ficha ampliada de fondo
- `GET/POST/DELETE /GET/investment/funds` - watchlist del usuario

## Procesos en background

En `app/main.py`:

- Bucle keep-alive (si hay `APP_URL`).
- Refresco en app (opcional): `INVESTMENT_BENCHMARK_REFRESH_IN_APP` + `INVESTMENT_BENCHMARK_REFRESH_HOUR`.
- Refresco por API (gratis): `POST /GET/investment/refresh-benchmark-cache` con header `X-Cron-Secret` (= `BENCHMARK_CACHE_CRON_SECRET`). Programable con [cron-job.org](https://cron-job.org) o `.github/workflows/refresh-benchmark-cache.yml`.

## Scripts útiles

- Reconstruir caché de benchmarks:

```bash
cd Backend
venv\Scripts\python.exe scripts\rebuild_investment_benchmark_series_cache.py
venv\Scripts\python.exe scripts\rebuild_investment_benchmark_series_cache.py --full-rebuild
```

Cron en Render (`0 */8 * * *`): actualización sin vaciar tabla. Reconstrucción completa: añadir `--full-rebuild` al `startCommand` o ejecutar manualmente.

## Deploy (Render)

El repo incluye `render.yaml` en la raíz:
- `rootDir: Backend`
- `buildCommand: pip install -r requirements.txt`
- `startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Variables sensibles (`SUPABASE_*`) se configuran en el panel de Render.
