"""
Dependencies for API endpoints (auth, etc.)
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

security = HTTPBearer(auto_error=False)


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Valida el JWT de Supabase y devuelve el payload del usuario."""
    if not settings.SUPABASE_JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth no configurado: añade SUPABASE_JWT_SECRET en .env (Supabase -> Project Settings -> API -> JWT Secret)",
        )
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token requerido",
        )
    try:
        payload = jwt.decode(
            cred.credentials,
            settings.SUPABASE_JWT_SECRET,
            audience="authenticated",
            algorithms=["HS256"],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
        )
