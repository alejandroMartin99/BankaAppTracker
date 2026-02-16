# Configuración Supabase - BankaAppTracker

## Resumen

- **Usuarios**: Se gestionan en auth.users (Supabase Manage > Users). El registro/login del frontend ya los crea.
- **Cuentas y transacciones**: Se guardan en tablas propias. Cuando un usuario sube un extracto, se extrae su `user_id` (auth) y la cuenta del extracto, y se vincula en `user_accounts`.

## Paso 1: Ejecutar el schema en Supabase

1. Abre **Supabase Dashboard** > **SQL Editor**
2. Si ya tienes tablas antiguas (`transactions`, `user_accounts`, `accounts`), ejecuta primero:

```sql
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS user_accounts CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
```

3. Ejecuta el contenido completo de `supabase_schema_v2.sql`

## Paso 2: Variables de entorno (.env)

En `Backend/.env`:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

| Variable | Dónde encontrarla |
|----------|-------------------|
| SUPABASE_URL | Project Settings > API > Project URL |
| SUPABASE_ANON_KEY | Project Settings > API > anon public |
| SUPABASE_SERVICE_ROLE_KEY | Project Settings > API > **service_role** (secret) |

La service_role key se usa para la conexión a la base de datos y para validar tokens de usuario.

## Paso 3: Reiniciar el backend

```bash
cd Backend
uvicorn app.main:app --reload
```
