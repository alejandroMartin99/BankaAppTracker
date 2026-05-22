# Arquitectura — BankaAppTracker

Documento de referencia visual y trazabilidad end-to-end. Para detalle operativo por capa, ver los README enlazados al final.

---

## 1. Contexto del sistema (C4 — nivel 1)

```mermaid
C4Context
  title BankaAppTracker — Contexto

  Person(user, "Usuario", "Finanzas personales")
  System(app, "BankaAppTracker", "Web SPA + API")
  System_Ext(supabase, "Supabase", "Auth + PostgreSQL")
  System_Ext(yahoo, "Yahoo Finance", "Precios fondos vía yfinance")
  System_Ext(banks, "Bancos", "Extractos Excel")

  Rel(user, app, "HTTPS")
  Rel(app, supabase, "JWT + service role")
  Rel(app, yahoo, "Históricos NAV")
  Rel(user, banks, "Exporta Excel")
  Rel(user, app, "Sube extracto")
```

---

## 2. Contenedores (despliegue)

```mermaid
flowchart TB
  subgraph Vercel["Vercel"]
    FE["Angular SPA<br/>Frontend/banka-app"]
  end

  subgraph Render["Render Free"]
    BE["FastAPI<br/>Backend/app"]
  end

  subgraph SupabaseCloud["Supabase Cloud"]
    AUTH["Auth"]
    PG[(PostgreSQL + RLS)]
  end

  subgraph External["Externo"]
    YF["yfinance / Yahoo"]
  end

  User((Usuario)) --> FE
  FE -->|"REST + Bearer JWT"| BE
  FE --> AUTH
  BE --> AUTH
  BE -->|"Service role"| PG
  BE --> YF
```

| Contenedor | Repo | URL prod (habitual) |
|------------|------|---------------------|
| SPA | `Frontend/banka-app` | `https://banka-app-tracker.vercel.app` |
| API | `Backend/` | `https://bankaapptracker.onrender.com` |
| Datos | `Backend/supabase/sql/` | Panel Supabase |

---

## 3. Módulos backend

```mermaid
flowchart TB
  subgraph Entry["app/main.py"]
    LIFE["lifespan<br/>keep-alive · refresh cache"]
    CORS["CORS + security headers"]
  end

  subgraph Routers["api/routers"]
    UP["upload_extract_file"]
    GT["get_transactions"]
    INV["investment"]
  end

  subgraph Services["api/services"]
    PIPE["pipe_extract_transactions"]
    SB["supabase_service"]
    IB["investment_benchmarks"]
    IFD["investment_fund_detail"]
  end

  LIFE --> Routers
  CORS --> Routers
  UP --> PIPE --> SB
  GT --> SB
  INV --> IB & IFD --> SB
  LIFE --> IB
```

---

## 4. Módulos frontend

```mermaid
flowchart LR
  subgraph Routes["app.routes.ts"]
    G["/gastos"]
    R["/resumen"]
    C["/charts"]
    I["/inversion"]
    H["/hipotecas"]
    SE["/gastos-compartidos"]
    A["/ajustes"]
  end

  subgraph Services
    TS["TransactionService"]
    IS["InvestmentService"]
    AS["AuthService"]
  end

  G & R & C & SE & H --> TS
  I --> IS
  G & R & C & I & H & A --> AS
```

---

## 5. Flujo de datos — importación extracto

```mermaid
sequenceDiagram
  autonumber
  participant U as Usuario
  participant FE as Angular
  participant API as POST /upload/Transactions
  participant P as pipe_extract_transactions
  participant DB as PostgreSQL

  U->>FE: Selecciona Excel
  FE->>API: multipart + JWT
  API->>P: decode (ibercaja/revolut/pluxee)
  P->>P: category_rules
  P->>DB: upsert accounts · user_accounts · transactions
  DB-->>API: OK
  API-->>FE: resumen importación
  FE-->>U: Lista actualizada
```

**Tablas tocadas:** `accounts`, `user_accounts`, `transactions`.

---

## 6. Flujo de datos — inversión (lectura)

```mermaid
sequenceDiagram
  autonumber
  participant U as Usuario
  participant FE as InversionComponent
  participant API as GET /investment/benchmarks
  participant RAM as Caché RAM backend (TTL corto)
  participant DB as investment_benchmark_series_cache
  participant SL as investment-benchmark-slice.ts

  U->>FE: Abre /inversion · elige periodo
  FE->>API: JWT
  API->>RAM: miss/hit
  RAM->>DB: batch por ISIN
  DB-->>API: nav_bars ~5y
  API-->>FE: items + errors
  FE->>SL: sliceBenchmarksForPeriod(YTD…)
  SL-->>U: Gráfico + tabla métricas
```

**Tablas:** `user_investment_funds`, `investment_benchmark_series_cache` (global por `instrument_key`).

---

## 7. Refresco automático caché inversión

```mermaid
stateDiagram-v2
  [*] --> ColdStart: Render wake / deploy
  ColdStart --> Check: maybe_refresh(startup)
  Check --> Skip: updated_at < 8h
  Check --> Run: vacío o ≥ 8h
  Run --> Yahoo: run_refresh_investment_benchmark_cache
  Yahoo --> DB: upsert filas caché
  DB --> Warm: Proceso activo
  Skip --> Warm
  Warm --> Ping: keep-alive GET /health
  Ping --> Check2: maybe_refresh(keep-alive)
  Check2 --> Run
  Check2 --> Skip
```

