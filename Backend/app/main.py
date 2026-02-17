"""
FastAPI Main Application
Application entry point for the Rubén Fitness Backend API
"""

import os
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routers.upload_extract_file import router as upload_router
from app.api.routers.get_transactions import router as get_router
from app.api.services.supabase.supabase_service import supabase_service

# Initialize FastAPI app
app = FastAPI(
    title="BANK_APP_TRAKER",
    description="Backend API for Bank Account Transaction Tracking",
    version="1.0.0"
)

# Configure CORS to allow frontend requests
# In development, use explicit origins; in production, allow all origins
cors_origins = settings.CORS_ORIGINS

# Check if we're in production
is_production = os.getenv("ENVIRONMENT") == "production" or os.getenv("ENV") == "production"

if is_production:
    # In production, allow all origins for easier deployment
    cors_origins = ["*"]
    # CRITICAL: allow_credentials=True + "*" is INVALID per CORS spec - browser rejects response
    # We use Bearer token (no cookies), so credentials=False is fine
    cors_credentials = False
    print(f"[CORS] Production mode: origins=*, credentials=False")
else:
    cors_credentials = True
    print(f"[CORS] Development mode: origins={cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    """Test endpoint para diagnosticar Render vs local.
    Usar: GET https://tu-backend.onrender.com/test"""
    supabase_ok = supabase_service.is_connected()
    uses_sr = supabase_service.uses_service_role() if hasattr(supabase_service, "uses_service_role") else None
    return {
        "status": "ok",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "supabase_connected": supabase_ok,
        "supabase_uses_service_role": uses_sr,
        "hint": "Si uses_service_role=false en Render, añade SUPABASE_SERVICE_ROLE_KEY en Environment" if (supabase_ok and uses_sr is False) else None,
        "timestamp": datetime.now().isoformat(),
    }


