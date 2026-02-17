# Desplegar Backend en Render

## 1. Conectar el repositorio

1. Entra en [render.com](https://render.com) e inicia sesión
2. **New** → **Web Service**
3. Conecta tu repositorio de GitHub (BankaAppTracker)
4. Render detectará el `render.yaml` automáticamente

## 2. Configurar variables de entorno

En el Dashboard de Render, ve a tu servicio → **Environment** y añade:

| Key | Valor |
|-----|-------|
| `SUPABASE_URL` | Tu URL de Supabase (Project Settings > API) |
| `SUPABASE_ANON_KEY` | Tu anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Tu service_role key |

`ENVIRONMENT=production` ya está definido en el Blueprint.

## 3. Desplegar

- **Auto Deploy**: Cada push a la rama principal desplegará automáticamente
- **Manual**: Usa **Manual Deploy** en el Dashboard

## 4. URL del API

Tras el despliegue, la API estará en:
```
https://bankaapp-backend.onrender.com
```

Endpoints:
- `GET /` - Health
- `GET /health` - Health check
- `GET /test` - **Diagnóstico**: indica si Supabase está conectado y si usa service_role
- `GET /GET/transactions` - Transacciones (requiere auth)
- `GET /GET/balances` - Saldos (requiere auth)
- `POST /upload/Transactions` - Subir extracto (requiere auth)

## 6. Si en local funciona pero en Render no

1. Abre `https://tu-backend.onrender.com/test`:
   - `supabase_connected: false` → falta `SUPABASE_URL` o las keys
   - `supabase_uses_service_role: false` → falta `SUPABASE_SERVICE_ROLE_KEY` (inserciones fallan por RLS)
2. Revisa los **Logs** en Render al subir un extracto: buscar `[Auth]` o `[Supabase]` para ver el error real
3. CORS: el backend usa `allow_credentials=False` en producción con `*` (requerido por la spec)

## 5. Frontend

En el frontend (Angular), actualiza `environment.prod.ts`:

```typescript
apiUrl: 'https://bankaapp-backend.onrender.com'
```

O la URL que te asigne Render si cambias el nombre del servicio.
