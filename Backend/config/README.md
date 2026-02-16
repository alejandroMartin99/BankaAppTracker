# Configuración de cuentas

## Modelo actual: subir = tu cuenta

Cada usuario ve solo las transacciones de las cuentas cuyos extractos ha subido él mismo.
Al subir un extracto, esa cuenta se asocia automáticamente al usuario en `user_accounts`.

## accounts.yaml (opcional)

Solo para **personalizar el nombre** que se muestra en Ibercaja. Si una cuenta no está en el yaml,
se usa "Cuenta XXXXXX" (últimos 6 dígitos del IBAN).

### Ibercaja
- **identifier**: últimos 6 dígitos del IBAN (ej. 716552, 716650)
- **name**: nombre mostrado (Conjunta, Personal, etc.)

### Revolut
- **default_name**: nombre para extractos Revolut (por defecto "Revolut")
