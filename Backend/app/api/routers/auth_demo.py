"""Acceso demo: sesión Supabase para cuenta compartida (credenciales solo en servidor)."""

from typing import Any, Dict

import httpx
from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter(prefix="/GET", tags=["auth"])


def _demo_configured() -> bool:
    return bool(
        settings.DEMO_LOGIN_ENABLED
        and settings.DEMO_USER_EMAIL.strip()
        and settings.DEMO_USER_PASSWORD
    )


@router.get("/auth/demo-available", summary="¿Modo demo disponible?")
async def demo_available() -> Dict[str, Any]:
    return {"available": _demo_configured()}


@router.post("/auth/demo-session", summary="Iniciar sesión como usuario demo")
async def demo_session() -> Dict[str, Any]:
    if not _demo_configured():
        raise HTTPException(status_code=503, detail="Modo demo no configurado en el servidor")

    base = (settings.SUPABASE_URL or "").rstrip("/")
    anon = settings.SUPABASE_KEY
    if not base or not anon:
        raise HTTPException(status_code=503, detail="Supabase no configurado")

    url = f"{base}/auth/v1/token?grant_type=password"
    email = settings.DEMO_USER_EMAIL.strip()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                json={"email": email, "password": settings.DEMO_USER_PASSWORD},
                headers={"apikey": anon, "Content-Type": "application/json"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="Error de conexión con Supabase") from e

    if resp.status_code >= 400:
        detail = "Credenciales demo inválidas"
        try:
            body = resp.json()
            if isinstance(body, dict) and body.get("error_description"):
                detail = str(body["error_description"])
            elif isinstance(body, dict) and body.get("msg"):
                detail = str(body["msg"])
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    if not access or not refresh:
        raise HTTPException(status_code=502, detail="Respuesta de sesión demo incompleta")

    return {
        "success": True,
        "access_token": access,
        "refresh_token": refresh,
        "expires_in": data.get("expires_in"),
    }
