"""
FastAPI Main Application
Application entry point for the Rubén Fitness Backend API
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.core.config import settings
from app.api.routers.upload_extract_file import router as upload_router
from app.api.routers.get_transactions import router as get_router
from app.api.services.supabase.supabase_service import supabase_service

KEEP_ALIVE_TASK: asyncio.Task | None = None


async def _keep_alive_loop() -> None:
    """Cada N minutos hace GET a la URL pública del backend para que Render no apague la instancia."""
    base_url = (settings.APP_URL or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
    if not base_url:
        return
    interval = max(60, settings.KEEP_ALIVE_INTERVAL_SECONDS)
    url = f"{base_url}/health"
    while True:
        try:
            await asyncio.sleep(interval)
            # Solo mantener vivo entre las 08:00 y las 22:00 (hora del servidor)
            now_hour = datetime.now().hour
            if not (8 <= now_hour < 22):
                continue
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                print(f"[keep-alive] {now_hour:02d}h GET {url} -> {resp.status_code}")
        except asyncio.CancelledError:
            print("[keep-alive] detenido")
            break
        except Exception as e:
            print(f"[keep-alive] error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global KEEP_ALIVE_TASK
    base_url = settings.APP_URL or os.getenv("RENDER_EXTERNAL_URL")
    if base_url:
        KEEP_ALIVE_TASK = asyncio.create_task(_keep_alive_loop())
        print(f"[keep-alive] iniciado cada {settings.KEEP_ALIVE_INTERVAL_SECONDS}s -> {base_url}/health")
    yield
    if KEEP_ALIVE_TASK and not KEEP_ALIVE_TASK.done():
        KEEP_ALIVE_TASK.cancel()
        try:
            await KEEP_ALIVE_TASK
        except asyncio.CancelledError:
            pass


# Initialize FastAPI app
app = FastAPI(
    title="BANK_APP_TRAKER",
    description="Backend API for Bank Account Transaction Tracking",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: lista explícita siempre (añade previews en CORS_ORIGINS en Render/Vercel)
cors_origins = settings.cors_origins_list
if not cors_origins:
    cors_origins = ["http://localhost:4200"]
    print("[CORS] CORS_ORIGINS vacío; usando http://localhost:4200")
cors_credentials = False
print(f"[CORS] origins={cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# Include routers
app.include_router(upload_router)
app.include_router(get_router)

@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    """Root endpoint health check (HEAD para Render)"""
    return {
        "message": "BANK_APP_TRAKER",
        "status": "running",
        "version": "1.0.0"
    }


@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    """Health check endpoint (Render usa HEAD)"""
    return {"status": "healthy"}


@app.get("/test")
async def test():
    """Diagnóstico opcional; desactivado en producción salvo ENABLE_DIAGNOSTIC_ENDPOINT=true."""
    if not settings.ENABLE_DIAGNOSTIC_ENDPOINT:
        return {"status": "ok"}
    supabase_ok = supabase_service.is_connected()
    uses_sr = (
        supabase_service.uses_service_role()
        if hasattr(supabase_service, "uses_service_role")
        else None
    )
    return {
        "status": "ok",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "supabase_connected": supabase_ok,
        "supabase_uses_service_role": uses_sr,
        "hint": (
            "Si uses_service_role=false, configura SUPABASE_SERVICE_ROLE_KEY"
            if (supabase_ok and uses_sr is False)
            else None
        ),
        "timestamp": datetime.now().isoformat(),
    }


