# BankaAppTracker

Importa transacciones de **Ibercaja** y **Revolut** desde Excel/CSV a Supabase. Frontend Angular + Backend FastAPI.

---

## Estructura del repo

```
BankaAppTracker/
├── Backend/           ← FastAPI (root para Render)
├── Frontend/
│   └── banka-app/     ← Angular (root para Vercel)
├── render.yaml        ← Config Backend en Render
└── README.md
```

---

## 1. Supabase

### Crear proyecto

1. [supabase.com](https://supabase.com) → New Project
2. **SQL Editor** → ejecuta `Backend/supabase_schema_v2.sql`
   - Si tienes tablas antiguas, ejecuta primero los `DROP` del final del archivo

### Keys necesarias

- **Settings > API**: `Project URL`, `anon` key, **`service_role`** key (secreto)

---

## 2. Desarrollo local

### Backend

```bash
cd Backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Crea `Backend/.env`:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

```bash
uvicorn app.main:app --reload
```

### Frontend

```bash
cd Frontend/banka-app
npm install
npm start
```

- Frontend: http://localhost:4200  
- Backend: http://localhost:8000

---

## 3. Deploy Backend (Render)

1. [render.com](https://render.com) → **New** → **Web Service**
2. Conecta el repo de GitHub (BankaAppTracker)
3. Render detecta `render.yaml` en la raíz. Si no:
   - **Root Directory**: `Backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

4. **Environment** → Añade estas variables (las de Supabase no están en el repo):
   | Key | Value |
   |-----|-------|
   | `ENVIRONMENT` | `production` |
   | `SUPABASE_URL` | Tu Project URL |
   | `SUPABASE_ANON_KEY` | Tu anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Tu service_role key |

5. **Save** → Render hace deploy. URL: `https://bankaapptracker.onrender.com`

6. Comprueba: `https://bankaapptracker.onrender.com/test` → debe devolver `"environment": "production"`

---

## 4. Deploy Frontend (Vercel)

1. [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Importa el repo de GitHub (BankaAppTracker)

3. **Configure Project**:
   - **Root Directory**: `Frontend/banka-app` (obligatorio; el Angular está ahí)
   - **Framework Preset**: Angular (auto-detecta)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist/banka-app` (Angular 18 puede usar `dist/banka-app/browser`)
   - **Install Command**: `npm ci` o `npm install`

   El `vercel.json` en `Frontend/banka-app` configura el fallback SPA para rutas como `/gastos`, `/resumen`.

4. **Environment Variables**: No necesitas ninguna (la URL del API va en `environment.prod.ts` en el código)

5. **Deploy**

6. Tras el deploy, actualiza **Supabase** → Authentication → URL Configuration:
   - **Site URL**: `https://tu-app.vercel.app` (tu URL real)
   - **Redirect URLs**: `https://tu-app.vercel.app/**`, `https://*.vercel.app/**`, `http://localhost:4200/**`

7. En `Frontend/banka-app/src/environment.prod.ts` debe estar la URL del backend:
   ```typescript
   apiUrl: 'https://bankaapptracker.onrender.com'
   ```
   Haz commit y push para que el próximo deploy use esa URL.

---

## 5. Resumen de URLs

| Dónde | URL |
|-------|-----|
| Backend Render | `https://bankaapptracker.onrender.com` |
| Frontend Vercel | `https://banka-app-tracker.vercel.app` |
| Supabase Site URL | La URL del frontend en Vercel |

---

## 6. Troubleshooting

### CORS bloquea las peticiones

- Backend: `ENVIRONMENT=production` en Render (obligatorio para CORS con `*`).
- Comprueba: `https://bankaapptracker.onrender.com/test` → `"environment": "production"`.

### "Token inválido" o 401

- Supabase Redirect URLs: añade la URL de Vercel.
- Si usas otra URL de frontend, añádela a Redirect URLs.

### Inserciones fallan (RLS)

- Asegúrate de tener `SUPABASE_SERVICE_ROLE_KEY` en Render.
- `/test` debe mostrar `"supabase_uses_service_role": true`.

### Backend dormido (Render free)

- La primera petición puede tardar ~30 s en responder.
- Considera un plan de pago para evitar cold starts.
