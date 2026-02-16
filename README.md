# BankaAppTracker

Importa transacciones de **Ibercaja** desde archivos Excel a Supabase.

## Setup rápido

### 1. Crear proyecto en Supabase

1. Ve a https://supabase.com/
2. Crea un proyecto
3. Usuarios: auth.users (Manage > Users) – el registro/login ya los crea
4. **SQL Editor**: ejecuta `Backend/supabase_schema_v2.sql`  
   (Si tienes tablas antiguas, ejecuta antes los DROP del final del archivo)
5. **Settings > API**: URL, anon key, **service_role key**

### 2. Configurar Backend

```bash
cd Backend
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

Crea `Backend/.env`:
```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

- **SUPABASE_SERVICE_ROLE_KEY**: Project Settings > API > service_role (DB + validación de tokens)

### 3. Ejecutar

```bash
uvicorn app.main:app --reload
```

## API

### POST /upload
Sube un Excel de Ibercaja.

```bash
curl -X POST http://localhost:8000/upload -F "file=@movimientos.xlsx"
```

### GET /transactions
Lista las transacciones.

```bash
curl http://localhost:8000/transactions
```

## Formato Ibercaja

El parser espera el Excel exportado desde **Banca Digital > Consulta Movimientos > Exportar**.

Columnas detectadas:
- Fecha Operacion / Fecha Valor
- Concepto
- Descripción
- Importe
