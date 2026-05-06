# Frontend técnico (Angular)

Frontend SPA de BankaAppTracker desarrollado con Angular 18.

## Stack

- Angular 18 (standalone components)
- RxJS
- SCSS
- Supabase JS (`@supabase/supabase-js`)

Proyecto app: `Frontend/banka-app`.

## Estructura relevante

```text
Frontend/banka-app/
├── src/
│   ├── app/
│   │   ├── layout/
│   │   ├── pages/
│   │   │   ├── resumen/
│   │   │   ├── gastos/
│   │   │   ├── charts/
│   │   │   ├── inversion/
│   │   │   ├── hipotecas/
│   │   │   ├── ajustes/
│   │   │   └── shared-expenses/
│   │   ├── services/
│   │   └── utils/
│   ├── styles.scss
│   └── environment*.ts
├── scripts/download-all-icons.js
└── package.json
```

## Scripts npm

Desde `Frontend/banka-app`:

```bash
npm install
npm start
```

Scripts disponibles:

- `npm start` - desarrollo (`ng serve`)
- `npm run build` - build producción
- `npm run watch` - build watch
- `npm test` - tests Angular
- `npm run icons` - descarga/actualiza set local de iconos

## Configuración de entorno

Revisar:

- `src/environment.ts`
- `src/environment.prod.ts`

Valores críticos:
- `apiUrl` (backend FastAPI)
- `supabaseUrl`
- `supabaseAnonKey`

## UI/UX y theming

- Tema global por variables CSS en `src/styles.scss`.
- Soporta modo oscuro mediante clase global (`theme-dark`) aplicada en root.
- Preferencia de tema persistida por usuario (metadata de Supabase) y fallback local.

## Módulos/páginas principales

- `Resumen`: KPIs por periodo, categorías y subcategorías.
- `Gastos`: listado detallado y balances por cuenta.
- `Charts`: analítica temporal y tendencias.
- `Inversión`: benchmarks, métricas y comparación de fondos.
- `Hipotecas`: amortización y simulaciones.
- `Ajustes`: configuración y operaciones de mantenimiento.

## Build y deploy

Deploy objetivo: Vercel con root `Frontend/banka-app`.

Parámetros típicos:
- Build command: `npm run build`
- Output: `dist/banka-app` (o `dist/banka-app/browser` según config Angular)
