"""
Dependencies for API endpoints (auth, etc.)
"""

import logging
import secrets

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.api.services.supabase.supabase_service import supabase_service

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Valida el JWT de Supabase usando la API (service_role) y devuelve el payload del usuario."""
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token requerido",
        )
    if not supabase_service.supabase:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio no disponible",
        )
    try:
        r = supabase_service.supabase.auth.get_user(cred.credentials)
        user = r.user
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido",
            )
        return {"sub": str(user.id), "email": user.email}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Auth get_user failed: %s: %s", type(e).__name__, e, exc_info=settings.DEBUG)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
        )


def verify_benchmark_cache_cron_secret(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> None:
    """Protege el refresco programado de caché (sin JWT; solo quien conoce el secreto)."""
    expected = (settings.BENCHMARK_CACHE_CRON_SECRET or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Refresco por API no configurado (falta BENCHMARK_CACHE_CRON_SECRET en el servidor).",
        )
    if not x_cron_secret or not secrets.compare_digest(x_cron_secret.strip(), expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Cron-Secret inválido",
        )
