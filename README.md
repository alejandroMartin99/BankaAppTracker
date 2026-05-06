# BankaAppTracker

Gestión financiera personal avanzada para centralizar cuentas, analizar gastos, seguir inversiones y simular hipoteca en una sola app.

## Qué es BankaAppTracker

BankaAppTracker es una app web pensada para tener una visión completa de tu dinero:
- Importas movimientos desde extractos (Ibercaja, Revolut, Pluxee y otros formatos compatibles).
- Obtienes análisis por categorías, subcategorías y cuentas.
- Visualizas evolución histórica de saldos y tendencias.
- Gestionas cartera de inversión y comparativas de rentabilidad.
- Simulas estrategias hipotecarias (amortizar capital vs invertir el extra).
- Trabajas con modo claro/oscuro y opciones de privacidad de saldos.

## Lo que puedes hacer en la app

### Resumen financiero inmediato
- Totales de gastos, ingresos y balance por periodo.
- Desglose por categorías y subcategorías con detalle de movimientos.
- Edición rápida de movimientos (fecha, descripción, categoría, subcategoría).

### Vista de movimientos (`Gastos`)
- Filtros temporales rápidos y rango personalizado.
- Saldo y métricas por cuenta.
- Lista de transacciones agrupadas por día.
- Badges por cuenta y soporte de iconos por categoría/subcategoría/marca.

### Analítica avanzada (`Charts`)
- Gastos e ingresos por mes.
- Evolución histórica de saldo por cuenta con línea de tendencia.
- Drill-down por categoría y subcategoría.
- Tablas analíticas para comparar último mes vs media.

### Gestión de inversión (`Inversión`)
- Curvas de benchmark por fondos/activos.
- Métricas clave: rentabilidad, volatilidad, drawdown.
- Seguimiento por clasificación (renta fija, variable, monetarios, sectores, cripto).
- Caché de series para rendimiento y estabilidad.

### Hipoteca y simulaciones (`Hipotecas`)
- Cuadro de amortización y curva de capital/intereses.
- Simulación de aportaciones extra a capital.
- Simulación alternativa invirtiendo el extra en fondo.
- Comparativas de tiempo total, intereses y coste final.

### Perfil y experiencia
- Renombrado de cuentas vinculadas.
- Control de privacidad para ocultar importes.
- Modo oscuro persistido por usuario.

## Capturas (opcional)

Si quieres convertir este README en una landing completa, puedes añadir capturas en `docs/screenshots/` y referenciarlas aquí:

```md
![Resumen](docs/screenshots/resumen.png)
![Charts](docs/screenshots/charts.png)
![Inversión](docs/screenshots/inversion.png)
![Hipotecas](docs/screenshots/hipotecas.png)
```

## Arquitectura del proyecto

```text
BankaAppTracker/
├── Backend/                # API FastAPI + lógica de negocio + Supabase
├── Frontend/
│   └── banka-app/          # App Angular (SPA)
├── render.yaml             # Deploy backend en Render
└── README.md
```

## Enlaces técnicos

- Backend técnico: [`Backend/README.md`](Backend/README.md)
- Frontend técnico: [`Frontend/README.md`](Frontend/README.md)

## Stack

- Frontend: Angular 18 + SCSS + Supabase Auth
- Backend: FastAPI + Supabase + yfinance
- Base de datos: Supabase (PostgreSQL + políticas)
- Deploy: Vercel (frontend) + Render (backend)
