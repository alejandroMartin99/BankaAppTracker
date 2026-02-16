# BankaAppTracker

Importa transacciones de **Ibercaja** desde archivos Excel a Supabase.

## Setup rápido

### 1. Crear proyecto en Supabase

1. Ve a https://supabase.com/
2. Crea un proyecto
3. Ve a **SQL Editor** y ejecuta en orden: `supabase_schema.sql` y `supabase_migration_user_accounts.sql`
4. Ve a **Settings > API** y copia URL, anon key y JWT Secret

### 2. Configurar

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

Crea `.env`:
```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-anon-key
# Para auth con Supabase (login), añade el JWT Secret: Project Settings -> API -> JWT Secret
SUPABASE_JWT_SECRET=tu-jwt-secret
```

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
