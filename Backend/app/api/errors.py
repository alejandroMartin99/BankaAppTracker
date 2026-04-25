"""Errores HTTP sin filtrar detalles internos al cliente."""

import logging
from fastapi import HTTPException

logger = logging.getLogger(__name__)


def internal_server_error(exc: Exception, log_tag: str) -> HTTPException:
    logger.error("[%s] Error procesando solicitud", log_tag, exc_info=False)
    return HTTPException(status_code=500, detail="Error interno del servidor")
