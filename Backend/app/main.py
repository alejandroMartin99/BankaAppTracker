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
    # This allows requests from any Vercel deployment (production, preview, etc.)
    cors_origins = ["*"]
    print(f"[CORS] Production mode: Allowing all origins")
else:
    print(f"[CORS] Development mode: Allowing origins: {cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(upload_router)
app.include_router(get_router)

@app.get("/")
async def root():
    """Root endpoint health check"""
    return {
        "message": "BANK_APP_TRAKER",
        "status": "running",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.get("/test")
async def test():
    """Test endpoint for debugging and verification"""
    return {
        "status": "ok",
        "message": "Backend is working correctly",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "cors_origins": cors_origins if not is_production else ["*"],
        "supabase_connected": supabase_service.is_connected() if hasattr(supabase_service, 'is_connected') else False,
        "timestamp": datetime.now().isoformat()
    }


