"""Errores HTTP sin filtrar detalles internos al cliente."""

import traceback
from fastapi import HTTPException


def internal_server_error(exc: Exception, log_tag: str) -> HTTPException:
    print(f"[ERROR] {log_tag}: {exc}")
    traceback.print_exc()
    return HTTPException(status_code=500, detail="Error interno del servidor")
