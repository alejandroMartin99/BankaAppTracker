"""
FastAPI Main Application
Application entry point for the Rubén Fitness Backend API
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
import httpx
from fastapi import FastAPI

logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.core.config import settings
from app.api.services.investment_benchmarks import maybe_refresh_investment_benchmark_cache
from app.api.routers.upload_extract_file import router as upload_router
from app.api.routers.get_transactions import router as get_router
from app.api.routers.investment import router as investment_router
from app.api.routers.recurring_payments import router as recurring_payments_router
from app.api.routers.auth_demo import router as auth_demo_router
from app.api.services.supabase.supabase_service import supabase_service

KEEP_ALIVE_TASK: asyncio.Task | None = None
BENCHMARK_WAKE_TASK: asyncio.Task | None = None


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
                logger.debug("[keep-alive] %02dh GET %s -> %s", now_hour, url, resp.status_code)
                if resp.status_code == 200:
                    await maybe_refresh_investment_benchmark_cache("keep-alive")
        except asyncio.CancelledError:
            logger.info("[keep-alive] detenido")
            break
        except Exception as e:
            logger.error("[keep-alive] error", exc_info=False)


async def _benchmark_refresh_on_startup() -> None:
    """Al arrancar/despertar la instancia (p. ej. Render tras inactividad)."""
    try:
        await maybe_refresh_investment_benchmark_cache("startup")
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.error("[benchmark-cache] error en startup", exc_info=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global KEEP_ALIVE_TASK, BENCHMARK_WAKE_TASK
    base_url = settings.APP_URL or os.getenv("RENDER_EXTERNAL_URL")
    if base_url:
        KEEP_ALIVE_TASK = asyncio.create_task(_keep_alive_loop())
        logger.info("[keep-alive] iniciado cada %ds -> %s/health", settings.KEEP_ALIVE_INTERVAL_SECONDS, base_url)
    if supabase_service.is_connected() and settings.INVESTMENT_BENCHMARK_REFRESH_IN_APP:
        BENCHMARK_WAKE_TASK = asyncio.create_task(_benchmark_refresh_on_startup())
        logger.info(
            "[benchmark-cache] al despertar, refresco si pasaron >= %.1fh desde el último en Supabase",
            settings.INVESTMENT_BENCHMARK_REFRESH_INTERVAL_HOURS,
        )
    elif supabase_service.is_connected():
        logger.info("[benchmark-cache] refresco automático desactivado (INVESTMENT_BENCHMARK_REFRESH_IN_APP=false)")
    yield
    if KEEP_ALIVE_TASK and not KEEP_ALIVE_TASK.done():
        KEEP_ALIVE_TASK.cancel()
        try:
            await KEEP_ALIVE_TASK
        except asyncio.CancelledError:
            pass
    if BENCHMARK_WAKE_TASK and not BENCHMARK_WAKE_TASK.done():
        BENCHMARK_WAKE_TASK.cancel()
        try:
            await BENCHMARK_WAKE_TASK
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
    logger.info("[CORS] CORS_ORIGINS vacío; usando http://localhost:4200")
cors_credentials = False
logger.info("[CORS] origins=%s", cors_origins)

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
app.include_router(investment_router)
app.include_router(recurring_payments_router)
app.include_router(auth_demo_router)

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
    """Diagnóstico: solo en desarrollo."""
    from fastapi import HTTPException
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not found")

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


