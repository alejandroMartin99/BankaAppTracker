"""
Application Configuration
Centralized configuration management using Pydantic Settings
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, AliasChoices
from typing import List

# .env en Backend/ (junto a app/)
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH) if _ENV_PATH.exists() else None,
        case_sensitive=True,
        extra="ignore"
    )
    
    # Application
    APP_NAME: str = "Rubén Fitness API"
    DEBUG: bool = False
    
    # CORS - el middleware hace match EXACTO (no soporta *.vercel.app)
    # In production (ENVIRONMENT=production) se usa ["*"] en main.py
    # Añade tu URL de Vercel si usas otra distinta
    CORS_ORIGINS: List[str] = [
        "http://localhost:4200",
        "http://localhost:3000",
        "https://banka-app-tracker.vercel.app",  # Producción Vercel (match exacto)
    ]
    
    # Supabase Configuration
    SUPABASE_URL: str = "https://eowsozcqryodxtpsduab.supabase.co"
    SUPABASE_KEY: str = Field(
        default="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvd3NvemNxcnlvZHh0cHNkdWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMjIyODIsImV4cCI6MjA4Mzg5ODI4Mn0.vfl0o9mgHtyw0Q20fPLkH2U8xSngvUAge4MrzYvToso",
        validation_alias=AliasChoices("SUPABASE_KEY", "SUPABASE_ANON_KEY"),
    )
    # Service Role Key: bypassa RLS y valida tokens. Project Settings -> API -> service_role
    SUPABASE_SERVICE_ROLE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    )
    
    # OpenAI Configuration
    OPENAI_API_KEY: str = ""
    
    # Firebase Configuration
    FIREBASE_CREDENTIALS_PATH: str = ""
    
    # Database (if needed separately)
    DATABASE_URL: str = ""


# Global settings instance
settings = Settings()