| Disparador | Código |
|------------|--------|
| Arranque | `main.py` → `_benchmark_refresh_on_startup()` |
| Keep-alive | `_keep_alive_loop()` tras HTTP 200 |
| Decisión 8 h | `should_refresh_investment_benchmark_cache()` |
| Ejecución | `run_refresh_investment_benchmark_cache()` |

Variables: `INVESTMENT_BENCHMARK_REFRESH_INTERVAL_HOURS`, `INVESTMENT_BENCHMARK_REFRESH_IN_APP`.

---

## 8. Modelo de datos (resumen ER)

```mermaid
erDiagram
  AUTH_USERS ||--o{ USER_ACCOUNTS : ""
  ACCOUNTS ||--o{ USER_ACCOUNTS : ""
  ACCOUNTS ||--o{ TRANSACTIONS : ""

  AUTH_USERS ||--o| USER_SHARED_SETTINGS : ""
  AUTH_USERS ||--o| USER_MORTGAGE_SETTINGS : ""
  AUTH_USERS ||--o{ USER_MORTGAGE_RECEIPTS : ""
  AUTH_USERS ||--o{ USER_INVESTMENT_FUNDS : ""

  INVESTMENT_BENCHMARK_SERIES_CACHE {
    text instrument_key PK
    jsonb payload
    timestamptz updated_at
  }

  INVESTMENT_FUND_DETAIL_CACHE {
    text cache_key PK
    jsonb payload
  }
```

Scripts y orden: [`Backend/supabase/README.md`](../Backend/supabase/README.md).

---

## 9. Seguridad y confianza

```mermaid
flowchart LR
  subgraph Public["Público"]
    H["/health"]
  end

  subgraph Protected["JWT obligatorio"]
    API["/GET/* · /upload/*"]
  end

  subgraph Secrets["Solo servidor"]
    SR["SUPABASE_SERVICE_ROLE_KEY"]
  end

  Client["Angular anon key"] -->|"Login"| Auth["Supabase Auth"]
  Client -->|"Bearer"| Protected
  Protected --> SR
  SR --> DB[(PostgreSQL)]
```

| Superficie | Protección |
|------------|------------|
| API REST | `HTTPBearer` + `get_current_user` |
| PostgREST directo | RLS `authenticated` |
| Escritura masiva | Solo backend con service role |
| CORS | Lista blanca `CORS_ORIGINS` |

---

## 10. Matriz de trazabilidad completa

| # | Capacidad | UI | Servicio FE | Endpoint | Servicio BE | Tabla / caché |
|---|-----------|-----|-------------|----------|-------------|---------------|
| 1 | Login | `/login` | AuthService | Supabase Auth | — | `auth.users` |
| 2 | Listar movimientos | `/gastos` | TransactionService | `GET /GET/transactions` | supabase_service | `transactions` |
| 3 | Saldos | `/gastos`, `/resumen` | TransactionService | `GET /GET/balances` | supabase_service | `transactions` |
| 4 | Importar Excel | upload UI | TransactionService | `POST /upload/Transactions` | pipe_extract | `transactions`, `accounts` |
| 5 | Editar categoría | modales | TransactionService | `PATCH .../category` | supabase_service | `transactions` |
| 6 | Charts analítica | `/charts` | TransactionService | `GET /GET/transactions` | supabase_service | `transactions` |
| 7 | Gastos compartidos | `/gastos-compartidos` | TransactionService | `GET /GET/shared-transactions` | supabase_service | + settings |
| 8 | Benchmarks | `/inversion` | InvestmentService | `GET /GET/investment/benchmarks` | investment_benchmarks | `investment_benchmark_series_cache` |
| 9 | Watchlist ISIN | `/inversion` | InvestmentService | `GET/POST/DELETE .../funds` | investment_* | `user_investment_funds` |
| 10 | Ficha fondo | modal | InvestmentService | `GET .../fund-detail` | investment_fund_detail | `investment_fund_detail_cache` |
| 11 | Hipoteca | `/hipotecas` | TransactionService | `GET/PATCH /GET/mortgage*` | supabase_service | `user_mortgage_*` |
| 12 | Renombrar cuenta | `/ajustes` | TransactionService | `PATCH /GET/accounts/{id}` | supabase_service | `accounts` |

---

## 11. Pipeline CI/CD (conceptual)

```mermaid
flowchart LR
  GH["Git push main"] --> VR["Vercel build<br/>Frontend/banka-app"]
  GH --> RD["Render deploy<br/>Backend/"]
  VR --> CDN["CDN SPA"]
  RD --> API["API URL"]
  CDN --> User
  API --> User
```

| Rama | Frontend | Backend |
|------|----------|---------|
| `main` | Auto-deploy Vercel | Auto-deploy Render (`render.yaml`) |

---

## 12. Capturas de producto

Carpeta reservada: [`screenshots/`](screenshots/). Añadir PNG/WebP y referenciar desde el [README raíz](../README.md#capturas-de-producto).

Sugerencia de nombres:

| Archivo | Pantalla |
|---------|----------|
| `gastos.png` | Lista movimientos |
| `resumen.png` | KPIs categorías |
| `charts.png` | Analítica temporal |
| `inversion.png` | Gráfico benchmarks |
| `hipotecas.png` | Simulación hipoteca |

---

## Documentación relacionada

| Documento | Uso |
|-----------|-----|
| [README raíz](../README.md) | Producto e inicio rápido |
| [Backend/README.md](../Backend/README.md) | API, env, background jobs |
| [Backend/supabase/README.md](../Backend/supabase/README.md) | SQL, migraciones, RLS |
| [Frontend/README.md](../Frontend/README.md) | Angular, rutas, build |
| [docs/README.md](README.md) | Índice de esta carpeta |
